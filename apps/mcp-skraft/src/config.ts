/**
 * Configuration du serveur MCP (`~/.agent-studio/mcp-skraft.json`, ou `SKRAFT_MCP_CONFIG`) : les
 * dossiers où il accepte un projet en plus des roots du client (ADR 0068, point 6), et l'hôte
 * GitHub (point 7). Les programmes autorisés et la politique de permissions viennent d'`admin.json`, comme pour
 * l'application.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";

/** Classes de rôle des agents (ADR 0048) et modèle choisi pour chacune. */
export type ModelesParClasse = Partial<Record<"strong" | "standard" | "light", string>>;

export interface ConfigurationServeur {
  autorises: string[];
  hostname: string;
  /** Runtime des agents (ADR 0070) : Copilot par défaut. */
  runtime: "copilot" | "claude";
  /** Modèle par classe de rôle ; absent : le défaut du runtime. */
  modeles: ModelesParClasse;
}

const schema = z
  .object({
    autorises: z.array(z.string().min(1)).default([]),
    hostname: z.string().min(1).max(253).default("github.com"),
    runtime: z.enum(["copilot", "claude"]).default("copilot"),
    modeles: z.object({ strong: z.string().min(1), standard: z.string().min(1), light: z.string().min(1) }).partial().strict().default({}),
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
    return { ok: true, config: { autorises: [], hostname: "github.com", runtime: "copilot", modeles: {} } };
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
  const modeles = Object.fromEntries(Object.entries(r.data.modeles).filter(([, v]) => v !== undefined)) as ModelesParClasse;
  return { ok: true, config: { autorises, hostname: r.data.hostname, runtime: r.data.runtime, modeles } };
}
