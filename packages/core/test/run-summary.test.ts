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
    expect(etapes[0]).toMatchObject({
      phase: "DESIGN",
      tours: 2,
      essaisMax: 1,
      rejets: [{ porte: "documents", motifs: ["model.md absent"] }],
      finsAnormales: [{ fin: "silence", raison: "aucun événement depuis 10 min" }],
    });
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

  it("une trace vide rend un résumé vide, pas une erreur", () => {
    expect(resumerTrace([])).toMatchObject({ etapes: [], parPhase: [], total: { duréeMs: 0, tours: 0 } });
  });
});
