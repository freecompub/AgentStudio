/**
 * Isolation réelle (J4) : l'extension tourne dans un processus Node distinct, sous le modèle de
 * permissions (lecture limitée à son dossier, ni écriture ni sous-processus), et ne parle au
 * principal que par RPC.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHookRegistry, createInteractionService, createRegistry, type TaskAgentRunner } from "@agent-studio/core";
import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, RecordingCheckpoints, sequentialIds } from "@agent-studio/core/testing";
import type { StackAdapter } from "@agent-studio/stack-adapters";
import { createTaskEngine, MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HostDeps } from "../src/in-process-host.js";
import { activateIsolated, type IsolatedHandle } from "../src/isolated-host.js";
import { createNodeLauncher } from "../src/launchers/node-launcher.js";
import { bundle } from "./support/bundle.js";
import { DEMO_MANIFEST } from "./fixtures/demo-manifest.js";

let dir: string;
let runtimeEntry: string;
let extDir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-studio-iso-"));
  runtimeEntry = join(dir, "runtime", "extension-child.mjs");
  extDir = join(dir, "ext");
  await bundle(join(import.meta.dirname, "../src/child/entry.ts"), runtimeEntry);
  await bundle(join(import.meta.dirname, "fixtures/demo-extension.ts"), join(extDir, "index.mjs"));
}, 60_000);
afterAll(() => rm(dir, { recursive: true, force: true }));

function deps() {
  const posted: string[] = [];
  const engine = createTaskEngine({ store: new MemoryTaskStore(), checkpoints: new RecordingCheckpoints(), clock: fixedClock(), ids: sequentialIds("t") });
  const workspace: Workspace = {
    root: "/projets/demo",
    files: { read: async () => "", write: async () => {}, list: async () => ["a.ts", "b.ts"] },
    checkpoints: { create: async (l) => ({ id: "cp", sha: "", head: "", label: l, createdAt: "" }), list: async () => [], diff: async () => ({ files: [], patch: "" }), rollback: async () => {} },
    repo: { head: async () => "h", commit: async () => "sha", sync: async () => ({ pulled: 0, pushed: 0 }) },
  };
  const stack: StackAdapter = {
    id: "typescript",
    detect: async () => true,
    isTestFile: (p) => p.startsWith("tests/"),
    testFilePattern: "^tests/",
    runTests: async () => ({ results: [{ id: "x", file: "x", status: "passed" }], exitCode: 0, timedOut: false, output: "", durationMs: 1 }),
  };
  const agents: TaskAgentRunner = { run: async () => ({ output: { summary: "", files: [] } as never }) };
  const evidence = new MemoryEvidenceStore();
  const d: HostDeps = {
    registry: createRegistry(),
    engine,
    agents,
    workspace,
    stack,
    interactions: createInteractionService({ store: new MemoryInteractionStore(), clock: fixedClock(), ids: sequentialIds("i"), deliver: async () => {} }),
    evidence,
    hooks: createHookRegistry(),
    chat: { post: (_e, md) => void posted.push(md) },
    clock: fixedClock(),
    ids: sequentialIds("e"),
  };
  return { d, posted, evidence };
}

async function until(check: () => boolean, ms = 10_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("Condition non atteinte");
    await new Promise((r) => setTimeout(r, 20));
  }
}

const launched: IsolatedHandle[] = [];
afterAll(async () => {
  for (const handle of launched) await handle.deactivate();
});

async function activate(extra: { hookTimeoutMs?: number } = {}) {
  const env = deps();
  const handle = await activateIsolated(
    { manifest: DEMO_MANIFEST, directory: extDir, entry: join(extDir, "index.mjs") },
    env.d,
    { launcher: createNodeLauncher(), runtimeEntry, ...extra },
  );
  launched.push(handle);
  return { ...env, handle };
}

describe("Hôte d'extension isolé (processus Node réel)", () => {
  it("l'extension tourne dans un autre processus et répond par RPC", async () => {
    const { d, posted, handle } = await activate();
    expect(handle.pid).toBeGreaterThan(0);
    expect(handle.pid).not.toBe(process.pid);
    await d.registry.command("hello")!.handler("Samir");
    await until(() => posted.length > 0);
    expect(posted[0]).toBe(`bonjour Samir depuis le pid ${handle.pid}`);
  }, 30_000);

  it("une permission non déclarée est refusée (D11)", async () => {
    const { d, posted } = await activate();
    await d.registry.command("commit")!.handler("");
    await until(() => posted.length > 0);
    expect(posted[0]).toBe("refusé : Permission non déclarée par diabeo.demo : git:commit");
  }, 30_000);

  it("second rempart : le processus ne peut pas lire hors de son dossier (modèle de permissions Node)", async () => {
    const { d, posted } = await activate();
    await d.registry.command("read-system")!.handler("");
    await until(() => posted.length > 0);
    expect(posted[0]).toBe("lecture système refusée : ERR_ACCESS_DENIED");
    // …mais peut lire le projet via ctx, avec fs:read déclarée.
    await d.registry.command("files")!.handler("");
    await until(() => posted.length > 1);
    expect(posted[1]).toBe("fichiers : a.ts, b.ts");
  }, 30_000);

  it("une tâche dont le réducteur vit dans l'extension est pilotée par le moteur du principal", async () => {
    const { d, evidence } = await activate();
    const id = await d.engine.start("diabeo.demo/count", {});
    await d.engine.idle(id);
    const rec = await d.engine.status(id);
    expect(rec?.status).toBe("finished");
    expect(rec?.state).toEqual({ n: 1, done: true, tests: 1 });
    expect((await evidence.list(id)).map((e) => e.phase)).toEqual(["DEMO"]);
  }, 30_000);

  it("un hook qui plante ou expire n'autorise rien ; un refus explicite est transmis", async () => {
    const { d } = await activate({ hookTimeoutMs: 300 });
    const [guard] = d.hooks.guards();
    expect(await guard!.check({ kind: "shell", toolName: "bash", command: "rm -rf /" })).toEqual({ decision: "deny", reason: "[diabeo.demo] rm interdit par la démo" });
    expect(await guard!.check({ kind: "shell", toolName: "bash", command: "ls" })).toEqual({ decision: "allow" });
    // Dans une session, la chaîne composée transforme plantage et délai en refus (D28).
    const { composeGuards } = await import("@agent-studio/core");
    const chain = composeGuards(d.hooks.guards(), { timeoutMs: 1_000 });
    expect(await chain.check({ kind: "shell", toolName: "bash", command: "boom" })).toMatchObject({ decision: "deny" });
    expect(await chain.check({ kind: "shell", toolName: "bash", command: "lent" })).toMatchObject({ decision: "deny" });
  }, 30_000);

  it("plantage : redémarrage automatique, puis désactivation au-delà de trois par heure", async () => {
    const { d, posted, handle } = await activate();
    for (let i = 1; i <= 3; i++) {
      const before = handle.pid;
      await d.registry.command("crash")!.handler("");
      await until(() => handle.pid !== before && handle.active);
    }
    await d.registry.command("hello")!.handler("toujours là");
    await until(() => posted.some((p) => p.includes("toujours là")));

    await d.registry.command("crash")!.handler("");
    await until(() => handle.disabled);
    expect(d.registry.command("hello")).toBeUndefined();
    expect(d.hooks.guards()).toEqual([]);
    expect(posted.at(-1)).toMatch(/désactivée jusqu'au prochain lancement/);
  }, 60_000);
});
