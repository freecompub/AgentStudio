/**
 * Le paquet construit, lancé comme le ferait un client MCP : `node dist/main.mjs` en processus
 * enfant, transport stdio (ADR 0068, point 3). Vérifie que le bundle démarre hors du monorepo de
 * sources, que le workflow skraft livré est activé, que la configuration borne les projets, et que
 * rien d'autre que le protocole ne sort sur stdout. Aucun appel à GitHub ni à Copilot : seuls des
 * outils qui n'en ont pas besoin sont appelés.
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createNodeLauncher } from "@agent-studio/extension-host";
import { compilerWorkflow, createRejoueurIsole, type EtatWorkflow } from "@agent-studio/workflow";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const paquet = resolve(import.meta.dirname, "..");
let base: string;
let home: string;
let depot: string;
beforeAll(async () => {
  execFileSync(process.execPath, [join(paquet, "scripts/build.mjs")], { stdio: "inherit" });
  base = await mkdtemp(join(tmpdir(), "mcp-stdio-"));
  home = join(base, "home");
  depot = join(base, "depot");
  const git = (...a: string[]) => execFileSync("git", a, { cwd: depot, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  execFileSync("mkdir", ["-p", depot, join(home, ".agent-studio")]);
  await writeFile(join(depot, "package.json"), JSON.stringify({ name: "essai", devDependencies: { vitest: "^4" } }));
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  await writeFile(join(home, ".agent-studio", "mcp-skraft.json"), JSON.stringify({ autorises: [base] }));
}, 120_000);
afterAll(() => rm(base, { recursive: true, force: true }));

async function connecter(env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(paquet, "dist/main.mjs")],
    cwd: depot,
    env: { PATH: process.env["PATH"] ?? "", HOME: home, AGENT_STUDIO_ADMIN_CONFIG: join(home, "admin-absent.json"), ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "essai", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

const texte = (r: unknown) => (r as { content: { text: string }[] }).content.map((c) => c.text).join("\n");

describe("Serveur MCP construit, en stdio (ADR 0068)", () => {
  it("démarre, expose ses outils, active le workflow skraft livré et détecte la pile du projet", async () => {
    const client = await connecter();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(["skraft_arreter", "skraft_attendre", "skraft_connexion", "skraft_demarrer", "skraft_etat", "skraft_rapport", "skraft_repondre", "skraft_reprendre"]);
      const etat = JSON.parse(texte(await client.callTool({ name: "skraft_etat", arguments: {} })));
      expect(etat).toMatchObject({ mode: "pilote", workflow: { nom: "skraft-workflow", accordRetenu: false }, pile: { id: "typescript", source: "detection" }, taches: [], questions: [] });
    } finally {
      await client.close();
    }
    // Le journal va dans le dossier de données, pas sur stdout (qui casserait le protocole).
    expect(await readFile(join(home, ".agent-studio", "mcp-skraft", "logs", "mcp-skraft.log"), "utf8")).toMatch(/serveur MCP skraft prêt/);
  }, 60_000);

  it("le processus enfant construit rejoue le workflow skraft livré, isolé (--permission), sans rien lire hors de lui", async () => {
    // Essai réel du 05/11 : l'enfant gardait `esbuild` en import externe, et Node refusait de lire
    // node_modules sous --permission ; le run échouait avant le premier agent.
    const c = await compilerWorkflow(join(paquet, "dist/workflows/skraft"));
    expect(c.ok).toBe(true);
    const r = createRejoueurIsole({ code: (c as { code: string }).code, launcher: createNodeLauncher(), runtimeEntry: join(paquet, "dist/workflow-child.mjs") });
    try {
      const etat: EtatWorkflow = { script: { nom: "skraft-workflow", empreinte: "e" }, entree: { story: "stories/US-2.md", auto: false }, journal: [], contenus: {} };
      const { etat: suite, nouveaux } = await r.rejouer(etat);
      expect(suite.fin).toBeUndefined();
      expect(nouveaux.length).toBeGreaterThan(0);
    } finally {
      r.arreter();
    }
  }, 60_000);

  it("runtime Claude choisi par la configuration (ADR 0070) : le serveur démarre et répond, le journal le dit", async () => {
    const f = join(home, "claude.json");
    await writeFile(f, JSON.stringify({ autorises: [base], runtime: "claude" }));
    const client = await connecter({ SKRAFT_MCP_CONFIG: f });
    try {
      const etat = JSON.parse(texte(await client.callTool({ name: "skraft_etat", arguments: {} })));
      expect(etat).toMatchObject({ mode: "pilote", workflow: { nom: "skraft-workflow" } });
    } finally {
      await client.close();
    }
    expect(await readFile(join(home, ".agent-studio", "mcp-skraft", "logs", "mcp-skraft.log"), "utf8")).toMatch(/"runtime":"claude"/);
  }, 60_000);

  it("projet hors des dossiers autorisés par la configuration : refusé", async () => {
    const client = await connecter({ SKRAFT_MCP_CONFIG: join(home, "vide.json") });
    try {
      const r = (await client.callTool({ name: "skraft_etat", arguments: {} })) as { isError?: boolean };
      expect(r.isError).toBe(true);
      expect(texte(r)).toMatch(/Projet refusé/);
    } finally {
      await client.close();
    }
  }, 60_000);

  it("configuration invalide : le serveur s'arrête, avec la raison sur stderr", async () => {
    const f = join(home, "casse.json");
    await writeFile(f, "{");
    let sortie = "";
    try {
      execFileSync(process.execPath, [join(paquet, "dist/main.mjs")], { env: { PATH: process.env["PATH"] ?? "", HOME: home, SKRAFT_MCP_CONFIG: f }, input: "", stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      sortie = String((e as { stderr: Buffer }).stderr);
    }
    expect(sortie).toMatch(/Configuration illisible/);
  }, 60_000);
});
