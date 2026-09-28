/**
 * Les deux seuls jetons substitués dans les arguments d'une commande de profil : `{rapport}`,
 * remplacé par un fichier temporaire hors du projet, et `{fichiers}`, développé en autant
 * d'arguments que de fichiers. Tout le reste passe tel quel, sans shell — un profil vient du
 * dépôt du projet et ne doit pas pouvoir fabriquer une commande par interpolation.
 */
export const JETON_RAPPORT = "{rapport}";
export const JETON_FICHIERS = "{fichiers}";
/**
 * **Dossier** où la commande de test doit déposer son rapport de couverture — et non un fichier,
 * délibérément : `dotnet test --collect` écrit sous un sous-dossier nommé par un GUID qu'il choisit
 * lui-même, et imposer un nom de fichier aurait exclu .NET. L'adaptateur cherche le rapport dans
 * l'arborescence. Produit par la MÊME exécution que les tests : mesurer la couverture ne doit pas
 * coûter un second passage de la suite.
 */
export const JETON_COUVERTURE = "{couverture}";

export function substituer(args: readonly string[], rapport: string, fichiers: readonly string[], couverture = ""): string[] {
  const out: string[] = [];
  for (const a of args) {
    if (a === JETON_FICHIERS) out.push(...fichiers);
    else out.push(a.replaceAll(JETON_RAPPORT, rapport).replaceAll(JETON_COUVERTURE, couverture));
  }
  return out;
}
