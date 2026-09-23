import { describe, expect, it } from "vitest";
import { describePermission } from "../src/permissions-text.js";

describe("Permissions en langage clair (§5.3)", () => {
  it.each([
    ["fs:read", "Lire les fichiers du projet"],
    ["fs:write:src/**", "Modifier les fichiers du projet correspondant à « src/** »"],
    ["shell:test", "Lancer les tests du projet"],
    ["shell:npm,make", "Exécuter les commandes : npm, make"],
    ["git:commit", "Enregistrer des modifications dans l'historique (commits)"],
    ["git:branch", "Créer ou changer de branche"],
    ["git:revert", "Revenir à un état antérieur du projet"],
    ["copilot:sessions", "Lancer des agents avec votre abonnement Copilot (consomme votre quota)"],
    ["net:none", "Aucun accès à Internet"],
    ["net:api.github.com,registry.npmjs.org", "Accéder à Internet : api.github.com, registry.npmjs.org"],
  ])("%s → %s", (p, text) => {
    expect(describePermission(p)).toBe(text);
  });
});
