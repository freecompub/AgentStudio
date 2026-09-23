import type { SessionEvent } from "@github/copilot-sdk";
import type { AgentEvent } from "@agent-studio/core";

const ACTIVITY: AgentEvent = { type: "activity" };

/**
 * Traduit un événement du SDK en `AgentEvent` normalisé. Les événements des sous-agents
 * et tout ce qui n'est pas connu comptent seulement comme signes de vie (watchdog, D30).
 */
export function mapSessionEvent(event: SessionEvent): AgentEvent {
  switch (event.type) {
    case "assistant.message":
      return event.data.parentToolCallId ? ACTIVITY : { type: "message", text: event.data.content };
    case "assistant.message_delta":
      return event.data.parentToolCallId ? ACTIVITY : { type: "message-delta", text: event.data.deltaContent };
    case "assistant.reasoning":
      return { type: "reasoning", text: event.data.content };
    case "tool.execution_start":
      return { type: "tool-start", toolCallId: event.data.toolCallId, toolName: event.data.toolName };
    case "tool.execution_progress":
      return { type: "tool-progress", toolCallId: event.data.toolCallId, message: event.data.progressMessage };
    case "tool.execution_complete":
      return { type: "tool-end", toolCallId: event.data.toolCallId, success: event.data.success };
    case "session.idle":
      return event.agentId ? ACTIVITY : { type: "idle" };
    case "session.error":
      return { type: "error", message: event.data.message };
    default:
      return ACTIVITY;
  }
}
