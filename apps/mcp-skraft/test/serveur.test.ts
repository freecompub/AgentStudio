/**
 * Le serveur MCP de bout en bout (ADR 0068), piloté par un vrai client MCP en mémoire, avec les
 * vrais services d'un projet et un workflow exécuté isolé ; agents scriptés, aucun LLM.
 */
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
import { ElicitRequestSchema, ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDepotsFichier, type Depots } from "../src/depots.js";
import { createPilesFichiers } from "../src/piles.js";
import { createProjets } from "../src/projets.js";
import { createServeurSkraft } from "../src/serveur.js";
import { ROLE_DECOUVREUR } from "../../../packages/project-services/src/decouverte-de-pile-agent.js";
import { FICHIERS_NODE, PILE_NODE } from "../../../packages/project-services/test/support/pile-node.js";
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
// Un run peut encore écrire dans `.taches/` au moment du nettoyage (ENOTEMPTY vu en CI le 08/11) : nouvelles tentatives, comme ailleurs.
afterAll(() => rm(racine, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

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
async function projet(o: { surDisque?: boolean; fichiers?: string[]; contenus?: Record<string, string> } = {}) {
  const root = await mkdtemp(join(racine, "projet-"));
  await mkdir(join(root, ".git"));
  await poser(root, o.contenus ?? {});
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
    files: { read: async () => "", write: async (p: string) => void ecrits.push(p), ensureDir: async () => {}, list: async () => o.fichiers ?? Object.keys(o.contenus ?? {}) },
    checkpoints: { create: async (label: string) => ({ id: "cp", sha: "s", head: "h", label, createdAt: "" }), list: async () => [], diff: async () => ({ files: [], patch: "" }), rollback: async () => {} },
    // Une copie du projet pour les canaris (ADR 0076) : un dossier temporaire tient lieu de worktree.
    repo: {
      worktree: async () => {
        const copie = await mkdtemp(join(racine, "copie-"));
        await cp(root, copie, { recursive: true });
        return { root: copie, dispose: () => rm(copie, { recursive: true, force: true }) };
      }, head: async () => "h", commit: async () => null, sync: async () => ({ pulled: 0, pushed: 0 }), switchBranch: async () => {} },
  } as unknown as Workspace;
  return { root, ecrits, consignes, runtime, stockages, workspace };
}

type Projet = Awaited<ReturnType<typeof projet>>;

/** Un serveur MCP (un client = un serveur), relié à un client en mémoire. */
/**
 * `repondre` : le client annonce l'elicitation (ADR 0075) et l'utilisateur répond par cette fonction,
 * qui reçoit la question ; `null` : il la refuse. `depots` : dépôts acceptés « toujours ».
 */
async function serveur(p: Projet, o: { pid: number; vivants: Set<number>; roots?: string[]; role?: "architecte" | "developpeur"; nonConnecte?: boolean; detecte?: boolean; repondre?: (question: string) => string | null; depots?: Depots }) {
  const factory = workspaceServicesFactory({
    extensions: [],
    stacks: [{ id: "typescript", layout: { acceptanceTests: [], unitTests: ["tests/**"], sources: ["src/**"] }, infrastructureModules: [], detect: async () => o.detecte ?? true, isTestFile: () => false, testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
    allowedPrograms: ["pytest"],
    programConsent: true,
    sansRepli: true,
    tasksDir: join(p.root, ".taches"),
    ...p.stockages,
    clock: fixedClock(),
    ids: sequentialIds(`s${o.pid}-`),
    workflows: { machine, launcher: createNodeLauncher(), runtimeEntry: enfant },
  });
  const projets = createProjets({
    ouvrir: (root, journal, ouverture) => ouvrirServicesSansFenetre({ factory, workspace: async () => p.workspace, runtime: async () => p.runtime, journal })(root, ouverture),
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
    ...(o.depots ? { depots: o.depots } : {}),
    connexion: {
      verifier: async () => (o.nonConnecte ? { ok: false as const, motif: "Non connecté à GitHub (github.com) : appelle skraft_connexion." } : { ok: true as const }),
      connecter: async () => ({ ok: true, texte: "Connexion à GitHub lancée. Ouvre https://github.com/login/device et saisis le code ABCD-1234." }),
    },
  });
  const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: { roots: {}, ...(o.repondre ? { elicitation: {} } : {}) } });
  if (o.repondre) {
    const repondre = o.repondre;
    client.setRequestHandler(ElicitRequestSchema, async (r) => {
      const reponse = repondre(r.params.message);
      return reponse === null ? { action: "decline" } : { action: "accept", content: { reponse } };
    });
  }
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
    expect(tools.map((t) => t.name).sort()).toEqual(["skraft_arreter", "skraft_attendre", "skraft_connexion", "skraft_demarrer", "skraft_etat", "skraft_pile", "skraft_rapport", "skraft_repondre", "skraft_reprendre"]);
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

  // 09/11 : que l'utilisateur suive la progression sans que l'hôte ait à interpréter l'état.
  it("skraft_attendre rend chaque changement (question à poser, réponse, fin) ; l'état porte une ligne de progression", async () => {
    const p = await projet();
    const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
    const id = /tâche (\S+)\./.exec((await s.appel("skraft_demarrer", { story: "stories/us-2.md", auto: true, accord: "une-fois" })).texte)![1]!;
    type Attente = { changements: string[]; progression: string[]; questions: { id: string; options: { id: string }[] }[]; termine: boolean };
    const attendre = async () => JSON.parse((await s.appel("skraft_attendre", { tache: id, delai: 10 })).texte) as Attente;
    const vus: string[] = [];
    let r = await attendre();
    for (let i = 0; i < 10 && !r.questions.length; i++) {
      vus.push(...r.changements);
      r = await attendre();
    }
    vus.push(...r.changements);
    expect(vus).toContain("Question à poser à l'utilisateur : Valider le résumé ? — résumé");
    // La story, donnée au lancement, plutôt que le nom du workflow (run du 09/11).
    expect(r.progression[0]).toMatch(/^stories\/us-2\.md · /);
    expect(r.progression[0]).toContain("attend une réponse");
    expect(r.progression[0]).toContain("1 question en attente");
    // L'état porte la même ligne.
    const e = JSON.parse((await s.appel("skraft_etat")).texte) as { taches: { progression: string }[] };
    expect(e.taches[0]!.progression).toContain("1 question en attente");

    await s.appel("skraft_repondre", { question: r.questions[0]!.id, option: r.questions[0]!.options[0]!.id });
    const suite: string[] = [];
    for (let i = 0; i < 10 && !r.termine; i++) {
      r = await attendre();
      suite.push(...r.changements);
    }
    expect(suite).toContain("Réponse reçue : le run reprend.");
    expect(suite.some((c) => c.startsWith("Run terminé"))).toBe(true);
    expect(r.termine).toBe(true);
    // Le SDK MCP abandonne un appel au bout de 60 s par défaut (run du 09/11) : l'attente reste en deçà.
    expect((await s.appel("skraft_attendre", { tache: id, delai: 120 })).erreur).toBe(true);
    // Run déjà terminé : la réponse est immédiate, sans attendre le délai.
    const t0 = Date.now();
    expect((await attendre()).changements).toEqual(["Le run est terminé : skraft_rapport donne son bilan."]);
    expect(Date.now() - t0).toBeLessThan(5_000);
    await s.fermer();
  }, 60_000);

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

  /**
   * Dépôt hors des dossiers permis, client qui sait poser une question (ADR 0075) : le serveur demande à
   * l'utilisateur au lieu de refuser. Copilot CLI ne déclare pas de roots : sans cela, aucun dépôt.
   */
  describe("dépôt hors des dossiers permis, accepté par l'utilisateur", () => {
    const hors = (p: Projet, o: { repondre: (q: string) => string | null; depots: Depots }) => serveur(p, { pid: 1, vivants: new Set([1]), roots: [join(racine, "machine")], ...o });

    it("« Oui, cette fois » : ouvert pour ce serveur seulement, sans redemander ; un autre serveur redemande", async () => {
      const p = await projet();
      const depots = createDepotsFichier(join(p.root, ".donnees-du-serveur", "depots-acceptes.json"));
      const questions: string[] = [];
      const s = await hors(p, { repondre: (q) => (questions.push(q), "Oui, cette fois"), depots });
      expect(await s.appel("skraft_etat", { projet: p.root })).toMatchObject({ erreur: false });
      expect(await s.appel("skraft_etat", { projet: p.root })).toMatchObject({ erreur: false });
      expect(questions).toHaveLength(1);
      expect(questions[0]).toContain(p.root);
      expect(questions[0]).toMatch(/branche.*checkpoints.*tests/s);
      await s.fermer();
      expect(await depots.liste()).toEqual([]);
      const t = await hors(p, { repondre: (q) => (questions.push(q), "Non"), depots });
      expect(await t.appel("skraft_etat", { projet: p.root })).toMatchObject({ erreur: true });
      expect(questions).toHaveLength(2);
      await t.fermer();
    }, 30_000);

    it("« Oui, toujours » : retenu, un autre serveur ne redemande pas", async () => {
      const p = await projet();
      const depots = createDepotsFichier(join(p.root, ".donnees-du-serveur", "depots-acceptes.json"));
      const s = await hors(p, { repondre: () => "Oui, toujours", depots });
      expect(await s.appel("skraft_etat", { projet: p.root })).toMatchObject({ erreur: false });
      await s.fermer();
      const t = await hors(p, { repondre: () => { throw new Error("ne devait pas redemander"); }, depots });
      expect(await t.appel("skraft_etat", { projet: p.root })).toMatchObject({ erreur: false });
      await t.fermer();
    }, 30_000);

    // Copilot CLI en mode non interactif (`-p`) refuse la question de lui-même (essai du 09/11) : le refus
    // ne doit pas prétendre que l'utilisateur a répondu.
    it("« Non » ou question refusée : refusé, sans prétendre que l'utilisateur a répondu", async () => {
      const p = await projet();
      const depots = createDepotsFichier(join(p.root, ".donnees-du-serveur", "depots-acceptes.json"));
      for (const repondre of [() => "Non", () => null]) {
        const s = await hors(p, { repondre, depots });
        expect(await s.appel("skraft_etat", { projet: p.root })).toEqual({ erreur: true, texte: expect.stringMatching(/^Projet refusé : l'accord demandé pour .+ n'a pas été donné \(refusé, ou personne pour répondre : un client non interactif refuse de lui-même\)\. Rien n'a été ouvert\.$/) });
        await s.fermer();
      }
    }, 30_000);
  });

  /** Un programme hors de la liste, accepté par l'utilisateur par la question du client (ADR 0075). */
  describe("programme hors liste, accepté par l'utilisateur", () => {
    const avecUv = `pile:\n${PILE.replace("pytest", "uv").trim().split("\n").map((l) => `  ${l}`).join("\n")}\n`;

    it("le client sait demander : la question nomme le programme, et la pile du projet est retenue", async () => {
      const p = await projet();
      await poser(p.root, { ".agent-studio/projet.yaml": avecUv });
      const questions: string[] = [];
      const s = await serveur(p, { pid: 1, vivants: new Set([1]), repondre: (q) => (questions.push(q), "Oui, cette fois") });
      expect((await s.etat()).pile).toEqual({ id: "python", source: "projet" });
      expect(questions).toHaveLength(1);
      expect(questions[0]).toMatch(/^Autoriser « uv » pour ce projet \?\n\n.*tests : uv --junit-xml=\{rapport\}/s);
      await s.fermer();
    }, 30_000);

    it("le client ne sait pas demander : la pile du projet est refusée, la détection reprend", async () => {
      const p = await projet();
      await poser(p.root, { ".agent-studio/projet.yaml": avecUv });
      const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
      const e = await s.etat();
      expect(e.pile).toEqual({ id: "typescript", source: "detection" });
      expect(e.messages.join("\n")).toMatch(/« uv » \(tests\) n'est pas un programme autorisé/);
      await s.fermer();
    }, 30_000);
  });

  /**
   * `skraft_pile` (ADR 0075) : la pile proposée par `/stack init`, écrite après la question du client ;
   * puis `/stack doctor`. Sans question possible, la proposition est rendue et rien n'est écrit.
   */
  describe("skraft_pile", () => {
    /** L'agent de découverte (ADR 0076), scripté : il soumet la pile `node --test`, que le code éprouve pour de vrai. */
    const decouvreur = (p: Projet, prompts: string[] = []) =>
      p.runtime.behave(ROLE_DECOUVREUR, async (t) => {
        prompts.push(t.prompt);
        await t.callTool("submit_pile", { piles: [{ racine: ".", yaml: PILE_NODE }], justification: "package.json et tests/." });
      });

    it("proposer : la pile de l'agent est vérifiée, puis écrite après l'accord de l'utilisateur", async () => {
      const p = await projet({ contenus: FICHIERS_NODE });
      decouvreur(p);
      const questions: string[] = [];
      const s = await serveur(p, { pid: 1, vivants: new Set([1]), detecte: false, repondre: (q) => (questions.push(q), "Oui, cette fois") });
      const r = await s.appel("skraft_pile", {});
      expect(r.erreur).toBe(false);
      expect(r.texte).toMatch(/Profil proposé par l'agent de découverte/);
      expect(r.texte).toMatch(/```yaml\n.*id: maison/s);
      expect(r.texte).toMatch(/Profil écrit/);
      // Les consignes de `/stack` sont dites dans les termes de l'outil : le client n'a pas ces commandes.
      expect(r.texte).not.toMatch(/\/stack|Rouvrez/);
      expect(r.texte).toMatch(/Il prend effet au prochain appel de skraft/);
      // `node` n'est pas dans la liste du serveur de test : demandé avant d'être lancé, puis l'écriture.
      expect(questions).toEqual([expect.stringMatching(/^Autoriser « node » pour ce projet \?/), expect.stringMatching(/^Écrire le profil de stack dans \.agent-studio\/projet\.yaml \?/)]);
      expect(p.ecrits).toContain(".agent-studio/projet.yaml");
      await s.fermer();
    }, 60_000);

    it("proposer, client qui ne sait pas demander : la pile est refusée sans être lancée, rien n'est écrit", async () => {
      const p = await projet({ contenus: FICHIERS_NODE });
      decouvreur(p);
      const s = await serveur(p, { pid: 1, vivants: new Set([1]), detecte: false });
      const r = await s.appel("skraft_pile", {});
      expect(r.texte).toMatch(/Rien n'a été écrit/);
      expect(r.texte).toMatch(/« node » \(tests\) n'est pas un programme autorisé/);
      expect(p.ecrits).toEqual([]);
      await s.fermer();
    }, 60_000);

    it("les options passent à la découverte ; une option avec un espace est refusée", async () => {
      const p = await projet({ contenus: FICHIERS_NODE });
      const prompts: string[] = [];
      decouvreur(p, prompts);
      const s = await serveur(p, { pid: 1, vivants: new Set([1]), detecte: false });
      await s.appel("skraft_pile", { sansBdd: true });
      expect(prompts[0]).toMatch(/sans BDD/);
      expect((await s.appel("skraft_pile", { etapes: "deux mots" })).erreur).toBe(true);
      await s.fermer();
    }, 60_000);

    it("proposer fait travailler un agent : sans connexion, refusé avec ce qu'il faut faire", async () => {
      const p = await projet({ contenus: FICHIERS_NODE });
      const s = await serveur(p, { pid: 1, vivants: new Set([1]), detecte: false, nonConnecte: true });
      expect(await s.appel("skraft_pile", {})).toEqual({ erreur: true, texte: expect.stringMatching(/skraft_connexion/) });
      await s.fermer();
    }, 30_000);

    it("après skraft_pile, le projet est relu : un profil écrit entre-temps prend effet", async () => {
      const p = await projet();
      const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
      expect((await s.etat()).pile).toEqual({ id: "typescript", source: "detection" });
      await poser(p.root, { ".agent-studio/projet.yaml": `pile:\n${PILE.trim().split("\n").map((l) => `  ${l}`).join("\n")}\n` });
      await s.appel("skraft_pile", { action: "diagnostiquer" });
      expect((await s.etat()).pile).toEqual({ id: "python", source: "projet" });
      await s.fermer();
    }, 30_000);

    it("diagnostiquer : le diagnostic de /stack doctor", async () => {
      const p = await projet();
      await poser(p.root, { ".agent-studio/projet.yaml": `pile:\n${PILE.trim().split("\n").map((l) => `  ${l}`).join("\n")}\n` });
      const s = await serveur(p, { pid: 1, vivants: new Set([1]) });
      expect((await s.appel("skraft_pile", { action: "diagnostiquer" })).texte).toMatch(/Diagnostic du profil/);
      await s.fermer();
    }, 30_000);
  });

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
