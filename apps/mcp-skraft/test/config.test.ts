/**
 * Configuration du serveur : dossiers autorisés (point 6) et hôte GitHub (point 7). Absente, des
 * valeurs prudentes : aucun dossier autorisé en plus des roots du client, github.com. Invalide :
 * refus explicite, jamais une configuration à moitié lue.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cheminConfiguration, lireConfiguration } from "../src/config.js";

let d: string;
beforeAll(async () => {
  d = await mkdtemp(join(tmpdir(), "mcp-config-"));
});
afterAll(() => rm(d, { recursive: true, force: true }));

describe("Configuration du serveur MCP", () => {
  it("absente : aucun dossier autorisé en plus des roots, github.com", async () => {
    expect(await lireConfiguration(join(d, "absente.json"))).toEqual({ ok: true, config: { autorises: [], hostname: "github.com", runtime: "copilot", modeles: {} } });
  });

  it("lue : dossiers autorisés (avec ~ développé) et hôte Enterprise", async () => {
    const f = join(d, "ok.json");
    await writeFile(f, JSON.stringify({ autorises: ["~/Projets", "/srv/depots"], hostname: "github.exemple.fr" }));
    expect(await lireConfiguration(f, { home: "/home/moi" })).toEqual({ ok: true, config: { autorises: ["/home/moi/Projets", "/srv/depots"], hostname: "github.exemple.fr", runtime: "copilot", modeles: {} } });
  });

  it("runtime au choix (ADR 0070) : Copilot par défaut, ou Claude, avec ses modèles par classe ; un runtime inconnu est refusé", async () => {
    const f = join(d, "claude.json");
    await writeFile(f, JSON.stringify({ runtime: "claude", modeles: { strong: "opus", light: "haiku" } }));
    expect(await lireConfiguration(f)).toMatchObject({ ok: true, config: { runtime: "claude", modeles: { strong: "opus", light: "haiku" } } });
    const g = join(d, "inconnu-runtime.json");
    await writeFile(g, JSON.stringify({ runtime: "gemini" }));
    expect(await lireConfiguration(g)).toMatchObject({ ok: false, motif: expect.stringContaining("runtime") });
  });

  it("invalide (JSON, champ inconnu, chemin relatif) : refusée, avec le fichier et la raison", async () => {
    for (const [nom, contenu] of [["casse.json", "{"], ["inconnu.json", JSON.stringify({ autorise: [] })], ["relatif.json", JSON.stringify({ autorises: ["Projets"] })]] as const) {
      const f = join(d, nom);
      await writeFile(f, contenu);
      const r = await lireConfiguration(f);
      expect(r).toEqual({ ok: false, motif: expect.stringContaining(f) });
    }
  });

  it("emplacement : variable d'environnement, sinon ~/.agent-studio/mcp-skraft.json", () => {
    expect(cheminConfiguration({ SKRAFT_MCP_CONFIG: "/etc/skraft.json" }, "/home/moi")).toBe("/etc/skraft.json");
    expect(cheminConfiguration({}, "/home/moi")).toBe(join("/home/moi", ".agent-studio", "mcp-skraft.json"));
  });
});
