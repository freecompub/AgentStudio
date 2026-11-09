/**
 * Services d'un projet pour le serveur MCP : les mêmes que l'application de bureau
 * (`@agent-studio/project-services`), sans fenêtre. Les messages de la conversation vont au journal
 * du projet, lu par `skraft_etat`.
 */
import type { AgentRuntime, ModelClass, UserConfirmer } from "@agent-studio/core";
import type { WorkspaceServices, WorkspaceServicesFactory } from "@agent-studio/project-services";
import type { Workspace } from "@agent-studio/workspace";
import type { OuvertureServices } from "./projets.js";

/**
 * Aucune fenêtre où demander : tout ce qui demanderait une confirmation est refusé. L'accord sur le
 * workflow se donne dans l'appel de `skraft_demarrer` (ADR 0068, point 9), pas ici.
 */
const SANS_FENETRE: UserConfirmer = { confirm: async () => "deny" };

export function ouvrirServicesSansFenetre(o: {
  factory: WorkspaceServicesFactory;
  workspace(root: string): Promise<Workspace>;
  runtime(): Promise<AgentRuntime>;
  journal(markdown: string): void;
  modelFor?(cls: ModelClass | undefined): Promise<string | undefined>;
}): (root: string, ouverture?: OuvertureServices) => Promise<WorkspaceServices> {
  return async (root, { pileFournie, confirmerProgrammes, repliPermis } = {}) =>
    o.factory({
      ...(pileFournie !== undefined ? { pileFournie } : {}),
      workspace: await o.workspace(root),
      runtime: o.runtime,
      onTask: () => {},
      onInteractions: () => {},
      onPost: (_extensionId, markdown) => o.journal(markdown),
      confirmer: SANS_FENETRE,
      // La question passe par le client (ADR 0075), pour ce seul usage : le reste demeure sans fenêtre.
      ...(confirmerProgrammes ? { confirmerProgrammes } : {}),
      ...(repliPermis ? { repliPermis } : {}),
      ...(o.modelFor ? { modelFor: o.modelFor } : {}),
    });
}
