import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHookRegistry, createInteractionService, createRegistry, createTaskAgentRunner } from "@agent-studio/core";
import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import { bundle, createNodeLauncher, type HostDeps } from "@agent-studio/extension-host";
import { createTaskEngine, MemoryTaskStore } from "@agent-studio/task-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createJsonAccordStore } from "../src/accord/accords.js";
import { trouverWorkflows } from "../src/chargeur/chargeur.js";
import { activerWorkflow, lireEntrees, manifesteDuWorkflow } from "../src/hote/activer.js";
import type { EtatWorkflow } from "../src/protocols.js";

/**
 * Lancement d'un workflow (ADR 0055, `docs/11` §6) : commande, lecture des arguments, accord de
 * l'utilisateur, puis exécution isolée ; chaque appel du script borné par `meta.permissions`.
 */

let racine: string;
let enfant: string;
beforeAll(async () => {
  racine = await mkdtemp(join(tmpdir(), "activer-"));
  enfant = join(racine, "runtime", "enfant.mjs");
  await bundle(resolve(import.meta.dirname, "../src/hote/enfant-entree.ts"), enfant);
}, 60_000);
afterAll(() => rm(racine, { recursive: true, force: true }));

const META = (corps = "") => `export const meta = {
  name: "demo",
  description: "Démo.",
  commande: "demo",
  entrees: {
    story: { type: "fichier", obligatoire: true, aide: "La story." },
    auto: { type: "booleen", defaut: false, aide: "Sans confirmation." },
  },
  phases: { REDACTION: "Rédaction" },
  permissions: { ecriture: [".skraft/**"], tests: false, git: ["commit"] },
  agents: {
    redacteur: { prompt: "agents/redacteur.agent.md", consignes: "Réponds en une phrase.", ecriture: [".skraft/**"], outils: ["list_files"], sortie: "report_phase", classe: "light" },
  },
};
export default async function (w, entree) {
  await w.phase("REDACTION", async () => {
    const a = await w.agent("redacteur", "Résume " + entree.story);
    await w.ecrireFichier(".skraft/resume.md", a.sortie.summary);
    ${corps}
    return true;
  });
  return entree;
}
`;

async function projet(corps = "") {
  const p = await mkdtemp(join(racine, "projet-"));
  const d = join(p, ".agent-studio/workflows/demo");
  for (const [rel, c] of Object.entries({ "workflow.mjs": META(corps), "agents/redacteur.agent.md": "Tu résumes des stories." })) {
    await mkdir(dirname(join(d, rel)), { recursive: true });
    await writeFile(join(d, rel), c);
  }
  const r = await trouverWorkflows({ projet: join(p, ".agent-studio/workflows") });
  if (r.erreurs.length) throw new Error(JSON.stringify(r.erreurs));
  return { p, w: r.workflows[0]! };
}

function hote(runtime: ScriptedRuntime) {
  const ecrits: string[] = [];
  const commits: string[] = [];
  const posts: string[] = [];
  const engine = createTaskEngine({ store: new MemoryTaskStore(), checkpoints: { create: async () => ({ id: "cp" }), rollback: async () => {} }, clock: fixedClock(), ids: sequentialIds("t") });
  const deps = {
    registry: createRegistry(),
    engine,
    agents: createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs: 60_000 }),
    workspace: {
      root: "/projets/demo",
      files: { read: async () => "", write: async (p: string) => void ecrits.push(p), ensureDir: async () => {}, list: async () => [] },
      checkpoints: { create: async (label: string) => ({ id: "cp-1", sha: "s", head: "h", label, createdAt: "" }), list: async () => [], diff: async () => ({ files: [], patch: "" }), rollback: async () => {} },
      repo: { worktree: async () => { throw new Error("non"); }, head: async () => "h", commit: async (m: string) => (commits.push(m), "sha"), sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
    },
    stack: { id: "ts", layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] }, infrastructureModules: [], detect: async () => true, isTestFile: () => false, testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) },
    interactions: createInteractionService({ store: new MemoryInteractionStore(), clock: fixedClock(), ids: sequentialIds("i"), deliver: (taskId, option, comment) => engine.dispatch(taskId, { type: "HUMAN_DECISION", decision: option, ...(comment ? { comment } : {}) }) }),
    chat: { post: (_id: string, md: string) => void posts.push(md) },
    evidence: new MemoryEvidenceStore(),
    hooks: createHookRegistry(),
    clock: fixedClock(),
    ids: sequentialIds("e"),
  } as unknown as HostDeps;
  return { deps, engine, ecrits, commits, posts };
}

const confirmeur = (reponse: "allow-once" | "allow-always" | "deny") => {
  const demandes: string[] = [];
  return { demandes, confirm: async (r: { title: string }) => (demandes.push(r.title), reponse) };
};

async function demarrer(corps = "", reponse: "allow-once" | "allow-always" | "deny" = "allow-once") {
  const { p, w } = await projet(corps);
  const runtime = new ScriptedRuntime();
  runtime.behave("workflow.demo/redacteur", async (t) => void (await t.callTool("report_phase", { summary: `résumé (${t.config.systemPrompt.includes("Tu résumes des stories.") ? "prompt du dossier" : "?"})`, files: [] })));
  const h = hote(runtime);
  const c = confirmeur(reponse);
  const r = await activerWorkflow(w, h.deps, { isolation: { launcher: createNodeLauncher(), runtimeEntry: enfant }, accords: createJsonAccordStore(join(p, "accords.json")), confirmer: c });
  if (!r.ok) throw new Error(r.motifs.join(" ; "));
  return { ...h, c, handle: r.handle, runtime };
}

const derniere = async (engine: ReturnType<typeof createTaskEngine>) => {
  const [t] = await engine.list();
  if (t) await engine.idle(t.id).catch(() => undefined);
  return t ? ((await engine.status(t.id))!.state as EtatWorkflow) : null;
};

describe("lecture des arguments d'après meta.entrees", () => {
  const E = { story: { type: "fichier" as const, obligatoire: true, aide: "La story." }, auto: { type: "booleen" as const, defaut: false, aide: "x" } };
  it("positionnels dans l'ordre des entrées, booléens en --nom, valeurs par défaut", () => {
    expect(lireEntrees(E, "stories/us-2.md")).toEqual({ ok: true, entree: { story: "stories/us-2.md", auto: false } });
    expect(lireEntrees(E, "--auto stories/us-2.md")).toEqual({ ok: true, entree: { story: "stories/us-2.md", auto: true } });
  });
  it("obligatoire absent, option inconnue, argument en trop : refus avec l'usage", () => {
    for (const a of ["", "--vite x", "a b"]) expect(lireEntrees(E, a)).toMatchObject({ ok: false, usage: expect.stringMatching(/<story>.*\[--auto\]/) });
  });
});

describe("manifeste interne fabriqué depuis le meta", () => {
  it("permissions et agents traduits : l'utilisateur ne voit que le meta", async () => {
    const { w } = await projet();
    const m = manifesteDuWorkflow(w);
    expect(m.id).toBe("workflow.demo");
    expect(m.permissions).toEqual(["fs:read", "fs:write:.skraft/**", "git:commit", "copilot:sessions"]);
    expect(m.contributes.agents?.[0]).toMatchObject({ name: "redacteur", prompt: "agents/redacteur.agent.md", role: "Réponds en une phrase.", output: "report_phase", write: [".skraft/**"], tools: ["list_files"], modelClass: "light" });
    expect(m.contributes.commands?.[0]?.name).toBe("demo");
  });
});

describe("activer un workflow", () => {
  it("la commande lance le workflow après accord ; l'agent reçoit le prompt du dossier ; l'écriture déclarée passe", async () => {
    const h = await demarrer();
    await h.deps.registry.command("demo")!.handler("stories/us-2.md");
    const s = await derniere(h.engine);
    expect(h.c.demandes).toEqual(["Exécuter le workflow « demo » (projet) ?"]);
    expect(s?.fin).toEqual({ statut: "fini", valeur: { clair: { story: "stories/us-2.md", auto: false } } });
    expect(h.ecrits).toEqual([".skraft/resume.md"]);
    await h.handle.deactivate();
  }, 30_000);

  it("accord refusé : rien ne démarre, et c'est dit", async () => {
    const h = await demarrer("", "deny");
    await h.deps.registry.command("demo")!.handler("stories/us-2.md");
    expect(await h.engine.list()).toEqual([]);
    expect(h.posts.at(-1)).toMatch(/accord refusé/);
    await h.handle.deactivate();
  }, 30_000);

  it("arguments invalides : l'usage est donné, rien ne démarre, l'accord n'est pas demandé", async () => {
    const h = await demarrer();
    await h.deps.registry.command("demo")!.handler("");
    expect(h.posts.at(-1)).toMatch(/Utilisation : `\/demo <story> \[--auto\]`/);
    expect(h.c.demandes).toEqual([]);
    await h.handle.deactivate();
  }, 30_000);

  it("écriture hors de meta.permissions.ecriture : refusée, la tâche échoue en le disant", async () => {
    const h = await demarrer(`await w.ecrireFichier("src/a.ts", "x");`);
    await h.deps.registry.command("demo")!.handler("stories/us-2.md");
    const s = await derniere(h.engine);
    expect(s?.fin).toMatchObject({ statut: "echec", motif: expect.stringMatching(/src\/a\.ts.*meta\.permissions/) });
    expect(h.ecrits).toEqual([".skraft/resume.md"]);
    await h.handle.deactivate();
  }, 30_000);

  it("Git non déclaré (branche) : refusé ; Git déclaré (commit) : passe", async () => {
    const h = await demarrer(`await w.commiter("docs: résumé"); await w.brancher("ailleurs");`);
    await h.deps.registry.command("demo")!.handler("stories/us-2.md");
    const s = await derniere(h.engine);
    expect(h.commits).toEqual(["docs: résumé"]);
    expect(s?.fin).toMatchObject({ statut: "echec", motif: expect.stringMatching(/git:branch.*meta\.permissions/) });
    await h.handle.deactivate();
  }, 30_000);
});
