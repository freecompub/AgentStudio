import { readFile } from "node:fs/promises";
import { profileFor, type Profile } from "@agent-studio/core";
import type { TrustedPublisher } from "@agent-studio/extension-packaging";
import { z } from "zod";

/**
 * Configuration posée par l'administrateur (D6, §12) : profil de l'utilisateur, éditeurs approuvés,
 * mode développeur, liste de révocation. Lue depuis un emplacement système que l'utilisateur ne
 * modifie pas ; l'application ne l'écrit jamais. Mécanisme d'attribution : O5 (choix provisoire).
 */
/**
 * Programmes qu'un profil de stack peut nommer sans que l'administrateur intervienne (D47, O12).
 *
 * Un profil vient du dépôt du projet, donc d'un fichier que l'agent peut modifier : sans cette
 * liste, il ferait exécuter n'importe quoi. N'y figurent que des lanceurs de tests, des linters,
 * des outils de format et de mutation — jamais un interpréteur (`bash`, `node`), un client réseau
 * (`curl`) ni un outil capable d'écrire hors du projet.
 */
export const DEFAULT_ALLOWED_PROGRAMS = [
  // tests
  "pytest", "go", "cargo", "gradle", "mvn", "dotnet", "vitest", "jest", "phpunit", "rspec",
  // qualité de forme
  "eslint", "ruff", "flake8", "pylint", "ktlint", "rubocop", "phpcs",
  // format (ADR 0071) ; `dotnet format`, `cargo fmt`, `ruff format` passent par leur programme
  "prettier",
  // mutation
  "stryker", "mutmut", "pitest",
] as const;

/** Un nom de commande, jamais un chemin : `./x` ou `/usr/bin/x` échapperaient à la liste. */
const nomDeProgramme = z
  .string()
  .min(1)
  .refine((v) => !/[/\\]/.test(v) && v !== "." && v !== "..", "doit être un nom de commande, sans chemin");

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
  /** Remplace la liste par défaut — un poste administré doit pouvoir restreindre, pas seulement élargir. */
  allowedPrograms: z.array(nomDeProgramme).optional(),
  /** L'utilisateur peut-il accepter un programme hors de la liste, quand on le lui demande (ADR 0075) ? */
  programConsent: z.boolean().default(true),
  revocation: z.object({ file: z.string().optional(), url: z.string().url().optional(), rootPublicKeyPem: z.string() }).optional(),
});

export interface AdminConfig {
  /** Chemin du fichier lu, ou « défaut ». */
  source: string;
  profile: Profile;
  trustedPublishers: TrustedPublisher[];
  developerMode: boolean;
  /** Programmes qu'un profil de stack peut lancer (D47, O12). */
  allowedPrograms: string[];
  /** D'où vient cette liste, en une phrase à citer quand un programme est refusé (09/11). */
  origineDesProgrammes: string;
  /** L'utilisateur peut accepter un programme hors de la liste, si on peut le lui demander (ADR 0075). */
  programConsent: boolean;
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
    return {
      source: "défaut",
      profile: profileFor("developpeur"),
      trustedPublishers: [],
      developerMode: false,
      allowedPrograms: [...DEFAULT_ALLOWED_PROGRAMS],
      programConsent: true,
      origineDesProgrammes: `Liste par défaut : aucun fichier d'administration à ${path}. Pour la changer, y écrire \`allowedPrograms\` (qui remplace la liste par défaut, sans s'y ajouter), ou désigner un autre fichier par la variable AGENT_STUDIO_ADMIN_CONFIG.`,
      revocation: null,
    };
  }
  let parsed: z.infer<typeof schema>;
  try {
    const r = schema.safeParse(JSON.parse(raw));
    if (!r.success) throw new Error(r.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; "));
    parsed = r.data;
  } catch (err) {
    // Fichier présent mais illisible : profil le plus restreint, jamais le plus permissif.
    // Configuration refusée : on n'autorise aucun programme. Retomber sur la liste par défaut
    // appliquerait des permissions que l'administrateur n'a pas relues.
    const error = err instanceof Error ? err.message : String(err);
    return { source: path, profile: profileFor("testeur"), trustedPublishers: [], developerMode: false, allowedPrograms: [], programConsent: false, origineDesProgrammes: `${path} est refusé (${error}) : aucun programme n'est autorisé.`, revocation: null, error };
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
    // Le fichier remplace la liste ; sans mention, celle par défaut s'applique.
    allowedPrograms: parsed.allowedPrograms ?? [...DEFAULT_ALLOWED_PROGRAMS],
    programConsent: parsed.programConsent,
    origineDesProgrammes: parsed.allowedPrograms
      ? `Liste de \`allowedPrograms\` dans ${path} ; elle remplace la liste par défaut, qui ne s'applique donc pas.`
      : `Liste par défaut : ${path} ne contient pas \`allowedPrograms\`. L'y ajouter remplace la liste par défaut, sans s'y ajouter.`,
    revocation: rev ? { rootPublicKeyPem: rev.rootPublicKeyPem, ...(rev.file ? { file: rev.file } : {}), ...(rev.url ? { url: rev.url } : {}) } : null,
  };
}
