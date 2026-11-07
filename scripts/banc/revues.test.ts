import { describe, expect, it } from "vitest";
import { mesurerRevues, sectionRevues } from "./revues.js";

// Comme dans les traces réelles, une lentille garde sa session d'une revue à l'autre (c1, a1, ti1).
let t = 0;
const at = () => new Date(Date.UTC(2026, 9, 15, 10, 0, t++)).toISOString();
const tour = (sessionId: string, role: string, prompt: string, sortie: unknown, appels: { entrée: number; nanoAiu: number }[], outils: string[] = []) => [
  { at: at(), kind: "tour-début", sessionId, role, prompt },
  ...appels.map((u) => ({ at: at(), kind: "usage", sessionId, role, entrée: u.entrée, sortie: 10, nanoAiu: u.nanoAiu })),
  ...outils.map((nom) => ({ at: at(), kind: "outil", sessionId, role, nom, appel: `${sessionId}-${nom}` })),
  { at: at(), kind: "tour-fin", sessionId, role, fin: "output", sortie },
];
const lens = (n: string) => `agent-studio.skraft/skraft-lens-${n}`;
const verdict = (v: string, ...gravites: string[]) => ({ verdict: v, defects: gravites.map((severity) => ({ severity, description: "d" })) });

const trace = [
  ...tour("m1", "agent-studio.skraft/skraft-architect-model", "Phase en cours : DESIGN", { summary: "s" }, [{ entrée: 5000, nanoAiu: 3e9 }]),
  ...tour("c1", lens("cold-reader"), "Revue de la phase DESIGN.", verdict("APPROVED"), [{ entrée: 1000, nanoAiu: 1e9 }]),
  ...tour("a1", lens("architecture"), "Revue de la phase DESIGN.", verdict("CHANGES_REQUESTED", "major", "minor"), [{ entrée: 2000, nanoAiu: 2e9 }], ["view", "view", "grep", "submit_lens_verdict"]),
  ...tour("m2", "agent-studio.skraft/skraft-architect-decide", "Phase en cours : DESIGN", { summary: "s" }, [{ entrée: 5000, nanoAiu: 3e9 }]),
  ...tour("c1", lens("cold-reader"), "Revue de la phase DESIGN.", verdict("APPROVED"), [{ entrée: 1500, nanoAiu: 1.5e9 }], ["view"]),
  ...tour("a1", lens("architecture"), "Revue de la phase DESIGN.", verdict("APPROVED"), [{ entrée: 2500, nanoAiu: 2.5e9 }]),
  ...tour("ti1", lens("test-integrity"), "Revue de la phase DELIVER.", verdict("CHANGES_REQUESTED", "blocker"), [{ entrée: 3000, nanoAiu: 3e9 }]),
];
const finRevueDeLivraison = trace.at(-1)!.at;
const apres = at();
const trace2 = [
  ...trace,
  ...tour("f1", "agent-studio.skraft/skraft-test", "Phase en cours : DELIVER", { summary: "s" }, [{ entrée: 4000, nanoAiu: 4e9 }]),
  ...tour("ti1", lens("test-integrity"), "Revue de la phase DELIVER.", verdict("APPROVED"), [{ entrée: 3500, nanoAiu: 3.5e9 }]),
];
const preuves = [
  { phase: "DELIVER_SCENARIO", source: "gate", at: finRevueDeLivraison, durationMs: 999 },
  { phase: "DELIVER_FIX_TEST", source: "gate", at: apres, durationMs: 2000 },
  { phase: "DELIVER", source: "agent", at: apres, durationMs: 500 },
  { phase: "DELIVER_SCENARIO", source: "gate", at: apres, durationMs: 3000 },
];

describe("Coût des revues et des corrections (docs/15 §5)", () => {
  const m = mesurerRevues(trace2, preuves);

  it("une ligne par phase, tour et lentille : appels, coût, tokens, lectures, verdict et défauts", () => {
    expect(m.lentilles).toEqual([
      { phase: "DESIGN", tour: 1, lentille: "cold-reader", appels: 1, nanoAiu: 1e9, entrée: 1000, lectures: 0, verdict: "APPROVED", défauts: { blocker: 0, major: 0, minor: 0 } },
      { phase: "DESIGN", tour: 1, lentille: "architecture", appels: 1, nanoAiu: 2e9, entrée: 2000, lectures: 3, verdict: "CHANGES_REQUESTED", défauts: { blocker: 0, major: 1, minor: 1 } },
      { phase: "DESIGN", tour: 2, lentille: "cold-reader", appels: 1, nanoAiu: 1.5e9, entrée: 1500, lectures: 1, verdict: "APPROVED", défauts: { blocker: 0, major: 0, minor: 0 } },
      { phase: "DESIGN", tour: 2, lentille: "architecture", appels: 1, nanoAiu: 2.5e9, entrée: 2500, lectures: 0, verdict: "APPROVED", défauts: { blocker: 0, major: 0, minor: 0 } },
      { phase: "DELIVER", tour: 1, lentille: "test-integrity", appels: 1, nanoAiu: 3e9, entrée: 3000, lectures: 0, verdict: "CHANGES_REQUESTED", défauts: { blocker: 1, major: 0, minor: 0 } },
      { phase: "DELIVER", tour: 2, lentille: "test-integrity", appels: 1, nanoAiu: 3.5e9, entrée: 3500, lectures: 0, verdict: "APPROVED", défauts: { blocker: 0, major: 0, minor: 0 } },
    ]);
  });

  it("re-revue sélective : le coût des lentilles relancées alors qu'elles avaient approuvé sans défaut au tour précédent", () => {
    expect(m.reRevue).toEqual({ relances: [{ phase: "DESIGN", tour: 2, lentille: "cold-reader", nanoAiu: 1.5e9 }], nanoAiu: 1.5e9, revuesNanoAiu: 13.5e9 });
  });

  it("patch partagé : lectures des lentilles et part de leurs tokens d'entrée", () => {
    expect(m.lectures).toEqual({ lectures: 4, lentillesEntrée: 13500, totalEntrée: 27500 });
  });

  it("mode rework : après la première revue de DELIVER, les exécutions de tests du code et les revues relancées", () => {
    expect(m.corrections).toEqual({ executions: 2, duréeMs: 5000, étiquettes: ["DELIVER_FIX_TEST", "DELIVER_SCENARIO"], revuesRelancées: 1, revuesNanoAiu: 3.5e9 });
  });

  it("rendu Markdown : une section, trois tableaux, l'économie possible chiffrée", () => {
    const md = sectionRevues(m, (n) => n / 1e9).join("\n");
    expect(md).toContain("## Coût des revues et des corrections");
    expect(md).toContain("| DESIGN | 2 | cold-reader | 1 | 1.5 | 1500 | 1 | APPROVED | 0/0/0 |");
    expect(md).toContain("Re-revue sélective : au plus 1.5 requêtes premium sur 13.5 consacrées aux revues");
    expect(md).toContain("Patch partagé : 4 lectures de fichiers par les lentilles ; leurs tokens d'entrée : 13500 sur 27500");
    expect(md).toContain("Mode rework : après la première revue de DELIVER, 2 exécutions de tests par le code (0m05 : DELIVER_FIX_TEST, DELIVER_SCENARIO), 1 revue relancée (3.5 requêtes premium)");
  });
});
