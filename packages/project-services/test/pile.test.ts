/**
 * Pile du projet (ADR 0068, point 8) : profil du projet, sinon détection, sinon profil fourni par
 * l'appelant (le client MCP), soumis à la même liste de programmes. Sans repli permis, aucune pile
 * n'est une erreur qui dit quoi fournir ; l'application de bureau garde son repli averti.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedClock, MemoryEvidenceStore, MemoryInteractionStore, MemoryTaskSessionStore, ScriptedRuntime, sequentialIds } from "@agent-studio/core/testing";
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

async function ouvrir(o: { detecte?: boolean; profilProjet?: string; fichierProjet?: string; fournie?: string; sansRepli?: boolean }) {
  const root = await mkdtemp(join(base, "projet-"));
  if (o.profilProjet || o.fichierProjet) await mkdir(join(root, ".agent-studio"), { recursive: true });
  if (o.profilProjet) await writeFile(join(root, ".agent-studio", "stack.yaml"), o.profilProjet);
  if (o.fichierProjet) await writeFile(join(root, ".agent-studio", "projet.yaml"), o.fichierProjet);
  const posts: string[] = [];
  const services = await workspaceServicesFactory({
    extensions: [],
    stacks: [{ id: "typescript", layout: { acceptanceTests: [], unitTests: [], sources: [] }, infrastructureModules: [], detect: async () => o.detecte ?? false, isTestFile: () => false, testFilePattern: "^tests/", runTests: async () => ({ results: [], exitCode: 0, timedOut: false, output: "", durationMs: 0 }) }],
    allowedPrograms: ["pytest"],
    ...(o.sansRepli ? { sansRepli: true } : {}),
    tasksDir: join(root, ".taches"),
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
  });
  return { services, posts };
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

  it("ancien stack.yaml seul : encore lu, avec un avertissement qui dit de le regrouper dans projet.yaml", async () => {
    const a = await ouvrir({ profilProjet: profil("python-ancien"), detecte: true });
    expect(a.services.pile()).toEqual({ id: "python-ancien", source: "projet" });
    expect(a.posts.join("\n")).toMatch(/regroupe.*projet\.yaml/s);
    await a.services.dispose();
  });

  it("pile fournie ignorée parce que le projet a la sienne : c'est dit", async () => {
    const a = await ouvrir({ detecte: true, fournie: profil("python-client") });
    expect(a.posts.join("\n")).toMatch(/pile fournie.*ignorée.*typescript/is);
    await a.services.dispose();
  });

  it("pile fournie qui nomme un programme hors de la liste de l'administrateur : refusée, avec le programme", async () => {
    await expect(ouvrir({ fournie: profil("python-client", "curl"), sansRepli: true })).rejects.toThrow(/curl/);
  });

  it("sans repli permis et sans aucune pile : refus qui dit quoi fournir", async () => {
    await expect(ouvrir({ sansRepli: true })).rejects.toThrow(/stack\.yaml/);
  });

  it("repli permis (application de bureau) : premier adaptateur, source « repli », et l'avertissement habituel", async () => {
    const a = await ouvrir({});
    expect(a.services.pile()).toEqual({ id: "typescript", source: "repli" });
    expect(a.posts.join("\n")).toMatch(/reconnu par aucun adaptateur/);
    await a.services.dispose();
  });
});
