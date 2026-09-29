import { isAbsolute, relative, resolve, sep } from "node:path";
import { realPath } from "./real-path.js";
import type { GuardDecision, ToolCallGuard } from "../protocols/agent-runtime.js";
import { matchesAny } from "./glob.js";

export interface TaskAgentGuardDeps {
  root: string;
  /** Périmètre d'écriture du rôle (globs relatifs à la racine) ; vide = lecture seule. */
  writable: readonly string[];
  /**
   * Outils dont le rôle dispose (ADR 0033). Sert uniquement à rédiger un refus utile : ne proposer
   * à l'agent que des sorties qui existent pour lui.
   */
  outils?: readonly string[];
}

const allow: GuardDecision = { decision: "allow" };
const deny = (reason: string): GuardDecision => ({ decision: "deny", reason });

/**
 * Garde d'un agent de tâche (session sans humain) : lecture dans le projet, écriture dans le
 * seul périmètre du rôle, ni shell, ni réseau, ni outil externe (§8.4, D20). Jamais de question.
 */
/**
 * Motif d'un refus de shell (ADR 0033).
 *
 * Le refus lui-même n'est pas discutable : décider qu'une commande est inoffensive demanderait de
 * l'analyser, et `ls -la .skraft; rm -rf /` passerait n'importe quelle liste blanche. Ce qui l'est,
 * c'est ce qu'on répond. L'ancien message invoquait l'exécution des tests — hors sujet pour un
 * chercheur qui voulait lister un dossier — et n'orientait que vers l'écriture, alors que la
 * tentative observée était une **lecture**. Dix-huit refus successifs n'avaient pas suffi à faire
 * trouver la sortie.
 *
 * On ne propose donc que des sorties qui existent pour ce rôle-là.
 */
function refusDeShell(deps: TaskAgentGuardDeps): string {
  const sorties = ["pour **lire** un fichier ou explorer le projet, sers-toi de tes outils de lecture"];
  if (deps.writable.length) sorties.push(`pour **écrire**, des outils d'édition, dans ton périmètre (${deps.writable.join(", ")})`);
  if (deps.outils?.includes("run_tests")) sorties.push("pour lancer les tests, l'outil `run_tests` : son résultat fait foi et il est enregistré comme preuve");
  if (deps.outils?.includes("run_lint")) sorties.push("pour l'analyse statique, l'outil `run_lint`");
  return `Le shell est désactivé pour ce rôle, sans exception : aucune commande ne peut être autorisée, même en lecture. Utilise tes outils — ${sorties.join(" ; ")}.`;
}

export function createTaskAgentGuard(deps: TaskAgentGuardDeps): ToolCallGuard {
  // Chemins réels des deux côtés : un lien sortant placé dans le projet ne doit pas passer.
  const root = realPath(deps.root);
  const rel = (p: string) => {
    const r = relative(root, realPath(resolve(root, p)));
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
          // `.git` comparé sans la casse (ADR 0035) : sur Windows et macOS, `.GIT/config` est le
          // même fichier, et un refus qui ne le reconnaît pas ne refuse rien.
          if (r === null || r === "" || r.split("/").some((seg) => seg.toLowerCase() === ".git"))
            return deny(`Écriture interdite : ${req.path ?? "(chemin inconnu)"}`);
          if (!matchesAny(deps.writable, r))
            return deny(
              deps.writable.length
                ? `Écriture interdite hors de ton périmètre : ${r}. Tu ne peux écrire que dans : ${deps.writable.join(", ")}.`
                : `Tu es en lecture seule : écriture refusée sur ${r}.`,
            );
          return allow;
        }
        case "shell":
          return deny(refusDeShell(deps));
        case "custom-tool":
          return allow;
        default:
          return deny(`Outil non autorisé pour ce rôle : ${req.toolName}`);
      }
    },
  };
}
