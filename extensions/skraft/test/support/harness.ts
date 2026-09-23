/**
 * Banc d'essai de skraft : vrai dépôt Git, vraie pile (moteur, hôte, exécuteur d'agents, preuves,
 * interactions persistées), agents simulés par un runtime scripté. Aucun LLM.
 */
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createHookRegistry,
  createInteractionService,
  createJsonEvidenceStore,
  createJsonInteractionStore,
  createRegistry,
  createTaskAgentRunner,
  createUsageRecorder,
} from "@agent-studio/core";
import { sequentialIds, type ScriptedBehavior, type ScriptedRuntime } from "@agent-studio/core/testing";
import { activateInProcess, activateIsolated, bundle, createNodeLauncher, type ExtensionHandle, type HostDeps } from "@agent-studio/extension-host";
import { createJsonTaskStore, createTaskEngine, type TaskRecord } from "@agent-studio/task-engine";
import { openWorkspace, type Workspace } from "@agent-studio/workspace";
import { manifest, skraftExtension, type SkraftState } from "../../src/index.js";

export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", ...args], { cwd, encoding: "utf8" }).trim();

export async function put(root: string, rel: string, content: string) {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), content);
}

export const US12 = `# US-12 — Plafonner le bolus proposé

En tant que patient, quand le calcul propose une dose de bolus supérieure au plafond défini par mon médecin,
je veux que la dose proposée soit limitée à ce plafond et qu'une alerte m'explique pourquoi.

## Critères d'acceptation
1. Plafond de 10 U, calcul à 6 U : dose proposée 6 U, pas d'alerte.
2. Plafond de 10 U, calcul à 12,5 U : dose proposée 10 U, alerte « Dose plafonnée à 10 U ».
3. Aucun plafond configuré : dose proposée égale au calcul, pas d'alerte.

## Questions ouvertes
- Le plafond s'applique-t-il par prise ou par jour ?
`;

export const SIMPLE = `# US-7 — Afficher l'unité

En tant que patient, je veux voir l'unité de la dose.

## Critères d'acceptation
1. La dose est affichée avec « U ».
`;

/** Projet Swift de démonstration (code seulement : S1 ne lance aucun test). */
export async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-studio-skraft-"));
  await put(root, "Package.swift", "// swift-tools-version:5.9\n");
  await put(root, "Sources/Domain/BolusCalculator.swift", "public struct BolusCalculator {}\n");
  await put(root, "Sources/Settings/MaxBolusSetting.swift", "public struct MaxBolusSetting {}\n");
  await put(root, "stories/us-12.md", US12);
  await put(root, "stories/us-7.md", SIMPLE);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

export const ROLE = (name: string) => `agent-studio.skraft/${name}`;

/** Agents simulés : chacun écrit son livrable dans son périmètre puis rend la main. */
export function simulatedAgents(runtime: ScriptedRuntime, root: string, over: Partial<Record<string, ScriptedBehavior>> = {}): ScriptedRuntime {
  const writer = (rel: string, content: string): ScriptedBehavior => async (t) => {
    await put(root, rel, content);
    await t.callTool("report_phase", { summary: `écrit ${rel}`, files: [rel] });
  };
  const behaviors: Record<string, ScriptedBehavior> = {
    "skraft-classifier": async (t) => {
      const proposed = /Niveau proposé par la grille : (\S+)/.exec(t.prompt)?.[1] ?? "medium";
      await t.callTool("submit_difficulty", { level: proposed, justification: "conforme à la grille" });
    },
    "skraft-researcher": writer(".skraft/us-12/research/research.md", "# Recherche\n"),
    "skraft-architect-model": async (t) => {
      const slug = /Dossier de travail : \.skraft\/([^/]+)\//.exec(t.prompt)?.[1] ?? "x";
      await writer(`.skraft/${slug}/design/event-model.md`, "`BolusCapped`\n")(t);
    },
    "skraft-architect-decide": async (t) => {
      const slug = /Dossier de travail : \.skraft\/([^/]+)\//.exec(t.prompt)?.[1] ?? "x";
      await writer(`.skraft/${slug}/design/contracts.md`, "`BolusCapped`\n")(t);
    },
    "skraft-acceptance": async (t) => {
      const slug = /Dossier de travail : \.skraft\/([^/]+)\//.exec(t.prompt)?.[1] ?? "x";
      await writer(`.skraft/${slug}/distill/features/plafond.feature`, "Fonctionnalité: plafond\n")(t);
    },
    "skraft-dev": writer("Sources/Domain/BolusCap.swift", "public struct BolusCap {}\n"),
    ...Object.fromEntries(
      ["cold-reader", "test-integrity", "architecture"].map((l) => [
        `skraft-lens-${l}`,
        (async (t) => void (await t.callTool("submit_lens_verdict", { lens: l, verdict: "APPROVED", defects: [] }))) as ScriptedBehavior,
      ]),
    ),
  };
  for (const [name, behavior] of Object.entries({ ...behaviors, ...over })) if (behavior) runtime.behave(ROLE(name), behavior);
  return runtime;
}

/** Panne simulée : l'opération désignée ne rend jamais la main (plantage du processus). */
export type HangPoint = "readStory" | "changedFiles" | "commit";

function withHang(ws: Workspace, hang: HangPoint | undefined): Workspace {
  if (!hang) return ws;
  const never = () => new Promise<never>(() => {});
  return {
    ...ws,
    files: { ...ws.files, read: (p) => (hang === "readStory" && p.startsWith("stories/") ? never() : ws.files.read(p)) },
    checkpoints: { ...ws.checkpoints, diff: (id) => (hang === "changedFiles" ? never() : ws.checkpoints.diff(id)) },
    repo: { ...ws.repo, commit: (m, o) => (hang === "commit" ? never() : ws.repo.commit(m, o)) },
  };
}

let artifacts: Promise<{ runtimeEntry: string; extDir: string }> | undefined;
function isolatedArtifacts() {
  artifacts ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-studio-skraft-bundles-"));
    const runtimeEntry = join(dir, "runtime", "extension-child.mjs");
    const extDir = join(dir, "skraft");
    await bundle(resolve(import.meta.dirname, "../../../../packages/extension-host/src/child/entry.ts"), runtimeEntry);
    await bundle(resolve(import.meta.dirname, "../../src/entry.ts"), join(extDir, "dist/index.mjs"));
    return { runtimeEntry, extDir };
  })();
  return artifacts;
}

const handles: ExtensionHandle[] = [];
export async function shutdownHosts(): Promise<void> {
  for (const h of handles.splice(0)) await h.deactivate().catch(() => undefined);
}

export async function assemble(root: string, runtime: ScriptedRuntime, tasksDir: string, opts: { hang?: HangPoint; isolated?: boolean } = {}) {
  const workspace = withHang(await openWorkspace(root), opts.hang);
  const usage = createUsageRecorder(join(tasksDir, "usage"));
  const engine = createTaskEngine({
    usage,
    store: createJsonTaskStore(tasksDir),
    checkpoints: workspace.checkpoints,
    clock: { now: () => new Date() },
    ids: sequentialIds(`t${Math.random().toString(36).slice(2, 6)}-`),
  });
  const interactions = createInteractionService({
    store: createJsonInteractionStore(join(tasksDir, "interactions")),
    clock: { now: () => new Date() },
    ids: sequentialIds(`int${Math.random().toString(36).slice(2, 6)}-`),
    deliver: (taskId, option, comment) => engine.dispatch(taskId, { type: "HUMAN_DECISION", decision: option, ...(comment ? { comment } : {}) }),
  });
  const registry = createRegistry();
  const posted: string[] = [];
  const hostDeps: HostDeps = {
    registry,
    engine,
    agents: createTaskAgentRunner({ runtime, root: workspace.root, idleMs: 3_600_000 }),
    workspace,
    stack: { id: "swift", detect: async () => true, isTestFile: (p) => /(^|\/)Tests\//.test(p), testFilePattern: "(^|\\/)Tests\\/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) },
    interactions,
    chat: { post: (_e, md) => void posted.push(md) },
    evidence: createJsonEvidenceStore(join(tasksDir, "evidence")),
    hooks: createHookRegistry(),
    usage,
    clock: { now: () => new Date() },
    ids: sequentialIds(`e${Math.random().toString(36).slice(2, 6)}-`),
  };
  if (opts.isolated) {
    const { runtimeEntry, extDir } = await isolatedArtifacts();
    handles.push(await activateIsolated({ manifest, directory: extDir, entry: join(extDir, "dist/index.mjs") }, hostDeps, { launcher: createNodeLauncher(), runtimeEntry }));
  } else handles.push(await activateInProcess({ manifest, module: skraftExtension }, hostDeps));
  return { engine, interactions, registry, posted, workspace, usage };
}

export async function until(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("Condition non atteinte à temps");
    await new Promise((r) => setTimeout(r, 25));
  }
}

export const stateOf = (r: TaskRecord | null) => r?.state as SkraftState | undefined;
