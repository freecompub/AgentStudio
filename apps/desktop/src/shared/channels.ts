/**
 * Noms des canaux IPC, sans dépendance (utilisables par le preload sandboxé).
 * `ipc-contract.ts` vérifie à la compilation qu'ils correspondent aux schémas.
 */
export const REQUEST_CHANNELS = [
  "auth:status",
  "auth:login",
  "workspace:current",
  "workspace:pick-folder",
  "workspace:open",
  "workspace:clone",
  "workspace:sync",
  "chat:start",
  "chat:send",
  "chat:undo",
  "chat:abort",
  "chat:turn-changes",
  "confirm:respond",
  "shell:open-device-page",
] as const;

export const EVENT_CHANNELS = ["chat:messages", "chat:agent", "chat:busy", "confirm:request", "auth:device-code"] as const;
