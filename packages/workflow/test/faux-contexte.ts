import { fixedClock, sequentialIds } from "@agent-studio/core/testing";
import type { AgentRunResult, ExtensionContext, TestRun } from "@agent-studio/extension-api";
import { createTaskEngine, MemoryTaskStore, type TaskEngine, type TaskRecord } from "@agent-studio/task-engine";
import { createWorkflowTask } from "../src/workflow-task.js";
import type { DeclarationWorkflow, EtatWorkflow, Json } from "../src/protocols.js";

export type Agent = (consigne: string) => Promise<AgentRunResult<never>> | AgentRunResult<never>;

/** Faux `ExtensionContext` : journalise chaque appel, dans l'ordre. */
export function fauxContexte(agents: Record<string, Agent> = {}, fichiers: Record<string, string> = {}) {
  const appels: string[] = [];
  const consignes: { nom: string; consigne: string; opts: unknown }[] = [];
  const oublis: string[][] = [];
  const rembobinages: string[] = [];
  const demandes: { title: string; options: { id: string; label: string }[]; requiredRoles?: string[]; detail?: string }[] = [];
  const messages: string[] = [];
  const archives: { label: string; files: { path: string; content: string }[] }[] = [];
  /** Fichiers « modifiés depuis le checkpoint », pour l'archivage avant rembobinage. */
  const modifies: Record<string, string> = {};
  let cp = 0;
  const ctx = {
    extensionId: "test.ext",
    agents: {
      async run(nom: string, consigne: string, opts?: unknown) {
        appels.push(`agent:${nom}`);
        consignes.push({ nom, consigne, opts });
        const a = agents[nom];
        if (!a) throw new Error(`Agent non déclaré : ${nom}`);
        return a(consigne);
      },
      async forget(_taskId: string, noms: readonly string[]) {
        oublis.push([...noms]);
      },
    },
    workspace: {
      async readFile(p: string) {
        appels.push(`lire:${p}`);
        const c = fichiers[p] ?? modifies[p];
        if (c === undefined) throw new Error(`Fichier absent : ${p}`);
        return c;
      },
      async writeFile(p: string, c: string) {
        appels.push(`ecrire:${p}`);
        fichiers[p] = c;
      },
      async ensureDir(p: string) {
        appels.push(`dossier:${p}`);
      },
      async listFiles() {
        appels.push("lister");
        return Object.keys(fichiers).sort();
      },
      async checkpoint(label: string) {
        appels.push(`checkpoint:${label}`);
        return { id: `cp-${++cp}` };
      },
      async rollback(id: string) {
        appels.push(`rollback:${id}`);
        rembobinages.push(id);
      },
      async changedFiles() {
        return Object.keys(modifies).map((path) => ({ path, status: "added" as const }));
      },
      async fingerprintTests() {
        return "empreinte-tests";
      },
      async fingerprint(globs: string[]) {
        return `empreinte:${globs.join(",")}`;
      },
    },
    git: {
      async commit(message: string) {
        appels.push(`commit:${message}`);
        return "sha-1";
      },
      async branch(nom: string) {
        appels.push(`branche:${nom}`);
      },
      async head() {
        return "h";
      },
    },
    stack: {
      layout: { acceptanceTests: [], unitTests: [], sources: [] },
      infrastructureModules: [],
      async runTests(): Promise<TestRun> {
        appels.push("tests");
        return { results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 } as unknown as TestRun;
      },
      isTestFile: () => false,
      mutation: async () => null,
      architecture: async () => null,
      lint: async () => null,
    },
    interactions: {
      async request(req: (typeof demandes)[number]) {
        appels.push(`humain:${req.title}`);
        demandes.push(req);
        return `i-${demandes.length}`;
      },
    },
    chat: {
      registerCommand: () => ({ dispose() {} }),
      post: (m: string) => void messages.push(m),
    },
    log: { info() {}, warn() {} },
    trace: {
      async rejected(_taskId: string, label: string, files: { path: string; content: string }[]) {
        archives.push({ label, files: [...files] });
      },
    },
  } as unknown as ExtensionContext;
  return { ctx, appels, consignes, oublis, rembobinages, demandes, messages, fichiers, archives, modifies };
}

/** Moteur réel, magasin en mémoire partageable entre deux « démarrages ». */
export function moteur(decl: DeclarationWorkflow<never>, ctx: ExtensionContext, store = new MemoryTaskStore()) {
  const engine: TaskEngine = createTaskEngine({
    store,
    checkpoints: { create: async () => ({ id: `e-${Math.random().toString(36).slice(2, 8)}` }), rollback: async () => {} },
    clock: fixedClock(),
    ids: sequentialIds("t"),
  });
  engine.register(createWorkflowTask(decl), ctx);
  return { engine, store };
}

export async function lancer(decl: DeclarationWorkflow<never>, ctx: ExtensionContext, entree: Json = null) {
  const m = moteur(decl, ctx);
  const id = await m.engine.start(decl.nom, entree);
  await m.engine.idle(id);
  return { ...m, id, record: async () => (await m.store.load(id)) as TaskRecord<EtatWorkflow> };
}

export const attendre = async (cond: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("condition jamais remplie");
};

export const sortie = (s: Record<string, unknown>) => ({ output: s }) as unknown as AgentRunResult<never>;
