/**
 * Programmes autorisés par défaut, tels que l'administrateur les fournit (D47, O12). Copiés ici
 * parce que `stack-adapters` ne dépend pas de l'application : si la liste de `admin-config`
 * change, ce double doit suivre — les profils livrés ne doivent nommer que des programmes
 * réellement autorisés sans intervention.
 */
export const DEFAULT_ALLOWED_PROGRAMS_FOR_TESTS = [
  "pytest", "go", "cargo", "gradle", "mvn", "dotnet", "swift", "vitest", "jest", "phpunit", "rspec",
  "eslint", "swiftlint", "ruff", "flake8", "pylint", "ktlint", "rubocop", "phpcs",
  "muter", "stryker", "mutmut", "pitest",
];
