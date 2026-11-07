import { describe, expect, it } from "vitest";
import { comparer, famille, mediane, type Run } from "./comparer.js";
import type { LigneEtape, ResumeComparable } from "./etapes.js";

/** Rapport de comparaison (`docs/10` §7) : mise en forme pure des résumés de runs. */

describe("famille de porte", () => {
  it("les deux nommages d'une même porte se rejoignent", () => {
    expect(famille("DELIVER")).toBe("pas");
    expect(famille("pas test (s1)")).toBe("pas");
    expect(famille("DELIVER : mutation")).toBe("mutation");
    expect(famille("mutation (correction ciblée)")).toBe("mutation");
    expect(famille("scénario s2")).toBe("scénario");
    expect(famille("panne (s2)")).toBe("panne");
    expect(famille("RED d'acceptance")).toBe("RED d'acceptance");
    expect(famille("revue")).toBe("revue");
  });
});

it("médiane", () => {
  expect(mediane([3, 1, 2])).toBe(2);
  expect(mediane([4, 1, 2, 3])).toBe(2.5);
  expect(mediane([])).toBe(0);
});

const ligne = (etape: LigneEtape["etape"], x: Partial<LigneEtape> = {}): LigneEtape => ({
  etape,
  sousEtapes: [],
  duréeMs: 60_000,
  attenteHumaineMs: 0,
  horsAttenteMs: 60_000,
  agentsMs: 50_000,
  codeMs: 5000,
  moteurMs: 10,
  tours: 1,
  appels: 2,
  nanoAiu: 2e9,
  entrée: 1000,
  sortie: 100,
  essaisMax: 0,
  rejets: 0,
  interventions: 0,
  ...x,
});
const resume = (etapes: LigneEtape[], rejeux: ResumeComparable["rejeux"]): ResumeComparable => {
  const s = (k: "duréeMs" | "attenteHumaineMs" | "horsAttenteMs" | "agentsMs" | "codeMs" | "moteurMs" | "tours" | "appels" | "nanoAiu" | "entrée" | "sortie" | "rejets" | "interventions") => etapes.reduce((n, l) => n + l[k], 0);
  return { etapes, rejeux, total: { duréeMs: s("duréeMs"), attenteHumaineMs: s("attenteHumaineMs"), horsAttenteMs: s("horsAttenteMs"), agentsMs: s("agentsMs"), codeMs: s("codeMs"), moteurMs: s("moteurMs"), tours: s("tours"), appels: s("appels"), nanoAiu: s("nanoAiu"), entrée: s("entrée"), sortie: s("sortie"), rejets: s("rejets"), interventions: s("interventions") } };
};

const runs: Run[] = [
  {
    nom: "2026-10-11-us-2-extension-aaaa",
    mode: "extension skraft",
    livre: true,
    arret: null,
    comparable: resume(
      [ligne("DIFFICULTÉ", { attenteHumaineMs: 2000, interventions: 1 }), ligne("DELIVER", { rejets: 1, nanoAiu: 8e9 })],
      [{ etape: "DELIVER", essai: 1, nature: "porte", porte: "DELIVER", motifs: ["Aucun nouveau test unitaire détecté."] }],
    ),
  },
  {
    nom: "2026-10-11-us-2-workflow-bbbb",
    mode: "workflow skraft",
    livre: false,
    arret: "plafond de 250 requêtes premium atteint",
    comparable: resume(
      [ligne("DIFFICULTÉ"), ligne("DESIGN", { rejets: 1, sousEtapes: ["revue"] }), ligne("DELIVER", { rejets: 1 })],
      [
        { etape: "DESIGN", sousEtape: "revue", essai: 1, nature: "revue", porte: "revue", motifs: ["lentille#1.1 : contexte | borné absent"] },
        { etape: "DELIVER", essai: 1, nature: "porte", porte: "pas test (s1)", motifs: ["Aucun nouveau test unitaire détecté."] },
      ],
    ),
  },
];
const md = comparer(runs, { date: "2026-10-11", story: "us-2", prix: 0.04 });

describe("rapport de comparaison", () => {
  it("synthèse : une colonne par approche, médiane et valeurs brutes", () => {
    expect(md).toContain("| Mesure | extension skraft | workflow skraft |");
    expect(md).toContain("| Livré | 1/1 | 0/1 — arrêts : plafond de 250 requêtes premium atteint |");
    expect(md).toContain("| Requêtes premium | 10 (10) | 6 (6) |");
    expect(md).toContain("| Coût (€) | 0.40 (0.40) | 0.24 (0.24) |");
    expect(md).toContain("| Attente humaine | 0m02 (0m02) | 0m00 (0m00) |");
  });

  it("une ligne par étape et par run", () => {
    expect(md).toContain("| workflow skraft · 2026-10-11-us-2-workflow-bbbb | DESIGN | revue | 1m00 | 0m50 | 0m05 | 0m00 | 0m00 | 1 | 2 | 2 | 1000 | 100 | 1 |");
  });

  it("rejeux run par run, motifs entiers", () => {
    expect(md).toMatch(/### workflow skraft · 2026-10-11-us-2-workflow-bbbb\n\n1\. \*\*DESIGN · revue\*\*, essai 1, revue, porte « revue »\n {3}- lentille#1\.1 : contexte \| borné absent/);
  });

  it("mis en regard par famille de porte ; un rejet d'un seul côté est à expliquer", () => {
    expect(md).toContain("| pas | 1 (1) | 1 (1) |  |");
    expect(md).toContain("| revue | 0 (0) | 1 (1) | **à expliquer** |");
  });

  it("sans prix, pas de colonne en euros", () => {
    expect(comparer(runs, { date: "2026-10-11", story: "us-2" })).not.toContain("Coût (€)");
  });
});
