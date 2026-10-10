/**
 * Workflows en dossier dans l'application (ADR 0055, `docs/11` §5, §6) : trouvés à l'ouverture du
 * projet, commande enregistrée, accord demandé, exécution isolée ; workflows invalides signalés.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, MemoryTaskSessionStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import { bundle, createNodeLauncher } from "@agent-studio/extension-host";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceServicesFactory } from "../src/main/workspace-services.js";

let racine: string;
let enfant: string;
beforeAll(async () => {
  racine = await mkdtemp(join(tmpdir(), "app-workflows-"));
  enfant = join(racine, "runtime", "workflow-child.mjs");
  await bundle(resolve(import.meta.dirname, "../../../packages/workflow/src/hote/enfant-entree.ts"), enfant);
}, 60_000);
afterAll(() => rm(racine, { recursive: true, force: true }));

const DEMO = `export const meta = {
  name: "demo",
  description: "Démo.",
  commande: "demo",
  entrees: { story: { type: "fichier", obligatoire: true, aide: "La story." } },
  phases: { REDACTION: "Rédaction" },
  permissions: { ecriture: [".skraft/**"] },
  agents: { redacteur: { prompt: "agents/redacteur.agent.md", ecriture: [".skraft/**"], sortie: "report_phase" } },
};
export default async function (w, entree) {
  await w.phase("REDACTION", async () => {
    const a = await w.agent("redacteur", "Résume " + entree.story);
    await w.ecrireFichier(".skraft/resume.md", a.sortie.summary);
    return true;
  });
}
`;

async function poser(base: string, fichiers: Record<string, string>) {
  for (const [rel, c] of Object.entries(fichiers)) {
    await mkdir(dirname(join(base, rel)), { recursive: true });
    await writeFile(join(base, rel), c);
  }
}

async function ouvrir(opts: { projet?: Record<string, string>; machine?: Record<string, string>; reponse?: "allow-once" | "allow-always" | "deny"; sansConfirmeur?: boolean }) {
  const projet = await mkdtemp(join(racine, "projet-"));
  const machine = await mkdtemp(join(racine, "machine-"));
  await poser(projet, opts.projet ?? {});
  await poser(machine, opts.machine ?? {});
  const ecrits: string[] = [];
  const posts: string[] = [];
  const demandes: string[] = [];
  const runtime = new ScriptedRuntime();
  runtime.behave("workflow.demo/redacteur", async (t) => void (await t.callTool("report_phase", { summary: "résumé", files: [] })));
  const workspace = {
    root: projet,
    files: { read: async () => "", write: async (p: string) => void ecrits.push(p), ensureDir: async () => {}, list: async () => [] },
    checkpoints: { create: async (label: string) => ({ id: "cp", sha: "s", head: "h", label, createdAt: "" }), list: async () => [], diff: async () => ({ files: [], patch: "" }), rollback: async () => {} },
    repo: { worktree: async () => { throw new Error("non"); }, head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
  } as unknown as Workspace;
  const services = await workspaceServicesFactory({
    extensions: [],
    stacks: [{ id: "typescript", layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] }, infrastructureModules: [], detect: async () => true, isTestFile: () => false, testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
    tasksDir: join(projet, ".taches"),
    taskStore: new MemoryTaskStore(),
    evidenceStore: new MemoryEvidenceStore(),
    interactionStore: new MemoryInteractionStore(),
    taskSessionStore: new MemoryTaskSessionStore(),
    clock: fixedClock(),
    ids: sequentialIds("id-"),
    workflows: { machine, launcher: createNodeLauncher(), runtimeEntry: enfant },
  })({
    workspace,
    runtime: async () => runtime,
    onTask: () => {},
    onInteractions: () => {},
    onPost: (_e, md) => void posts.push(md),
    ...(opts.sansConfirmeur ? {} : { confirmer: { confirm: async (r: { title: string }) => (demandes.push(r.title), opts.reponse ?? "allow-once") } }),
  });
  return { services, ecrits, posts, demandes };
}

const until = async (check: () => Promise<boolean> | boolean) => {
  for (let i = 0; i < 400 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10));
  expect(await check()).toBe(true);
};

const WF = { ".agent-studio/workflows/demo/workflow.mjs": DEMO, ".agent-studio/workflows/demo/agents/redacteur.agent.md": "Tu résumes." };

describe("Workflows en dossier dans l'application (ADR 0055)", () => {
  it("un workflow du projet devient une commande ; après accord, il tourne jusqu'au bout", async () => {
    const o = await ouvrir({ projet: WF });
    expect(o.services.commands().map((c) => c.invocation)).toContain("demo");
    expect(await o.services.route("/demo stories/us-2.md")).toEqual({ kind: "handled" });
    expect(o.demandes).toEqual(["Exécuter le workflow « demo » (projet) ?"]);
    await until(async () => (await o.services.tasks()).some((t) => t.status === "finished"));
    expect(o.ecrits).toEqual([".skraft/resume.md"]);
    await o.services.dispose();
  }, 30_000);

  it("le dossier de la machine est lu aussi ; le projet l'emporte à nom égal, et c'est dit", async () => {
    const machine = Object.fromEntries(Object.entries(WF).map(([k, v]) => [k.replace(".agent-studio/workflows/", ""), v]));
    const o = await ouvrir({ projet: WF, machine });
    expect(o.posts.some((p) => /« demo » du projet remplace celui de la machine/.test(p))).toBe(true);
    await o.services.route("/demo x.md");
    expect(o.demandes).toEqual(["Exécuter le workflow « demo » (projet) ?"]);
    await o.services.dispose();
  }, 30_000);

  it("un workflow invalide est écarté avec son motif, sans empêcher l'ouverture du projet", async () => {
    const o = await ouvrir({ projet: { ".agent-studio/workflows/casse/workflow.mjs": "export const meta = { name: NOM };\nexport default async () => {};\n" } });
    expect(o.posts.some((p) => /Workflow écarté.*casse.*meta non littéral/s.test(p))).toBe(true);
    expect(o.services.commands().map((c) => c.invocation)).not.toContain("casse");
    await o.services.dispose();
  }, 30_000);

  it("l'agent principal peut proposer un workflow ; rien ne démarre sans confirmation", async () => {
    const o = await ouvrir({ projet: WF, reponse: "allow-once" });
    const [outil] = o.services.outilsAgent();
    expect(outil!.name).toBe("proposer_workflow");
    expect(outil!.description).toContain("demo (/demo <story>) : Démo.");
    expect((outil!.parameters as { properties: { nom: { enum: string[] } } }).properties.nom.enum).toEqual(["demo"]);

    expect(await outil!.handler({ nom: "demo", arguments: "stories/us-2.md" })).toMatch(/accept/);
    // Proposition confirmée, puis accord sur le workflow (première exécution).
    expect(o.demandes).toEqual(["Lancer le workflow « demo » proposé par l'agent ?", "Exécuter le workflow « demo » (projet) ?"]);
    await until(async () => (await o.services.tasks()).some((t) => t.status === "finished"));
    await o.services.dispose();
  }, 30_000);

  it("proposition refusée : rien ne démarre, et l'agent l'apprend ; workflow inconnu : refusé", async () => {
    const o = await ouvrir({ projet: WF, reponse: "deny" });
    const [outil] = o.services.outilsAgent();
    expect(await outil!.handler({ nom: "demo", arguments: "x.md" })).toMatch(/refusé/);
    expect(await o.services.tasks()).toEqual([]);
    await expect(outil!.handler({ nom: "autre", arguments: "" })).rejects.toThrow(/inconnu/);
    await o.services.dispose();
  }, 30_000);

  it("sans workflow actif, l'agent principal n'a pas l'outil", async () => {
    const o = await ouvrir({});
    expect(o.services.outilsAgent()).toEqual([]);
    await o.services.dispose();
  }, 30_000);

  it("sans moyen de demander l'accord, les workflows ne sont pas activés, et c'est dit", async () => {
    const o = await ouvrir({ projet: WF, sansConfirmeur: true });
    expect(o.services.commands().map((c) => c.invocation)).not.toContain("demo");
    expect(o.posts.some((p) => /workflows.*non activés/i.test(p))).toBe(true);
    await o.services.dispose();
  }, 30_000);
});
