import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { JETON_RAPPORT } from "./tokens.js";

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

/**
 * Quel lecteur va avec quelle section. Sans ce découpage, un profil pouvait déclarer
 * `mutation: { report: vitest-json }` : le schéma l'acceptait, et l'adaptateur appelait de toute
 * façon le lecteur de mutation — le lecteur annoncé n'était jamais honoré, et rien ne le disait.
 */
const LECTEURS_PAR_SECTION = {
  tests: ["junit-xml", "vitest-json"],
  lint: ["eslint-json", "swiftlint-json"],
  mutation: ["muter-json"],
} as const satisfies Record<"tests" | "lint" | "mutation", readonly ReportReader[]>;

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
      .refine((f) => !f.split(/[\\/]/).includes(".."), "`file` ne doit pas contenir `..` : un canari s'écrit dans le projet, jamais hors de lui.")
      .refine(
        (f) => f.includes(JETON_MARQUE),
        // Sans marque dans le nom, `file: Tests/MesTests.swift` écraserait ce fichier pour la
        // durée du diagnostic puis le supprimerait : les canaris suivants s'exécuteraient contre
        // une suite amputée, et les constats décriraient un projet qui n'est pas celui de l'utilisateur.
        `\`file\` doit contenir la marque ${JETON_MARQUE}, sans quoi le canari écraserait un fichier existant du projet.`,
      ),
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
      .strict()
      // Sans aucun emplacement de test, rien ne distingue un test du code de production : la
      // garde d'écriture de la phase rouge n'a plus de périmètre, et les portes TDD ne peuvent
      // plus rien juger. Refuser vaut mieux que laisser un profil dont les portes sont creuses.
      .refine(
        (l) => l.unitTests.length > 0 || l.acceptanceTests.length > 0,
        "`layout` doit déclarer au moins un emplacement de test (`unitTests` ou `acceptanceTests`) : sans lui, rien ne distingue un test du code de production.",
      ),
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

    // Le lecteur doit décrire ce que la section produit. Sinon l'adaptateur appelait celui de la
    // section quoi qu'il arrive, et le lecteur annoncé n'était jamais honoré.
    const attendus: readonly ReportReader[] = LECTEURS_PAR_SECTION[section];
    if (!attendus.includes(c.report))
      return {
        error: `Profil de stack refusé : ${section}.report — « ${c.report} » ne décrit pas ce que produit \`${section}\` ; attendu ${attendus.map((r) => `« ${r} »`).join(" ou ")}.`,
      };

    // Le lint est lu sur la sortie standard, jamais dans un fichier : `{rapport}` y devenait la
    // chaîne vide, l'outil écrivait nulle part, et la porte disait « rien n'a été jugé » sans
    // jamais dire pourquoi.
    if (section === "lint" && c.command.some((a) => a.includes(JETON_RAPPORT)))
      return {
        error: `Profil de stack refusé : lint.command — \`${JETON_RAPPORT}\` n'a pas de sens pour \`lint\`, dont la sortie est lue sur la sortie standard.`,
      };
  }

  return { profile: parsed.data };
}
