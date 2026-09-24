/**
 * Les motifs glob sont définis dans `@agent-studio/extension-api` : une extension doit pouvoir
 * s'en servir sans dépendre du cœur (D10). Réexporté ici pour le reste du cœur.
 */
export { globToRegExp, matchesAny } from "@agent-studio/extension-api";
