import { ScriptedRuntime } from "@agent-studio/core/testing";
import type { GitHubAuth } from "@agent-studio/github-auth";
import type { FolderPicker, RuntimeFactory } from "./protocols.js";

/**
 * Mode d'essai : l'application démarre avec un runtime d'agent **scripté**, une session GitHub
 * feinte et un sélecteur de dossier qui ne montre aucune boîte native. Il n'existe que pour les
 * essais de bout en bout (Playwright + Electron), qui doivent lancer la vraie application — vrai
 * processus principal, vrai préchargement, vrai IPC — sans jamais appeler Copilot.
 *
 * C'est une consigne explicite du projet : **aucune requête réelle au LLM**, en CI comme ailleurs
 * (§16). Le port `AgentRuntime` rend cela possible sans rien simuler du reste : seul l'adaptateur
 * change, tout le câblage éprouvé est celui de production.
 *
 * ## La garde
 *
 * Deux conditions, dont la seconde est la vraie : la variable d'environnement, **et** une
 * application non empaquetée. Un binaire distribué ne peut donc pas être basculé dans ce mode,
 * quoi qu'on mette dans son environnement. La variable seule ne suffit jamais.
 *
 * ## Ce qu'il faudra faire avant de distribuer
 *
 * Ce module est compilé dans le paquet, inerte mais présent. Le jour où l'application sera
 * publiée, il devra être exclu du bundle de production — la garde protège l'exécution, pas la
 * taille ni la surface de lecture.
 */
const VARIABLE = "AGENT_STUDIO_MODE_ESSAI";

export function modeEssaiActif(app: { isPackaged: boolean }): boolean {
  // `isPackaged` d'abord : c'est la condition qu'aucune variable d'environnement ne contourne.
  return !app.isPackaged && process.env[VARIABLE] === "1";
}

/**
 * Dossier que le sélecteur rendra, au lieu d'ouvrir une boîte native qu'un essai automatisé ne
 * peut pas piloter. L'essai y prépare un dépôt Git avant de lancer l'application.
 */
const DOSSIER = "AGENT_STUDIO_ESSAI_PROJET";
const PAQUET = "AGENT_STUDIO_ESSAI_PAQUET";

export interface FabriquesDEssai {
  auth: GitHubAuth;
  runtimeFactory: RuntimeFactory;
  folderPicker: FolderPicker;
}

export function fabriquesDEssai(): FabriquesDEssai {
  // Une seule instance : l'application demande le runtime à la première conversation, et les
  // comportements scriptés par l'essai doivent lui parvenir.
  const runtime = new ScriptedRuntime();

  return {
    auth: {
      status: async () => ({ loggedIn: true, user: "essai", tokenKind: "oauth", copilotCompatible: true, hostname: "github.invalid" }),
      token: async () => "jeton-d-essai-jamais-envoyé",
      login: async () => ({ loggedIn: true, user: "essai", tokenKind: "oauth", copilotCompatible: true, hostname: "github.invalid" }),
      logout: async () => {},
      hostname: () => "github.invalid",
    },
    runtimeFactory: () => runtime,
    folderPicker: {
      pick: async () => process.env[DOSSIER] ?? null,
      pickPackage: async () => process.env[PAQUET] ?? null,
    },
  };
}
