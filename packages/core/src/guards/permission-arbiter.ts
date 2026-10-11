import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { realPath } from "./real-path.js";
import type { GuardDecision, ToolCallGuard, ToolCallRequest } from "../protocols/agent-runtime.js";
import type { UserConfirmer } from "../protocols/interaction.js";
import { composeGuards } from "./compose-guards.js";

/** Règle mémorisée par l'utilisateur (« toujours autoriser ») : commande exacte, domaine web ou outil MCP. */
export interface PermissionRule {
  kind: "shell" | "url" | "mcp";
  value: string;
}

export interface PermissionRules {
  list(): Promise<PermissionRule[]>;
  add(rule: PermissionRule): Promise<void>;
}

type PolicyVerdict = GuardDecision | { decision: "ask"; title: string; detail: string; rule: PermissionRule | null };

/**
 * Commandes Git qui modifient l'historique ou l'arbre : réservées au service Workspace (D29).
 *
 * Les options placées avant le sous-commande sont ignorées, y compris celles qui prennent leur
 * valeur **séparément** (`-C <chemin>`, `-c <clé=valeur>`, `--git-dir <p>`…) : ne consommer que
 * l'option laisserait `git -C /tmp commit` passer pour une commande anodine, et D29 se
 * contournerait par un « toujours autoriser » accordé à celle-ci.
 */
const GIT_OPTION_A_VALEUR = "(?:-[cC]|--git-dir|--work-tree|--namespace|--exec-path|--super-prefix)\\s+\\S+";
const GIT_MUTATION = new RegExp(
  `\\bgit\\s+(?:(?:${GIT_OPTION_A_VALEUR}|-\\S+)\\s+)*(?:commit|reset|checkout|switch|stash|rebase|push|pull|restore|clean|merge|am|cherry-pick|revert|update-ref|tag|branch\\s+-[dDmMfc])\\b`,
);
/** Git en lecture seule, sans métacaractère de shell : autorisé sans question. */
const GIT_READ_ONLY = /^\s*git\s+(?:status|log|diff|show)\b[^;&|`$<>()\n]*$/;

const allow: GuardDecision = { decision: "allow" };
const deny = (reason: string): GuardDecision => ({ decision: "deny", reason });

/**
 * Politique du cœur pour la session principale (non interactive, pure) : lecture et écriture
 * confinées au projet, `.git` intouchable, Git en écriture réservé à l'application ; shell,
 * réseau et outils externes soumis à l'utilisateur.
 */
export function mainSessionPolicy(root: string, req: ToolCallRequest): PolicyVerdict {
  // Chemins réels des deux côtés : un lien sortant placé dans le projet ne doit pas passer.
  const base = realPath(root);
  const inside = (p: string) => {
    const rel = relative(base, realPath(resolve(base, p)));
    return { ok: rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), rel };
  };
  switch (req.kind) {
    case "read":
      if (!req.path) return allow;
      return inside(req.path).ok ? allow : deny(`Lecture interdite hors du projet : ${req.path}`);
    case "write": {
      if (!req.path) return deny("Écriture refusée : chemin inconnu.");
      const { ok, rel } = inside(req.path);
      if (!ok || rel === "") return deny(`Écriture interdite hors du projet : ${req.path}`);
      if (rel.split(sep).includes(".git")) return deny("Le dossier .git est réservé à l'application.");
      return allow;
    }
    case "shell": {
      const command = req.command ?? "";
      if (GIT_MUTATION.test(command))
        return deny("Les opérations Git sont réservées à l'application (checkpoints, synchronisation). N'exécute pas de commande Git qui modifie le dépôt.");
      if (GIT_READ_ONLY.test(command)) return allow;
      return { decision: "ask", title: "Exécuter une commande ?", detail: `L'agent veut exécuter :\n${command}`, rule: { kind: "shell", value: command.trim() } };
    }
    case "url": {
      let host: string | null = null;
      try {
        host = req.url ? new URL(req.url).hostname : null;
      } catch {
        host = null;
      }
      return { decision: "ask", title: "Accéder à Internet ?", detail: `L'agent veut consulter : ${req.url ?? "(adresse inconnue)"}`, rule: host ? { kind: "url", value: host } : null };
    }
    case "mcp":
      return { decision: "ask", title: "Utiliser un outil externe ?", detail: `L'agent veut appeler l'outil ${req.toolName}.`, rule: { kind: "mcp", value: req.toolName } };
    case "custom-tool":
      return allow;
    default:
      return { decision: "ask", title: "Autoriser cette action ?", detail: `L'agent veut utiliser l'outil ${req.toolName}.`, rule: null };
  }
}

export interface PermissionArbiterDeps {
  root: string;
  confirmer: UserConfirmer;
  rules: PermissionRules;
  /** Hooks `onPreToolUse` des extensions actives, relus à chaque appel. */
  extensionGuards: () => ToolCallGuard[];
  hookTimeoutMs?: number;
  /** Politique du profil (§10.3) : « souple » autorise sans question les commandes de test. */
  profilePolicy?: "prudente" | "souple";
}

/** Commande de test seule, sans enchaînement ni redirection. */
const TEST_COMMAND = /^\s*(?:(?:npm|pnpm|yarn)\s+(?:run\s+)?test|(?:npx\s+|pnpm\s+(?:exec\s+)?)?vitest\s+run|dotnet\s+test)\b[^;&|`$<>()\n]*$/;

/**
 * Arbitre unique (D27) : politique du cœur → hooks d'extension (premier refus l'emporte, plantage
 * ou délai = refus, D28) → règles mémorisées → demande à l'écran. Une règle ne contourne jamais
 * un refus du cœur ni d'une extension.
 */
export function createPermissionArbiter(deps: PermissionArbiterDeps): ToolCallGuard {
  return {
    async check(req) {
      const verdict = mainSessionPolicy(deps.root, req);
      if (verdict.decision === "deny") return verdict;

      const hooks = deps.extensionGuards();
      if (hooks.length) {
        const d = await composeGuards(hooks, deps.hookTimeoutMs !== undefined ? { timeoutMs: deps.hookTimeoutMs } : {}).check(req);
        if (d.decision === "deny") return d;
      }
      if (verdict.decision === "allow") return allow;
      if (deps.profilePolicy === "souple" && req.kind === "shell" && TEST_COMMAND.test(req.command ?? "")) return allow;

      const rule = verdict.rule;
      if (rule && (await deps.rules.list()).some((r) => r.kind === rule.kind && r.value === rule.value)) return allow;
      try {
        const answer = await deps.confirmer.confirm({ title: verdict.title, detail: verdict.detail });
        if (answer === "allow-always" && rule) await deps.rules.add(rule);
        return answer === "deny" ? deny("Action refusée par l'utilisateur.") : allow;
      } catch {
        return deny("Confirmation impossible : action refusée par précaution.");
      }
    },
  };
}

export function createMemoryPermissionRules(initial: PermissionRule[] = []): PermissionRules {
  const rules = [...initial];
  return {
    list: async () => [...rules],
    add: async (r) => {
      if (!rules.some((x) => x.kind === r.kind && x.value === r.value)) rules.push(r);
    },
  };
}

/** Règles utilisateur persistées en JSON (profil utilisateur), écriture atomique. */
export function createJsonPermissionRules(file: string): PermissionRules {
  const read = async (): Promise<PermissionRule[]> => {
    try {
      const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
      return Array.isArray(raw)
        ? raw.filter((r): r is PermissionRule => !!r && ["shell", "url", "mcp"].includes((r as PermissionRule).kind) && typeof (r as PermissionRule).value === "string")
        : [];
    } catch {
      return [];
    }
  };
  // Les ajouts se suivent : deux « toujours autoriser » simultanés reliraient tous deux l'état
  // d'avant et l'un écraserait l'autre. Ils partageaient de surcroît le même fichier temporaire,
  // que le premier `rename` faisait disparaître sous le second.
  let file_d_attente: Promise<void> = Promise.resolve();

  return {
    list: read,
    add(rule) {
      const suivant = file_d_attente.then(async () => {
        const rules = await read();
        if (rules.some((r) => r.kind === rule.kind && r.value === rule.value)) return;
        await mkdir(dirname(file), { recursive: true });
        const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
        await writeFile(tmp, JSON.stringify([...rules, rule], null, 2));
        await rename(tmp, file);
      });
      // La file continue même après un échec, sinon un incident bloquerait tous les ajouts.
      file_d_attente = suivant.catch(() => undefined);
      return suivant;
    },
  };
}
