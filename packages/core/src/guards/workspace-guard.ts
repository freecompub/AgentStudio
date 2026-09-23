import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GuardDecision, ToolCallGuard, ToolCallRequest } from "../protocols/agent-runtime.js";
import type { UserConfirmer } from "../protocols/interaction.js";

export interface WorkspaceGuardDeps {
  root: string;
  confirmer: UserConfirmer;
}

/** Commandes Git qui modifient l'historique ou l'arbre : réservées au service Workspace (D29). */
const GIT_MUTATION =
  /\bgit\s+(?:-\S+\s+)*(?:commit|reset|checkout|switch|stash|rebase|push|pull|restore|clean|merge|am|cherry-pick|revert|update-ref|tag|branch\s+-[dDmMfc])\b/;

/** Git en lecture seule, sans aucun métacaractère de shell : autorisé sans question. */
const GIT_READ_ONLY = /^\s*git\s+(?:status|log|diff|show)\b[^;&|`$<>()\n]*$/;

const allow: GuardDecision = { decision: "allow" };
const deny = (reason: string): GuardDecision => ({ decision: "deny", reason });

/**
 * Garde de la session principale (J1). Politique :
 * lecture et écriture confinées au projet, `.git` intouchable, Git en écriture réservé à
 * l'application, confirmation explicite pour le shell, le réseau et les outils MCP.
 * Toute erreur de confirmation vaut refus (D28).
 */
export function createWorkspaceGuard(deps: WorkspaceGuardDeps): ToolCallGuard {
  const root = resolve(deps.root);

  function insideRoot(path: string): { ok: boolean; rel: string } {
    const abs = resolve(root, path);
    const rel = relative(root, abs);
    const ok = rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
    return { ok, rel };
  }

  async function ask(title: string, detail: string): Promise<GuardDecision> {
    try {
      return (await deps.confirmer.confirm({ title, detail })) ? allow : deny("Action refusée par l'utilisateur.");
    } catch {
      return deny("Confirmation impossible : action refusée par précaution.");
    }
  }

  return {
    async check(req: ToolCallRequest): Promise<GuardDecision> {
      switch (req.kind) {
        case "read": {
          if (!req.path) return allow; // lecture sans chemin (ex. recherche) : bornée par le répertoire de travail
          return insideRoot(req.path).ok ? allow : deny(`Lecture interdite hors du projet : ${req.path}`);
        }
        case "write": {
          if (!req.path) return deny("Écriture refusée : chemin inconnu.");
          const { ok, rel } = insideRoot(req.path);
          if (!ok || rel === "") return deny(`Écriture interdite hors du projet : ${req.path}`);
          if (rel.split(sep).includes(".git")) return deny("Le dossier .git est réservé à l'application.");
          return allow;
        }
        case "shell": {
          const command = req.command ?? "";
          if (GIT_MUTATION.test(command))
            return deny("Les opérations Git sont réservées à l'application (checkpoints, synchronisation). N'exécute pas de commande Git qui modifie le dépôt.");
          if (GIT_READ_ONLY.test(command)) return allow;
          return ask("Exécuter une commande ?", `L'agent veut exécuter :\n${command}`);
        }
        case "url":
          return ask("Accéder à Internet ?", `L'agent veut consulter : ${req.url ?? "(adresse inconnue)"}`);
        case "mcp":
          return ask("Utiliser un outil externe ?", `L'agent veut appeler l'outil ${req.toolName}.`);
        case "custom-tool":
          return allow;
        default:
          return ask("Autoriser cette action ?", `L'agent veut utiliser l'outil ${req.toolName}.`);
      }
    },
  };
}
