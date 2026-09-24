import { z } from "zod";
import { EVENT_CHANNELS as EVENT_NAMES, REQUEST_CHANNELS as REQUEST_NAMES } from "./channels.js";

/**
 * Contrat IPC renderer ↔ principal. Chaque requête est validée côté principal
 * (forme, taille) avant d'atteindre un service. Aucun jeton ni objet du SDK n'y figure.
 */

const text = (max: number) => z.string().max(max);

export const roleSchema = z.enum(["testeur", "po", "developpeur", "architecte", "administrateur"]);

export const chatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "notice"]),
  text: z.string(),
  createdAt: z.string(),
  checkpointId: z.string().optional(),
  undone: z.boolean().optional(),
  origin: z.string().optional(),
});
export type ChatMessageDto = z.infer<typeof chatMessageSchema>;

export const authStatusSchema = z.union([
  z.object({ loggedIn: z.literal(false), hostname: z.string() }),
  z.object({
    loggedIn: z.literal(true),
    user: z.string(),
    tokenKind: z.enum(["oauth", "classic-pat", "fine-grained-pat", "unknown"]),
    copilotCompatible: z.boolean(),
    /** `github.com` ou l'instance GitHub Enterprise choisie. */
    hostname: z.string(),
  }),
]);
export type AuthStatusDto = z.infer<typeof authStatusSchema>;

export const fileChangeSchema = z.object({ path: z.string(), status: z.enum(["added", "modified", "deleted"]) });
export const workspaceDiffSchema = z.object({ files: z.array(fileChangeSchema), patch: z.string() });
export type WorkspaceDiffDto = z.infer<typeof workspaceDiffSchema>;

export const workspaceInfoSchema = z.object({ root: z.string(), name: z.string() });
export type WorkspaceInfoDto = z.infer<typeof workspaceInfoSchema>;

const usageRowSchema = z.object({
  phase: z.string(),
  label: z.string(),
  requests: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  retries: z.number(),
  durationMs: z.number(),
});
export type UsageRowDto = z.infer<typeof usageRowSchema>;

export const taskCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  phase: z.string(),
  phaseLabel: z.string(),
  status: z.enum(["running", "waiting", "finished"]),
  alert: z.boolean(),
  milestone: z.boolean(),
  step: z.object({ index: z.number(), total: z.number(), behavior: z.string() }).optional(),
  feedback: z.string().optional(),
  /** Usage par état (D37), dans l'unité du fournisseur. */
  usage: z.object({ unit: z.enum(["requests", "tokens"]), rows: z.array(usageRowSchema), total: usageRowSchema }).optional(),
  updatedAt: z.string(),
});
export type TaskCardDto = z.infer<typeof taskCardSchema>;

export const interactionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  extensionId: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  options: z.array(z.object({ id: z.string(), label: z.string() })),
  requiredRoles: z.array(roleSchema).optional(),
  freeText: z.boolean().optional(),
  createdAt: z.string(),
});
export type InteractionDto = z.infer<typeof interactionSchema>;

export const commandListingSchema = z.object({ invocation: z.string(), title: z.string(), description: z.string() });
export type CommandListingDto = z.infer<typeof commandListingSchema>;

/** Modèles proposés et celui retenu pour le projet ; `null` = le runtime décide (D38, ADR 0020). */
const modelListingSchema = z
  .object({
    models: z.array(z.object({ id: text(200), name: text(200), multiplier: z.number().optional() }).strict()),
    selected: text(200).nullable(),
  })
  .strict();
export type ModelListingDto = z.infer<typeof modelListingSchema>;

export const uiModeSchema = z.enum(["simple", "advanced"]);
export type UiMode = z.infer<typeof uiModeSchema>;

export const profileInfoSchema = z.object({
  role: roleSchema,
  roleLabel: z.string(),
  defaultMode: uiModeSchema,
  permissionPolicy: z.enum(["prudente", "souple"]),
  developerMode: z.boolean(),
  /** Origine de la configuration : fichier de l'administrateur ou valeurs par défaut. */
  adminSource: z.string(),
});
export type ProfileInfoDto = z.infer<typeof profileInfoSchema>;

export const extensionInfoSchema = z.object({
  id: z.string(),
  version: z.string(),
  publisher: z.string(),
  builtIn: z.boolean(),
  signed: z.boolean(),
  status: z.enum(["active", "disabled"]),
  reason: z.string().optional(),
  commands: z.array(z.string()),
});
export type ExtensionInfoDto = z.infer<typeof extensionInfoSchema>;

const permissionTextSchema = z.object({ permission: z.string(), description: z.string() });
export const consentRequestSchema = z.object({
  id: z.string(),
  kind: z.enum(["install", "update"]),
  extensionId: z.string(),
  version: z.string(),
  publisher: z.string(),
  signed: z.boolean(),
  commands: z.array(z.string()),
  permissions: z.array(permissionTextSchema),
  added: z.array(permissionTextSchema),
  warnings: z.array(z.string()),
});
export type ConsentRequestDto = z.infer<typeof consentRequestSchema>;

const empty = z.object({}).strict();

/** Requêtes (renderer → principal, `invoke`) : entrée et sortie par canal. */
export const requests = {
  "auth:status": { input: empty, output: authStatusSchema },
  "auth:login": { input: z.object({ hostname: text(253).min(1).optional() }).strict(), output: authStatusSchema },
  "auth:logout": { input: empty, output: z.void() },
  "workspace:current": { input: empty, output: workspaceInfoSchema.nullable() },
  "workspace:pick-folder": { input: empty, output: z.string().nullable() },
  "workspace:open": { input: z.object({ path: text(4096).min(1) }).strict(), output: workspaceInfoSchema },
  "workspace:close": { input: empty, output: z.void() },
  "workspace:clone": {
    input: z.object({ url: text(2048).min(1), dest: text(4096).min(1) }).strict(),
    output: workspaceInfoSchema,
  },
  "workspace:sync": { input: empty, output: z.object({ pulled: z.number(), pushed: z.number() }) },
  "models:list": { input: empty, output: modelListingSchema },
  "model:set": { input: z.object({ id: text(200).min(1).nullable() }).strict(), output: z.void() },
  "chat:start": { input: empty, output: z.array(chatMessageSchema) },
  "chat:send": { input: z.object({ text: text(100_000).min(1) }).strict(), output: z.void() },
  "chat:undo": { input: z.object({ messageId: text(200).min(1) }).strict(), output: z.void() },
  "chat:abort": { input: empty, output: z.void() },
  "chat:turn-changes": { input: z.object({ messageId: text(200).min(1) }).strict(), output: workspaceDiffSchema },
  "confirm:respond": {
    input: z.object({ id: text(100).min(1), answer: z.enum(["allow-once", "allow-always", "deny"]) }).strict(),
    output: z.void(),
  },
  "shell:open-device-page": { input: empty, output: z.void() },
  "commands:list": { input: empty, output: z.array(commandListingSchema) },
  "tasks:list": { input: empty, output: z.array(taskCardSchema) },
  "task:cancel": { input: z.object({ taskId: text(200).min(1) }).strict(), output: z.void() },
  "interactions:list": { input: empty, output: z.array(interactionSchema) },
  "profile:get": { input: empty, output: profileInfoSchema },
  "ui:get-mode": { input: empty, output: uiModeSchema },
  "ui:set-mode": { input: z.object({ mode: uiModeSchema }).strict(), output: z.void() },
  "extensions:list": { input: empty, output: z.array(extensionInfoSchema) },
  "extensions:install": {
    input: empty,
    output: z.object({ status: z.enum(["installed", "declined", "rejected", "cancelled"]), id: z.string().optional(), version: z.string().optional(), reason: z.string().optional() }),
  },
  "extensions:uninstall": { input: z.object({ id: text(200).min(1) }).strict(), output: z.void() },
  "extension-consent:respond": { input: z.object({ id: text(100).min(1), accept: z.boolean() }).strict(), output: z.void() },
  "interaction:respond": {
    input: z.object({ id: text(200).min(1), option: text(100).min(1), comment: text(4000).optional() }).strict(),
    output: z.void(),
  },
} as const;

export type RequestChannel = keyof typeof requests;
export type RequestInput<C extends RequestChannel> = z.infer<(typeof requests)[C]["input"]>;
export type RequestOutput<C extends RequestChannel> = z.infer<(typeof requests)[C]["output"]>;

const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message-delta"), text: z.string() }),
  z.object({ type: z.literal("message"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("tool-start"), toolCallId: z.string(), toolName: z.string() }),
  z.object({ type: z.literal("tool-progress"), toolCallId: z.string(), message: z.string() }),
  z.object({ type: z.literal("tool-end"), toolCallId: z.string(), success: z.boolean() }),
  z.object({ type: z.literal("tool-denied"), toolName: z.string(), reason: z.string() }),
  z.object({ type: z.literal("idle") }),
  z.object({ type: z.literal("error"), message: z.string() }),
  z.object({ type: z.literal("activity") }),
]);

/** Événements (principal → renderer). */
export const events = {
  "chat:messages": z.object({ messages: z.array(chatMessageSchema) }),
  "chat:agent": z.object({ event: agentEventSchema }),
  "chat:busy": z.object({ busy: z.boolean() }),
  "confirm:request": z.object({ id: z.string(), title: z.string(), detail: z.string() }),
  "auth:device-code": z.object({ code: z.string(), verificationUrl: z.string() }),
  "task:update": taskCardSchema,
  "interactions:changed": z.object({ pending: z.array(interactionSchema) }),
  "extension-consent:request": consentRequestSchema,
  "extensions:changed": z.object({}),
} as const;

export type EventChannel = keyof typeof events;
export type EventPayload<C extends EventChannel> = z.infer<(typeof events)[C]>;

/** Égalité exacte des listes de noms et des schémas, vérifiée par le compilateur. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const requestNamesMatch: Same<(typeof REQUEST_NAMES)[number], RequestChannel> = true;
const eventNamesMatch: Same<(typeof EVENT_NAMES)[number], EventChannel> = true;
void requestNamesMatch;
void eventNamesMatch;

export const REQUEST_CHANNELS: readonly RequestChannel[] = REQUEST_NAMES;
export const EVENT_CHANNELS: readonly EventChannel[] = EVENT_NAMES;

/** API exposée au renderer par le preload (`window.agentStudio`). */
export interface RendererApi {
  invoke<C extends RequestChannel>(channel: C, input: RequestInput<C>): Promise<RequestOutput<C>>;
  on<C extends EventChannel>(channel: C, cb: (payload: EventPayload<C>) => void): () => void;
}
