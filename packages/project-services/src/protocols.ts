/**
 * Services d'un projet ouvert (registre, extensions, workflows, moteur de tâches, interactions),
 * indépendants de l'application qui les héberge : l'application de bureau et le serveur MCP
 * (ADR 0068).
 */
import type { AgentRuntime, CommandListing, ModelClass, Role, ToolCallGuard, ToolSpec, UserConfirmer } from "@agent-studio/core";
import type { Workspace } from "@agent-studio/workspace";
import type { InteractionDto, TaskCardDto } from "./dto.js";

/** Accord sur un workflow donné d'avance : pour ce lancement, ou retenu pour son empreinte. */
export type AccordDonne = "une-fois" | "toujours";

export interface WorkflowActif {
  nom: string;
  commande: string;
  description: string;
  /** `/demo <story> [--auto]`. */
  syntaxe: string;
  /** Accord déjà retenu (« toujours ») pour l'empreinte actuelle du dossier. */
  accordRetenu: boolean;
  /** Ce que l'utilisateur doit voir avant d'accepter (`resumeAccord`). */
  accord: { title: string; detail: string };
}

/** Résultat du routage d'un message tapé dans le chat. */
export type RouteOutcome = { kind: "chat" } | { kind: "handled" } | { kind: "unknown-command"; name: string };

/** Services liés à un projet ouvert : registre, extensions, moteur de tâches, interactions. */
export interface WorkspaceServices {
  /** `/commande` → extension ; texte libre → à envoyer à la session principale. */
  route(text: string): Promise<RouteOutcome>;
  commands(): CommandListing[];
  /** Hooks `onPreToolUse` des extensions actives, pour l'arbitre de la session principale. */
  hookGuards(): ToolCallGuard[];
  /** Outils donnés à l'agent principal (`proposer_workflow` si un workflow est actif, ADR 0055). */
  outilsAgent(): ToolSpec[];
  /** Workflows en dossier activés pour ce projet (ADR 0055). */
  workflows(): Promise<WorkflowActif[]>;
  /**
   * Lance un workflow comme sa commande, et dit ce qui a réellement démarré. Sans `accord`, celui
   * du workflow est demandé au confirmeur s'il n'est pas retenu ; avec, il vaut réponse pour ce
   * seul lancement (ADR 0068 : un client sans fenêtre le donne dans son appel).
   */
  lancerWorkflow(nom: string, args: string, o?: { accord?: AccordDonne }): Promise<{ ok: true; taskId: string } | { ok: false; motif: string }>;
  tasks(): Promise<TaskCardDto[]>;
  cancelTask(taskId: string): Promise<void>;
  pendingInteractions(): Promise<InteractionDto[]>;
  respond(id: string, option: string, comment?: string, by?: { role: Role }): Promise<void>;
  /**
   * Démarre ce qui touche aux sessions d'agent : purge des sessions orphelines, puis reprise des
   * tâches. Appelé **après** la libération des services précédents du même projet : sinon leur
   * purge commune du registre des sessions supprimerait celles que ces services ouvrent.
   */
  demarrer?(): Promise<void>;
  dispose(): Promise<void>;
}

export interface WorkspaceServicesArgs {
  workspace: Workspace;
  /** Runtime d'agent obtenu à la demande (authentification au premier besoin). */
  runtime: () => Promise<AgentRuntime>;
  onTask(card: TaskCardDto): void;
  onInteractions(pending: InteractionDto[]): void;
  /** Message d'une extension à consigner dans la conversation. */
  onPost(extensionId: string, markdown: string): void;
  /** Notification système (jalons et alertes), si l'application est en arrière-plan (§7.2). */
  notify?(title: string, body: string): void;
  /**
   * Confirmation dans la fenêtre, pour les commandes du cœur qui élargissent ce que
   * l'application a le droit de lancer — écrire un profil de stack, par exemple (§8.5).
   * Absente, la commande `/stack` n'est pas enregistrée : mieux vaut pas de commande qu'une
   * commande qui écrirait sans demander.
   */
  confirmer?: UserConfirmer;
  /**
   * Modèle réel pour une classe de rôle d'un agent de tâche (ADR 0048), relu dans les réglages à
   * chaque appel. Absent : les agents des tâches ne demandent aucun modèle.
   */
  modelFor?(cls: ModelClass | undefined): Promise<string | undefined>;
}

export type WorkspaceServicesFactory = (args: WorkspaceServicesArgs) => Promise<WorkspaceServices>;
