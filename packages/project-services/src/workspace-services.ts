import { createHash } from "node:crypto";
import { accessSync, constants as fsConstants } from "node:fs";
import { readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import {
  createHookRegistry,
  createInteractionService,
  createJsonEvidenceStore,
  createJsonInteractionStore,
  createJsonTaskSessionStore,
  createProgressReporter,
  createJsonlTraceStore,
  createUsageRecorder,
  sumUsage,
  type TraceStore,
  type UsageRecorder,
  type UsageRow,
  createLazyRuntime,
  resumerTrace,
  createRegistry,
  createTaskAgentRunner,
  routeIntent,
  type Clock,
  type EvidenceStore,
  type InteractionStore,
  type TaskSessionStore,
  type IdGenerator,
  type Logger,
  type ToolSpec,
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
  FICHIER_PROJET,
  ecrirePileDansProjet,
  lireFichierProjet,
  selectStackAdapter,
  type StackAdapter,
} from "@agent-studio/stack-adapters";
import { createJsonTaskStore, createTaskEngine, type TaskRecord, type TaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import type { UserConfirmer } from "@agent-studio/core";
import type { InteractionDto, TaskCardDto } from "./dto.js";
import type { SourcePile, WorkspaceServices, WorkspaceServicesFactory } from "./protocols.js";
import { activerWorkflow, createJsonAccordStore, lireEntrees, rapportDuWorkflow, resumeAccord, syntaxeCommande, trouverWorkflows, type AccordStore, type EtatWorkflow, type WorkflowTrouve } from "@agent-studio/workflow";
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
  /**
   * Aucune pile (ni profil, ni détection, ni pile fournie) est une erreur, au lieu du repli averti
   * sur le premier adaptateur : un repli ferait échouer toutes les portes pour une mauvaise raison
   * (serveur MCP, ADR 0068, point 8).
   */
  sansRepli?: boolean;
  /** Obligatoire dès qu'une extension est isolée. */
  isolation?: { launcher: ProcessLauncher; runtimeEntry: string };
  /** Dossier des tâches ; un sous-dossier par projet. */
  tasksDir: string;
  clock: Clock;
  ids: IdGenerator;
  logger?: Logger;
  /** Trace d'exécution imposée (tests) ; sinon un fichier JSONL par tâche sous `traces/`. */
  traceStore?: TraceStore;
  /** Pour les tests : stockages imposés. */
  taskStore?: TaskStore;
  evidenceStore?: EvidenceStore;
  interactionStore?: InteractionStore;
  /** Registre des sessions d'agent ouvertes (ADR 0053). */
  taskSessionStore?: TaskSessionStore;
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
  /**
   * Workflows en dossier (ADR 0055) : ceux de la machine (`machine`) et ceux du projet
   * (`.agent-studio/workflows/`), exécutés isolés par `launcher` sur `runtimeEntry`.
   */
  workflows?: { machine?: string; launcher: ProcessLauncher; runtimeEntry: string; accordsFile?: string };
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

/** Aucune pile pour le projet, et pas de repli permis (`sansRepli`). */
export class AucunePile extends Error {
  override name = "AucunePile";
}

/** Fabrique des services d'un projet : assemble registre, moteur, interactions et extensions. */
export function workspaceServicesFactory(cfg: WorkspaceServicesConfig): WorkspaceServicesFactory {
  return async ({ workspace, runtime, onTask, onInteractions, onPost, notify, confirmer, modelFor, pileFournie }) => {
    // Le profil déclaré par le projet l'emporte : c'est lui qui décrit sa vraie chaîne (J5).
    const declare = await lireProfilDuProjet(workspace.root, cfg.allowedPrograms ?? [], onPost, cfg.logger);
    const detected = declare ?? (await selectStackAdapter(workspace.root, cfg.stacks));
    let source: SourcePile = declare ? "projet" : detected ? "detection" : "repli";
    let choisie = detected;
    if (pileFournie !== undefined) {
      if (choisie)
        onPost("agent-studio", `La pile fournie par l'appelant est ignorée : le projet a la sienne, **${choisie.id}** (${declare ? `profil \`${PROFIL_PROJET}\`` : "détection automatique"}).`);
      else {
        // Même contrôle qu'un profil du projet : schéma, et programmes de la liste de l'administrateur.
        const lu = parseStackProfile(pileFournie, { allowedPrograms: cfg.allowedPrograms ?? [] });
        if ("error" in lu) throw new Error(`Pile fournie refusée : ${lu.error}`);
        choisie = createProfileAdapter(lu.profile);
        source = "client";
        onPost("agent-studio", `Stack du projet : **${choisie.id}**, fournie par l'appelant.`);
      }
    }
    if (!choisie && cfg.sansRepli)
      throw new AucunePile(
        `Aucune pile pour ce projet : ni profil \`${PROFIL_PROJET}\`, ni adaptateur qui le reconnaisse (${cfg.stacks.map((s) => s.id).join(", ") || "aucun"}). Fournis une pile au format de \`${PROFIL_PROJET}\`.`,
      );
    const stack = choisie ?? cfg.stacks[0];
    if (!stack) throw new Error("Aucun adaptateur de stack configuré");
    const sources = typeof cfg.extensions === "function" ? await cfg.extensions() : cfg.extensions;
    const manifests = sources.map((e) => e.manifest);
    if (declare) onPost("agent-studio", `Stack du projet : **${declare.id}**, d'après le profil déclaré par le projet.`);
    if (source === "repli") {
      cfg.logger?.warn("aucun adaptateur ne reconnaît le projet", { root: workspace.root, fallback: stack.id });
      // Dit dans la conversation, pas seulement dans le journal : le repli change ce que font
      // les portes et les commandes, et l'utilisateur doit savoir pourquoi.
      onPost(
        "agent-studio",
        `**Ce projet n'est reconnu par aucun adaptateur.** L'application se rabat sur \`${stack.id}\`, dont les commandes de test et les emplacements de fichiers ne correspondent probablement pas. Les commandes qui exécutent des tests risquent d'échouer.`,
      );
    } else cfg.logger?.info("adaptateur de stack retenu", { root: workspace.root, stack: stack.id, source });
    const projectKey = createHash("sha256").update(workspace.root).digest("hex").slice(0, 16);
    const usage = cfg.usageRecorder ?? createUsageRecorder(join(cfg.tasksDir, projectKey, "usage"));
    // Une seule trace pour la tâche : l'exécuteur d'agents y écrit les tours, l'extension y archive
    // les livrables qu'un rollback va effacer (ADR 0038).
    const traceStore = cfg.traceStore ?? createJsonlTraceStore(join(cfg.tasksDir, projectKey, "traces"));
    const usageRows = new Map<string, UsageRow[]>();
    const engine = createTaskEngine({
      usage,
      // Transitions, effets, rejets et arbitrages (ADR 0032) : sans elle, la trace n'avait que les
      // tours d'agent, et un rejet ne se lisait nulle part (run réel du 05/11).
      trace: traceStore,
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
      if (record.status === "finished") {
        // Écriture sur disque : un échec ne doit pas devenir une exception non capturée
        // du processus principal.
        void interactions.cancelForTask(record.id).catch((err: unknown) => cfg.logger?.warn("annulation des demandes impossible", { taskId: record.id, error: String(err) }));
        // Les sessions d'agent survivent d'un essai à l'autre (ADR 0039) : c'est ici qu'elles sont
        // libérées, sans quoi leur état s'accumulerait indéfiniment sur le disque.
        void agents.releaseTask(record.id).catch((err: unknown) => cfg.logger?.warn("libération des sessions impossible", { taskId: record.id, error: String(err) }));
      }
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

    // Un seul exécuteur d'agents pour toutes les extensions : la clé de continuité porte déjà
    // l'identifiant de l'extension, et `releaseTask` doit pouvoir libérer les sessions d'une
    // tâche où qu'elles aient été ouvertes (ADR 0039).
    const agents = createTaskAgentRunner({
      runtime: createLazyRuntime(runtime),
      root: workspace.root,
      ...(cfg.agentIdleMs !== undefined ? { idleMs: cfg.agentIdleMs } : {}),
      ...(cfg.agentMaxTurnMs !== undefined ? { maxMs: cfg.agentMaxTurnMs } : {}),
      ...(cfg.agentMaxInputTokens !== undefined ? { maxInputTokens: cfg.agentMaxInputTokens } : {}),
      ...(cfg.agentMaxContextFraction !== undefined ? { maxContextFraction: cfg.agentMaxContextFraction } : {}),
      // Trace d'exécution (ADR 0032), un fichier JSONL par tâche, à côté des preuves.
      trace: traceStore,
      // Chaque session ouverte est inscrite ici : un crash ne la rend plus orpheline (ADR 0053).
      sessions: cfg.taskSessionStore ?? createJsonTaskSessionStore(join(cfg.tasksDir, projectKey, "sessions")),
      ...(cfg.logger ? { logger: cfg.logger.child({ component: "agents" }) } : {}),
    });
    const hooks = createHookRegistry();
    const handles: ExtensionHandle[] = [];
    const depsCommunes = () => ({
      registry,
      engine,
      agents,
      workspace,
      stack,
      interactions,
      evidence,
      hooks,
      trace: traceStore,
      usage,
      ...(modelFor ? { modelFor } : {}),
      clock: cfg.clock,
      ids: cfg.ids,
      chat: { post: onPost },
      ...(cfg.logger ? { logger: cfg.logger } : {}),
    });
    for (const ext of sources) {
      const hostDeps = {
        registry,
        engine,
        agents,
        workspace,
        stack,
        interactions,
        evidence,
        hooks,
        trace: traceStore,
        usage,
        ...(modelFor ? { modelFor } : {}),
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
    // Workflows en dossier (ADR 0055) : machine puis projet ; avant la reprise des tâches, pour que
    // celles d'un workflow retrouvent leur définition.
    /** Workflows activés, pour l'outil `proposer_workflow` de l'agent principal (`docs/11` §6). */
    const actifs: { nom: string; commande: string; description: string; syntaxe: string; workflow: WorkflowTrouve }[] = [];
    let accordsWorkflows: AccordStore | null = null;
    // Accord donné d'avance par l'appelant de `lancerWorkflow` (ADR 0068) : il répond à la seule
    // demande d'accord de ce lancement, puis tombe, qu'elle ait eu lieu ou non.
    let accordPonctuel: "allow-once" | "allow-always" | null = null;
    const confirmerWorkflows = confirmer && {
      confirm: (r: { title: string; detail: string }) => {
        const a = accordPonctuel;
        accordPonctuel = null;
        return a ? Promise.resolve(a) : confirmer.confirm(r);
      },
    };
    if (cfg.workflows) {
      const recherche = await trouverWorkflows({
        ...(cfg.workflows.machine ? { machine: cfg.workflows.machine } : {}),
        projet: join(workspace.root, ".agent-studio", "workflows"),
      });
      for (const e of recherche.erreurs) onPost("agent-studio", `**Workflow écarté** (\`${e.dossier}\`) : ${e.motifs.join(" ; ")}`);
      for (const r of recherche.remplacements) onPost("agent-studio", `Le workflow « ${r.nom} » du projet remplace celui de la machine (\`${r.dossierMachine}\`).`);
      if (recherche.workflows.length && !confirmer)
        onPost("agent-studio", "Workflows du projet non activés : l'application n'a aucun moyen de demander ton accord avant de les exécuter.");
      else if (confirmer) {
        const accords = createJsonAccordStore(cfg.workflows.accordsFile ?? join(cfg.tasksDir, "accords-workflows.json"));
        accordsWorkflows = accords;
        for (const w of recherche.workflows) {
          const r = await activerWorkflow(w, depsCommunes(), { isolation: { launcher: cfg.workflows.launcher, runtimeEntry: cfg.workflows.runtimeEntry }, accords, confirmer: confirmerWorkflows! });
          if (r.ok) {
            handles.push(r.handle);
            manifests.push(r.manifest);
            actifs.push({ nom: w.nom, commande: w.meta.commande, description: w.meta.description, syntaxe: syntaxeCommande(w.meta.commande, w.meta.entrees), workflow: w });
          } else onPost("agent-studio", `**Workflow écarté** (\`${w.dossier}\`) : ${r.motifs.join(" ; ")}`);
        }
      }
    }
    const lancerWorkflow: WorkspaceServices["lancerWorkflow"] = async (nom, args, o = {}) => {
      const a = actifs.find((x) => x.nom === nom);
      if (!a) return { ok: false, motif: `Workflow inconnu : ${nom}` };
      const lu = lireEntrees(a.workflow.meta.entrees, args, a.commande);
      if (!lu.ok) return { ok: false, motif: lu.usage };
      // Ce qui a réellement démarré, et non ce que la commande était censée faire : un accord
      // refusé ne crée aucune tâche.
      const avant = new Set((await engine.list()).map((t) => t.id));
      accordPonctuel = o.accord === "toujours" ? "allow-always" : o.accord === "une-fois" ? "allow-once" : null;
      try {
        await registry.command(a.commande)!.handler(args);
      } finally {
        accordPonctuel = null;
      }
      const lancee = (await engine.list()).find((t) => !avant.has(t.id));
      return lancee ? { ok: true, taskId: lancee.id } : { ok: false, motif: `Workflow « ${nom} » non lancé : accord refusé.` };
    };
    return {
      async demarrer() {
        // Au démarrage, les sessions encore inscrites sont celles d'un crash, d'une fermeture
        // interrompue ou des services précédents du projet, déjà libérés : on les supprime, et
        // chaque agent repartira neuf (ADR 0053). Sans attendre : si des sessions restent, cela
        // démarre le runtime, ce qui ne doit pas bloquer l'ouverture du projet. Le registre est lu
        // avant toute nouvelle inscription, donc les sessions des tâches reprises ne sont pas visées.
        void agents.releaseAll().catch((err: unknown) => cfg.logger?.warn("purge des sessions impossible", { error: String(err) }));
        await engine.resumeAll();
      },
      async route(text) {
        const intent = routeIntent(registry, text);
        if (intent.kind === "chat") return { kind: "chat" };
        if (intent.kind === "unknown-command") return intent;
        await intent.command.handler(intent.args);
        return { kind: "handled" };
      },
      commands: () => registry.commands(),
      hookGuards: () => hooks.guards(),
      // L'agent principal propose ; l'utilisateur confirme avant tout démarrage (`docs/11` §6).
      outilsAgent: (): ToolSpec[] => {
        if (!actifs.length || !confirmer) return [];
        return [
          {
            name: "proposer_workflow",
            description:
              "Propose à l'utilisateur de lancer un workflow ; rien ne démarre sans sa confirmation. Workflows disponibles :\n" +
              actifs.map((a) => `- ${a.nom} (${a.syntaxe}) : ${a.description}`).join("\n"),
            parameters: {
              type: "object",
              properties: {
                nom: { type: "string", enum: actifs.map((a) => a.nom) },
                arguments: { type: "string", description: "Arguments de la commande, comme l'utilisateur les taperait (ex. stories/us-2.md)." },
              },
              required: ["nom", "arguments"],
              additionalProperties: false,
            },
            async handler(raw) {
              const { nom, arguments: args } = raw as { nom: string; arguments: string };
              const a = actifs.find((x) => x.nom === nom);
              if (!a) throw new Error(`Workflow inconnu : ${nom}`);
              // Une seule demande à l'utilisateur (revue de la PR #12) : tant que l'accord sur le
              // workflow n'est pas donné pour toujours, la commande le demande, et cette demande vaut
              // confirmation de la proposition ; sinon, l'outil confirme lui-même.
              if (await accordsWorkflows?.accorde(a.nom, a.workflow.empreinte)) {
                const r = await confirmer.confirm({ title: `Lancer le workflow « ${nom} » proposé par l'agent ?`, detail: `/${a.commande} ${args}\n\n${a.description}` });
                if (r === "deny") return "Proposition refusée par l'utilisateur : ne relance pas ce workflow sans qu'il le demande.";
              }
              const r = await lancerWorkflow(nom, args);
              if (!r.ok) return `Rien n'a démarré : ${r.motif}\n\nNe dis pas que /${a.commande} tourne.`;
              return `Workflow lancé : /${a.commande} ${args} (tâche ${r.taskId}). L'avancement s'affiche dans le panneau des tâches.`;
            },
          },
        ];
      },
      workflows: async () =>
        Promise.all(
          actifs.map(async (a) => ({
            nom: a.nom,
            commande: a.commande,
            description: a.description,
            syntaxe: a.syntaxe,
            accordRetenu: (await accordsWorkflows?.accorde(a.nom, a.workflow.empreinte)) ?? false,
            accord: resumeAccord(a.workflow),
          })),
        ),
      pile: () => ({ id: stack.id, source }),
      lancerWorkflow,
      async rapportWorkflow(taskId) {
        const r = (await engine.list()).find((t) => t.id === taskId);
        // Les tâches de workflow sont celles des déclarations `workflow.<nom>` (manifesteDuWorkflow).
        return r && r.name.startsWith("workflow.") ? rapportDuWorkflow(r.state as EtatWorkflow) : null;
      },
      etapesDuRun: async (taskId) => resumerTrace(await traceStore.list(taskId).catch(() => [])).etapes,
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
        // Fermeture normale traitée comme un crash (ADR 0053) : aucune session ne survit au
        // processus, pas même celles d'une tâche en attente d'une réponse humaine.
        await agents.releaseAll().catch((err: unknown) => cfg.logger?.warn("libération des sessions impossible", { error: String(err) }));
      },
    };
  };
}

/** Ancien emplacement du profil (avant l'ADR 0071), relu le temps de la transition. */
const PROFIL_PROJET = ".agent-studio/stack.yaml";

/** Où est le profil de pile du projet, et ce qu'il faut en dire (ADR 0071). */
interface SourceDuProfil {
  /** Nom à donner dans les messages : `projet.yaml` (section pile) ou l'ancien `stack.yaml`. */
  libelle: string;
  /** Profil en YAML ; `null` : le fichier de projet n'a pas de section `pile`. */
  brut: string | null;
  erreur?: string;
  avertissements: string[];
}

async function lireOuNul(chemin: string): Promise<string | null> {
  try {
    return await readFile(chemin, "utf8");
  } catch {
    return null;
  }
}

/** `projet.yaml` fait foi (ADR 0071) ; sinon l'ancien `stack.yaml`, avec un avertissement. */
async function lireSourceDuProfil(root: string): Promise<SourceDuProfil | null> {
  const projet = await lireOuNul(join(root, FICHIER_PROJET));
  const ancien = await lireOuNul(join(root, PROFIL_PROJET));
  if (projet !== null) {
    const avertissements = ancien !== null ? [`\`${PROFIL_PROJET}\` est ignoré : \`${FICHIER_PROJET}\` fait foi, supprime-le (ADR 0071).`] : [];
    const p = lireFichierProjet(projet);
    if ("error" in p) return { libelle: `\`${FICHIER_PROJET}\``, brut: null, erreur: p.error, avertissements };
    return { libelle: `\`${FICHIER_PROJET}\` (section pile)`, brut: p.pile ?? null, avertissements };
  }
  if (ancien !== null)
    return { libelle: `\`${PROFIL_PROJET}\``, brut: ancien, avertissements: [`Profil de pile lu dans \`${PROFIL_PROJET}\` : regroupe-le dans \`${FICHIER_PROJET}\`, section pile (ADR 0071).`] };
  return null;
}

/**
 * Lit le profil déclaré par le projet, s'il existe. Un profil refusé n'interrompt pas
 * l'ouverture : il est expliqué à l'utilisateur — champ et valeur fautive nommés — et la
 * détection habituelle reprend la main. Le fichier vient du dépôt, donc d'une source que
 * l'agent peut modifier : les programmes qu'il nomme sont soumis à la liste de l'administrateur.
 */
async function lireProfilDeclare(root: string, allowedPrograms: readonly string[]): Promise<ProfilDeclare> {
  const src = await lireSourceDuProfil(root);
  if (!src) return null; // pas de profil : la détection s'applique, sans rien dire
  if (src.erreur) return { error: src.erreur };
  if (src.brut === null) return null;
  const lu = parseStackProfile(src.brut, { allowedPrograms });
  return "error" in lu ? { error: `${src.libelle} : ${lu.error}` } : lu;
}

async function lireProfilDuProjet(
  root: string,
  allowedPrograms: readonly string[],
  onPost: (extensionId: string, markdown: string) => void,
  logger?: Logger,
): Promise<StackAdapter | null> {
  const src = await lireSourceDuProfil(root);
  for (const a of src?.avertissements ?? []) onPost("agent-studio", a);
  const lu = await lireProfilDeclare(root, allowedPrograms);
  if (lu === null) return null;
  if ("error" in lu) {
    logger?.warn("profil de stack refusé", { root, error: lu.error });
    onPost("agent-studio", `**Le profil de stack du projet est refusé.** ${lu.error}\n\nL'application se rabat sur la détection automatique ; corrigez ${src?.libelle ?? `\`${FICHIER_PROJET}\``} puis rouvrez le projet.`);
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
    // `/stack init` écrit la section `pile` du fichier de projet (ADR 0071).
    chemin: FICHIER_PROJET,
    profilDeclare: () => lireProfilDeclare(workspace.root, allowedPrograms),
    stackActive: () => ({ id: stack.id, declaree }),
    post: (markdown) => onPost("agent-studio", markdown),
    confirmer: (req) => confirmer.confirm(req),
    async ecrireProfil(yaml) {
      const existant = await workspace.files.read(FICHIER_PROJET).catch(() => null);
      const r = ecrirePileDansProjet(existant, yaml);
      if (typeof r !== "string") throw new Error(r.error);
      await workspace.files.write(FICHIER_PROJET, r);
    },

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
