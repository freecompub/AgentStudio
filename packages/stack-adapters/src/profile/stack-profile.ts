import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * Profil de stack déclaratif (J5, O11) : un projet décrit sa chaîne au lieu qu'un adaptateur
 * soit écrit pour lui. Ajouter un langage devient un fichier à remplir, non du code à livrer.
 *
 * Ce fichier vient du dépôt du projet, que l'agent peut modifier : son contenu est traité comme
 * non fiable. D'où deux gardes qui ne relèvent pas du confort mais de la sécurité — les lecteurs
 * de rapport sont **nommés** et écrits par nous, et les programmes sont soumis à une liste
 * d'autorisation (D47, O12).
 */

/**
 * Lecteurs de rapport fournis par l'application : un profil les désigne, il n'en invente pas.
 * N'y figurent que les formats réellement lus — en ajouter un demande d'écrire son lecteur.
 */
export const REPORT_READERS = ["junit-xml", "vitest-json", "eslint-json", "swiftlint-json", "muter-json"] as const;
export type ReportReader = (typeof REPORT_READERS)[number];

const commande = z
  .object({
    /** Programme puis arguments, jamais une ligne de shell : aucune interpolation possible. */
    command: z.array(z.string().min(1)).min(1, "`command` doit nommer un programme et ses arguments."),
    report: z.enum(REPORT_READERS),
  })
  .strict();

/**
 * Gabarits de canaris (§8.6) : des tests dont la bonne réponse est connue d'avance. Le code les
 * écrit dans une copie isolée du projet, lance la commande déclarée, et vérifie que l'échec
 * obtenu porte bien le classement attendu — sans demander l'avis d'un LLM.
 */
export const CANARY_KINDS = ["passed", "assertion", "missing_symbol", "syntax"] as const;
export type CanaryKind = (typeof CANARY_KINDS)[number];

/** Marque unique injectée par le code, qui permet de retrouver les résultats du canari. */
export const JETON_MARQUE = "{marque}";

const canari = z
  .object({
    kind: z.enum(CANARY_KINDS),
    /**
     * Où écrire le canari, relativement à la racine. Ce fichier est réellement créé sur le
     * disque : un chemin absolu ou remontant écrirait hors de la copie isolée.
     */
    file: z
      .string()
      .min(1)
      .refine((f) => !f.startsWith("/") && !/^[A-Za-z]:/.test(f), "`file` doit être un chemin relatif à la racine du projet.")
      .refine((f) => !f.split(/[\\/]/).includes(".."), "`file` ne doit pas contenir `..` : un canari s'écrit dans le projet, jamais hors de lui."),
    content: z.string().min(1),
  })
  .strict()
  .refine(
    (c) => c.kind === "syntax" || c.content.includes(JETON_MARQUE),
    // Sans marque, les résultats du canari seraient confondus avec ceux du projet. Le canari de
    // syntaxe y échappe : il ne produit souvent aucun résultat, la suite ne compilant pas.
    `\`content\` doit contenir la marque ${JETON_MARQUE}, qui sert à reconnaître les résultats du canari.`,
  );

const schema = z
  .object({
    id: z.string().min(1),
    /** Fichiers dont la présence signale cette stack (`pyproject.toml`, `Package.swift`…). */
    detect: z.array(z.string().min(1)).min(1),
    tests: commande,
    lint: commande.optional(),
    mutation: commande.optional(),
    layout: z
      .object({
        acceptanceTests: z.array(z.string()).default([]),
        unitTests: z.array(z.string()).default([]),
        sources: z.array(z.string()).default([]),
      })
      .strict(),
    /** Ce que cet écosystème tient pour de l'infrastructure ; un domaine ne l'importe pas. */
    infrastructureModules: z.array(z.string()).default([]),
    /** Facultatif : sans eux, `/stack doctor` ne peut pas vérifier le classement des échecs. */
    canaries: z.array(canari).default([]),
  })
  .strict();

export type StackProfile = z.infer<typeof schema>;

export interface ParseOptions {
  /** Programmes que l'administrateur autorise à lancer (D47, O12). */
  allowedPrograms: readonly string[];
}

export function parseStackProfile(raw: string, opts: ParseOptions): { profile: StackProfile } | { error: string } {
  let brut: unknown;
  try {
    brut = parseYaml(raw);
  } catch (err) {
    return { error: `Le profil de stack n'est pas un YAML valide : ${err instanceof Error ? err.message : String(err)}` };
  }

  const parsed = schema.safeParse(brut);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => {
      const champ = i.path.join(".") || "(racine)";
      // Le message de zod dit ce qui était attendu, jamais ce qui a été écrit : sans cela,
      // l'auteur du profil doit deviner laquelle de ses valeurs est refusée.
      const recu = i.path.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k as string], brut);
      const cite = typeof recu === "string" || typeof recu === "number" ? ` (reçu : « ${String(recu)} »)` : "";
      return `${champ} — ${i.message}${cite}`;
    });
    return { error: `Profil de stack refusé : ${details.join(" ; ")}` };
  }

  // Le programme est le premier élément : c'est lui qui s'exécute, les arguments ne sont
  // que des données passées sans shell.
  const autorises = new Set(opts.allowedPrograms);
  for (const [section, c] of [
    ["tests", parsed.data.tests],
    ["lint", parsed.data.lint],
    ["mutation", parsed.data.mutation],
  ] as const) {
    if (!c) continue;
    const programme = c.command[0]!;
    if (!autorises.has(programme))
      return { error: `Profil de stack refusé : « ${programme} » (${section}) n'est pas un programme autorisé.` };
  }

  return { profile: parsed.data };
}
