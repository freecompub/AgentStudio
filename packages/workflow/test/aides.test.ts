import { EnvFailureError } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import { agir, essayer } from "../src/aides.js";
import { Escalade, PanneEnvironnement, TourInterrompu } from "../src/erreurs.js";
import type { DeclarationWorkflow, W } from "../src/protocols.js";
import { fauxContexte, lancer, sortie } from "./faux-contexte.js";

/** `essayer` n'appelle `w` que par `fn` : un `w` vide suffit à le tester en code pur. */
const w = {} as W;

describe("essayer : budget d'essais appliqué par le code (D24)", () => {
  it("réussite au premier essai : fn appelée une fois, sans motif", async () => {
    const vus: (readonly string[])[] = [];
    await essayer(w, { max: 3 }, async (motifs) => (vus.push(motifs), []));
    expect(vus).toEqual([[]]);
  });

  it("les motifs d'un rejet passent à l'essai suivant", async () => {
    const vus: (readonly string[])[] = [];
    await essayer(w, { max: 3 }, async (motifs, essai) => (vus.push(motifs), essai === 1 ? ["ADR sans conséquences"] : []));
    expect(vus).toEqual([[], ["ADR sans conséquences"]]);
  });

  it("budget épuisé : Escalade avec les derniers motifs, après exactement max essais", async () => {
    let essais = 0;
    const r = await essayer(w, { max: 3 }, async (_m, essai) => (essais++, [`rejet ${essai}`])).catch((e: unknown) => e);
    expect(essais).toBe(3);
    expect(r).toBeInstanceOf(Escalade);
    expect((r as Escalade).motifs).toEqual(["rejet 3"]);
  });

  it("première revue garantie (ADR 0042) : un essai de plus, une seule fois", async () => {
    const issues = [["porte"], { motifs: ["défaut D-1"], revue: true as const }, { motifs: ["défaut D-2"], revue: true as const }];
    let essais = 0;
    const r = await essayer(w, { max: 2, premiereRevueGarantie: true }, async () => issues[essais++]!).catch((e: unknown) => e);
    expect(essais).toBe(3);
    expect((r as Escalade).motifs).toEqual(["défaut D-2"]);
  });

  it("essai garanti demandé par le script (arbitrage humain, ADR 0046) : un essai de plus, chaque fois qu'il le demande", async () => {
    let essais = 0;
    const r = await essayer(w, { max: 1 }, async () => {
      essais++;
      return { motifs: [`défaut ${essais}`], revue: true, garanti: essais < 3 };
    }).catch((e: unknown) => e);
    expect(essais).toBe(3);
    expect((r as Escalade).motifs).toEqual(["défaut 3"]);
  });

  it("sans l'option, la revue n'a pas d'essai garanti", async () => {
    let essais = 0;
    await essayer(w, { max: 2 }, async () => (essais++ === 0 ? ["porte"] : { motifs: ["défaut"], revue: true })).catch(() => undefined);
    expect(essais).toBe(2);
  });

  it("tour interrompu : compté comme un rejet, avec la consigne de reprendre sans recommencer", async () => {
    const vus: (readonly string[])[] = [];
    await essayer(w, { max: 3 }, async (motifs, essai) => {
      vus.push(motifs);
      if (essai === 1) throw new TourInterrompu("aucune activité depuis 300 s");
      return [];
    });
    expect(vus[1]![0]).toMatch(/interrompu \(aucune activité depuis 300 s\)/);
    expect(vus[1]![1]).toMatch(/ne recommence pas de zéro/);
  });

  it("panne d'environnement : remonte aussitôt, sans consommer d'essai (D25)", async () => {
    let essais = 0;
    const r = await essayer(w, { max: 3 }, async () => {
      essais++;
      throw new PanneEnvironnement("quota épuisé");
    }).catch((e: unknown) => e);
    expect(essais).toBe(1);
    expect(r).toBeInstanceOf(PanneEnvironnement);
  });
});

const decl = (script: (w: W) => Promise<unknown>): DeclarationWorkflow<never> => ({ nom: "test/aides", script, empreinte: "v1" });

describe("w.phase : checkpoint, commit, escalade (docs/09 §5.2)", () => {
  const phaseQuiEchoue = (w: W) =>
    w.phase(
      "DESIGN",
      () =>
        essayer(w, { max: 1 }, async () => {
          await w.agent("archi", "Conçois.");
          return ["porte cohérence"];
        }),
      { commit: "docs: DESIGN" },
    );

  it("la fonction de phase reçoit le checkpoint de la phase", async () => {
    const f = fauxContexte();
    const t = await lancer(decl((w) => w.phase("DESIGN", async (cp) => cp)), f.ctx);
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: "cp-1" } });
  });

  it("réussite : checkpoint à l'ouverture, commit à la fin, la phase est celle de la tâche", async () => {
    const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
    const t = await lancer(
      decl((w) => w.phase("DESIGN", async () => void (await w.agent("archi", "")), { commit: "docs: DESIGN" })),
      f.ctx,
    );
    expect(f.appels).toEqual(["checkpoint:DESIGN", "agent:archi", "commit:docs: DESIGN"]);
    expect((await t.record()).phase).toBe("DESIGN");
  });

  it("escalade : rembobine au checkpoint de la phase, fait oublier ses agents, demande quoi faire", async () => {
    const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
    const t = await lancer(decl(phaseQuiEchoue), f.ctx);
    expect(f.rembobinages).toEqual(["cp-1"]);
    expect(f.oublis).toEqual([["archi"]]);
    expect(f.demandes[0]!.title).toBe("Phase DESIGN : porte cohérence");
    expect(f.demandes[0]!.options.map((o) => o.label)).toEqual(["Relancer la phase", "Sauter la phase", "Abandonner la tâche"]);
    expect((await t.record()).status).toBe("waiting");
  });

  it("rembobinage : les livrables effacés sont archivés d'abord (ADR 0038), puis la phase reprépare ce qu'il faut", async () => {
    const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
    f.modifies["docs/conception.md"] = "brouillon";
    await lancer(
      decl((w) =>
        w.phase(
          "DESIGN",
          () =>
            essayer(w, { max: 1 }, async () => {
              await w.agent("archi", "");
              return ["porte"];
            }),
          { apresRembobinage: () => w.creerDossier(".skraft/design") },
        ),
      ),
      f.ctx,
    );
    expect(f.archives).toEqual([{ label: "DESIGN rembobinage", files: [{ path: "docs/conception.md", content: "brouillon" }] }]);
    const i = f.appels.indexOf("rollback:cp-1");
    expect(f.appels.slice(i, i + 2)).toEqual(["rollback:cp-1", "dossier:.skraft/design"]);
  });

  it("relancer : la phase repart, sans nouveau checkpoint ; sauter : la tâche continue sans elle", async () => {
    const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
    const t = await lancer(
      decl(async (w) => {
        await phaseQuiEchoue(w);
        return "après";
      }),
      f.ctx,
    );
    await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[0]!.id });
    await t.engine.idle(t.id);
    expect(f.appels.filter((a) => a === "agent:archi")).toHaveLength(2);
    expect(f.appels.filter((a) => a.startsWith("checkpoint:"))).toHaveLength(1);

    await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[1]!.options[1]!.id });
    await t.engine.idle(t.id);
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: "après" } });
    expect(f.appels).not.toContain("commit:docs: DESIGN");
  });

  it("abandonner : la tâche se termine en échec avec le motif de l'escalade", async () => {
    const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
    const t = await lancer(decl(phaseQuiEchoue), f.ctx);
    await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[2]!.id });
    await t.engine.idle(t.id);
    expect((await t.record()).state.fin).toEqual({ statut: "echec", motif: "Phase DESIGN abandonnée : porte cohérence" });
  });

  it("panne d'environnement dans la phase : escalade immédiate", async () => {
    const f = fauxContexte({
      archi: () => {
        throw new EnvFailureError("quota épuisé");
      },
    });
    await lancer(decl(phaseQuiEchoue), f.ctx);
    expect(f.demandes[0]!.title).toBe("Phase DESIGN : panne d'environnement : quota épuisé");
  });
});

describe("agir : la question bloquante d'un agent passe à l'humain, puis l'agent reprend", () => {
  it("pose la question avec les choix de l'agent, puis relance le même agent avec la réponse", async () => {
    let tour = 0;
    const f = fauxContexte({
      chercheur: () => (++tour === 1 ? ({ blocker: { question: "Quel module ?", choices: ["Paiement", "Facturation"] } } as never) : sortie({ summary: "ok" })),
    });
    const t = await lancer(
      decl(async (w) => (await agir(w, "chercheur", "Enquête.")).summary),
      f.ctx,
    );
    expect(f.demandes[0]).toMatchObject({ title: "Quel module ?" });
    expect(f.demandes[0]!.options.map((o) => o.label)).toEqual(["Paiement", "Facturation"]);

    await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[1]!.id });
    await t.engine.idle(t.id);
    expect(f.consignes[1]!.consigne).toBe("Enquête.\n\nRéponse de l'utilisateur à ta question « Quel module ? » : Facturation");
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: "ok" } });
  });
});
