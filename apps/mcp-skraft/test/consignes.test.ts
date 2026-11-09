/**
 * Les réponses de `/stack init` et `/stack doctor`, rendues par `skraft_pile` (ADR 0075) : leurs
 * consignes nomment des commandes de l'application, que le client MCP n'a pas. On les dit dans les
 * termes de l'outil.
 */
import { describe, expect, it } from "vitest";
import { consignesPourLeClient } from "../src/consignes.js";

describe("consignesPourLeClient", () => {
  it("rouvrir le projet : inutile, il est relu au prochain appel ; /stack doctor devient l'action diagnostiquer", () => {
    expect(consignesPourLeClient("Profil écrit. Rouvrez le projet pour qu'il prenne effet, puis `/stack doctor` pour voir ce qu'il vaut.")).toBe(
      "Profil écrit. Il prend effet au prochain appel de skraft ; `skraft_pile` avec action « diagnostiquer » dit ce qu'il vaut.",
    );
    expect(consignesPourLeClient("Composants écrits. Rouvrez le projet pour qu'ils prennent effet, puis `/stack doctor` pour voir ce qu'ils valent.")).toBe(
      "Composants écrits. Ils prennent effet au prochain appel de skraft ; `skraft_pile` avec action « diagnostiquer » dit ce qu'ils valent.",
    );
  });

  it("les options de /stack init deviennent les arguments de l'outil", () => {
    expect(consignesPourLeClient("Donne ce qui manque : `/stack init --etapes <dossier>`, `/stack init --lanceur <nom>` ; sinon `/stack init --sans-bdd`.")).toBe(
      "Donne ce qui manque : `skraft_pile` avec `etapes`, `skraft_pile` avec `lanceur` ; sinon `skraft_pile` avec `sansBdd: true`.",
    );
    expect(consignesPourLeClient("Pour le savoir : `/stack doctor` ; `/stack init` peut le proposer.")).toBe(
      "Pour le savoir : `skraft_pile` avec action « diagnostiquer » ; `skraft_pile` peut le proposer.",
    );
  });
});
