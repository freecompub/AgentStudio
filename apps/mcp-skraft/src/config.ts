/**
 * Configuration du serveur MCP (`~/.agent-studio/mcp-skraft.json`, ou `SKRAFT_MCP_CONFIG`) : les
 * dossiers où il accepte un projet en plus des roots du client (ADR 0068, point 6), et l'hôte
 * GitHub (point 7). Les programmes autorisés et le profil viennent d'`admin.json`, comme pour
 * l'application.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

export interface ConfigurationServeur {
  autorises: string[];
  hostname: string;
}

const schema = z
  .object({
    autorises: z.array(z.string().min(1)).default([]),
    hostname: z.string().min(1).max(253).default("github.com"),
  })
  .strict();

export function cheminConfiguration(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env["SKRAFT_MCP_CONFIG"] || join(home, ".agent-studio", "mcp-skraft.json");
}

export async function lireConfiguration(fichier: string, o: { home?: string } = {}): Promise<{ ok: true; config: ConfigurationServeur } | { ok: false; motif: string }> {
  const home = o.home ?? homedir();
  let brut: string;
  try {
    brut = await readFile(fichier, "utf8");
  } catch {
    return { ok: true, config: { autorises: [], hostname: "github.com" } };
  }
  let json: unknown;
  try {
    json = JSON.parse(brut);
  } catch (e) {
    return { ok: false, motif: `Configuration illisible (${fichier}) : ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = schema.safeParse(json);
  if (!r.success) return { ok: false, motif: `Configuration refusée (${fichier}) : ${r.error.issues.map((i) => `${i.path.join(".") || "racine"} : ${i.message}`).join(" ; ")}` };
  const autorises = r.data.autorises.map((a) => (a === "~" ? home : a.startsWith("~/") ? join(home, a.slice(2)) : a));
  const relatif = autorises.find((a) => !isAbsolute(a));
  if (relatif) return { ok: false, motif: `Configuration refusée (${fichier}) : « ${relatif} » n'est pas un chemin absolu.` };
  return { ok: true, config: { autorises, hostname: r.data.hostname } };
}
