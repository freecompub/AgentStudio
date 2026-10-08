import { TurnTimeoutError, EnvFailureError } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import { createWorkflowTask } from "../src/workflow-task.js";
import { PanneEnvironnement, TourInterrompu } from "../src/erreurs.js";
import type { DeclarationWorkflow, EtatWorkflow, W } from "../src/protocols.js";
import { attendre, fauxContexte, lancer, moteur, sortie } from "./faux-contexte.js";

const decl = (script: (w: W, entree: never) => Promise<unknown>, extra: Partial<DeclarationWorkflow<never>> = {}): DeclarationWorkflow<never> => ({
  nom: "test/flux",
  script,
  empreinte: "v1",
  ...extra,
});

describe("Workflow rejouable (ADR 0052)", () => {
  it("un script sans appel se termine aussitôt, avec sa valeur", async () => {
    const { ctx } = fauxContexte();
    const t = await lancer(decl(async () => 42), ctx);
    const r = await t.record();
    expect(r.status).toBe("finished");
    expect(r.state.fin).toEqual({ statut: "fini", valeur: { clair: 42 } });
  });

  it("chaque appel w.* devient un effet, dans l'ordre, et son résultat revient au script", async () => {
    const f = fauxContexte({ redacteur: (c) => sortie({ summary: `lu : ${c}` }) }, { "story.md": "US-1" });
    const t = await lancer(
      decl(async (w) => {
        const story = await w.lireFichier("story.md");
        const r = await w.agent<{ summary: string }>("redacteur", story);
        await w.ecrireFichier("rapport.md", r.sortie!.summary);
        return r.sortie!.summary;
      }),
      f.ctx,
    );
    expect(f.appels).toEqual(["lire:story.md", "agent:redacteur", "ecrire:rapport.md"]);
    expect(f.fichiers["rapport.md"]).toBe("lu : US-1");
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: "lu : US-1" } });
  });

  it("même effet suivant après rejeu : un événement sans résultat nouveau ne réémet rien", async () => {
    const def = createWorkflowTask(
      decl(async (w) => {
        await w.lireFichier("a");
        await w.lireFichier("b");
      }),
    );
    const s0 = await def.initialState(null);
    expect(await def.initialEffects(s0)).toEqual([{ kind: "lireFichier", n: 1 }]);
    const t1 = await def.transition(s0, { type: "RESULTAT", n: 1, resultat: "A" });
    expect(t1.effects).toEqual([{ kind: "lireFichier", n: 2 }]);
    // Reprise après crash : l'appel 2 est toujours demandé, le moteur va le rejouer ; rien de neuf.
    const t2 = await def.transition(t1.state, { type: "RESUMED" });
    expect(t2.effects).toEqual([]);
    expect(t2.state.journal).toEqual(t1.state.journal);
  });

  it("reprise au bon endroit après un crash : l'appel coupé est refait, les précédents ne le sont pas", async () => {
    const script = async (w: W) => {
      const a = await w.agent<{ summary: string }>("premier", "x");
      const b = await w.agent<{ summary: string }>("second", "y");
      return `${a.sortie!.summary}+${b.sortie!.summary}`;
    };
    // Premier démarrage : le second agent ne rend jamais la main (le processus va « mourir »).
    const avant = fauxContexte({ premier: () => sortie({ summary: "A" }), second: () => new Promise(() => {}) });
    const m1 = moteur(decl(script), avant.ctx);
    const id = await m1.engine.start("test/flux", null);
    await attendre(async () => (await m1.store.load(id))?.inflight !== null && avant.appels.includes("agent:second"));

    // Second démarrage, même magasin, nouveau contexte.
    const apres = fauxContexte({ premier: () => sortie({ summary: "JAMAIS" }), second: () => sortie({ summary: "B" }) });
    const m2 = moteur(decl(script), apres.ctx, m1.store);
    await m2.engine.resumeAll();
    await attendre(async () => (await m2.store.load(id))?.status === "finished");

    expect(apres.appels).toEqual(["agent:second"]);
    expect(((await m2.store.load(id))!.state as EtatWorkflow).fin).toEqual({ statut: "fini", valeur: { clair: "A+B" } });
  });

  it("non-déterminisme détecté : la tâche s'arrête en le disant, sans diverger", async () => {
    let k = 0;
    const f = fauxContexte({}, { f0: "", f1: "", f2: "" });
    const t = await lancer(
      decl(async (w) => {
        await w.lireFichier(`f${k++}`);
        await w.lireFichier("f2");
      }),
      f.ctx,
    );
    const r = await t.record();
    expect(r.status).toBe("finished");
    expect(r.state.fin).toMatchObject({ statut: "echec", motif: expect.stringMatching(/Non-déterminisme.*appel 1/) });
    expect(f.appels).toEqual(["lire:f0"]);
  });

  it("script modifié : une tâche commencée refuse de reprendre avec un autre script", async () => {
    const script = async (w: W) => {
      await w.humain("valider", "On continue ?", [{ id: "oui", label: "Oui" }]);
      await w.lireFichier("a");
    };
    const f = fauxContexte({}, { a: "" });
    const m1 = moteur(decl(script, { empreinte: "v1" }), f.ctx);
    const id = await m1.engine.start("test/flux", null);
    await m1.engine.idle(id);

    const m2 = moteur(decl(script, { empreinte: "v2" }), f.ctx, m1.store);
    await m2.engine.resumeAll();
    await m2.engine.dispatch(id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[0]!.id });
    await m2.engine.idle(id);
    const r = (await m2.store.load(id))!;
    expect(r.status).toBe("finished");
    expect((r.state as EtatWorkflow).fin).toMatchObject({ statut: "echec", motif: expect.stringMatching(/script.*modifié/i) });
    expect(f.appels).not.toContain("lire:a");
  });

  it("appels parallèles : un effet chacun, résultats rangés par numéro d'appel et non par ordre d'arrivée", async () => {
    const def = createWorkflowTask(
      decl(async (w) => {
        const [a, b] = await Promise.all([w.lireFichier("a"), w.lireFichier("b")]);
        return [a, b];
      }),
    );
    const s0 = await def.initialState(null);
    expect(await def.initialEffects(s0)).toEqual([
      { kind: "lireFichier", n: 1 },
      { kind: "lireFichier", n: 2 },
    ]);
    const t1 = await def.transition(s0, { type: "RESULTAT", n: 2, resultat: "B" });
    expect(t1.effects).toEqual([]);
    const t2 = await def.transition(t1.state, { type: "RESULTAT", n: 1, resultat: "A" });
    expect(t2.state.fin).toEqual({ statut: "fini", valeur: { clair: ["A", "B"] } });
  });

  it("w.rembobiner fait oublier exactement les agents qui ont travaillé depuis le checkpoint", async () => {
    const ok = () => sortie({ summary: "" });
    const f = fauxContexte({ avant: ok, x: ok, y: ok });
    await lancer(
      decl(async (w) => {
        await w.agent("avant", "");
        const cp = await w.checkpoint("DESIGN");
        await w.agent("x", "");
        await w.agent("y", "");
        await w.agent("x", "");
        await w.rembobiner(cp);
      }),
      f.ctx,
    );
    expect(f.rembobinages).toEqual(["cp-1"]);
    expect(f.oublis).toEqual([["x", "y"]]);
  });

  it("humain : profils pris dans la déclaration, décision rendue au script", async () => {
    const f = fauxContexte();
    const t = await lancer(
      decl(async (w) => (await w.humain("ratifier-adr", "Ratifier ADR-0007 ?", [{ id: "accepter", label: "Accepter" }, { id: "refuser", label: "Refuser" }])).decision, {
        humains: { "ratifier-adr": ["architecte"] },
      }),
      f.ctx,
    );
    expect((await t.record()).status).toBe("waiting");
    expect(f.demandes[0]).toMatchObject({ title: "Ratifier ADR-0007 ?", requiredRoles: ["architecte"] });

    await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[1]!.id });
    await t.engine.idle(t.id);
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: "refuser" } });
  });

  it("humain : une question absente de la déclaration fait échouer la tâche", async () => {
    const f = fauxContexte();
    const t = await lancer(decl(async (w) => w.humain("inconnue", "?", [{ id: "a", label: "A" }]), { humains: { autre: ["po"] } }), f.ctx);
    expect((await t.record()).state.fin).toMatchObject({ statut: "echec", motif: expect.stringMatching(/inconnue.*non déclarée/) });
    expect(f.demandes).toEqual([]);
  });

  it("magasin de contenus : un gros fichier lu deux fois n'est stocké qu'une fois, le journal ne garde qu'un renvoi", async () => {
    const gros = "x".repeat(10_000);
    const f = fauxContexte({}, { a: gros, b: gros });
    const t = await lancer(
      decl(async (w) => {
        await w.lireFichier("a");
        await w.lireFichier("b");
        return (await w.lireFichier("a")).length;
      }),
      f.ctx,
    );
    const s = (await t.record()).state;
    expect(Object.keys(s.contenus)).toHaveLength(1);
    expect(JSON.stringify(s.journal).length).toBeLessThan(1_000);
    expect(s.fin).toEqual({ statut: "fini", valeur: { clair: 10_000 } });
  });

  it("erreurs journalisées : un tour interrompu et une panne se relèvent au rejeu sous leur classe", async () => {
    const f = fauxContexte({
      muet: () => {
        throw new TurnTimeoutError(1_000);
      },
      panne: () => {
        throw new EnvFailureError("quota épuisé");
      },
    });
    const t = await lancer(
      decl(async (w) => {
        const vu: string[] = [];
        for (const nom of ["muet", "panne"]) {
          try {
            await w.agent(nom, "");
          } catch (e) {
            vu.push(e instanceof TourInterrompu ? "interrompu" : e instanceof PanneEnvironnement ? "panne" : "autre");
          }
        }
        return vu;
      }),
      f.ctx,
    );
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: ["interrompu", "panne"] } });
  });

  it("w.lancerTests : preuve rattachée à la tâche, sous l'étiquette demandée ou la phase en cours", async () => {
    const f = fauxContexte();
    const vus: unknown[] = [];
    (f.ctx.stack as { runTests: (o: unknown) => Promise<unknown> }).runTests = async (o: unknown) => (vus.push(o), { results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 });
    await lancer(
      decl((w) =>
        w.phase("DISTILL", async () => {
          await w.lancerTests();
          await w.lancerTests({ etiquette: "DISTILL_RED" });
          return true;
        }),
      ),
      f.ctx,
    );
    expect(vus).toMatchObject([{ evidence: { taskId: "t1", phase: "DISTILL" } }, { evidence: { taskId: "t1", phase: "DISTILL_RED" } }]);
  });

  it("w.disposition rend les emplacements de la stack du projet et ses modules d'infrastructure", async () => {
    const f = fauxContexte();
    const t = await lancer(decl(async (w) => w.disposition()), f.ctx);
    expect((await t.record()).state.fin).toEqual({
      statut: "fini",
      valeur: { clair: { acceptanceTests: [], infrastructureModules: ["Infrastructure"], sources: [], unitTests: [] } },
    });
  });

  it("w.preuves rend les preuves de la tâche ; w.architecture contrôle les règles de dépendance", async () => {
    const f = fauxContexte();
    const t = await lancer(
      decl(async (w) => ({ preuves: await w.preuves(), architecture: await w.architecture([{ module: "Domain", forbidden: ["Infrastructure"] }]) })),
      f.ctx,
    );
    expect((await t.record()).state.fin).toMatchObject({
      valeur: { clair: { preuves: [{ taskId: "t1", phase: "DELIVER_RED" }], architecture: { regles: [{ module: "Domain", forbidden: ["Infrastructure"] }] } } },
    });
  });

  it("preuves rattachées à une étape : w.lancerTests et w.agent passent l'étape (scénario) au cœur", async () => {
    const f = fauxContexte({ dev: () => sortie({ summary: "" }) });
    const vus: unknown[] = [];
    (f.ctx.stack as { runTests: (o: unknown) => Promise<unknown> }).runTests = async (o: unknown) => (vus.push(o), { results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 });
    await lancer(
      decl(async (w) => {
        await w.lancerTests({ etiquette: "DELIVER_RED", etape: "ac-1" });
        await w.agent("dev", "", { preuve: { etape: "ac-1" } });
      }),
      f.ctx,
    );
    expect(vus).toMatchObject([{ evidence: { taskId: "t1", phase: "DELIVER_RED", stepId: "ac-1" } }]);
    expect(f.consignes[0]!.opts).toMatchObject({ evidence: { taskId: "t1", stepId: "ac-1" } });
  });

  it("w.echec termine la tâche en échec avec son motif", async () => {
    const f = fauxContexte();
    const t = await lancer(decl(async (w) => w.echec("Story invalide : critère 2 vide")), f.ctx);
    expect((await t.record()).state.fin).toEqual({ statut: "echec", motif: "Story invalide : critère 2 vide" });
  });

  it("annulation : la tâche se termine, plus aucun appel ne part", async () => {
    const f = fauxContexte();
    const t = await lancer(
      decl(async (w) => {
        await w.humain("valider", "?", [{ id: "oui", label: "Oui" }]);
        await w.lireFichier("a");
      }),
      f.ctx,
    );
    await t.engine.cancel(t.id);
    const r = await t.record();
    expect(r.status).toBe("finished");
    expect(r.state.fin).toEqual({ statut: "annule" });
    expect(f.appels).not.toContain("lire:a");
  });

  it("w.agent : les motifs du rejet précédent s'ajoutent à la consigne, les restrictions passent au tour", async () => {
    const f = fauxContexte({ archi: () => sortie({ summary: "" }) });
    await lancer(decl(async (w) => w.agent("archi", "Conçois.", { motifs: ["ADR sans conséquences"], lectureSeule: ["tests/**"], gelApresRouge: true })), f.ctx);
    expect(f.consignes[0]!.consigne).toBe("Conçois.\n\nRejet précédent :\n  - ADR sans conséquences");
    expect(f.consignes[0]!.opts).toMatchObject({ readOnly: ["tests/**"], freezeTestsAfterRed: true, evidence: { taskId: "t1" } });
  });

  it("w.agent : une question bloquante est rendue au script, pas levée", async () => {
    const f = fauxContexte({ chercheur: () => ({ blocker: { question: "Quel module ?", choices: ["A", "B"] } }) as never });
    const t = await lancer(decl(async (w) => (await w.agent("chercheur", "")).blocage), f.ctx);
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: { question: "Quel module ?", choix: ["A", "B"] } } });
  });
});
