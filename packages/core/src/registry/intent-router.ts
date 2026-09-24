import type { CommandContribution, Registry } from "./registry.js";

export type Intent =
  | { kind: "command"; command: CommandContribution; args: string }
  | { kind: "unknown-command"; name: string }
  | { kind: "chat"; text: string };

const COMMAND = /^\s*\/([a-z0-9.-]+(?:\/[a-z0-9-]+)?)(?:\s+([\s\S]*))?$/;

/** `/commande` → handler d'extension ; texte libre → session principale (§4.2). */
export function routeIntent(registry: Registry, text: string): Intent {
  const m = COMMAND.exec(text);
  if (!m?.[1]) return { kind: "chat", text };
  const command = registry.command(m[1]);
  if (!command) return { kind: "unknown-command", name: m[1] };
  return { kind: "command", command, args: (m[2] ?? "").trim() };
}
