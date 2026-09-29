import type { SessionEvent } from "@github/copilot-sdk";
import { describe, expect, it } from "vitest";
import { mapSessionEvent } from "../src/events/map-session-event.js";

/** Fabrique un événement SDK minimal ; les champs non utilisés par l'adaptateur sont omis. */
const ev = (type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
  ({ id: "e", parentId: null, timestamp: "2026-09-23T10:00:00Z", type, data, ...extra }) as unknown as SessionEvent;

describe("mapSessionEvent", () => {
  it("message complet de l'agent principal", () => {
    expect(mapSessionEvent(ev("assistant.message", { content: "Bonjour", messageId: "m" }))).toEqual({
      type: "message",
      text: "Bonjour",
    });
  });

  it("fragment de message en flux", () => {
    expect(mapSessionEvent(ev("assistant.message_delta", { deltaContent: "Bon", messageId: "m" }))).toEqual({
      type: "message-delta",
      text: "Bon",
    });
  });

  it("les messages d'un sous-agent ne sont qu'un signe de vie", () => {
    expect(mapSessionEvent(ev("assistant.message", { content: "x", messageId: "m", parentToolCallId: "t" }))).toEqual({
      type: "activity",
    });
    expect(mapSessionEvent(ev("assistant.message_delta", { deltaContent: "x", messageId: "m", parentToolCallId: "t" }))).toEqual({
      type: "activity",
    });
  });

  it("raisonnement", () => {
    expect(mapSessionEvent(ev("assistant.reasoning", { content: "je pense", reasoningId: "r" }))).toEqual({
      type: "reasoning",
      text: "je pense",
    });
  });

  it("début, progression et fin d'outil", () => {
    expect(mapSessionEvent(ev("tool.execution_start", { toolCallId: "t1", toolName: "bash" }))).toEqual({
      type: "tool-start",
      toolCallId: "t1",
      toolName: "bash",
    });
    expect(mapSessionEvent(ev("tool.execution_progress", { toolCallId: "t1", progressMessage: "ligne" }))).toEqual({
      type: "tool-progress",
      toolCallId: "t1",
      message: "ligne",
    });
    expect(mapSessionEvent(ev("tool.execution_complete", { toolCallId: "t1", success: false }))).toEqual({
      type: "tool-end",
      toolCallId: "t1",
      success: false,
    });
  });

  it("idle de la session principale termine le tour ; celui d'un sous-agent non", () => {
    expect(mapSessionEvent(ev("session.idle", {}))).toEqual({ type: "idle" });
    expect(mapSessionEvent(ev("session.idle", {}, { agentId: "sub" }))).toEqual({ type: "activity" });
  });

  it("erreur de session", () => {
    expect(mapSessionEvent(ev("session.error", { errorType: "quota", message: "Quota épuisé" }))).toEqual({
      type: "error",
      message: "Quota épuisé",
    });
  });

  it("usage d'un appel au modèle : tokens et multiplicateur", () => {
    expect(mapSessionEvent(ev("assistant.usage", { model: "gpt-5", inputTokens: 1200, outputTokens: 80, cost: 1 }))).toEqual({
      type: "usage",
      model: "gpt-5",
      inputTokens: 1200,
      outputTokens: 80,
      multiplier: 1,
    });
  });

  it("l'échec d'un outil porte SON MOTIF, pas seulement un booléen (ADR 0037)", () => {
    // Quinze échecs d'écriture ont coûté trois runs d'enquête : la trace disait « échoué » et le
    // message du SDK — « Parent directories must exist before creating the file » — était jeté ici.
    expect(
      mapSessionEvent(
        ev("tool.execution_complete", {
          toolCallId: "t1",
          success: false,
          error: { code: "ENOENT", message: "Parent directories must exist before creating the file" },
        }),
      ),
    ).toEqual({
      type: "tool-end",
      toolCallId: "t1",
      success: false,
      error: { code: "ENOENT", message: "Parent directories must exist before creating the file" },
    });
  });

  it("un succès reste un succès nu : pas de champ d'erreur inventé", () => {
    expect(mapSessionEvent(ev("tool.execution_complete", { toolCallId: "t1", success: true }))).toEqual({
      type: "tool-end",
      toolCallId: "t1",
      success: true,
    });
  });

  it("session.usage_info devient l'occupation de la fenêtre (ADR 0031)", () => {
    // C'est la seule mesure qui DÉCROÎT quand le runtime compacte, là où le cumul des `usage`
    // compte ce qui a transité et ne redescend jamais.
    expect(
      mapSessionEvent(
        ev("session.usage_info", { currentTokens: 120_000, tokenLimit: 200_000, systemTokens: 9_000, conversationTokens: 105_000, toolDefinitionsTokens: 6_000, messagesLength: 42 }),
      ),
    ).toEqual({
      type: "context",
      currentTokens: 120_000,
      tokenLimit: 200_000,
      systemTokens: 9_000,
      conversationTokens: 105_000,
      toolDefinitionsTokens: 6_000,
      messages: 42,
    });
  });

  it("tout autre événement est un signe de vie — y compris un usage_info sans ses deux nombres", () => {
    // Un `context` aux champs vides obligerait chaque lecteur à savoir l'ignorer.
    expect(mapSessionEvent(ev("session.usage_info", {}))).toEqual({ type: "activity" });
    expect(mapSessionEvent(ev("session.usage_info", { currentTokens: 10 }))).toEqual({ type: "activity" });
    expect(mapSessionEvent(ev("hook.start", {}))).toEqual({ type: "activity" });
  });
});
