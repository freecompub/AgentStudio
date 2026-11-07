import { EnvFailureError } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import { agir, essayer } from "../src/aides.js";
import { Escalade, PanneEnvironnement, SauterPhase, TourInterrompu } from "../src/erreurs.js";
import type { DeclarationWorkflow, W } from "../src/protocols.js";
import { fauxContexte, lancer, sortie } from "./faux-contexte.js";

/** `essayer` n'appelle de `w` que `rejet` (trace) : un `w` qui note ses rejets suffit. */
const rejets: { porte: string; motifs: readonly string[] }[] = [];
const w = { rejet: async (porte: string, motifs: readonly string[]) => void rejets.push({ porte, motifs }) } as unknown as W;

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

  it("motifs initiaux (reprise d'une phase relancée, D15 de docs/12) : le premier essai les reçoit", async () => {
    const vus: (readonly string[])[] = [];
    await essayer(w, { max: 3, motifs: ["Revue : verdict REJECTED"] }, async (motifs, essai) => (vus.push(motifs), essai === 1 ? ["porte"] : []));
    expect(vus).toEqual([["Revue : verdict REJECTED"], ["porte"]]);
  });

  it("chaque essai refusé est tracé : porte nommée, motifs exacts ; revue et tour interrompu nommés d'office", async () => {
    rejets.length = 0;
    const issues = [{ motifs: ["citation hors limites"], porte: "citations" }, { motifs: ["D-1"], revue: true as const }, ["sans nom"]];
    let i = 0;
    await essayer(w, { max: 5 }, async (_m, essai) => {
      if (essai === 4) throw new TourInterrompu("silence");
      return essai === 5 ? [] : issues[i++]!;
    });
    expect(rejets.map((r) => [r.porte, r.motifs[0]])).toEqual([
      ["citations", "citation hors limites"],
      ["revue", "D-1"],
      ["porte", "sans nom"],
      ["délai", expect.stringMatching(/interrompu \(silence\)/)],
    ]);
  });

  it("rejet non compté (question de revue, D4 de docs/12) : l'essai est rejoué avec ses motifs, sans consommer de budget ni retracer", async () => {
    rejets.length = 0;
    const vus: [readonly string[], number][] = [];
    const issues = [{ motifs: ["Question de la revue (architecture) : par ligne ? — Réponse : par ligne"], nonCompte: true as const }, ["porte"], []];
    let i = 0;
    await essayer(w, { max: 2 }, async (motifs, essai) => (vus.push([motifs, essai]), issues[i++]!));
    expect(vus).toEqual([[[], 1], [["Question de la revue (architecture) : par ligne ? — Réponse : par ligne"], 1], [["porte"], 2]]);
    // Le script a déjà tracé la question et sa réponse : essayer ne retrace que le rejet compté.
    expect(rejets.map((r) => r.porte)).toEqual(["porte"]);
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

  it("relancer : la phase repart avec les motifs de l'escalade (D15 de docs/12)", async () => {
    const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
    const vus: (readonly string[])[] = [];
    const t = await lancer(
      decl((w) =>
        w.phase("DESIGN", (_cp, relance) =>
          essayer(w, { max: 1, motifs: relance }, async (motifs) => {
            vus.push(motifs);
            await w.agent("archi", "");
            // Le script est rejoué à chaque pas du moteur : la décision ne dépend que de ce qu'il reçoit.
            return relance.length ? [] : ["porte cohérence : ADR-002 sans conséquences"];
          }),
        ),
      ),
      f.ctx,
    );
    await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[0]!.id });
    await t.engine.idle(t.id);
    expect(vus[0]).toEqual([]);
    expect(vus.at(-1)).toEqual(["porte cohérence : ADR-002 sans conséquences"]);
    expect((await t.record()).state.fin).toMatchObject({ statut: "fini" });
  });

  describe("commit de la phase en échec (D19 de docs/12)", () => {
    const phaseQuiReussit = (w: W, manque: string[]) =>
      w.phase("DESIGN", async () => (await w.agent("archi", ""), true), { commit: "docs: DESIGN", commitManque: (m) => void manque.push(m) });

    it("aucun rembobinage ; relancer refait le seul commit", async () => {
      const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
      f.echecsDeCommit.n = 1;
      const t = await lancer(decl((w) => phaseQuiReussit(w, [])), f.ctx);
      expect(f.rembobinages).toEqual([]);
      expect(f.demandes[0]!.title).toMatch(/^Phase DESIGN : commit impossible \(.*index\.lock/);
      expect(f.demandes[0]!.options.map((o) => o.label)).toEqual(["Relancer le commit", "Continuer sans commiter", "Abandonner la tâche"]);
      await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[0]!.id });
      await t.engine.idle(t.id);
      expect(f.appels.filter((a) => a === "agent:archi")).toHaveLength(1);
      expect(f.appels.filter((a) => a === "commit:docs: DESIGN")).toHaveLength(2);
      expect((await t.record()).state.fin).toMatchObject({ statut: "fini" });
    });

    it("continuer sans commiter : la phase rend sa valeur, le choix est tracé comme rejet « commit » et signalé au script", async () => {
      const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
      f.echecsDeCommit.n = 1;
      // Le script est rejoué : ce qu'il note vit dans le script, et se lit dans sa valeur de fin.
      const t = await lancer(
        decl(async (w) => {
          const manque: string[] = [];
          return { faite: await phaseQuiReussit(w, manque), manque };
        }),
        f.ctx,
      );
      await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[1]!.id });
      await t.engine.idle(t.id);
      const etat = (await t.record()).state;
      expect(etat.lastRejection).toEqual({ gate: "commit", reasons: [expect.stringMatching(/DESIGN.*index\.lock.*sans commit/)] });
      expect(etat.fin).toMatchObject({ statut: "fini", valeur: { clair: { faite: true, manque: [expect.stringMatching(/index\.lock/)] } } });
      expect(f.rembobinages).toEqual([]);
    });
  });

  it("SauterPhase levée par le script : la phase est rembobinée et sautée, sans nouvelle question", async () => {
    const f = fauxContexte();
    const t = await lancer(
      decl(async (w) => {
        const r = await w.phase("DELIVER", async () => {
          throw new SauterPhase();
        });
        return r === undefined ? "sautée" : "faite";
      }),
      f.ctx,
    );
    expect(f.rembobinages).toEqual(["cp-1"]);
    expect(f.demandes).toEqual([]);
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: "sautée" } });
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
