/**
 * Critères de sortie de J2 (§14), sans LLM : vrai dépôt Git, vrai Vitest, agents scriptés.
 *  1. `/tdd` déroule un cycle complet sur un projet TypeScript ;
 *  2. une modification de test par l'agent dev est détectée et annulée ;
 *  3. un redémarrage en plein GREEN reprend proprement.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInteractionService, createRegistry, createTaskAgentRunner } from "@agent-studio/core";
import { fixedClock, MemoryInteractionStore, ScriptedRuntime, sequentialIds, type ScriptedBehavior } from "@agent-studio/core/testing";
import { activateInProcess } from "@agent-studio/extension-host";
import { createTypeScriptAdapter } from "@agent-studio/stack-adapters";
import { createJsonTaskStore, createTaskEngine, type TaskRecord } from "@agent-studio/task-engine";
import { openWorkspace } from "@agent-studio/workspace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { manifest, tddExtension, type TddState } from "../src/index.js";

const NODE_MODULES = resolve(import.meta.dirname, "../../../node_modules");
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@localhost", ...args], { cwd, encoding: "utf8" }).trim();

async function put(root: string, rel: string, content: string) {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), content);
}

async function createProject(): Promise<string> {
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

const CAP_TEST = `import { it, expect } from "vitest";
import { cap } from "../src/cap";
it("plafonne la dose", () => expect(cap(12.5, 10)).toBe(10));
`;
const CAP_SRC = "export const cap = (dose: number, max: number): number => Math.min(dose, max);\n";

function planner(steps: { id: string; behavior: string }[]): ScriptedBehavior {
  return async (t) => void (await t.callTool("submit_plan", { steps }));
}

function testAgent(root: string): ScriptedBehavior {
  return async (t) => {
    await put(root, "tests/cap.test.ts", CAP_TEST);
    await t.callTool("report_phase", { summary: "test de plafonnement écrit", files: ["tests/cap.test.ts"] });
  };
}

function devAgent(root: string, opts: { tamperFirst?: boolean; hang?: boolean } = {}): ScriptedBehavior & { prompts: string[] } {
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

async function assemble(root: string, runtime: ScriptedRuntime, tasksDir: string) {
  const workspace = await openWorkspace(root);
  const engine = createTaskEngine({
    store: createJsonTaskStore(tasksDir),
    checkpoints: workspace.checkpoints,
    clock: { now: () => new Date() },
    ids: sequentialIds(`t${Math.random().toString(36).slice(2, 6)}-`),
  });
  const interactions = createInteractionService({
    store: new MemoryInteractionStore(),
    clock: fixedClock(),
    ids: sequentialIds("int-"),
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
    },
  );
  return { engine, interactions, registry, posted, workspace };
}

async function until(check: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("Condition non atteinte à temps");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const phaseOf = (r: TaskRecord | null) => (r?.state as TddState | undefined)?.phase;
const ROLE = (name: string) => `diabeo.tdd/${name}`;

describe("Extension tdd — critères de sortie de J2", () => {
  let root: string;
  let tasksDir: string;

  beforeEach(async () => {
    root = await createProject();
    tasksDir = await mkdtemp(join(tmpdir(), "agent-studio-tasks-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(tasksDir, { recursive: true, force: true });
  });

  async function startTdd(app: Awaited<ReturnType<typeof assemble>>) {
    await app.registry.command("tdd")!.handler("Plafonner la dose proposée");
    const [task] = await app.engine.list();
    await until(async () => (await app.interactions.pending()).length === 1);
    const [review] = await app.interactions.pending();
    expect(review?.title).toContain("Valider le plan TDD");
    await app.interactions.respond(review!.id, "approve");
    return task!.id;
  }

  it("1. /tdd déroule un cycle complet : plan validé, rouge, vert, nettoyage, commits", async () => {
    const runtime = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: "plafonne une dose au-dessus du plafond" }]))
      .behave(ROLE("tdd-test"), testAgent(root))
      .behave(ROLE("tdd-dev"), devAgent(root));
    const app = await assemble(root, runtime, tasksDir);

    const id = await startTdd(app);
    await app.engine.idle(id);

    const rec = await app.engine.status(id);
    expect(phaseOf(rec)).toBe("DONE");
    expect(rec?.status).toBe("finished");
    expect((rec?.state as TddState).steps[0]?.status).toBe("done");
    expect(git(root, "log", "--format=%s")).toBe(
      ["feat: plafonne une dose au-dessus du plafond", "test: plafonne une dose au-dessus du plafond", "init"].join("\n"),
    );
    expect(git(root, "status", "--porcelain")).toBe("");
    expect(app.posted[0]).toContain("Cycle TDD lancé");
    // Sessions éphémères : une par rôle et par phase, toutes supprimées (D17).
    expect(runtime.deleted.length).toBe(runtime.history.length);
    expect(runtime.history.length).toBe(4); // planificateur, test, dev vert, dev nettoyage
  }, 90_000);

  it("2. une modification de test par l'agent dev est détectée, annulée, et l'agent est relancé avec le motif", async () => {
    const dev = devAgent(root, { tamperFirst: true });
    const runtime = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: "plafonne la dose" }]))
      .behave(ROLE("tdd-test"), testAgent(root))
      .behave(ROLE("tdd-dev"), dev);
    const app = await assemble(root, runtime, tasksDir);

    const id = await startTdd(app);
    await app.engine.idle(id);

    expect(phaseOf(await app.engine.status(id))).toBe("DONE");
    // Le test gelé a été restauré à sa version rouge.
    expect(await readFile(join(root, "tests/cap.test.ts"), "utf8")).toBe(CAP_TEST);
    expect(await readFile(join(root, "src/cap.ts"), "utf8")).toBe(CAP_SRC);
    // Relance ciblée : le deuxième tour vert reçoit le motif précis du rejet.
    const greenPrompts = dev.prompts.filter((p) => p.includes("phase verte"));
    expect(greenPrompts).toHaveLength(2);
    expect(greenPrompts[1]).toContain("Rejet précédent : Les fichiers de test ont été modifiés");
    expect(git(root, "log", "--format=%s", "-1")).toBe("feat: plafonne la dose");
  }, 90_000);

  it("3. un redémarrage en plein GREEN reprend proprement depuis le checkpoint", async () => {
    // Premier lancement : l'agent dev écrit un brouillon puis ne rend jamais la main (plantage).
    const first = new ScriptedRuntime()
      .behave(ROLE("tdd-planner"), planner([{ id: "s1", behavior: "plafonne la dose" }]))
      .behave(ROLE("tdd-test"), testAgent(root))
      .behave(ROLE("tdd-dev"), devAgent(root, { hang: true }));
    const app1 = await assemble(root, first, tasksDir);
    const id = await startTdd(app1);
    await until(async () => existsSync(join(root, "src/brouillon.ts")));
    const crashed = await app1.engine.status(id);
    expect(phaseOf(crashed)).toBe("GREEN");
    expect(crashed?.inflight?.effect).toMatchObject({ kind: "runDevAgent", mode: "green" });

    // Redémarrage : nouveaux services sur le même dépôt et le même stockage des tâches.
    const second = new ScriptedRuntime().behave(ROLE("tdd-dev"), devAgent(root));
    const app2 = await assemble(root, second, tasksDir);
    await app2.engine.resumeAll();
    await app2.engine.idle(id);

    const rec = await app2.engine.status(id);
    expect(phaseOf(rec)).toBe("DONE");
    // Le travail partiel n'a pas été « récupéré » : rollback au checkpoint avant l'effet.
    expect(existsSync(join(root, "src/brouillon.ts"))).toBe(false);
    expect(git(root, "log", "--format=%s", "-1")).toBe("feat: plafonne la dose");
  }, 90_000);
});
