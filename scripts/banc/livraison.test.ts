import { describe, expect, it } from "vitest";
import type { EtatWorkflow } from "@agent-studio/workflow";
import { workflowLivre } from "./livraison.js";

const etat = (fin: EtatWorkflow["fin"], contenus: EtatWorkflow["contenus"] = {}): EtatWorkflow => ({
  script: { nom: "skraft", empreinte: "test" },
  entree: {},
  journal: [],
  contenus,
  ...(fin ? { fin } : {}),
});

describe("livraison du workflow", () => {
  it("lit les phases dans un résultat en clair", () => {
    expect(workflowLivre(etat({ statut: "fini", valeur: { clair: { phases: ["DELIVER"] } } }))).toBe(true);
  });

  it("résout un résultat rangé dans le magasin de contenus", () => {
    expect(workflowLivre(etat({ statut: "fini", valeur: { ref: "sha256:test" } }, {
      "sha256:test": JSON.stringify({ phases: ["RESEARCH", "DESIGN", "DISTILL", "DELIVER"] }),
    }))).toBe(true);
  });

  it("ne confond pas fin, saut de livraison et abandon", () => {
    expect(workflowLivre(undefined)).toBe(false);
    expect(workflowLivre(etat({ statut: "annule" }))).toBe(false);
    expect(workflowLivre(etat({ statut: "echec", motif: "refus" }))).toBe(false);
    expect(workflowLivre(etat({ statut: "fini", valeur: { clair: { phases: ["DISTILL"] } } }))).toBe(false);
  });

  it("signale une référence manquante au lieu de déclarer non livré", () => {
    expect(() => workflowLivre(etat({ statut: "fini", valeur: { ref: "absente" } }))).toThrow("Contenu absent");
  });
});
