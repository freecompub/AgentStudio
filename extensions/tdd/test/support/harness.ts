/**
 * Banc d'essai de l'extension tdd : vrai dépôt Git, vrai Vitest, vraie pile (moteur, hôte,
 * exécuteur d'agents, preuves, interactions persistées) et agents scriptés. Aucun LLM.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createHookRegistry,
  createInteractionService,
  createJsonEvidenceStore,
  createJsonInteractionStore,
  createRegistry,
  createTaskAgentRunner,
  type Evidence,
} from "@agent-studio/core";
import { ScriptedRuntime, sequentialIds, type ScriptedBehavior } from "@agent-studio/core/testing";
import { activateInProcess } from "@agent-studio/extension-host";
import { createTypeScriptAdapter } from "@agent-studio/stack-adapters";
import { createJsonTaskStore, createTaskEngine, type TaskRecord } from "@agent-studio/task-engine";
import { openWorkspace } from "@agent-studio/workspace";
import { manifest, tddExtension, type TddState } from "../../src/index.js";

const NODE_MODULES = resolve(import.meta.dirname, "../../../../node_modules");
export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", ...args], { cwd, encoding: "utf8" }).trim();

export async function put(root: string, rel: string, content: string) {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), content);
}

export async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-studio-tdd-"));
  await symlink(NODE_MODULES, join(root, "node_modules"));
  await put(root, ".gitignore", "node_modules\n");
  await put(root, "package.json", '{"name":"demo","type":"module","devDependencies":{"vitest":"*"}}\n');
  await put(root, "tests/smoke.test.ts", 'import { it, expect } from "vitest";\nit("socle", () => expect(1).toBe(1));\n');
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return root;
}

// ---------- Agents scriptés ----------------------------------------------------------

export const CAP_TEST = `import { it, expect } from "vitest";
import { cap } from "../src/cap";
it("plafonne la dose", () => expect(cap(12.5, 10)).toBe(10));
`;
export const CAP_SRC = "export const cap = (dose: number, max: number): number => Math.min(dose, max);\n";

export function planner(steps: { id: string; behavior: string }[]): ScriptedBehavior {
  return async (t) => void (await t.callTool("submit_plan", { steps }));
}

export function testAgent(root: string): ScriptedBehavior {
  return async (t) => {
    await put(root, "tests/cap.test.ts", CAP_TEST);
    await t.callTool("report_phase", { summary: "test de plafonnement écrit", files: ["tests/cap.test.ts"] });
  };
}

export function devAgent(root: string, opts: { tamperFirst?: boolean; hang?: boolean } = {}): ScriptedBehavior & { prompts: string[] } {
  const prompts: string[] = [];
  let greenTurns = 0;
  const behavior: ScriptedBehavior = async (t) => {
    prompts.push(t.prompt);
    if (t.prompt.includes("phase de nettoyage")) {
      await t.callTool("report_phase", { summary: "rien à nettoyer", files: [] });
      return;
    }
    greenTurns++;
    if (opts.hang) {
      await put(root, "src/brouillon.ts", "// travail partiel\n");
      t.hang();
      return;
    }
    if (opts.tamperFirst && greenTurns === 1) {
      // Contournement : l'agent « arrange » le test au lieu d'écrire le code.
      await put(root, "tests/cap.test.ts", CAP_TEST.replace("toBe(10)", "toBeDefined()"));
      await put(root, "src/cap.ts", "export const cap = (dose: number, _max: number): number => dose;\n");
    } else {
      await put(root, "src/cap.ts", CAP_SRC);
    }
    await t.callTool("report_phase", { summary: "cap implémenté", files: ["src/cap.ts"] });
  };
  return Object.assign(behavior, { prompts });
}

// ---------- Assemblage de l'application (sans Electron) ------------------------------

export async function assemble(root: string, runtime: ScriptedRuntime, tasksDir: string) {
  const workspace = await openWorkspace(root);
  const engine = createTaskEngine({
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
  await activateInProcess(
    { manifest, module: tddExtension },
    {
      registry,
      engine,
      agents: createTaskAgentRunner({ runtime, root: workspace.root, idleMs: 3_600_000 }),
      workspace,
      stack: createTypeScriptAdapter(),
      interactions,
      chat: { post: (_ext, md) => void posted.push(md) },
      evidence: createJsonEvidenceStore(join(tasksDir, "evidence")),
      hooks: createHookRegistry(),
      clock: { now: () => new Date() },
      ids: sequentialIds(`e${Math.random().toString(36).slice(2, 6)}-`),
    },
  );
  const evidence = createJsonEvidenceStore(join(tasksDir, "evidence"));
  return { engine, interactions, registry, posted, workspace, evidence };
}

export async function until(check: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("Condition non atteinte à temps");
    await new Promise((r) => setTimeout(r, 50));
  }
}

export const phaseOf = (r: TaskRecord | null) => (r?.state as TddState | undefined)?.phase;
export const ROLE = (name: string) => `diabeo.tdd/${name}`;

