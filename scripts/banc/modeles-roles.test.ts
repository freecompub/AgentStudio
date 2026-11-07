import { expect, it } from "vitest";
import { lireModelesRoles, modelePourRole } from "./modeles-roles.js";

it("verrouille le modèle par rôle indépendamment du préfixe extension ou workflow", () => {
  const roles = lireModelesRoles("skraft-architect-model:claude-sonnet-5.5,skraft-dev:gpt-6.1-sol");
  expect(modelePourRole(roles, "workflow.skraft-workflow/skraft-architect-model")).toBe("claude-sonnet-5.5");
  expect(modelePourRole(roles, "agent-studio.skraft/skraft-dev")).toBe("gpt-6.1-sol");
});

it("ne laisse aucun rôle non configuré retomber sur Auto", () => {
  expect(() => modelePourRole(lireModelesRoles("skraft-dev:gpt-6.1-sol"), "x/skraft-test")).toThrow("Modèle non fixé");
  expect(modelePourRole(lireModelesRoles(""), "x/skraft-test")).toBeUndefined();
});

it("refuse les associations invalides et doublons", () => {
  for (const value of ["skraft-dev:", ":modele", "skraft-dev:x:y", "skraft-dev:a,skraft-dev:b"])
    expect(() => lireModelesRoles(value)).toThrow();
});
