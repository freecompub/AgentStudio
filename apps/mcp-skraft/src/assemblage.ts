/**
 * Assemblage réel du serveur MCP (ADR 0068) : mêmes briques que l'application de bureau
 * (`apps/desktop/src/main/index.ts`), sans Electron. Tout ce que le serveur garde est dans son
 * dossier de données (`~/.agent-studio/mcp-skraft/`) : tâches, piles fournies, verrous, état du
 * CLI Copilot, journal. Le journal va dans un fichier : stdout est le canal du protocole MCP.
 */
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createJsonLogger } from "@agent-studio/core";
import { createNodeLauncher } from "@agent-studio/extension-host";
import { createGhAuth, createNodeCommandRunner, createNodeProcessSpawner } from "@agent-studio/github-auth";
import { defaultAdminConfigPath, loadAdminConfig, workspaceServicesFactory } from "@agent-studio/project-services";
import { createClaudeRuntime, createLanceurClaude, MODELES_CLAUDE } from "@agent-studio/runtime-claude";
import { createCopilotClient, createCopilotRuntime } from "@agent-studio/runtime-copilot";
import { createTypeScriptAdapter } from "@agent-studio/stack-adapters";
import { cliGitRunnerFactory, openWorkspace } from "@agent-studio/workspace";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cheminConfiguration, lireConfiguration } from "./config.js";
import { createConnexion } from "./connexion.js";
import { createConnexionClaude } from "./connexion-claude.js";
import { createDepotsFichier } from "./depots.js";
import { createPilesFichiers } from "./piles.js";
import { createProjets, type Projets } from "./projets.js";
import { createServeurSkraft } from "./serveur.js";
import { ouvrirServicesSansFenetre } from "./services.js";
import { prendreVerrou, processusVivant } from "./verrou.js";

/** Nom du workflow livré avec le serveur (`workflows/skraft/`, `meta.name`). */
export const WORKFLOW_SKRAFT = "skraft-workflow";

export interface OptionsAssemblage {
  home: string;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Dossier du paquet construit : `workflows/` et `workflow-child.mjs`. */
  racinePaquet: string;
  version: string;
}

export async function assemblerServeur(o: OptionsAssemblage): Promise<{ ok: true; mcp: McpServer; projets: Projets } | { ok: false; motif: string }> {
  const donnees = join(o.home, ".agent-studio", "mcp-skraft");
  mkdirSync(join(donnees, "logs"), { recursive: true });
  const fichierJournal = join(donnees, "logs", "mcp-skraft.log");
  const logger = createJsonLogger({ write: (ligne) => appendFileSync(fichierJournal, `${ligne}\n`), level: "info" }, { pid: process.pid });

  const lue = await lireConfiguration(cheminConfiguration(o.env, o.home), { home: o.home });
  if (!lue.ok) return lue;
  const config = lue.config;
  const admin = await loadAdminConfig(defaultAdminConfigPath(process.platform, o.env));
  if (admin.error) logger.error("configuration administrateur invalide : profil restreint appliqué", { source: admin.source, error: admin.error });

  // Runtime des agents (ADR 0070) : Copilot par défaut, ou Claude par le CLI.
  const { connexion, runtime } =
    config.runtime === "claude"
      ? (() => {
          const lanceur = createLanceurClaude();
          const c = createConnexionClaude(lanceur);
          return { connexion: c, runtime: c.runtime(() => createClaudeRuntime({ lanceur, logger: logger.child({ component: "runtime" }) })) };
        })()
      : (() => {
          const c = createConnexion(createGhAuth({ runner: createNodeCommandRunner(), spawner: createNodeProcessSpawner(), hostname: config.hostname }));
          return {
            connexion: c,
            runtime: c.runtime((jeton, hostname) =>
              createCopilotRuntime({
                client: createCopilotClient({ gitHubToken: jeton, hostname, baseDirectory: join(donnees, "copilot") }),
                logger: logger.child({ component: "runtime" }),
              }),
            ),
          };
        })();
  // Modèle par classe de rôle (ADR 0048) : la configuration, sinon le défaut de Claude ; avec
  // Copilot, seulement ce que la configuration nomme (sinon le runtime décide).
  const modeles = config.runtime === "claude" ? { ...MODELES_CLAUDE, ...config.modeles } : config.modeles;
  const modelFor = async (cls: "strong" | "standard" | "light" | undefined) => (cls ? modeles[cls] : undefined);
  const git = cliGitRunnerFactory({ config: { [`credential.https://${config.hostname}.helper`]: "!gh auth git-credential" } });
  const surSortieDErreur = (c: string) => logger.warn("sortie d'erreur d'un workflow", { output: c.slice(0, 2_000) });

  const factory = workspaceServicesFactory({
    extensions: [],
    stacks: [createTypeScriptAdapter()],
    allowedPrograms: admin.allowedPrograms,
    origineDesProgrammes: admin.origineDesProgrammes,
    // Sans pile, refus qui dit quoi fournir (point 8) : un repli ferait échouer les portes.
    sansRepli: true,
    tasksDir: join(donnees, "tasks"),
    clock: { now: () => new Date() },
    ids: { next: () => randomUUID() },
    logger,
    // Le workflow livré avec le serveur ; un workflow du même nom dans le projet le remplace, et
    // son accord est demandé à part (origine « projet »).
    workflows: { machine: join(o.racinePaquet, "workflows"), launcher: createNodeLauncher({ onStderr: surSortieDErreur }), runtimeEntry: join(o.racinePaquet, "workflow-child.mjs") },
  });
  const cle = (root: string) => createHash("sha256").update(root).digest("hex").slice(0, 16);
  const projets = createProjets({
    ouvrir: (root, journal, pileFournie) => ouvrirServicesSansFenetre({ factory, workspace: (r) => openWorkspace(r, { git }), runtime, journal, modelFor })(root, pileFournie),
    // Hors du dépôt : les checkpoints capturent les fichiers non suivis (ADR 0068, point 5).
    verrou: (root) => prendreVerrou(join(donnees, "verrous", `${cle(root)}.lock`), { pid: process.pid, estVivant: processusVivant }),
    piles: createPilesFichiers(join(donnees, "piles")),
  });
  const mcp = createServeurSkraft({ projets, workflow: WORKFLOW_SKRAFT, role: admin.profile.role, autorises: config.autorises, depots: createDepotsFichier(join(donnees, "depots-acceptes.json")), cwd: o.cwd, connexion, version: o.version });
  logger.info("serveur MCP skraft prêt", { version: o.version, role: admin.profile.role, autorises: config.autorises.length, runtime: config.runtime });
  return { ok: true, mcp, projets };
}
