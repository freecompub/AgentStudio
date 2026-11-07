/**
 * Arguments d'un tour `claude -p` (ADR 0070). Le prompt du tour passe par l'entrée standard, le
 * prompt système et la configuration MCP par fichier : un dossier de passation dépasse vite ce
 * qu'une ligne de commande accepte (Windows : 32 767 caractères).
 */

/** Outils intégrés laissés à l'agent : lire et écrire, jamais de shell (les tests passent par `run_tests`). */
export const OUTILS_INTEGRES = ["Read", "Write", "Edit", "Glob", "Grep"] as const;

/** Nom de notre outil MCP qui reçoit les demandes de permission. */
export const OUTIL_PERMISSION = "permission";

/** Nom sous lequel le modèle voit un outil de notre serveur MCP. */
export const nomMcp = (serveur: string, outil: string) => `mcp__${serveur}__${outil}`;

export interface Tour {
  fichierPrompt: string;
  fichierMcp: string;
  /** Nom de notre serveur MCP dans la configuration. */
  serveur: string;
  /** Nos outils (`ToolSpec.name`), autorisés sans demande. */
  outils: readonly string[];
  sessionId: string;
  /** Vrai : la session existe déjà, on la reprend. */
  reprise: boolean;
  modele?: string;
  budgetUsd?: number;
}

export function argumentsDuTour(t: Tour): string[] {
  const permission = nomMcp(t.serveur, OUTIL_PERMISSION);
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    // Isolement (essais du 06/11) : `--system-prompt` seul n'écarte pas le CLAUDE.md du projet.
    "--setting-sources", "",
    "--disable-slash-commands",
    // Mémoire automatique coupée (essai du 07/11) : le dossier de travail est le dépôt de
    // l'utilisateur, et sa mémoire Claude Code entrerait dans le contexte de nos agents.
    "--settings", JSON.stringify({ autoMemoryEnabled: false }),
    "--strict-mcp-config",
    "--mcp-config", t.fichierMcp,
    "--system-prompt-file", t.fichierPrompt,
    "--tools", OUTILS_INTEGRES.join(","),
    "--allowedTools", ...t.outils.map((o) => nomMcp(t.serveur, o)),
    // Caché au modèle, utilisé par le CLI : toute autre demande passe par notre garde.
    "--disallowedTools", permission,
    "--permission-prompts", "host",
    "--permission-prompt-tool", permission,
    ...(t.reprise ? ["--resume", t.sessionId] : ["--session-id", t.sessionId]),
    ...(t.modele ? ["--model", t.modele] : []),
    ...(t.budgetUsd !== undefined ? ["--max-budget-usd", String(t.budgetUsd)] : []),
  ];
}
