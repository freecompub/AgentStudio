/**
 * Résumé d'un run par étape, lu dans la trace (ADR 0032) : durée, tours, rejets et leurs motifs,
 * fins anormales, tokens. Fonction pure : la trace est la seule source, le résumé ne peut pas
 * raconter autre chose que ce qui a été enregistré.
 */
import { describe, expect, it } from "vitest";
import { resumerTrace } from "../src/trace/run-summary.js";
import type { TraceEntry } from "../src/protocols/trace.js";

let minute = 0;
const at = (m: number) => new Date(Date.UTC(2026, 9, 3, 10, m)).toISOString();
const e = (o: Record<string, unknown>, m = minute++): TraceEntry => ({ taskId: "t1", at: at(m), ...o }) as TraceEntry;

describe("resumerTrace", () => {
  it("découpe le run en étapes consécutives, avec leur durée", () => {
    const etapes = resumerTrace([
      e({ kind: "transition", événement: "INITIALIZED", phase: "RESEARCH", effets: ["runSpecialist"] }, 0),
      e({ kind: "tour-début", sessionId: "s1", phase: "RESEARCH", prompt: "", repris: false }, 1),
      e({ kind: "transition", événement: "AGENT_REPORTED", phase: "REVIEW", effets: ["runReview"] }, 4),
      e({ kind: "transition", événement: "LENSES_DONE", phase: "DESIGN", effets: ["runSpecialist"] }, 6),
      e({ kind: "transition", événement: "GATE_OK", phase: "DONE", effets: [] }, 20),
    ]).etapes;
    expect(etapes.map((x) => [x.phase, x.duréeMs / 60_000])).toEqual([
      ["RESEARCH", 4],
      ["REVIEW", 2],
      ["DESIGN", 14],
      ["DONE", 0],
    ]);
  });

  it("compte les tours, les rejets avec leurs motifs et les fins anormales de chaque étape", () => {
    const { etapes } = resumerTrace([
      e({ kind: "transition", événement: "INITIALIZED", phase: "DESIGN", effets: [] }, 0),
      e({ kind: "tour-début", sessionId: "s1", phase: "DESIGN", prompt: "", repris: false }, 1),
      e({ kind: "tour-fin", sessionId: "s1", fin: "silence", raison: "aucun événement depuis 10 min" }, 2),
      e({ kind: "transition", événement: "TIMEOUT", phase: "DESIGN", essais: 1, effets: [] }, 2),
      e({ kind: "rejet", porte: "documents", motifs: ["model.md absent"] }, 2),
      e({ kind: "tour-début", sessionId: "s2", phase: "DESIGN", prompt: "", repris: false }, 3),
      e({ kind: "tour-fin", sessionId: "s2", fin: "output" }, 5),
    ]);
    // Le rejet appartient à l'essai qui a échoué ; la reprise de la phase est un nouvel essai.
    expect(etapes[0]).toMatchObject({
      phase: "DESIGN",
      essai: 1,
      tours: 1,
      essaisMax: 1,
      rejets: [{ porte: "documents", motifs: ["model.md absent"] }],
      finsAnormales: [{ fin: "silence", raison: "aucun événement depuis 10 min" }],
    });
    expect(etapes[1]).toMatchObject({ phase: "DESIGN", essai: 2, tours: 1, rejets: [], finsAnormales: [] });
  });

  it("chaque rejeu est une étape : essai numéroté par phase, début et fin ; une phase qui revient après la revue compte aussi", () => {
    const { etapes, parPhase } = resumerTrace([
      e({ kind: "transition", événement: "INITIALIZED", phase: "DESIGN", effets: [] }, 0),
      e({ kind: "tour-début", sessionId: "s1", phase: "DESIGN", prompt: "", repris: false }, 1),
      e({ kind: "rejet", porte: "cohérence", motifs: ["nom absent du modèle"] }, 3),
      e({ kind: "tour-début", sessionId: "s2", phase: "DESIGN", prompt: "", repris: false }, 4),
      e({ kind: "transition", événement: "AGENT_REPORTED", phase: "REVIEW", effets: [] }, 7),
      e({ kind: "transition", événement: "LENSES_DONE", phase: "DESIGN", effets: [] }, 9),
      e({ kind: "transition", événement: "GATE_OK", phase: "DISTILL", effets: [] }, 12),
    ]);
    expect(etapes.map((x) => [x.phase, x.essai, x.début, x.fin, x.duréeMs / 60_000])).toEqual([
      ["DESIGN", 1, at(0), at(4), 4],
      ["DESIGN", 2, at(4), at(7), 3],
      ["REVIEW", 1, at(7), at(9), 2],
      ["DESIGN", 3, at(9), at(12), 3],
      ["DISTILL", 1, at(12), at(12), 0],
    ]);
    expect(parPhase.find((p) => p.phase === "DESIGN")).toMatchObject({ duréeMs: 10 * 60_000, rejets: [{ porte: "cohérence", motifs: ["nom absent du modèle"] }] });
  });

  it("rattache l'usage d'une session à l'étape où elle a commencé", () => {
    // L'usage ne porte pas la phase : il arrive avec son seul identifiant de session.
    const { etapes, total } = resumerTrace([
      e({ kind: "tour-début", sessionId: "s1", phase: "RESEARCH", prompt: "", repris: false }, 0),
      e({ kind: "usage", sessionId: "s1", modèle: "m", entrée: 100, sortie: 10, nanoAiu: 5 }, 1),
      e({ kind: "transition", événement: "GATE_OK", phase: "DESIGN", effets: [] }, 2),
      e({ kind: "usage", sessionId: "s1", entrée: 50, sortie: 5 }, 3),
      e({ kind: "tour-début", sessionId: "s2", phase: "DESIGN", prompt: "", repris: false }, 4),
      e({ kind: "usage", sessionId: "s2", entrée: 7, sortie: 1, nanoAiu: 2 }, 5),
    ]);
    expect(etapes.map((x) => [x.phase, x.entrée, x.sortie, x.nanoAiu, x.appels])).toEqual([
      ["RESEARCH", 150, 15, 5, 2],
      ["DESIGN", 7, 1, 2, 1],
    ]);
    expect(total).toMatchObject({ entrée: 157, sortie: 16, nanoAiu: 7, appels: 3, tours: 2, rejets: 0 });
  });

  it("note les modèles réellement utilisés par étape (ADR 0048)", () => {
    const { etapes } = resumerTrace([
      e({ kind: "tour-début", sessionId: "s1", phase: "CLASSIFY", prompt: "", repris: false }, 0),
      e({ kind: "usage", sessionId: "s1", modèle: "gpt-5-mini", entrée: 1 }, 1),
      e({ kind: "tour-début", sessionId: "s2", phase: "DESIGN", prompt: "", repris: false }, 2),
      e({ kind: "usage", sessionId: "s2", modèle: "claude-sonnet-5.5", entrée: 1 }, 3),
      e({ kind: "usage", sessionId: "s2", modèle: "claude-sonnet-5.5", entrée: 1 }, 4),
    ]);
    expect(etapes.map((x) => [x.phase, x.modèles])).toEqual([
      ["CLASSIFY", ["gpt-5-mini"]],
      ["DESIGN", ["claude-sonnet-5.5"]],
    ]);
  });

  it("additionne par phase les étapes qui reviennent", () => {
    const { parPhase } = resumerTrace([
      e({ kind: "transition", événement: "A", phase: "DESIGN", effets: [] }, 0),
      e({ kind: "transition", événement: "B", phase: "REVIEW", effets: [] }, 3),
      e({ kind: "transition", événement: "C", phase: "DESIGN", effets: [] }, 4),
      e({ kind: "rejet", porte: "revue", motifs: ["x"] }, 4),
      e({ kind: "transition", événement: "D", phase: "DONE", effets: [] }, 10),
    ]);
    expect(parPhase.find((p) => p.phase === "DESIGN")).toMatchObject({ duréeMs: 9 * 60_000, rejets: [{ porte: "revue" }] });
  });

  it("temps des agents, des effets et du moteur, par étape (docs/10 P2)", () => {
    const sec = (s: number) => new Date(Date.UTC(2026, 9, 3, 11, 0, s)).toISOString();
    const x = (o: Record<string, unknown>, s: number): TraceEntry => ({ taskId: "t1", at: sec(s), ...o }) as TraceEntry;
    const r = resumerTrace([
      x({ kind: "transition", événement: "RESUMED", phase: "DESIGN", effets: ["agent"], duréeMs: 3 }, 0),
      x({ kind: "tour-début", sessionId: "s1", phase: "DESIGN", prompt: "", repris: false }, 1),
      x({ kind: "tour-fin", sessionId: "s1", fin: "output" }, 41),
      x({ kind: "effet", effet: "agent", phase: "DESIGN", duréeMs: 42_000, issue: "ok" }, 42),
      x({ kind: "transition", événement: "RESULTAT", phase: "DESIGN", effets: ["lancerTests"], duréeMs: 5 }, 42),
      x({ kind: "effet", effet: "lancerTests", phase: "DESIGN", duréeMs: 18_000, issue: "ok" }, 60),
      x({ kind: "transition", événement: "RESULTAT", phase: "DESIGN", effets: [], duréeMs: 2 }, 60),
    ]);
    expect(r.etapes[0]).toMatchObject({ phase: "DESIGN", agentsMs: 40_000, effetsMs: 60_000, codeMs: 20_000, moteurMs: 10 });
    expect(r.total).toMatchObject({ agentsMs: 40_000, effetsMs: 60_000, codeMs: 20_000, moteurMs: 10 });
  });

  it("une trace vide rend un résumé vide, pas une erreur", () => {
    expect(resumerTrace([])).toMatchObject({ etapes: [], parPhase: [], total: { duréeMs: 0, tours: 0 } });
  });
});
