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

  it("tout autre événement est un signe de vie", () => {
    expect(mapSessionEvent(ev("session.usage_info", {}))).toEqual({ type: "activity" });
    expect(mapSessionEvent(ev("hook.start", {}))).toEqual({ type: "activity" });
  });
});
