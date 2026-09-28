import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import {
  createHookRegistry,
  createInteractionService,
  createJsonEvidenceStore,
  createJsonInteractionStore,
  createProgressReporter,
  createUsageRecorder,
  sumUsage,
  type UsageRecorder,
  type UsageRow,
  createLazyRuntime,
  createRegistry,
  createTaskAgentRunner,
  routeIntent,
  type Clock,
  type EvidenceStore,
  type InteractionStore,
  type IdGenerator,
  type Logger,
} from "@agent-studio/core";
import type { ExtensionManifest } from "@agent-studio/extension-api";
import {
  activateInProcess,
  activateIsolated,
  type ExtensionHandle,
  type IsolatedExtension,
  type LoadedExtension,
  type ProcessLauncher,
} from "@agent-studio/extension-host";
import {
  createNodeProcessRunner,
  createProfileAdapter,
  diagnoseProfile,
  globToRegExp,
  runCanaries,
  parseStackProfile,
  selectStackAdapter,
  type StackAdapter,
} from "@agent-studio/stack-adapters";
import { createJsonTaskStore, createTaskEngine, type TaskRecord, type TaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import type { UserConfirmer } from "@agent-studio/core";
import type { InteractionDto, TaskCardDto } from "../shared/ipc-contract.js";
import type { WorkspaceServicesFactory } from "./protocols.js";
import { createStackCommand, type ProfilDeclare, type StackCommandDeps } from "./stack-command.js";

/** Extension à activer : dans le principal (tests, J2) ou dans son propre processus (J4). */
export type ExtensionSource = ({ kind: "in-process" } & LoadedExtension) | ({ kind: "isolated" } & IsolatedExtension);

export interface WorkspaceServicesConfig {
  /** Extensions à activer, relues à chaque ouverture de projet (installation, révocation). */
  extensions: ExtensionSource[] | (() => Promise<ExtensionSource[]>);
  /** Adaptateurs de stack, par ordre de préférence : le premier qui reconnaît le projet est retenu. */
  stacks: StackAdapter[];
  /** Programmes qu'un profil de stack peut lancer (D47, O12) ; vide = aucun profil n'est accepté. */
  allowedPrograms?: readonly string[];
  /** Obligatoire dès qu'une extension est isolée. */
  isolation?: { launcher: ProcessLauncher; runtimeEntry: string };
  /** Dossier des tâches ; un sous-dossier par projet. */
  tasksDir: string;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
  /** Pour les tests : stockages imposés. */
  taskStore?: TaskStore;
  evidenceStore?: EvidenceStore;
  interactionStore?: InteractionStore;
  usageRecorder?: UsageRecorder;
  /** Unité d'usage du runtime (`RuntimeCapabilities.usageUnit`). */
  usageUnit?: "requests" | "tokens";
  agentIdleMs?: number;
  /** Plafond de durée totale d'un tour d'agent (ADR 0026). */
  agentMaxTurnMs?: number;
  /** Plafond du cumul des tokens d'entrée d'un tour (ADR 0027, désactivé par défaut depuis 0031). */
  agentMaxInputTokens?: number;
  /** Fraction de la fenêtre de contexte au-delà de laquelle un tour est coupé (ADR 0031). */
  agentMaxContextFraction?: number;
}

/** Construit la carte de tâche (§7.2) à partir de l'état persisté et des libellés du manifeste. */
export function toTaskCard(
  record: TaskRecord,
  manifests: ExtensionManifest[],
  usage?: { unit: "requests" | "tokens"; rows: UsageRow[] },
): TaskCardDto {
  const [extId, taskName] = record.name.split("/") as [string, string];
  const decl = manifests.find((m) => m.id === extId)?.contributes.tasks?.find((t) => t.name === taskName);
  const s = (record.state ?? {}) as {
    phase?: string;
    feature?: string;
    current?: number;
    steps?: { behavior: string }[];
    feedback?: string;
    retries?: Record<string, number>;
  };
  // Nom d'état publié par le moteur (phaseOf de la tâche), sinon convention `state.phase`.
  const phase = record.phase ?? s.phase ?? "";
  const step = s.steps?.[s.current ?? 0];
  return {
    id: record.id,
    title: `${decl?.title ?? record.name}${s.feature ? ` : ${s.feature}` : ""}`,
    phase,
    phaseLabel: decl?.states[phase] ?? phase,
    status: record.status,
    alert: decl?.alerts?.includes(phase) ?? false,
    milestone: decl?.milestones?.includes(phase) ?? false,
    ...(step && s.steps ? { step: { index: (s.current ?? 0) + 1, total: s.steps.length, behavior: step.behavior } } : {}),
    ...(s.feedback ? { feedback: s.feedback } : {}),
    ...(usage ? { usage: usageDto(usage.unit, usage.rows, s.retries ?? {}, decl?.states ?? {}) } : {}),
    updatedAt: record.updatedAt,
  };
}

/** Usage par état : compteurs de l'enregistreur, réessais tenus par la tâche, libellés du manifeste. */
function usageDto(unit: "requests" | "tokens", rows: UsageRow[], retries: Record<string, number>, labels: Record<string, string>) {
  const phases = [...rows.map((r) => r.phase), ...Object.keys(retries).filter((p) => !rows.some((r) => r.phase === p))];
  const merged = phases.map((phase) => {
    const r = rows.find((x) => x.phase === phase);
    return {
      phase,
      label: labels[phase] ?? phase,
      requests: r?.requests ?? 0,
      inputTokens: r?.inputTokens ?? 0,
      outputTokens: r?.outputTokens ?? 0,
      retries: retries[phase] ?? 0,
      durationMs: r?.durationMs ?? 0,
    };
  });
  const t = sumUsage(merged.map((m) => ({ ...m, effects: 0 })));
  return { unit, rows: merged, total: { phase: "total", label: "Total", requests: t.requests, inputTokens: t.inputTokens, outputTokens: t.outputTokens, retries: t.retries, durationMs: t.durationMs } };
}

/** Fabrique des services d'un projet : assemble registre, moteur, interactions et extensions. */
export function workspaceServicesFactory(cfg: WorkspaceServicesConfig): WorkspaceServicesFactory {
  return async ({ workspace, runtime, onTask, onInteractions, onPost, notify, confirmer }) => {
    const sources = typeof cfg.extensions === "function" ? await cfg.extensions() : cfg.extensions;
    const manifests = sources.map((e) => e.manifest);
    // Le profil déclaré par le projet l'emporte : c'est lui qui décrit sa vraie chaîne (J5).
    const declare = await lireProfilDuProjet(workspace.root, cfg.allowedPrograms ?? [], onPost, cfg.logger);
    const detected = declare ?? (await selectStackAdapter(workspace.root, cfg.stacks));
    const stack = detected ?? cfg.stacks[0];
    if (!stack) throw new Error("Aucun adaptateur de stack configuré");
    if (declare) onPost("agent-studio", `Stack du projet : **${declare.id}**, d'après le profil \`${PROFIL_PROJET}\`.`);
    if (!detected) {
      cfg.logger?.warn("aucun adaptateur ne reconnaît le projet", { root: workspace.root, fallback: stack.id });
      // Dit dans la conversation, pas seulement dans le journal : le repli change ce que font
      // les portes et les commandes, et l'utilisateur doit savoir pourquoi.
      onPost(
        "agent-studio",
        `**Ce projet n'est reconnu par aucun adaptateur.** L'application se rabat sur \`${stack.id}\`, dont les commandes de test et les emplacements de fichiers ne correspondent probablement pas. Les commandes qui exécutent des tests risquent d'échouer.`,
      );
    } else cfg.logger?.info("adaptateur de stack retenu", { root: workspace.root, stack: stack.id });
    const projectKey = createHash("sha256").update(workspace.root).digest("hex").slice(0, 16);
    const usage = cfg.usageRecorder ?? createUsageRecorder(join(cfg.tasksDir, projectKey, "usage"));
    const usageRows = new Map<string, UsageRow[]>();
    const engine = createTaskEngine({
      usage,
      store: cfg.taskStore ?? createJsonTaskStore(join(cfg.tasksDir, projectKey)),
      checkpoints: workspace.checkpoints,
      clock: cfg.clock,
      ids: cfg.ids,
      ...(cfg.logger ? { logger: cfg.logger.child({ component: "tasks" }) } : {}),
    });
    const interactions = createInteractionService({
      // Demandes persistées : une escalade survit au redémarrage (J3, D31).
      store: cfg.interactionStore ?? createJsonInteractionStore(join(cfg.tasksDir, projectKey, "interactions")),
      clock: cfg.clock,
      ids: cfg.ids,
      deliver: (taskId, option, comment) => engine.dispatch(taskId, { type: "HUMAN_DECISION", decision: option, ...(comment ? { comment } : {}) }),
    });
    const toDto = (r: Awaited<ReturnType<typeof interactions.pending>>[number]): InteractionDto => ({
      id: r.id,
      taskId: r.taskId,
      extensionId: r.extensionId,
      title: r.title,
      options: r.options,
      createdAt: r.createdAt,
      ...(r.detail ? { detail: r.detail } : {}),
      ...(r.requiredRoles ? { requiredRoles: r.requiredRoles } : {}),
      ...(r.freeText ? { freeText: true } : {}),
    });
    const offInteractions = interactions.onChange((pending) => onInteractions(pending.map(toDto)));
    const latestCards = new Map<string, TaskCardDto>();
    const reporter = createProgressReporter({
      onCard: (s) => {
        const card = latestCards.get(s.taskId);
        if (card) onTask(card);
      },
      onMilestone: (s, text) => {
        onPost(s.extensionId, text);
        notify?.("Jalon atteint", text);
      },
      onAlert: (s, text) => {
        onPost(s.extensionId, text);
        notify?.("Tâche à surveiller", text);
      },
    });
    const unit = cfg.usageUnit ?? "requests";
    const records = new Map<string, TaskRecord>();
    const publish = (record: TaskRecord) => {
      const rows = usageRows.get(record.id);
      const card = toTaskCard(record, manifests, rows ? { unit, rows } : undefined);
      latestCards.set(card.id, card);
      reporter.update({
        taskId: card.id,
        extensionId: record.name.split("/")[0] ?? "",
        title: card.title,
        phase: card.phase,
        phaseLabel: card.phaseLabel,
        milestone: card.milestone,
        alert: card.alert,
        ...(card.step ? { step: card.step } : {}),
        ...(card.feedback ? { detail: card.feedback } : {}),
      });
    };
    const offTasks = engine.onUpdate((record) => {
      records.set(record.id, record);
      publish(record);
      if (record.status === "finished")
        // Écriture sur disque : un échec ne doit pas devenir une exception non capturée
        // du processus principal.
        void interactions.cancelForTask(record.id).catch((err: unknown) => cfg.logger?.warn("annulation des demandes impossible", { taskId: record.id, error: String(err) }));
    });
    // L'usage arrive aussi hors transition (fin d'un tour d'agent) : la carte suit.
    const offUsage = usage.onChange((taskId, rows) => {
      usageRows.set(taskId, rows);
      const record = records.get(taskId);
      if (record) publish(record);
    });
    for (const r of await engine.list()) usageRows.set(r.id, await usage.report(r.id));

    const evidence = cfg.evidenceStore ?? createJsonEvidenceStore(join(cfg.tasksDir, projectKey, "evidence"));
    const registry = createRegistry();

    // `/stack` appartient au cœur, pas à une extension : elle décrit le projet lui-même, et
    // doit rester disponible même quand aucune extension n'est installée.
    if (confirmer)
      registry.addCommand({
        extensionId: "agent-studio",
        name: "stack",
        title: "Stack du projet",
        description: "Affiche la stack employée ; `init` propose un profil à déclarer, `doctor` dit ce qu'il vaut.",
        handler: createStackCommand(
          stackCommandDeps({ workspace, allowedPrograms: cfg.allowedPrograms ?? [], stack, declaree: declare !== null, confirmer, onPost }),
        ),
      });

    const hooks = createHookRegistry();
    const handles: ExtensionHandle[] = [];
    for (const ext of sources) {
      const hostDeps = {
        registry,
        engine,
        agents: createTaskAgentRunner({
          runtime: createLazyRuntime(runtime),
          root: workspace.root,
          ...(cfg.agentIdleMs !== undefined ? { idleMs: cfg.agentIdleMs } : {}),
          ...(cfg.agentMaxTurnMs !== undefined ? { maxMs: cfg.agentMaxTurnMs } : {}),
          ...(cfg.agentMaxInputTokens !== undefined ? { maxInputTokens: cfg.agentMaxInputTokens } : {}),
          ...(cfg.agentMaxContextFraction !== undefined ? { maxContextFraction: cfg.agentMaxContextFraction } : {}),
          ...(cfg.logger ? { logger: cfg.logger.child({ component: "agents" }) } : {}),
        }),
        workspace,
        stack,
        interactions,
        evidence,
        hooks,
        usage,
        clock: cfg.clock,
        ids: cfg.ids,
        chat: { post: onPost },
        ...(cfg.logger ? { logger: cfg.logger } : {}),
      };
      try {
        if (ext.kind === "in-process") handles.push(await activateInProcess({ manifest: ext.manifest, module: ext.module }, hostDeps));
        else {
          if (!cfg.isolation) throw new Error("Aucun lanceur d'hôte d'extension configuré");
          handles.push(await activateIsolated({ manifest: ext.manifest, directory: ext.directory, entry: ext.entry }, hostDeps, cfg.isolation));
        }
      } catch (err) {
        cfg.logger?.error("activation d'extension impossible", { extensionId: ext.manifest.id, error: String(err) });
        onPost(ext.manifest.id, `L'extension ${ext.manifest.id} n'a pas pu être activée : ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await engine.resumeAll();

    return {
      async route(text) {
        const intent = routeIntent(registry, text);
        if (intent.kind === "chat") return { kind: "chat" };
        if (intent.kind === "unknown-command") return intent;
        await intent.command.handler(intent.args);
        return { kind: "handled" };
      },
      commands: () => registry.commands(),
      hookGuards: () => hooks.guards(),
      tasks: async () =>
        (await engine.list())
          .map((r) => toTaskCard(r, manifests, usageRows.has(r.id) ? { unit, rows: usageRows.get(r.id)! } : undefined))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      cancelTask: (taskId) => engine.cancel(taskId),
      pendingInteractions: async () => (await interactions.pending()).map(toDto),
      respond: (id, option, comment, by) => interactions.respond(id, option, comment, by),
      async dispose() {
        offTasks();
        offUsage();
        reporter.dispose();
        offInteractions();
        for (const h of handles) await h.deactivate();
      },
    };
  };
}

/** Emplacement du profil, dans le dépôt : il décrit le projet et se versionne avec lui. */
const PROFIL_PROJET = ".agent-studio/stack.yaml";

/**
 * Lit le profil déclaré par le projet, s'il existe. Un profil refusé n'interrompt pas
 * l'ouverture : il est expliqué à l'utilisateur — champ et valeur fautive nommés — et la
 * détection habituelle reprend la main. Le fichier vient du dépôt, donc d'une source que
 * l'agent peut modifier : les programmes qu'il nomme sont soumis à la liste de l'administrateur.
 */
async function lireProfilDeclare(root: string, allowedPrograms: readonly string[]): Promise<ProfilDeclare> {
  let brut: string;
  try {
    brut = await readFile(join(root, PROFIL_PROJET), "utf8");
  } catch {
    return null; // pas de profil : la détection s'applique, sans rien dire
  }
  return parseStackProfile(brut, { allowedPrograms });
}

async function lireProfilDuProjet(
  root: string,
  allowedPrograms: readonly string[],
  onPost: (extensionId: string, markdown: string) => void,
  logger?: Logger,
): Promise<StackAdapter | null> {
  const lu = await lireProfilDeclare(root, allowedPrograms);
  if (lu === null) return null;
  if ("error" in lu) {
    logger?.warn("profil de stack refusé", { root, error: lu.error });
    onPost("agent-studio", `**Le profil de stack du projet est refusé.** ${lu.error}\n\nL'application se rabat sur la détection automatique ; corrigez \`${PROFIL_PROJET}\` puis rouvrez le projet.`);
    return null;
  }
  return createProfileAdapter(lu.profile);
}

/**
 * Dépendances de `/stack`, toutes tirées du Workspace — seul service autorisé à toucher le
 * disque. `programmeTrouvable` cherche dans le PATH sans rien exécuter : lancer un programme
 * pour savoir s'il existe serait exactement ce que la liste blanche cherche à éviter.
 */
function stackCommandDeps(args: {
  workspace: Workspace;
  allowedPrograms: readonly string[];
  stack: StackAdapter;
  declaree: boolean;
  confirmer: UserConfirmer;
  onPost: (extensionId: string, markdown: string) => void;
}): StackCommandDeps {
  const { workspace, allowedPrograms, stack, declaree, confirmer, onPost } = args;
  const fichiers = () => workspace.files.list();

  return {
    chemin: PROFIL_PROJET,
    profilDeclare: () => lireProfilDeclare(workspace.root, allowedPrograms),
    stackActive: () => ({ id: stack.id, declaree }),
    post: (markdown) => onPost("agent-studio", markdown),
    confirmer: (req) => confirmer.confirm(req),
    ecrireProfil: (yaml) => workspace.files.write(PROFIL_PROJET, yaml),

    async indices() {
      const tous = await fichiers();
      // Seule la racine intéresse la détection : un `pyproject.toml` enfoui dans un exemple ne
      // dit rien de la stack du projet.
      const racine = tous.filter((f) => !f.includes("/"));
      let dependances: string[] = [];
      try {
        const pkg = JSON.parse(await workspace.files.read("package.json")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        dependances = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
      } catch {
        /* pas de package.json lisible : on s'en tient aux fichiers */
      }
      return { fichiers: racine, dependances };
    },

    /**
     * Éprouve le profil en l'exécutant, dans une copie isolée jetable (§8.6, point 4). Jamais
     * dans le répertoire de l'utilisateur : l'un des canaris ne compile pas volontairement.
     */
    async canaris(profile) {
      const copie = await workspace.repo.worktree();
      try {
        const { constats } = await runCanaries(profile, { runner: createNodeProcessRunner(), sandboxRoot: copie.root });
        return constats;
      } finally {
        await copie.dispose();
      }
    },

    async diagnostiquer(profile) {
      const tous = await fichiers();
      return diagnoseProfile(profile, {
        programmeTrouvable: (p) => dansLePath(p),
        cheminExiste: (glob) => {
          const re = globToRegExp(glob);
          return tous.some((f) => re.test(f));
        },
        fichiersDeDetectionPresents: profile.detect.some((d) => tous.includes(d)),
      });
    },
  };
}

/** Le programme est-il lançable ? Recherche dans le PATH, sans exécuter quoi que ce soit. */
function dansLePath(programme: string): boolean {
  const chemins = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean);
  const suffixes = process.platform === "win32" ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";") : [""];
  for (const base of chemins)
    for (const suffixe of suffixes) {
      try {
        accessSync(join(base, `${programme}${suffixe}`), fsConstants.X_OK);
        return true;
      } catch {
        /* pas ici : on continue */
      }
    }
  return false;
}
