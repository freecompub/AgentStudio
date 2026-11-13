/**
 * Les commandes du serveur pour Copilot CLI (10/11) : Copilot n'affiche pas les prompts MCP comme des
 * commandes, mais il affiche chaque skill (`SKILL.md`) en `/<nom>`. Un skill par outil, dans
 * `skills/`, que `copilot skill add <dossier>` inscrit une fois pour toutes. Chacun dit quel outil
 * appeler, et que les questions reviennent à l'utilisateur.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseMarkdownDoc } from "@agent-studio/extension-host";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServeurSkraft } from "../src/serveur.js";

const SKILLS = join(import.meta.dirname, "../skills");

async function outils(): Promise<string[]> {
  const mcp = createServeurSkraft({ projets: {} as never, workflow: "x", autorises: [], cwd: "/", connexion: { verifier: async () => ({ ok: true }), connecter: async () => ({ ok: true, texte: "" }) } });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await mcp.connect(b);
  await client.connect(a);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((t) => t.name).sort();
}

const lire = async (nom: string) => parseMarkdownDoc(await readFile(join(SKILLS, nom, "SKILL.md"), "utf8"));

describe("Commandes du serveur MCP : un skill par outil", () => {
  it("chaque outil a son skill `skraft-<nom>`, et aucun skill n'est orphelin", async () => {
    const attendus = (await outils()).map((t) => t.replace("_", "-"));
    expect((await readdir(SKILLS)).sort()).toEqual(attendus);
  });

  it("le frontmatter nomme la commande et la décrit ; le corps dit l'outil à appeler", async () => {
    for (const outil of await outils()) {
      const nom = outil.replace("_", "-");
      const doc = await lire(nom);
      expect(doc.data.name, nom).toBe(nom);
      expect(doc.data.description?.length ?? 0, nom).toBeGreaterThan(30);
      expect(doc.body, nom).toContain(`\`${outil}\``);
    }
  });

  it("les questions reviennent toujours à l'utilisateur : aucun skill ne répond à sa place", async () => {
    for (const nom of await readdir(SKILLS)) expect((await lire(nom)).body, nom).toMatch(/jamais à la place de l'utilisateur/);
  });
});
