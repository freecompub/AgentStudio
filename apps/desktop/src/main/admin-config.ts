import { readFile } from "node:fs/promises";
import { profileFor, type Profile } from "@agent-studio/core";
import type { TrustedPublisher } from "@agent-studio/extension-packaging";
import { z } from "zod";

/**
 * Configuration posée par l'administrateur (D6, §12) : profil de l'utilisateur, éditeurs approuvés,
 * mode développeur, liste de révocation. Lue depuis un emplacement système que l'utilisateur ne
 * modifie pas ; l'application ne l'écrit jamais. Mécanisme d'attribution : O5 (choix provisoire).
 */
const schema = z.object({
  profile: z
    .object({
      role: z.enum(["testeur", "po", "developpeur", "architecte", "administrateur"]),
      defaultMode: z.enum(["simple", "advanced"]).optional(),
      permissionPolicy: z.enum(["prudente", "souple"]).optional(),
    })
    .optional(),
  trustedPublishers: z
    .array(z.object({ publisher: z.string(), keyId: z.string(), publicKeyPem: z.string(), trustedUpdates: z.boolean().default(false) }))
    .default([]),
  developerMode: z.boolean().default(false),
  revocation: z.object({ file: z.string().optional(), url: z.string().url().optional(), rootPublicKeyPem: z.string() }).optional(),
});

export interface AdminConfig {
  /** Chemin du fichier lu, ou « défaut ». */
  source: string;
  profile: Profile;
  trustedPublishers: TrustedPublisher[];
  developerMode: boolean;
  revocation: { file?: string; url?: string; rootPublicKeyPem: string } | null;
  error?: string;
}

export function defaultAdminConfigPath(platform: NodeJS.Platform, env: Record<string, string | undefined>): string {
  if (env["AGENT_STUDIO_ADMIN_CONFIG"]) return env["AGENT_STUDIO_ADMIN_CONFIG"];
  if (platform === "win32") return `${env["ProgramData"] ?? "C:\\ProgramData"}\\agent-studio\\admin.json`;
  if (platform === "darwin") return "/Library/Application Support/agent-studio/admin.json";
  return "/etc/agent-studio/admin.json";
}

export async function loadAdminConfig(path: string): Promise<AdminConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // Poste personnel sans administration : développeur, sans éditeur tiers approuvé.
    return { source: "défaut", profile: profileFor("developpeur"), trustedPublishers: [], developerMode: false, revocation: null };
  }
  let parsed: z.infer<typeof schema>;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "));
    parsed = r.data;
  } catch (err) {
    // Fichier présent mais illisible : profil le plus restreint, jamais le plus permissif.
    return { source: path, profile: profileFor("testeur"), trustedPublishers: [], developerMode: false, revocation: null, error: err instanceof Error ? err.message : String(err) };
  }
  const p = parsed.profile;
  const profile = p
    ? profileFor(p.role, { ...(p.defaultMode ? { defaultMode: p.defaultMode } : {}), ...(p.permissionPolicy ? { permissionPolicy: p.permissionPolicy } : {}) })
    : profileFor("developpeur");
  const rev = parsed.revocation;
  return {
    source: path,
    profile,
    trustedPublishers: parsed.trustedPublishers,
    developerMode: parsed.developerMode,
    revocation: rev ? { rootPublicKeyPem: rev.rootPublicKeyPem, ...(rev.file ? { file: rev.file } : {}), ...(rev.url ? { url: rev.url } : {}) } : null,
  };
}
