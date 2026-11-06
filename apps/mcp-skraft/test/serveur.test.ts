/**
 * Le serveur MCP de bout en bout (ADR 0068), piloté par un vrai client MCP en mémoire, avec les
 * vrais services d'un projet et un workflow exécuté isolé ; agents scriptés, aucun LLM.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fixedClock, MemoryEvidenceStore, MemoryTaskSessionStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import { bundle, createNodeLauncher } from "@agent-studio/extension-host";
import { workspaceServicesFactory } from "@agent-studio/project-services";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPilesFichiers } from "../src/piles.js";
import { createProjets } from "../src/projets.js";
import { createServeurSkraft } from "../src/serveur.js";
import { ouvrirServicesSansFenetre } from "../src/services.js";
import { prendreVerrou } from "../src/verrou.js";

let racine: string;
let enfant: string;
let machine: string;
beforeAll(async () => {
  racine = await mkdtemp(join(tmpdir(), "mcp-serveur-"));
  enfant = join(racine, "runtime", "workflow-child.mjs");
  await bundle(resolve(import.meta.dirname, "../../../packages/workflow/src/hote/enfant-entree.ts"), enfant);
  machine = join(racine, "machine");
  await poser(join(machine, "demo"), { "workflow.mjs": DEMO, "agents/redacteur.agent.md": "Tu résumes." });
}, 60_000);
afterAll(() => rm(racine, { recursive: true, force: true }));

const DEMO = `export const meta = {
  name: "demo",
  description: "Démo.",
  commande: "demo",
  entrees: {
    story: { type: "fichier", obligatoire: true, aide: "La story." },
    auto: { type: "booleen", defaut: false, aide: "Sans confirmation." },
    archi: { type: "texte", aide: "Skill d'architecture." },
  },
  phases: { REDACTION: "Rédaction" },
  humains: { valider: ["architecte"] },
  permissions: { ecriture: [".skraft/**"] },
  agents: { redacteur: { prompt: "agents/redacteur.agent.md", ecriture: [".skraft/**"], sortie: "report_phase" } },
};
export default async function (w, entree) {
  await w.phase("REDACTION", async () => {
    const a = await w.agent("redacteur", "Résume " + entree.story + " " + (entree.archi ?? "défaut") + " " + entree.auto);
    const d = await w.humain("valider", "Valider le résumé ?", [{ id: "oui", label: "Oui" }, { id: "non", label: "Non" }], { detail: a.sortie.summary });
    await w.ecrireFichier(".skraft/resume.md", a.sortie.summary + " " + d.decision);
    return true;
  });
  await w.informer("Bilan : terminé.");
  return { slug: "demo" };
}
`;

const PILE = `
id: python
detect: [pyproject.toml]
tests:
  command: [pytest, "--junit-xml={rapport}"]
  report: junit-xml
layout:
  unitTests: ["tests/**"]
  sources: ["src/**"]
`;

async function poser(base: string, fichiers: Record<string, string>) {
  for (const [rel, c] of Object.entries(fichiers)) {
    await mkdir(dirname(join(base, rel)), { recursive: true });
    await writeFile(join(base, rel), c);
  }
}

/** Projet partagé par les serveurs d'un même test : mêmes stockages, comme sur le disque. */
async function projet(o: { surDisque?: boolean } = {}) {
  const root = await mkdtemp(join(racine, "projet-"));
  await mkdir(join(root, ".git"));
  const ecrits: string[] = [];
  const consignes: string[] = [];
  const runtime = new ScriptedRuntime();
  runtime.behave("workflow.demo/redacteur", async (t) => {
    consignes.push(t.prompt);
    await t.callTool("report_phase", { summary: "résumé", files: [] });
  });
  // Sur disque : les stockages JSON de production (tâches, preuves, interactions, sessions).
  const stockages = o.surDisque ? {} : { taskStore: new MemoryTaskStore(), evidenceStore: new MemoryEvidenceStore(), taskSessionStore: new MemoryTaskSessionStore() };
  const workspace = {
    root,
    files: { read: async () => "", write: async (p: string) => void ecrits.push(p), ensureDir: async () => {}, list: async () => [] },
    checkpoints: { create: async (label: string) => ({ id: "cp", sha: "s", head: "h", label, createdAt: "" }), list: async () => [], diff: async () => ({ files: [], patch: "" }), rollback: async () => {} },
    repo: { worktree: async () => { throw new Error("non"); }, head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
  } as unknown as Workspace;
  return { root, ecrits, consignes, runtime, stockages, workspace };
}

type Projet = Awaited<ReturnType<typeof projet>>;

/** Un serveur MCP (un client = un serveur), relié à un client en mémoire. */
async function serveur(p: Projet, o: { pid: number; vivants: Set<number>; roots?: string[]; role?: "architecte" | "developpeur"; nonConnecte?: boolean; detecte?: boolean }) {
  const factory = workspaceServicesFactory({
    extensions: [],
    stacks: [{ id: "typescript", layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] }, infrastructureModules: [], detect: async () => o.detecte ?? true, isTestFile: () => false, testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
    allowedPrograms: ["pytest"],
    sansRepli: true,
    tasksDir: join(p.root, ".taches"),
    ...p.stockages,
    clock: fixedClock(),
    ids: sequentialIds(`s${o.pid}-`),
    workflows: { machine, launcher: createNodeLauncher(), runtimeEntry: enfant },
  });
  const projets = createProjets({
    ouvrir: (root, journal, pileFournie) => ouvrirServicesSansFenetre({ factory, workspace: async () => p.workspace, runtime: async () => p.runtime, journal })(root, pileFournie),
    piles: createPilesFichiers(join(p.root, ".donnees-du-serveur", "piles")),
    verrou: (root) => prendreVerrou(join(root, ".agent-studio", "mcp-skraft.lock"), { pid: o.pid, estVivant: (x) => o.vivants.has(x) }),
  });
  const mcp = createServeurSkraft({
    projets,
    workflow: "demo",
    role: o.role ?? "architecte",
    autorises: [],
    cwd: p.root,
    pid: o.pid,
    connexion: {
      verifier: async () => (o.nonConnecte ? { ok: false as const, motif: "Non connecté à GitHub (github.com) : appelle skraft_connexion." } : { ok: true as const }),
      connecter: async () => ({ ok: true, texte: "Connexion à GitHub lancée. Ouvre https://github.com/login/device et saisis le code ABCD-1234." }),
    },
  });
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: { roots: {} } });
  client.setRequestHandler(ListRootsRequestSchema, async () => ({ roots: (o.roots ?? [p.root]).map((r) => ({ uri: pathToFileURL(r).href })) }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.connect(b);
  await client.connect(a);
  const appel = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { type: string; text: string }[]; isError?: boolean };
    return { texte: r.content.map((c) => c.text).join("\n"), erreur: r.isError === true };
  };
  const etat = async () => JSON.parse((await appel("skraft_etat")).texte) as {
    mode: string;
    pid: number;
    detenteur?: number;
    workflow: { nom: string; accordRetenu: boolean } | null;
    pile: { id: string; source: string };
    taches: { id: string; status: string; phase: string }[];
    questions: { id: string; title: string; detail?: string; options: { id: string; label: string }[] }[];
    messages: string[];
  };
  const fermer = async () => {
    await client.close();
    await projets.fermer();
  };
  return { client, appel, etat, fermer };
}

const until = async (check: () => Promise<boolean> | boolean) => {
  for (let i = 0; i < 400 && !(await check()); i++) await new Promise((r) => setTimeout(r, 10));
  expect(await check()).toBe(true);
};

describe("Serveur MCP skraft (ADR 0068)", () => {
  it("expose des outils courts : démarrer, état, répondre, reprendre, arrêter", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["skraft_arreter", "skraft_connexion", "skraft_demarrer", "skraft_etat", "skraft_rapport", "skraft_repondre", "skraft_reprendre"]);
    await s.fermer();
  }, 30_000);

  it("sans accord retenu, démarrer ne lance rien et rend le résumé à montrer (point 9)", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
    const r = await s.appel("skraft_demarrer", { story: "stories/us-2.md" });
    expect(r.texte).toMatch(/^Accord requis/);
    expect(r.texte).toContain("Exécuter le workflow « demo » (machine) ?");
    expect(r.texte).toContain("Écrire : .skraft/**");
    expect(r.texte).toMatch(/accord: "une-fois"/);
    expect((await s.etat()).taches).toEqual([]);
    await s.fermer();
  }, 30_000);

  it("avec l'accord : le run démarre, sa question s'affiche dans l'état, la réponse le mène au bout", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
    const r = await s.appel("skraft_demarrer", { story: "stories/us-2.md", auto: true, archi: "java", accord: "une-fois" });
    expect(r.erreur).toBe(false);
    const id = /tâche (\S+)\./.exec(r.texte)?.[1];
    expect(id).toBeDefined();
    await until(async () => (await s.etat()).questions.length === 1);
    expect(p.consignes[0]).toContain("Résume stories/us-2.md java true");
    const e = await s.etat();
    expect(e.mode).toBe("pilote");
    expect(e.taches).toMatchObject([{ id, status: "waiting" }]);
    expect(e.questions[0]).toMatchObject({ title: "Valider le résumé ?", detail: "résumé", options: [{ label: "Oui" }, { label: "Non" }] });

    const rep = await s.appel("skraft_repondre", { question: e.questions[0]!.id, option: e.questions[0]!.options[0]!.id });
    expect(rep.erreur).toBe(false);
    await until(async () => (await s.etat()).taches[0]?.status === "finished");
    expect(p.ecrits).toEqual([".skraft/resume.md"]);

    const rapport = await s.appel("skraft_rapport", { tache: id });
    const lu = JSON.parse(rapport.texte) as { etapes: { phase: string; essai: number; debut: string; fin: string; dureeMs: number; tours: number }[] };
    expect(lu).toMatchObject({ statut: "fini", valeur: { slug: "demo" }, messages: ["Bilan : terminé."] });
    // Étapes du run lues dans sa trace : phase, essai, début, fin, durée, tours.
    expect(lu.etapes.find((e) => e.phase === "REDACTION")).toMatchObject({ essai: 1, tours: 1, debut: expect.any(String), fin: expect.any(String), dureeMs: expect.any(Number) });
    expect(await s.appel("skraft_rapport", { tache: "inconnue" })).toEqual({ erreur: true, texte: expect.stringMatching(/inconnue/) });
    await s.fermer();
  }, 30_000);

  it("une réponse refusée (profil, option inconnue) est une erreur de l'outil, avec la raison", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]), role: "developpeur" });
    await s.appel("skraft_demarrer", { story: "x.md", accord: "une-fois" });
    await until(async () => (await s.etat()).questions.length === 1);
    const q = (await s.etat()).questions[0]!;
    expect(await s.appel("skraft_repondre", { question: q.id, option: q.options[0]!.id })).toEqual({ erreur: true, texte: expect.stringMatching(/Seul le profil/) });
    expect(await s.appel("skraft_repondre", { question: q.id, option: "peut-etre" })).toMatchObject({ erreur: true });
    await s.fermer();
  }, 30_000);

  it("deux serveurs sur un projet : le second consulte, refuse de lancer ; il reprend la main quand le premier meurt", async () => {
    const p = await projet();
    const vivants = new Set([1, 2]);
    const premier = await serveur(p, { pid: 1, vivants });
    await premier.appel("skraft_demarrer", { story: "x.md", accord: "une-fois" });
    await until(async () => (await premier.etat()).questions.length === 1);

    const second = await serveur(p, { pid: 2, vivants });
    const e = await second.etat();
    expect(e.mode).toBe("consultation");
    // Chaque serveur dit son PID et celui du pilote : l'utilisateur sait dans quelle fenêtre répondre.
    expect(e).toMatchObject({ pid: 2, detenteur: 1 });
    expect(await premier.etat()).toMatchObject({ mode: "pilote", pid: 1 });
    expect(e.taches).toHaveLength(1);
    expect(e.questions).toHaveLength(1);
    expect(await second.appel("skraft_demarrer", { story: "y.md", accord: "une-fois" })).toEqual({ erreur: true, texte: expect.stringMatching(/Ce serveur \(PID 2\) est en consultation.*serveur skraft PID 1/s) });
    expect(await second.appel("skraft_repondre", { question: e.questions[0]!.id, option: e.questions[0]!.options[0]!.id })).toMatchObject({ erreur: true, texte: expect.stringMatching(/consultation/) });
    expect(await second.appel("skraft_reprendre")).toMatchObject({ erreur: true, texte: expect.stringMatching(/PID 1/) });

    // Le premier s'arrête sans libérer son verrou (client fermé brutalement).
    vivants.delete(1);
    expect(await second.appel("skraft_reprendre")).toMatchObject({ erreur: false });
    expect((await second.etat()).mode).toBe("pilote");
    await second.fermer();
    await premier.fermer();
  }, 30_000);

  it("reprise hors Electron : le serveur s'arrête pendant une question ; le suivant relit le disque, et le run va au bout", async () => {
    const p = await projet({ surDisque: true });
    const premier = await serveur(p, { pid: 1, vivants: new Set([1]) });
    const id = /tâche (\S+)\./.exec((await premier.appel("skraft_demarrer", { story: "x.md", accord: "une-fois" })).texte)![1]!;
    await until(async () => (await premier.etat()).questions.length === 1);
    await premier.fermer();

    // Nouveau processus : autres services, mêmes fichiers. Le rejeu du journal ne relance pas l'agent.
    const appelsAvant = p.consignes.length;
    const second = await serveur(p, { pid: 2, vivants: new Set([2]) });
    const e = await second.etat();
    expect(e.mode).toBe("pilote");
    expect(e.taches).toMatchObject([{ id, status: "waiting" }]);
    expect(e.questions).toHaveLength(1);
    await second.appel("skraft_repondre", { question: e.questions[0]!.id, option: e.questions[0]!.options[0]!.id });
    await until(async () => (await second.etat()).taches[0]?.status === "finished");
    expect(JSON.parse((await second.appel("skraft_rapport", { tache: id })).texte)).toMatchObject({ statut: "fini", messages: ["Bilan : terminé."] });
    expect(p.consignes.length).toBe(appelsAvant);
    await second.fermer();
  }, 60_000);

  it("arrêter un run l'abandonne", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
    const r = await s.appel("skraft_demarrer", { story: "x.md", accord: "une-fois" });
    const id = /tâche (\S+)\./.exec(r.texte)![1]!;
    await until(async () => (await s.etat()).questions.length === 1);
    expect((await s.appel("skraft_arreter", { tache: id })).erreur).toBe(false);
    await until(async () => (await s.etat()).taches[0]?.status === "finished");
    expect((await s.etat()).questions).toEqual([]);
    await s.fermer();
  }, 30_000);

  it("non connecté à GitHub : démarrer, répondre et reprendre renvoient vers skraft_connexion ; l'état reste lisible", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]), nonConnecte: true });
    for (const [outil, args] of [["skraft_demarrer", { story: "x.md", accord: "une-fois" }], ["skraft_repondre", { question: "q", option: "o" }], ["skraft_reprendre", {}]] as const)
      expect(await s.appel(outil, args)).toEqual({ erreur: true, texte: expect.stringMatching(/skraft_connexion/) });
    expect((await s.etat()).taches).toEqual([]);
    expect(await s.appel("skraft_connexion")).toEqual({ erreur: false, texte: expect.stringContaining("ABCD-1234") });
    await s.fermer();
  }, 30_000);

  it("la pile retenue et sa source, le workflow et son accord figurent dans l'état", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
    expect((await s.etat()).pile).toEqual({ id: "typescript", source: "detection" });
    expect((await s.etat()).workflow).toEqual({ nom: "demo", accordRetenu: false });
    await s.appel("skraft_demarrer", { story: "x.md", accord: "toujours" });
    expect((await s.etat()).workflow).toEqual({ nom: "demo", accordRetenu: true });
    await s.fermer();
  }, 30_000);

  it("projet sans pile reconnue : refus qui demande l'argument pile ; fournie, elle est gardée pour les reprises, hors du dépôt", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]), detecte: false });
    expect(await s.appel("skraft_etat")).toEqual({ erreur: true, texte: expect.stringMatching(/Aucune pile.*argument « pile » de skraft_demarrer/s) });
    const r = await s.appel("skraft_demarrer", { story: "x.md", accord: "une-fois", pile: PILE });
    expect(r.erreur).toBe(false);
    expect((await s.etat()).pile).toEqual({ id: "python", source: "client" });
    await s.fermer();
    // Un autre serveur, plus tard (reprise) : même pile, sans la redonner.
    const t = await serveur(p, { pid: 2, vivants: new Set([2]), detecte: false });
    expect((await t.etat()).pile).toEqual({ id: "python", source: "client" });
    await t.fermer();
    expect(p.ecrits.some((f) => f.includes("stack.yaml"))).toBe(false);
  }, 30_000);

  it("une autre pile fournie pendant un run est refusée ; après la fin du run, elle remplace la précédente", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]), detecte: false });
    await s.appel("skraft_demarrer", { story: "x.md", accord: "une-fois", pile: PILE });
    await until(async () => (await s.etat()).questions.length === 1);
    const autre = PILE.replace("id: python", "id: python-bis");
    expect(await s.appel("skraft_demarrer", { story: "y.md", accord: "une-fois", pile: autre })).toEqual({ erreur: true, texte: expect.stringMatching(/run en cours/) });
    const q = (await s.etat()).questions[0]!;
    await s.appel("skraft_repondre", { question: q.id, option: q.options[0]!.id });
    await until(async () => (await s.etat()).taches.every((t) => t.status === "finished"));
    expect((await s.appel("skraft_demarrer", { story: "y.md", accord: "une-fois", pile: autre })).erreur).toBe(false);
    expect((await s.etat()).pile).toEqual({ id: "python-bis", source: "client" });
    await s.fermer();
  }, 30_000);

  it("pile fournie qui nomme un programme interdit : refusée, avec le programme ; rien ne démarre", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]), detecte: false });
    expect(await s.appel("skraft_demarrer", { story: "x.md", accord: "une-fois", pile: PILE.replace("pytest", "curl") })).toEqual({ erreur: true, texte: expect.stringContaining("curl") });
    await s.fermer();
  }, 30_000);

  it("un projet hors des roots du client est refusé, sans rien ouvrir", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]), roots: [join(racine, "machine")] });
    expect(await s.appel("skraft_etat", { projet: p.root })).toEqual({ erreur: true, texte: expect.stringMatching(/Projet refusé/) });
    await s.fermer();
  }, 30_000);

  it("story ou skill avec un espace : refusé, car la commande sépare ses arguments par des espaces", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
    // Sans ce refus, « mots.md » deviendrait le skill d'architecture, et le run partirait sur « deux ».
    expect(await s.appel("skraft_demarrer", { story: "deux mots.md", accord: "une-fois" })).toMatchObject({ erreur: true, texte: expect.stringMatching(/espace/) });
    expect(await s.appel("skraft_demarrer", { story: "x.md", archi: "clean java", accord: "une-fois" })).toMatchObject({ erreur: true, texte: expect.stringMatching(/espace/) });
    expect((await s.etat()).taches).toEqual([]);
    await s.fermer();
  }, 30_000);
});
