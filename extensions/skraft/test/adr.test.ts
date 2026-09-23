import { describe, expect, it } from "vitest";
import { adrPath, nextAdrNumber, parseAdr, renderAdr, setAdrStatus, validateAdrInput } from "../src/adr.js";

const INPUT = {
  title: "Plafond appliqué dans le domaine",
  status: "Proposed" as const,
  context: "La dose proposée peut dépasser le plafond du médecin.",
  decision: "Le plafond est appliqué par `BolusCapPolicy` dans le module Domain.",
  consequences: "L'interface affiche l'alerte produite par le domaine.",
  alternatives: "Plafond dans l'interface : rejeté, logique métier hors du domaine.",
};

describe("ADR : rendu et lecture (§6.5 render_adr, sans reprise de skraft)", () => {
  it("rendu depuis le gabarit, relu à l'identique", () => {
    const md = renderAdr(8, INPUT, "2026-09-23");
    expect(md.split("\n")[0]).toBe("# ADR-008 — Plafond appliqué dans le domaine");
    expect(parseAdr(md)).toEqual({ number: 8, id: "ADR-008", title: "Plafond appliqué dans le domaine", status: "Proposed", supersedes: [], missing: [] });
  });

  it("remplacements déclarés", () => {
    const md = renderAdr(9, { ...INPUT, supersedes: ["ADR-003"] }, "2026-09-23");
    expect(parseAdr(md).supersedes).toEqual(["ADR-003"]);
  });

  it("chemin : docs/adr/adr-NNN-<slug>.md", () => {
    expect(adrPath(8, "Plafond appliqué dans le domaine")).toBe("docs/adr/adr-008-plafond-applique-dans-le-domaine.md");
  });

  it("validation des arguments : champ manquant ou statut autre que Proposed refusé", () => {
    expect(validateAdrInput({ ...INPUT, decision: " " })).toEqual(["Champ obligatoire vide : decision"]);
    expect(validateAdrInput({ ...INPUT, status: "Accepted" })).toEqual(["Un nouvel ADR est toujours au statut Proposed"]);
  });

  it("numérotation : suivant le plus grand, numéro imposé en double refusé", () => {
    expect(nextAdrNumber([1, 2, 7])).toBe(8);
    expect(nextAdrNumber([])).toBe(1);
  });

  it("changement de statut à la ratification, seule la ligne de statut change", () => {
    const md = renderAdr(8, INPUT, "2026-09-23");
    const accepted = setAdrStatus(md, "Accepted");
    expect(parseAdr(accepted).status).toBe("Accepted");
    expect(accepted.replace("Accepted", "Proposed")).toBe(md);
  });

  it("champs d'en-tête manquants détectés", () => {
    expect(parseAdr("# ADR-004 — X\n\n- Statut : Proposed\n\n## Contexte\n\nc\n").missing).toEqual(["Décision", "Conséquences", "Alternatives"]);
  });
});
