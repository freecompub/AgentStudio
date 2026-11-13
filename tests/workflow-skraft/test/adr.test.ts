// Repris de extensions/skraft-workflow/test/adr.test.ts (2026-10-10) : teste le workflow en dossier (ADR 0055).
import { describe, expect, it } from "vitest";
import { adrPath, avecStory, ligneNumerotation, motifsNumerosPris, nextAdrNumber, numerotationAdrs, parseAdr, renderAdr, setAdrStatus, validateAdrInput } from "../../../workflows/skraft/adr.mjs";

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

  it("reconnaît les anciens titres ADR séparés par deux-points", () => {
    expect(parseAdr("# ADR-052: Décision ancienne\n\n- Statut : Accepted\n\n## Contexte\n\nc\n## Décision\n\nd\n## Conséquences\n\nq\n## Alternatives\n\na\n")).toMatchObject({
      number: 52,
      id: "ADR-052",
      title: "Décision ancienne",
      status: "Accepted",
      missing: [],
    });
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

describe("Numérotation des ADR calculée par le code, donnée à l'architecte (11/11)", () => {
  const projet = [
    { path: "docs/adr/0001-monorepo.md", md: "# ADR 0001 — Monorepo\n" },
    { path: "docs/adr/0002-renderer.md", md: "# ADR 0002 — Renderer\n" },
  ];
  it("le prochain numéro suit tous les ADR, quel que soit leur format ; ceux de la story ne sont pas « pris »", () => {
    const sien = { path: "docs/adr/adr-003-x.md", md: avecStory(renderAdr(3, INPUT, "2026-11-11"), "us12-f15ade30") };
    expect(numerotationAdrs([...projet, sien], "us12-f15ade30")).toEqual({ prochain: 4, pris: [1, 2] });
    expect(numerotationAdrs([], "us12-f15ade30")).toEqual({ prochain: 1, pris: [] });
  });
  it("la ligne du dossier de passation dit le numéro à prendre, et que les numéros pris sont interdits", () => {
    expect(ligneNumerotation({ prochain: 79, pris: [1, 78] })).toBe(
      "Numérotation des ADR, calculée par le code : ton prochain ADR est ADR-079 (docs/adr/adr-079-<titre>.md), puis ADR-080, et ainsi de suite. Les numéros des autres ADR du projet (2, jusqu'à ADR-078) sont pris : tu ne peux pas les écrire.",
    );
    expect(ligneNumerotation({ prochain: 1, pris: [] })).toBe("Numérotation des ADR, calculée par le code : ton prochain ADR est ADR-001 (docs/adr/adr-001-<titre>.md), puis ADR-002, et ainsi de suite.");
  });
  it("les numéros pris deviennent des motifs en lecture seule pour le tour de l'architecte", () => {
    expect(motifsNumerosPris([1, 78])).toEqual(["docs/adr/adr-001-*.md", "docs/adr/adr-078-*.md"]);
  });
});
