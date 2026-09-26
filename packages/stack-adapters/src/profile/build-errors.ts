import { isAbsolute, relative } from "node:path";
import type { FailureKind, TestResult } from "../protocols.js";

/**
 * Erreurs de compilation déclarées par un profil (J5, §8.3).
 *
 * Dans un langage compilé, un symbole absent **empêche la compilation** : le lanceur ne produit
 * aucun rapport de tests, et sans cette lecture le rouge légitime du pas RED — « la fonction que
 * je viens d'appeler n'existe pas encore » — n'atteint jamais la porte. L'adaptateur Swift écrit à
 * la main savait le faire ; un profil ne savait pas, ce qui rendait les profils inutilisables sur
 * la moitié des écosystèmes.
 *
 * Le motif vient du dépôt du projet, donc d'une source non fiable. Trois bornes en découlent, et
 * elles ne relèvent pas du confort : le motif est refusé s'il porte un quantificateur imbriqué ou
 * s'il est démesuré, il est appliqué **ligne à ligne** et non à toute la sortie, et le nombre de
 * lignes examinées comme la longueur de chacune sont plafonnés. Un moteur d'expressions
 * régulières ne s'interrompt pas : la seule protection est de ne jamais lui donner de quoi
 * s'emballer.
 */

export interface BuildErrorSpec {
  /** Sous-chaînes qui, dans un message, désignent un symbole absent. Comparaison insensible à la casse. */
  missingSymbol: readonly string[];
  pattern: string;
}

export interface CompiledBuildErrorSpec {
  readonly re: RegExp;
  readonly missingSymbol: readonly string[];
}

/** Au-delà, une ligne n'est pas un message de compilateur : on ne la soumet pas au moteur. */
const LIGNE_MAX = 1000;
/** Lignes examinées au plus ; une sortie de compilation utile tient largement dedans. */
const LIGNES_MAX = 20_000;
/** Fichiers en erreur rapportés au plus : au-delà, la porte n'a plus rien à apprendre. */
const FICHIERS_MAX = 200;
const MOTIF_MAX = 300;

/**
 * Quantificateur appliqué à un groupe qui en contient déjà un — `(\w+)+`, `(a*)*`, `(.+)*`. C'est
 * la forme qui fait revenir le moteur sur ses pas de façon exponentielle. Heuristique, donc
 * imparfaite : elle écarte les cas connus, elle ne prouve pas l'absence de tout risque. Les bornes
 * d'exécution ci-dessus sont là pour ce qu'elle laisse passer.
 */
const QUANTIFICATEUR_IMBRIQUE = /\([^)]*[+*}][^)]*\)\s*[+*]|\([^)]*[+*][^)]*\)\s*\{\d/;

export function compileBuildErrorSpec(spec: { pattern: string; missingSymbol?: readonly string[] }):
  | { spec: CompiledBuildErrorSpec }
  | { error: string } {
  if (spec.pattern.length > MOTIF_MAX) return { error: `\`buildErrors.pattern\` est trop long (${spec.pattern.length} caractères, maximum ${MOTIF_MAX}).` };
  if (QUANTIFICATEUR_IMBRIQUE.test(spec.pattern))
    return {
      error:
        "`buildErrors.pattern` contient un quantificateur imbriqué (de la forme `(…+)+`) : " +
        "cette construction fait revenir le moteur sur ses pas de façon exponentielle et figerait l'application.",
    };
  if (!spec.pattern.includes("(?<file>") || !spec.pattern.includes("(?<message>"))
    return { error: "`buildErrors.pattern` doit comporter les groupes nommés `(?<file>…)` et `(?<message>…)`." };

  let re: RegExp;
  try {
    re = new RegExp(spec.pattern);
  } catch (err) {
    return { error: `\`buildErrors.pattern\` n'est pas une expression régulière valide : ${err instanceof Error ? err.message : String(err)}` };
  }
  return { spec: { re, missingSymbol: spec.missingSymbol ?? [] } };
}

const relatif = (root: string, chemin: string) => (isAbsolute(chemin) ? relative(root, chemin) : chemin).replaceAll("\\", "/");

/**
 * Un résultat en échec par fichier en erreur, la **première** erreur du fichier faisant foi : les
 * suivantes en découlent presque toujours, le compilateur cascadant à partir de la première cause.
 */
export function readBuildErrors(sortie: string, spec: CompiledBuildErrorSpec, root: string): TestResult[] {
  const parFichier = new Map<string, string>();
  const lignes = sortie.split("\n", LIGNES_MAX);

  for (const ligne of lignes) {
    if (ligne.length > LIGNE_MAX) continue;
    const m = spec.re.exec(ligne);
    const fichier = m?.groups?.["file"];
    const message = m?.groups?.["message"];
    if (fichier === undefined || message === undefined) continue;
    const rel = relatif(root, fichier);
    if (!parFichier.has(rel)) parFichier.set(rel, message.trim());
    if (parFichier.size >= FICHIERS_MAX) break;
  }

  return [...parFichier].map(([file, message]) => ({
    id: file,
    file,
    status: "failed" as const,
    failureKind: classerErreurDeCompilation(message, spec.missingSymbol),
    message,
  }));
}

/**
 * Un symbole absent est le rouge **légitime** du pas RED ; tout le reste — syntaxe, types,
 * configuration — est une mauvaise raison que la porte doit rejeter. En cas de doute, `other_error`
 * : refuser un rouge correct fait perdre un tour, l'accepter à tort laisse passer du code qui ne
 * compile pas.
 */
export function classerErreurDeCompilation(message: string, missingSymbol: readonly string[]): FailureKind {
  const bas = message.toLowerCase();
  return missingSymbol.some((s) => bas.includes(s.toLowerCase())) ? "missing_symbol" : "other_error";
}
