/**
 * Modèle par classe de rôle (ADR 0048). Une extension déclare la CLASSE d'un agent (fort, standard,
 * léger) ; le projet associe chaque classe à un modèle réel. L'extension ne nomme jamais un modèle :
 * elle ne choisit pas ce que l'utilisateur paie.
 */
import { describe, expect, it } from "vitest";
import { MODEL_CLASSES, resolveModel } from "../src/agents/model-class.js";

describe("resolveModel", () => {
  const classes = { strong: "claude-sonnet-5.5", light: "gpt-5-mini" };

  it("la classe de l'agent l'emporte, si le projet l'associe à un modèle", () => {
    expect(resolveModel("light", { classes, fallback: "claude-sonnet-5" })).toBe("gpt-5-mini");
    expect(resolveModel("strong", { classes })).toBe("claude-sonnet-5.5");
  });

  it("classe non associée, ou agent sans classe : le modèle du projet (ADR 0020)", () => {
    expect(resolveModel("standard", { classes, fallback: "claude-sonnet-5" })).toBe("claude-sonnet-5");
    expect(resolveModel(undefined, { classes, fallback: "claude-sonnet-5" })).toBe("claude-sonnet-5");
  });

  it("rien de réglé : aucun modèle, le runtime décide (comportement d'avant)", () => {
    expect(resolveModel("light", {})).toBeUndefined();
    expect(resolveModel(undefined, { fallback: null })).toBeUndefined();
  });

  it("un modèle que l'abonnement ne propose pas est ignoré : on retombe sur le suivant", () => {
    // La disponibilité dépend de l'abonnement, et change : un réglage peut viser un modèle disparu.
    const available = ["claude-sonnet-5", "gpt-5-mini"];
    expect(resolveModel("strong", { classes, fallback: "claude-sonnet-5", available })).toBe("claude-sonnet-5");
    expect(resolveModel("light", { classes, fallback: "claude-sonnet-5", available })).toBe("gpt-5-mini");
    expect(resolveModel("strong", { classes, fallback: "absent-aussi", available })).toBeUndefined();
  });

  it("liste des modèles inconnue (vide ou absente) : aucun filtrage", () => {
    expect(resolveModel("strong", { classes, available: [] })).toBe("claude-sonnet-5.5");
  });

  it("trois classes, dans l'ordre du plus coûteux au plus léger", () => {
    expect(MODEL_CLASSES).toEqual(["strong", "standard", "light"]);
  });
});
