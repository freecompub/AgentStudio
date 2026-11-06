import type { ResumeEtape, ResumeRun } from "@agent-studio/core";
import { describe, expect, it } from "vitest";
import { etapeCommune, resumerParEtape } from "./etapes.js";

/**
 * Étapes communes (`docs/10` §3) : la trace de l'extension et celle du workflow, découpées pareil.
 */

describe("nom d'étape de la trace → étape commune", () => {
  it("stades et phases connus", () => {
    expect(etapeCommune("INIT")).toEqual({ etape: "PRÉPARATION" });
    expect(etapeCommune("DÉBUT")).toEqual({ etape: "PRÉPARATION" });
    expect(etapeCommune("CLASSIFY")).toEqual({ etape: "DIFFICULTÉ", sousEtape: "classifieur" });
    expect(etapeCommune("CONFIRM_DIFFICULTY")).toEqual({ etape: "DIFFICULTÉ", sousEtape: "confirmation" });
    expect(etapeCommune("ROUTE")).toEqual({ etape: "QUESTIONS" });
    expect(etapeCommune("DELIVER")).toEqual({ etape: "DELIVER" });
    expect(etapeCommune("RATIFICATION", "DISTILL")).toEqual({ etape: "DESIGN", sousEtape: "ratification" });
    expect(etapeCommune("DONE", "DELIVER")).toEqual({ etape: "BILAN" });
  });

  it("revue, arbitrage, escalade, blocage : dans l'étape en cours", () => {
    expect(etapeCommune("REVIEW", "DISTILL")).toEqual({ etape: "DISTILL", sousEtape: "revue" });
    expect(etapeCommune("ARBITRATION", "DESIGN")).toEqual({ etape: "DESIGN", sousEtape: "arbitrage" });
    expect(etapeCommune("ESCALATED", "RESEARCH")).toEqual({ etape: "RESEARCH", sousEtape: "escalade" });
    expect(etapeCommune("BLOCKED", "DELIVER")).toEqual({ etape: "DELIVER", sousEtape: "blocage" });
  });
});

const et = (phase: string, début: string, duréeMs: number, x: Partial<ResumeEtape> = {}): ResumeEtape => ({
  phase,
  essai: 1,
  début,
  fin: début,
  duréeMs,
  tours: 0,
  essaisMax: 0,
  rejets: [],
  finsAnormales: [],
  appels: 0,
  entrée: 0,
  sortie: 0,
  nanoAiu: 0,
  modèles: [],
  agentsMs: 0,
  effetsMs: 0,
  codeMs: 0,
  moteurMs: 0,
  ...x,
});
const run = (etapes: ResumeEtape[]): ResumeRun => ({ etapes, parPhase: [], total: {} as ResumeRun["total"] });
const T = (s: number) => new Date(Date.UTC(2026, 9, 10, 8, 0, s)).toISOString();

describe("résumé par étape commune", () => {
  const trace = run([
    et("INIT", T(0), 1000),
    et("CLASSIFY", T(1), 4000, { tours: 1, appels: 2, nanoAiu: 2e9, agentsMs: 3000, effetsMs: 3500, codeMs: 500 }),
    et("CONFIRM_DIFFICULTY", T(5), 10_000),
    et("DESIGN", T(15), 20_000, { tours: 2, appels: 5, nanoAiu: 5e9, rejets: [{ porte: "cohérence", motifs: ["Décision sans ADR."] }], essaisMax: 1 }),
    et("REVIEW", T(35), 5000, { tours: 3, rejets: [{ porte: "revue", motifs: ["lentille#1.1 : contexte borné absent"] }] }),
    et("DESIGN", T(40), 10_000, { tours: 1, essaisMax: 2 }),
    et("RATIFICATION", T(50), 30_000),
    et("DONE", T(80), 0),
  ]);
  const demandes = [
    { createdAt: T(5), answer: { answeredAt: T(14) } },
    { createdAt: T(51), answer: { answeredAt: T(79) } },
  ];
  const r = resumerParEtape(trace, demandes);

  it("regroupe dans l'ordre, sous-étapes comprises ; une phase qui revient s'additionne", () => {
    expect(r.etapes.map((l) => [l.etape, l.sousEtapes])).toEqual([
      ["PRÉPARATION", []],
      ["DIFFICULTÉ", ["classifieur", "confirmation"]],
      ["DESIGN", ["revue", "ratification"]],
      ["BILAN", []],
    ]);
    const design = r.etapes[2]!;
    expect(design).toMatchObject({ duréeMs: 65_000, tours: 6, appels: 5, nanoAiu: 5e9, essaisMax: 2, rejets: 2 });
  });

  it("attente humaine retirée de la durée murale, dans l'étape où la question est posée", () => {
    expect(r.etapes[1]).toMatchObject({ duréeMs: 14_000, attenteHumaineMs: 9000, horsAttenteMs: 5000, interventions: 1, agentsMs: 3000, codeMs: 500 });
    expect(r.etapes[2]).toMatchObject({ attenteHumaineMs: 28_000, horsAttenteMs: 37_000, interventions: 1 });
    expect(r.total).toMatchObject({ duréeMs: 80_000, attenteHumaineMs: 37_000, horsAttenteMs: 43_000, interventions: 2, rejets: 2 });
  });

  it("rejeux numérotés par étape, avec leur nature et leurs motifs entiers", () => {
    expect(r.rejeux).toEqual([
      { etape: "DESIGN", essai: 1, nature: "porte", porte: "cohérence", motifs: ["Décision sans ADR."] },
      { etape: "DESIGN", sousEtape: "revue", essai: 2, nature: "revue", porte: "revue", motifs: ["lentille#1.1 : contexte borné absent"] },
    ]);
  });

  it("question sans réponse : elle attend jusqu'à la fin donnée", () => {
    const s = resumerParEtape(run([et("ROUTE", T(0), 60_000)]), [{ createdAt: T(10) }], T(60));
    expect(s.etapes[0]).toMatchObject({ etape: "QUESTIONS", attenteHumaineMs: 50_000, horsAttenteMs: 10_000 });
  });
});
