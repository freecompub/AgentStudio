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
  "commands:list",
  "tasks:list",
  "task:cancel",
  "interactions:list",
  "interaction:respond",
  "profile:get",
  "ui:get-mode",
  "ui:set-mode",
  "extensions:list",
  "extensions:install",
  "extensions:uninstall",
  "extension-consent:respond",
] as const;

export const EVENT_CHANNELS = [
  "chat:messages",
  "chat:agent",
  "chat:busy",
  "confirm:request",
  "auth:device-code",
  "task:update",
  "interactions:changed",
  "extension-consent:request",
  "extensions:changed",
] as const;
