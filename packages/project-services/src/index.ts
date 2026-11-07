/**
 * Services d'un projet ouvert, sans dépendance à l'application qui les héberge : l'application de
 * bureau (Electron) et le serveur MCP (ADR 0068) les assemblent de la même façon.
 */
export type * from "./protocols.js";
export * from "./dto.js";
export { AucunePile, workspaceServicesFactory, toTaskCard, type ExtensionSource, type WorkspaceServicesConfig } from "./workspace-services.js";
export { createStackCommand, type ProfilDeclare, type StackCommandDeps } from "./stack-command.js";
export { DEFAULT_ALLOWED_PROGRAMS, defaultAdminConfigPath, loadAdminConfig, type AdminConfig } from "./admin-config.js";
