import { isAbsolute, relative, resolve, sep } from "node:path";
import type { GuardDecision, ToolCallGuard } from "../protocols/agent-runtime.js";
import { matchesAny } from "./glob.js";

export interface TaskAgentGuardDeps {
  root: string;
  /** Périmètre d'écriture du rôle (globs relatifs à la racine) ; vide = lecture seule. */
  writable: readonly string[];
}

const allow: GuardDecision = { decision: "allow" };
const deny = (reason: string): GuardDecision => ({ decision: "deny", reason });

/**
 * Garde d'un agent de tâche (session sans humain) : lecture dans le projet, écriture dans le
 * seul périmètre du rôle, ni shell, ni réseau, ni outil externe (§8.4, D20). Jamais de question.
 */
export function createTaskAgentGuard(deps: TaskAgentGuardDeps): ToolCallGuard {
  const root = resolve(deps.root);
  const rel = (p: string) => {
    const r = relative(root, resolve(root, p));
    return r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r) ? null : r.split(sep).join("/");
  };

  return {
    async check(req) {
      switch (req.kind) {
        case "read":
          if (!req.path) return allow;
          return rel(req.path) !== null ? allow : deny(`Lecture interdite hors du projet : ${req.path}`);
        case "write": {
          const r = req.path ? rel(req.path) : null;
          if (r === null || r === "" || r.split("/").includes(".git")) return deny(`Écriture interdite : ${req.path ?? "(chemin inconnu)"}`);
          if (!matchesAny(deps.writable, r))
            return deny(
              deps.writable.length
                ? `Écriture interdite hors de ton périmètre : ${r}. Tu ne peux écrire que dans : ${deps.writable.join(", ")}.`
                : `Tu es en lecture seule : écriture refusée sur ${r}.`,
            );
          return allow;
        }
        case "shell":
          return deny("Le shell est désactivé pour ce rôle : les tests sont lancés et vérifiés par l'orchestrateur. Modifie les fichiers avec les outils d'édition, puis termine ta phase.");
        case "custom-tool":
          return allow;
        default:
          return deny(`Outil non autorisé pour ce rôle : ${req.toolName}`);
      }
    },
  };
}
