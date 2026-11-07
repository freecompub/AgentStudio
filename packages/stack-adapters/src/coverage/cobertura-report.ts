import { relatifDepuis } from "../chemin-relatif.js";
import type { CoverageReport } from "../protocols.js";

/**
 * Rapport de couverture au format **Cobertura**.
 *
 * Ce format est retenu parce qu'il est le seul que produisent, nativement ou par une option,
 * `dotnet test --collect "XPlat Code Coverage"`, `vitest --coverage.reporter=cobertura`,
 * `pytest --cov-report=xml` et les convertisseurs JaCoCo. Un lecteur pour quatre écosystèmes.
 *
 * La couverture n'est pas redondante avec la mutation : elle en est le **plancher**. La mutation
 * juge si un test sert à quelque chose, la couverture seulement si le code est atteint — mais elle
 * est peu coûteuse et presque toujours disponible, là où un outil de mutation manque souvent.
 */

/** `<line number="12" hits="3"/>` — l'attribut `branch` est ignoré : nous comptons des lignes. */
const LIGNE = /<line\b[^>]*\bnumber="(\d+)"[^>]*\bhits="(\d+)"/g;
const CLASSE = /<class\b[^>]*\bfilename="([^"]+)"[^>]*>([\s\S]*?)<\/class>/g;

/**
 * `null` quand le rapport n'est pas exploitable — la porte dira alors qu'elle n'a rien mesuré,
 * plutôt que de conclure à une couverture nulle. Une liste vide, elle, veut dire « mesuré, rien à
 * signaler » : la distinction est celle entre « non vérifié » et « vérifié sans trouver ».
 */
export function parseCoberturaReport(brut: string, root: string): CoverageReport | null {
  if (!/<coverage[\s>]/.test(brut)) return null;

  // Par fichier : les lignes vues, et celles atteintes au moins une fois. Un même numéro peut
  // apparaître plusieurs fois (classes partielles, méthodes génériques) ; il ne compte qu'une fois,
  // sans quoi le total enflerait et le pourcentage n'aurait plus de sens.
  const parFichier = new Map<string, { vues: Set<number>; atteintes: Set<number> }>();

  for (const c of brut.matchAll(CLASSE)) {
    const file = relatifDepuis(root, c[1]!);
    const entree = parFichier.get(file) ?? { vues: new Set<number>(), atteintes: new Set<number>() };
    for (const l of c[2]!.matchAll(LIGNE)) {
      const n = Number(l[1]);
      entree.vues.add(n);
      if (Number(l[2]) > 0) entree.atteintes.add(n);
    }
    parFichier.set(file, entree);
  }

  const files = [...parFichier]
    // Un fichier sans ligne exécutable — interface, constantes — n'est pas à 0 % : il n'a rien à
    // couvrir. Le compter ferait échouer une porte sur du code qu'aucun test ne peut atteindre.
    .filter(([, e]) => e.vues.size > 0)
    .map(([file, e]) => ({
      file,
      covered: e.atteintes.size,
      total: e.vues.size,
      score: Math.round((e.atteintes.size / e.vues.size) * 1000) / 10,
      lines: [...e.vues].sort((a, b) => a - b).map((number) => ({ number, covered: e.atteintes.has(number) })),
    }));

  return { files };
}
