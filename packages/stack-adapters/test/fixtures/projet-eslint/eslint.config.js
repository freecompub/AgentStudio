/**
 * Configuration du projet-témoin ESLint. Volontairement minimale : ce qui est éprouvé ici est
 * notre plomberie — la commande du profil, la lecture du rapport, le champ `analyzed` —, pas les
 * capacités d'ESLint.
 *
 * Les fichiers sont en JavaScript et non en TypeScript : l'analyseur par défaut d'ESLint ne lit
 * pas les annotations de type, et ajouter `typescript-eslint` au dépôt pour un témoin serait
 * disproportionné. Le témoin Vitest, lui, est en TypeScript.
 */
export default [
  // Ce fichier viole la règle, ET il est ignoré : il doit donc être absent d'`analyzed`.
  // Le compter comme propre attesterait une conformité que personne n'a vérifiée — c'est le
  // défaut réintroduit le 24/09, et ce témoin est là pour qu'il ne revienne pas.
  { ignores: ["src/ignore-moi.js"] },
  { files: ["**/*.js"], rules: { "no-unused-vars": "error" } },
];
