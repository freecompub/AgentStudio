/**
 * Pile du projet (ADR 0068, point 8) : profil du projet, sinon détection, sinon profil fourni par
 * l'appelant (le client MCP), soumis à la même liste de programmes. Sans repli permis, aucune pile
 * n'est une erreur qui dit quoi fournir ; l'application de bureau garde son repli averti.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, MemoryTaskSessionStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
import type { ConfirmAnswer, ConfirmRequest } from "@agent-studio/core";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import type { Workspace } from "@agent-studio/workspace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaceServicesFactory } from "../src/workspace-services.js";

let base: string;
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "pile-"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

const profil = (id: string, programme = "pytest") => `
id: ${id}
detect: [pyproject.toml]
tests:
  command: [${programme}, "--junit-xml={rapport}"]
  report: junit-xml
layout:
  unitTests: ["tests/**"]
  sources: ["src/**"]
`;

/**
 * `repondre` : l'utilisateur à qui l'on demande d'accepter un programme (ADR 0075) ; `consentement` :
 * ce que permet l'administrateur (par défaut, oui) ; `root` : rouvrir un projet déjà créé.
 */
async function ouvrir(o: { detecte?: boolean; profilProjet?: string; fichierProjet?: string; fournie?: string; sansRepli?: boolean; repondre?: (q: ConfirmRequest) => ConfirmAnswer; consentement?: boolean; root?: string; taches?: string; repliPermis?: boolean }) {
  const root = o.root ?? (await mkdtemp(join(base, "projet-")));
  if (o.profilProjet || o.fichierProjet) await mkdir(join(root, ".agent-studio"), { recursive: true });
  if (o.profilProjet) await writeFile(join(root, ".agent-studio", "stack.yaml"), o.profilProjet);
  if (o.fichierProjet) await writeFile(join(root, ".agent-studio", "projet.yaml"), o.fichierProjet);
  const posts: string[] = [];
  const services = await workspaceServicesFactory({
    extensions: [],
    stacks: [{ id: "typescript", layout: { acceptanceTests: [], unitTests: [], sources: [] }, infrastructureModules: [], detect: async () => o.detecte ?? false, isTestFile: () => false, testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
    allowedPrograms: ["pytest"],
    origineDesProgrammes: "Liste de `allowedPrograms` dans /etc/agent-studio/admin.json.",
    programConsent: o.consentement ?? true,
    ...(o.sansRepli ? { sansRepli: true } : {}),
    tasksDir: o.taches ?? join(root, ".taches"),
    taskStore: new MemoryTaskStore(),
    evidenceStore: new MemoryEvidenceStore(),
    interactionStore: new MemoryInteractionStore(),
    taskSessionStore: new MemoryTaskSessionStore(),
    clock: fixedClock(),
    ids: sequentialIds("id-"),
  })({
    workspace: { root, files: { list: async () => [] } } as unknown as Workspace,
    runtime: async () => new ScriptedRuntime(),
    onTask: () => {},
    onInteractions: () => {},
    onPost: (_e, md) => void posts.push(md),
    ...(o.fournie !== undefined ? { pileFournie: o.fournie } : {}),
    ...(o.repliPermis ? { repliPermis: true } : {}),
    ...(o.repondre ? { confirmerProgrammes: { confirm: async (q: ConfirmRequest) => o.repondre!(q) } } : {}),
  });
  return { services, posts, root };
}

describe("Pile du projet (ADR 0068, point 8)", () => {
  it("profil du projet, puis détection, puis pile fournie : la première qui existe, et sa source", async () => {
    const a = await ouvrir({ profilProjet: profil("python-projet"), detecte: true, fournie: profil("python-client") });
    expect(a.services.pile()).toEqual({ id: "python-projet", source: "projet" });
    const b = await ouvrir({ detecte: true, fournie: profil("python-client") });
    expect(b.services.pile()).toEqual({ id: "typescript", source: "detection" });
    const c = await ouvrir({ fournie: profil("python-client"), sansRepli: true });
    expect(c.services.pile()).toEqual({ id: "python-client", source: "client" });
    for (const x of [a, b, c]) await x.services.dispose();
  });

  it("projet.yaml (ADR 0071) : la section pile fait foi, avant l'ancien stack.yaml, qui est signalé comme ignoré", async () => {
    const indente = (t: string) => t.trim().split("\n").map((l) => `  ${l}`).join("\n");
    const a = await ouvrir({ fichierProjet: `pile:\n${indente(profil("python-projet"))}\n`, profilProjet: profil("python-ancien"), detecte: true });
    expect(a.services.pile()).toEqual({ id: "python-projet", source: "projet" });
    expect(a.posts.join("\n")).toMatch(/stack\.yaml.*ignoré.*projet\.yaml/s);
    await a.services.dispose();
  });

  it("projet.yaml sans section pile : la détection s'applique ; section pile refusée : nommée, puis détection", async () => {
    const a = await ouvrir({ fichierProjet: "qualite:\n  couverture:\n    reste: 70\n", detecte: true });
    expect(a.services.pile()).toEqual({ id: "typescript", source: "detection" });
    await a.services.dispose();
    const indente = (t: string) => t.trim().split("\n").map((l) => `  ${l}`).join("\n");
    const b = await ouvrir({ fichierProjet: `pile:\n${indente(profil("python-projet", "curl"))}\n`, detecte: true });
    expect(b.services.pile().source).toBe("detection");
    expect(b.posts.join("\n")).toMatch(/projet\.yaml.*section pile.*refus|refus.*projet\.yaml.*section pile/s);
    expect(b.posts.join("\n")).toMatch(/curl/);
    await b.services.dispose();
  });

  it("projet.yaml à composants (ADR 0074) : une pile composée, et la pile dit ses composants", async () => {
    const indente = (t: string, n: number) => t.trim().split("\n").map((l) => `${" ".repeat(n)}${l}`).join("\n");
    const projet = `composants:\n  - nom: api\n    racine: services/api\n    pile:\n${indente(profil("python-api"), 6)}\n  - nom: outils\n    racine: outils\n    pile:\n${indente(profil("python-outils"), 6)}\n`;
    const a = await ouvrir({ fichierProjet: projet, detecte: true });
    expect(a.services.pile()).toEqual({
      id: "python-api",
      source: "projet",
      composants: [{ nom: "api", racine: "services/api", id: "python-api" }, { nom: "outils", racine: "outils", id: "python-outils" }],
    });
    await a.services.dispose();
  });

  it("composant dont la pile est refusée : nommé avec sa raison, puis la détection reprend la main", async () => {
    const indente = (t: string, n: number) => t.trim().split("\n").map((l) => `${" ".repeat(n)}${l}`).join("\n");
    const projet = `composants:\n  - nom: api\n    racine: api\n    pile:\n${indente(profil("python-api", "curl"), 6)}\n`;
    const a = await ouvrir({ fichierProjet: projet, detecte: true });
    expect(a.services.pile().source).toBe("detection");
    expect(a.posts.join("\n")).toMatch(/composant « api ».*curl/s);
    await a.services.dispose();
  });

  it("composant de monorepo : outils peut viser le node_modules partagé à la racine, pas au-delà du projet", async () => {
    const indente = (t: string, n: number) => t.trim().split("\n").map((l) => `${" ".repeat(n)}${l}`).join("\n");
    const avec = (outil: string) => `composants:\n  - nom: web\n    racine: apps/web\n    pile:\n${indente(profil("web").replace("detect: [pyproject.toml]", `detect: [pyproject.toml]\noutils: [${outil}]`), 6)}\n`;
    const a = await ouvrir({ fichierProjet: avec("../../node_modules/.bin"), detecte: true });
    expect(a.services.pile().source).toBe("projet");
    await a.services.dispose();
    const b = await ouvrir({ fichierProjet: avec("../../../ailleurs"), detecte: true });
    expect(b.services.pile().source).toBe("detection");
    expect(b.posts.join("\n")).toMatch(/sort du projet/);
    await b.services.dispose();
  });

  it("ancien stack.yaml seul : encore lu, avec un avertissement qui dit de le regrouper dans projet.yaml", async () => {
    const a = await ouvrir({ profilProjet: profil("python-ancien"), detecte: true });
    expect(a.services.pile()).toEqual({ id: "python-ancien", source: "projet" });
    expect(a.posts.join("\n")).toMatch(/regroupe.*projet\.yaml/s);
    await a.services.dispose();
  });

  it("pile fournie au format composants (ADR 0074, serveur MCP) : une pile composée, de source client ; un composant refusé est nommé", async () => {
    const indente = (t: string, n: number) => t.trim().split("\n").map((l) => `${" ".repeat(n)}${l}`).join("\n");
    const fournie = `composants:\n  - nom: api\n    racine: api\n    pile:\n${indente(profil("python-api"), 6)}\n`;
    const a = await ouvrir({ fournie, sansRepli: true });
    expect(a.services.pile()).toEqual({ id: "python-api", source: "client", composants: [{ nom: "api", racine: "api", id: "python-api" }] });
    await a.services.dispose();
    const refusee = `composants:\n  - nom: api\n    racine: api\n    pile:\n${indente(profil("python-api", "curl"), 6)}\n`;
    await expect(ouvrir({ fournie: refusee, sansRepli: true })).rejects.toThrow(/composant « api ».*curl/s);
  });

  it("pile fournie ignorée parce que le projet a la sienne : c'est dit", async () => {
    const a = await ouvrir({ detecte: true, fournie: profil("python-client") });
    expect(a.posts.join("\n")).toMatch(/pile fournie.*ignorée.*typescript/is);
    await a.services.dispose();
  });

  it("pile fournie qui nomme un programme hors de la liste de l'administrateur : refusée, avec le programme", async () => {
    await expect(ouvrir({ fournie: profil("python-client", "curl"), sansRepli: true })).rejects.toThrow(/curl/);
  });

  it("le refus d'un programme dit d'où vient la liste, pour une pile fournie, une pile du projet et un composant (09/11)", async () => {
    const origine = /Programmes autorisés : pytest\. Liste de `allowedPrograms` dans \/etc\/agent-studio\/admin\.json\./;
    await expect(ouvrir({ fournie: profil("python-client", "uv"), sansRepli: true })).rejects.toThrow(origine);
    const a = await ouvrir({ fichierProjet: `pile:\n${profil("python-projet", "uv").trim().split("\n").map((l) => `  ${l}`).join("\n")}\n`, detecte: true });
    expect(a.posts.join("\n")).toMatch(origine);
    await a.services.dispose();
    const indente = (t: string, n: number) => t.trim().split("\n").map((l) => `${" ".repeat(n)}${l}`).join("\n");
    const b = await ouvrir({ fichierProjet: `composants:\n  - nom: api\n    racine: api\n    pile:\n${indente(profil("python-api", "uv"), 6)}\n`, detecte: true });
    expect(b.posts.join("\n")).toMatch(origine);
    await b.services.dispose();
  });

  it("sans repli permis et sans aucune pile : refus qui dit quoi fournir", async () => {
    await expect(ouvrir({ sansRepli: true })).rejects.toThrow(/stack\.yaml/);
  });

  it("sans repli permis, mais ouvert pour proposer la pile (`skraft_pile`, ADR 0075) : le repli, sans refus", async () => {
    const a = await ouvrir({ sansRepli: true, repliPermis: true });
    expect(a.services.pile()).toEqual({ id: "typescript", source: "repli" });
    await a.services.dispose();
  });

  it("repli permis (application de bureau) : premier adaptateur, source « repli », et l'avertissement habituel", async () => {
    const a = await ouvrir({});
    expect(a.services.pile()).toEqual({ id: "typescript", source: "repli" });
    expect(a.posts.join("\n")).toMatch(/reconnu par aucun adaptateur/);
    await a.services.dispose();
  });
});

/**
 * Un programme hors de la liste de l'administrateur (ADR 0075) : au lieu de refuser la pile, on demande
 * à l'utilisateur, s'il y a quelqu'un à qui demander et que l'administrateur le permet.
 */
describe("Programme hors liste, accepté par l'utilisateur", () => {
  const enPile = (t: string) => `pile:\n${t.trim().split("\n").map((l) => `  ${l}`).join("\n")}\n`;
  const avecUv = enPile(profil("python-uv", "uv"));

  it("« une fois » : la pile est retenue ; la question nomme le programme, la commande et l'origine de la liste ; rouvert, on redemande", async () => {
    const questions: ConfirmRequest[] = [];
    const a = await ouvrir({ fichierProjet: avecUv, repondre: (q) => (questions.push(q), "allow-once") });
    expect(a.services.pile()).toEqual({ id: "python-uv", source: "projet" });
    expect(questions).toHaveLength(1);
    expect(questions[0]!.title).toBe("Autoriser « uv » pour ce projet ?");
    expect(questions[0]!.detail).toContain("tests : uv --junit-xml={rapport}");
    expect(questions[0]!.detail).toContain("Liste de `allowedPrograms` dans /etc/agent-studio/admin.json.");
    expect(questions[0]!.detail).toMatch(/sans shell/);
    expect(a.posts.join("\n")).toMatch(/« uv » accepté par l'utilisateur pour ce projet \(cette fois\)/);
    await a.services.dispose();
    const b = await ouvrir({ root: a.root, repondre: (q) => (questions.push(q), "allow-once") });
    expect(questions).toHaveLength(2);
    await b.services.dispose();
  });

  it("« toujours » : retenu hors du dépôt, rouvert sans question ; pas pour un autre projet", async () => {
    const a = await ouvrir({ fichierProjet: avecUv, repondre: () => "allow-always" });
    expect(a.services.pile().source).toBe("projet");
    await a.services.dispose();
    const b = await ouvrir({ root: a.root, repondre: () => { throw new Error("ne devait pas redemander"); } });
    expect(b.services.pile()).toEqual({ id: "python-uv", source: "projet" });
    await b.services.dispose();
    const questions: string[] = [];
    // Même dossier des tâches, autre projet : l'accord ne vaut que pour le projet accepté.
    const c = await ouvrir({ fichierProjet: avecUv, detecte: true, taches: join(a.root, ".taches"), repondre: (q) => (questions.push(q.title), "deny") });
    expect(questions).toEqual(["Autoriser « uv » pour ce projet ?"]);
    await c.services.dispose();
  });

  it("« non », personne à qui demander, ou administrateur qui l'interdit : refusée comme avant", async () => {
    // L'administrateur qui l'interdit : même si l'utilisateur dirait oui, on ne lui demande rien.
    const poseesMalgre: string[] = [];
    for (const o of [{ repondre: (): ConfirmAnswer => "deny" }, {}, { repondre: (q: ConfirmRequest): ConfirmAnswer => (poseesMalgre.push(q.title), "allow-always"), consentement: false }]) {
      const a = await ouvrir({ fichierProjet: avecUv, detecte: true, ...o });
      expect(a.services.pile().source).toBe("detection");
      expect(a.posts.join("\n")).toMatch(/« uv » \(tests\) n'est pas un programme autorisé/);
      await a.services.dispose();
    }
    expect(poseesMalgre).toEqual([]);
  });

  it("un programme désigné par un chemin n'est jamais demandé : il échapperait à la liste", async () => {
    const posees: string[] = [];
    const a = await ouvrir({ fichierProjet: enPile(profil("python-chemin", "./outils/lanceur")), detecte: true, repondre: (q) => (posees.push(q.title), "allow-always") });
    expect(a.services.pile().source).toBe("detection");
    expect(posees).toEqual([]);
    await a.services.dispose();
  });

  it("pile fournie et composant : même question ; deux sections du même programme, une seule question", async () => {
    const questions: ConfirmRequest[] = [];
    const repondre = (q: ConfirmRequest): ConfirmAnswer => (questions.push(q), "allow-once");
    const deuxSections = `${profil("python-uv", "uv")}lint:\n  command: [uv, run, ruff]\n  report: eslint-json\n`;
    const a = await ouvrir({ fournie: deuxSections, sansRepli: true, repondre });
    expect(a.services.pile()).toEqual({ id: "python-uv", source: "client" });
    expect(questions).toHaveLength(1);
    expect(questions[0]!.detail).toContain("lint : uv run ruff");
    await a.services.dispose();
    const indente = (t: string, n: number) => t.trim().split("\n").map((l) => `${" ".repeat(n)}${l}`).join("\n");
    const b = await ouvrir({ fichierProjet: `composants:\n  - nom: api\n    racine: api\n    pile:\n${indente(profil("python-api", "uv"), 6)}\n`, repondre });
    expect(b.services.pile().source).toBe("projet");
    expect(questions).toHaveLength(2);
    await b.services.dispose();
  });
});
