import { describe, expect, it } from "vitest";
import { renderAdr, supersessionLine } from "../src/adr.js";
import { checkDesign, ligneNomsDuModele, matriceDeCoherence, matriceMarkdown, type DesignInput, routerMotifsDeDesign } from "../src/design.js";

const adr = (n: number, over: Record<string, unknown> = {}) =>
  renderAdr(n, { title: `Décision ${n}`, status: "Proposed", context: "c", decision: "d", consequences: "q", alternatives: "a", ...over } as never, "2026-09-23");

/** Sections que contracts.md doit porter pour le modèle de la fixture (phase 8 de solution-architect). */
const SECTIONS = "## Commande `CapBolus`\n\n## Événement `BolusCapped`\n\n";

function input(over: Partial<DesignInput> = {}): DesignInput {
  return {
    docs: {
      "event-model.md": "Commande `CapBolus` → événement `BolusCapped`, vue `ProposedDose`.",
      "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`.",
      "contracts.md": "## Commande `CapBolus`\n- dose : `MaxBolus`, validé.\n\n## Événement `BolusCapped`\n- dose plafonnée : `MaxBolus`\n",
      "diagrams.md": "`BolusCalculation` émet `BolusCapped`.",
    },
    adrs: [
      { path: "docs/adr/adr-001-decision-1.md", md: adr(1), isNew: false },
      { path: "docs/adr/adr-002-decision-2.md", md: adr(2), isNew: true },
    ],
    supersessions: "",
    modifiedExistingAdrs: [],
    ...over,
  };
}

describe("Porte cohérence (SPEC-skraft §7.2, fixtures §13.2)", () => {
  it("conception cohérente : aucun rejet", () => {
    expect(checkDesign(input())).toEqual([]);
  });

  it("événement cité dans contracts.md absent du modèle : rejet nommant les deux fichiers", () => {
    const r = checkDesign(input({ docs: { ...input().docs, "contracts.md": `${SECTIONS}\`CapBolus\` produit \`BolusLimited\`.` } }));
    expect(r).toEqual(["`BolusLimited` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md."]);
  });

  // Run réel du 03/10 sur US-2 : DESIGN rejetée trois fois, 200 requêtes premium, pour un nom
  // pourtant défini. Le modèle le déclarait dans un bloc de code et sous forme d'appel ; la porte
  // ne reconnaissait qu'un nom seul entre backticks.
  it("un nom défini dans un bloc de code du modèle est connu", () => {
    const docs = {
      ...input().docs,
      "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`.\n\n```\nTauxDeRemise { }\nMontant AppliqueA(Montant montant)\n```\n",
      "contracts.md": `${SECTIONS}\`MaxBolus\` est validé ; \`AppliqueA\` ne fait aucun arrondi.`,
    };
    expect(checkDesign(input({ docs }))).toEqual([]);
  });

  it("un nom défini sous forme d'appel entre backticks dans le modèle est connu", () => {
    const docs = {
      ...input().docs,
      "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`. Retourne `palier.Taux.AppliqueA(SousTotal)`.",
      "contracts.md": `${SECTIONS}\`MaxBolus\` ; \`AppliqueA\` ; \`SousTotal\`.`,
    };
    expect(checkDesign(input({ docs }))).toEqual([]);
  });

  it("un nom écrit seulement en prose dans le modèle, hors code, reste inconnu", () => {
    // La convention reste celle des documents de conception : un nom du modèle s'écrit en code.
    const docs = { ...input().docs, "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`, et AppliqueA en prose.", "contracts.md": `${SECTIONS}\`AppliqueA\`.` };
    expect(checkDesign(input({ docs }))).toEqual(["`AppliqueA` cité dans contracts.md n'existe pas dans event-model.md ni dans domain-model.md."]);
  });

  it("identifiant cité dans diagrams.md absent : rejet", () => {
    expect(checkDesign(input({ docs: { ...input().docs, "diagrams.md": "`GhostAggregate` émet `BolusCapped`." } }))).toEqual([
      "`GhostAggregate` cité dans diagrams.md n'existe pas dans event-model.md ni dans domain-model.md.",
    ]);
  });

  it("modèle d'événements absent : rejet", () => {
    const docs = { ...input().docs };
    delete (docs as Record<string, string>)["event-model.md"];
    expect(checkDesign(input({ docs }))).toEqual(expect.arrayContaining(["Document de conception manquant : event-model.md."]));
  });

  it("ADR existant modifié : rejet (append-only)", () => {
    expect(checkDesign(input({ modifiedExistingAdrs: ["docs/adr/adr-001-decision-1.md"] }))).toEqual([
      "ADR existant modifié : docs/adr/adr-001-decision-1.md (les ADR sont append-only ; en rédiger un nouveau qui le remplace).",
    ]);
  });

  it("nouvel ADR : champ manquant ou statut autre que Proposed", () => {
    const broken = adr(2).replace(/## Alternatives[\s\S]*$/, "");
    const first = { path: "docs/adr/adr-001-decision-1.md", md: adr(1), isNew: false };
    expect(checkDesign(input({ adrs: [first, { path: "docs/adr/adr-002-x.md", md: broken, isNew: true }] }))).toEqual(["docs/adr/adr-002-x.md : section manquante « Alternatives »."]);
    const accepted = adr(2).replace("Statut : Proposed", "Statut : Accepted");
    expect(checkDesign(input({ adrs: [first, { path: "docs/adr/adr-002-x.md", md: accepted, isNew: true }] }))).toEqual(["docs/adr/adr-002-x.md : statut Accepted, Proposed attendu."]);
  });

  it("numérotation : trou ou doublon", () => {
    expect(checkDesign(input({ adrs: [{ path: "docs/adr/adr-001-x.md", md: adr(1), isNew: false }, { path: "docs/adr/adr-003-x.md", md: adr(3), isNew: true }] }))).toEqual(["Numérotation des ADR : ADR-002 manque : aucun fichier de docs/adr/ ne porte ce numéro."]);
    expect(checkDesign(input({ adrs: [{ path: "docs/adr/adr-001-x.md", md: adr(1), isNew: false }, { path: "docs/adr/adr-001-bis.md", md: adr(1), isNew: true }] }))).toEqual(["Numérotation des ADR : ADR-001 est déjà pris par docs/adr/adr-001-x.md : docs/adr/adr-001-bis.md doit prendre le prochain numéro libre, ADR-002."]);
  });

  it("un ADR historique titré « ADR-NNN: … » compte dans la numérotation : son numéro n'est pas reproché comme manquant", () => {
    // Faux rejet vu en run (10/11) : `# ADR-001: …` n'était pas lu, et ADR-001 « manquait ».
    const historique = { path: "docs/adr/adr-001-x.md", md: adr(1).replace("# ADR-001 —", "# ADR-001:"), isNew: false };
    expect(checkDesign(input({ adrs: [historique, { path: "docs/adr/adr-002-x.md", md: adr(2), isNew: true }] }))).toEqual([]);
  });


  it("un ADR existant hors convention compte dans la numérotation : la story continue après lui", () => {
    // Run de LEC-1 sur AgentStudio (11/11) : `docs/adr/0078-x.md` titré « # ADR 0078 — x » était
    // invisible, et la porte réclamait ADR-001 à ADR-078, que l'architecte ne peut pas écrire.
    const existant = { path: "docs/adr/0078-x.md", md: "# ADR 0078 — x\n\n- Statut : Accepté\n", isNew: false };
    expect(checkDesign(input({ adrs: [existant, { path: "docs/adr/adr-079-y.md", md: adr(79), isNew: true }] }))).toEqual([]);
    expect(checkDesign(input({ adrs: [existant, { path: "docs/adr/adr-078-y.md", md: adr(78), isNew: true }] }))).toEqual(["Numérotation des ADR : ADR-078 est déjà pris par docs/adr/0078-x.md : docs/adr/adr-078-y.md doit prendre le prochain numéro libre, ADR-079."]);
  });

  it("deux ADR de la story sur un même numéro : les deux sont nommés, avec le prochain numéro libre", () => {
    const premier = { path: "docs/adr/adr-001-x.md", md: adr(1), isNew: false };
    const a = { path: "docs/adr/adr-002-a.md", md: adr(2), isNew: true };
    const b = { path: "docs/adr/adr-002-b.md", md: adr(2), isNew: true };
    expect(checkDesign(input({ adrs: [premier, a, b] }))).toEqual(["Numérotation des ADR : ADR-002 en double : docs/adr/adr-002-a.md et docs/adr/adr-002-b.md. Le prochain numéro libre est ADR-003."]);
  });

  it("un doublon entre ADR existants du projet n'est pas reproché à la story", () => {
    const existants = [
      { path: "docs/adr/0068-a.md", md: "# ADR 0068 — a\n", isNew: false },
      { path: "docs/adr/0068-b.md", md: "# ADR 0068 — b\n", isNew: false },
    ];
    expect(checkDesign(input({ adrs: [...existants, { path: "docs/adr/adr-069-y.md", md: adr(69), isNew: true }] }))).toEqual([]);
  });

  it("un ADR de la story hors convention : le motif nomme le fichier et la convention attendue", () => {
    const premier = { path: "docs/adr/adr-001-x.md", md: adr(1), isNew: false };
    const attendu = (chemin: string) =>
      `Numérotation des ADR : ADR-002 existe (${chemin}) mais ne suit pas la convention skraft : fichier attendu docs/adr/adr-002-<titre>.md, titre attendu « # ADR-002 — <Titre> ».`;
    // Titre hors convention.
    const titre = { path: "docs/adr/0002-y.md", md: adr(2).replace("# ADR-002 —", "# ADR 0002 —"), isNew: true };
    expect(checkDesign(input({ adrs: [premier, titre] }))).toEqual([attendu("docs/adr/0002-y.md")]);
    // Nom de fichier hors convention, titre conforme.
    const nom = { path: "docs/adr/0002-y.md", md: adr(2), isNew: true };
    expect(checkDesign(input({ adrs: [premier, nom] }))).toEqual([attendu("docs/adr/0002-y.md")]);
    // Le numéro suivant reste reconnu : seul le fichier hors convention est reproché.
    expect(checkDesign(input({ adrs: [premier, titre, { path: "docs/adr/adr-003-z.md", md: adr(3), isNew: true }] }))).toEqual([attendu("docs/adr/0002-y.md")]);
  });
  it("un trou déjà présent dans le dépôt n'est pas reproché à la phase", () => {
    // ADR-002 a été archivé avant cette story : l'agent ne peut pas le recréer, et le lui
    // reprocher ferait échouer DESIGN jusqu'à épuisement du budget, sur chaque tentative.
    const existants = [
      { path: "docs/adr/adr-001-x.md", md: adr(1), isNew: false },
      { path: "docs/adr/adr-003-x.md", md: adr(3), isNew: false },
    ];
    expect(checkDesign(input({ adrs: existants }))).toEqual([]);
    // En revanche, le nouvel ADR doit bien prendre le numéro suivant.
    expect(checkDesign(input({ adrs: [...existants, { path: "docs/adr/adr-004-x.md", md: adr(4), isNew: true }] }))).toEqual([]);
    expect(checkDesign(input({ adrs: [...existants, { path: "docs/adr/adr-006-x.md", md: adr(6), isNew: true }] }))).toEqual([
      "Numérotation des ADR : ADR-004 manque : aucun fichier de docs/adr/ ne porte ce numéro.",
      "Numérotation des ADR : ADR-005 manque : aucun fichier de docs/adr/ ne porte ce numéro.",
    ]);
  });

  it("remplacement : présent dans le nouvel ADR ET dans supersessions.md", () => {
    const adrs = [
      { path: "docs/adr/adr-001-x.md", md: adr(1), isNew: false },
      { path: "docs/adr/adr-002-x.md", md: adr(2, { supersedes: ["ADR-001"] }), isNew: true },
    ];
    expect(checkDesign(input({ adrs }))).toEqual(["ADR-002 remplace ADR-001 mais le registre supersessions.md ne le mentionne pas."]);
    expect(checkDesign(input({ adrs, supersessions: supersessionLine("ADR-002", "ADR-001") }))).toEqual([]);
    expect(checkDesign(input({ supersessions: supersessionLine("ADR-002", "ADR-001") }))).toEqual([
      "supersessions.md indique qu'ADR-002 remplace ADR-001, mais ADR-002 ne le déclare pas.",
    ]);
  });
});

/**
 * Deux anti-patrons d'ADR portés en code depuis les skills reprises : le verdict inscrit dans le
 * nom de fichier (`architecture-review-criteria` G14) et l'ADR de « bonne pratique »
 * (`adr-eligibility-gate`, Q2). Ils sont reconnaissables sans interprétation ; le reste de ces
 * skills reste du jugement, et appartient aux lentilles.
 *
 * DESIGN est la phase où nous avons le moins de portes : chaque règle mécanisable y compte double.
 */
describe("Anti-patrons d'ADR reconnaissables sans interprétation", () => {
  const avecAdr = (path: string, titre: string) =>
    checkDesign(input({ adrs: [{ path, md: adr(1, { title: titre }), isNew: true }] }));

  it.each(["docs/adr/adr-001-event-sourcing-rejected.md", "docs/adr/adr-001-cqrs-accepted.md", "docs/adr/adr-001-saga-deprecated.md", "docs/adr/adr-001-x-superseded.md"])(
    "le verdict dans le nom de fichier est refusé : %s",
    (path) => {
      const r = avecAdr(path, "Event Sourcing");
      expect(r.join(" ")).toMatch(/nom de fichier|verdict/i);
      // Le motif doit dire où le verdict a sa place, sinon l'agent renomme au hasard.
      expect(r.join(" ")).toMatch(/Statut/);
    },
  );

  it("un nom de fichier qui décrit le sujet passe", () => {
    expect(avecAdr("docs/adr/adr-001-event-sourcing.md", "Event Sourcing")).toEqual([]);
  });

  it("un sujet qui contient un mot proche du verdict n'est pas refusé", () => {
    // « rejet » est ici le sujet de la décision, pas son verdict.
    expect(avecAdr("docs/adr/adr-001-rejet-des-paiements.md", "Rejet des paiements")).toEqual([]);
  });

  it.each(["Ne pas utiliser de variables globales", "Éviter le couplage fort", "Toujours valider aux frontières", "Avoid hardcoded values", "No hardcoded phase names"])(
    "un ADR de « bonne pratique » est refusé : %s",
    (titre) => {
      const r = avecAdr("docs/adr/adr-001-sujet.md", titre);
      expect(r.join(" ")).toMatch(/bonne pratique|décision/i);
    },
  );

  it("un titre qui nomme une décision passe", () => {
    for (const titre of ["Event Sourcing pour le journal des paiements", "Découpage domaine / application", "Résultat typé plutôt qu'exception"])
      expect(avecAdr("docs/adr/adr-001-sujet.md", titre), titre).toEqual([]);
  });
});

describe("Porte cohérence : modèle et carte des contextes (option C de docs/15 §4.5)", () => {
  // Repris de skraft-plugin v1.6.1, solution-architect-reviewer : G8 (« chaque commande a au moins
  // un événement ») et G6 (« chaque relation entre contextes porte un patron explicite »). Chez
  // eux, une lentille le lit ; ici, le code le vérifie.
  it("une commande sans événement : rejet (G8)", () => {
    const docs = { ...input().docs, "event-model.md": "Commande `CapBolus` → événement `BolusCapped`.\nCommande `ResetCap` : remet le plafond.\n", "contracts.md": `${SECTIONS}## Commande \`ResetCap\`\n` };
    expect(checkDesign(input({ docs }))).toEqual([
      "Commande `ResetCap` : aucun événement dans event-model.md. Chaque commande produit au moins un événement : « Commande `ResetCap` → événement `…` ».",
    ]);
  });

  it("une commande reliée à son événement dans un tableau : acceptée ; une requête n'a pas besoin d'événement", () => {
    const docs = { ...input().docs, "event-model.md": "Commande `CapBolus` → événement `BolusCapped`.\nCommande `ResetCap` : remet le plafond.\n\n| `ResetCap` | `CapReset` |\n\nRequête `GetDose` → vue `ProposedDose`.\n", "contracts.md": `${SECTIONS}## Commande \`ResetCap\`\n\n## Requête \`GetDose\`\n` };
    expect(checkDesign(input({ docs }))).toEqual([]);
  });

  it("une relation entre contextes sans patron : rejet (G6) ; avec un patron : acceptée", () => {
    const sans = { ...input().docs, "context-map.md": "`Bolus` → `Patient`\n`Bolus` : Core\n`Patient` : Generic\n" };
    expect(checkDesign(input({ docs: sans }))).toEqual([
      "context-map.md : la relation « `Bolus` → `Patient` » ne nomme aucun patron (ACL, Conformist, Shared Kernel, Customer-Supplier, Open Host Service, Published Language, Partnership, Separate Ways).",
    ]);
    const avec = { ...input().docs, "context-map.md": "`Bolus` → `Patient` : Conformist, le dossier patient est repris tel quel.\n`Bolus` : Core\n`Patient` : Generic\n" };
    expect(checkDesign(input({ docs: avec }))).toEqual([]);
  });
});

describe("Matrice de cohérence construite par le code (G10 de skraft-plugin, docs/15 §4.5)", () => {
  // Chez le plugin, l'architecte remplit la matrice et se donne « consistency-gate: PASS ». Ici, le
  // code relève la catégorie de chaque nom dans chaque document et juge lui-même.
  it("même catégorie partout : PASS, une ligne par concept, la catégorie relevée dans chaque document", () => {
    const m = matriceDeCoherence(input());
    expect(m.verdict).toBe("PASS");
    expect(m.lignes.find((l) => l.concept === "CapBolus")).toEqual({ concept: "CapBolus", cellules: { "event-model.md": ["command"], "contracts.md": ["command"] }, verdict: "PASS" });
    expect(m.lignes.find((l) => l.concept === "MaxBolus")).toEqual({ concept: "MaxBolus", cellules: { "domain-model.md": ["valueObject"] }, verdict: "PASS" });
  });

  it("une requête dans un ADR, une commande dans le modèle : FAIL et rejet nommant les deux documents", () => {
    const adrs = [...input().adrs, { path: "docs/adr/adr-003-dose.md", md: adr(3, { decision: "Requête `GetProposedDose` en lecture seule." }), isNew: true }];
    const docs = { ...input().docs, "event-model.md": "Commande `CapBolus` → événement `BolusCapped`.\nCommande `GetProposedDose` → événement `DoseProposed`.\n" };
    const i = input({ docs, adrs });
    expect(matriceDeCoherence(i).verdict).toBe("FAIL");
    expect(checkDesign(i)).toContain(
      "`GetProposedDose` est classé Commande (event-model.md) et Requête (ADR-003) : catégories incompatibles (matrice de cohérence).",
    );
  });

  it("une entité et un objet-valeur sous le même nom : incompatibles ; un agrégat et une entité : compatibles", () => {
    const docs = { ...input().docs, "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`, entité `BolusCalculation`.\n", "diagrams.md": "Entité `MaxBolus`.\n" };
    const r = checkDesign(input({ docs }));
    expect(r).toEqual(["`MaxBolus` est classé Objet-valeur (domain-model.md) et Entité (diagrams.md) : catégories incompatibles (matrice de cohérence)."]);
  });

  it("libellé en majuscule ou minuscule ; un nom en minuscules n'est pas un concept", () => {
    const docs = { ...input().docs, "event-model.md": "COMMANDE `CapBolus` → événement `BolusCapped`.\nevent `onClick`.\n" };
    const m = matriceDeCoherence(input({ docs }));
    expect(m.lignes.map((l) => l.concept)).toEqual(["CapBolus", "BolusCapped", "BolusCalculation", "MaxBolus"]);
  });

  it("rendu Markdown : écrit par le code, une colonne par document, ligne consistency-gate", () => {
    const md = matriceMarkdown(matriceDeCoherence(input()));
    expect(md).toContain("Écrite par le code");
    expect(md).toContain("| `CapBolus` | Commande | — | Commande | — | PASS |");
    expect(md).toMatch(/consistency-gate: PASS\n$/);
  });
});

describe("Concept d'un ADR absent du modèle (STRUCTURAL_DRIFT de skraft-plugin, docs/15 §4.5)", () => {
  // Plugin v1.6.1, consistency-matrix.template.md : « le concept existe dans un artefact et pas dans
  // l'autre (un ADR mentionne un agrégat que le diagramme n'a jamais dessiné, ou les contrats
  // définissent un Repository qu'aucun ADR n'a ratifié) ». Ici, vérifié par le code.
  it("un concept classé dans un nouvel ADR, absent du modèle : rejet", () => {
    const adrs = [...input().adrs, { path: "docs/adr/adr-003-historique.md", md: adr(3, { decision: "Agrégat `DoseLedger` conserve l'historique des doses." }), isNew: true }];
    expect(checkDesign(input({ adrs }))).toEqual(["`DoseLedger`, Agrégat dans ADR-003, n'existe ni dans event-model.md ni dans domain-model.md."]);
  });

  // Run du 08/11 (et du 07/11) : « Agrégat `Panier` » était dans domain-model.md, et la porte le disait
  // absent. Les noms du modèle étaient relevés comme des identifiants composés (`GrilleDePaliers`) :
  // un nom d'un seul mot n'y figurait jamais, alors que ceux de l'ADR, si.
  it("un concept d'un seul mot présent dans le modèle : accepté", () => {
    const docs = { ...input().docs, "domain-model.md": `${input().docs["domain-model.md"]}\n### Agrégat \`Panier\` (existant, étendu)\n` };
    const adrs = [...input().adrs, { path: "docs/adr/adr-003-panier.md", md: adr(3, { decision: "Nous gardons l'Agrégat `Panier` comme seule frontière de cohérence." }), isNew: true }];
    expect(checkDesign(input({ docs, adrs }))).toEqual([]);
  });

  it("un concept d'un seul mot absent du modèle : toujours rejeté", () => {
    const adrs = [...input().adrs, { path: "docs/adr/adr-003-registre.md", md: adr(3, { decision: "Agrégat `Registre` conserve l'historique des doses." }), isNew: true }];
    expect(checkDesign(input({ adrs }))).toEqual(["`Registre`, Agrégat dans ADR-003, n'existe ni dans event-model.md ni dans domain-model.md."]);
  });

  it("un concept cité seulement dans les alternatives écartées de l'ADR : accepté", () => {
    const adrs = [...input().adrs, { path: "docs/adr/adr-003-historique.md", md: adr(3, { alternatives: "Agrégat `DoseLedger` : écarté, l'historique n'est pas demandé." }), isNew: true }];
    expect(checkDesign(input({ adrs }))).toEqual([]);
  });
});

describe("Méthode de DESIGN vérifiée par le code (docs/15 §4.6)", () => {
  // Repris de skraft-plugin v1.6.1, solution-architect : phases 5 (sous-domaines classés), 7.0
  // (engagements déjà dans le code), 7 (déclencheurs obligatoires d'ADR) et 8 (format des contrats).
  const carte = (rel: string) => `${rel}\n\`Bolus\` : Core\n\`Patient\` : Generic\n`;

  it("un contexte de la carte non classé Core, Supporting ou Generic : rejet (phase 5)", () => {
    const docs = { ...input().docs, "context-map.md": "`Bolus` → `Patient` : Conformist\n`Bolus` : Core\n" };
    expect(checkDesign(input({ docs }))).toEqual([
      "context-map.md : le contexte `Patient` n'est classé ni Core, ni Supporting, ni Generic (une ligne « `Patient` : Core | Supporting | Generic »).",
    ]);
  });

  it("une couche anticorruption sans ADR qui la ratifie : rejet ; avec un ADR : acceptée (phase 7)", () => {
    const docs = { ...input().docs, "context-map.md": carte("`Bolus` → `Patient` : ACL") };
    expect(checkDesign(input({ docs }))).toEqual([
      "context-map.md : la relation « `Bolus` → `Patient` » adopte une couche anticorruption, mais aucun ADR ne la ratifie.",
    ]);
    const adrs = [input().adrs[0]!, { path: "docs/adr/adr-002-decision-2.md", md: adr(2, { decision: "Couche anticorruption entre Bolus et Patient." }), isNew: true }];
    expect(checkDesign(input({ docs, adrs }))).toEqual([]);
  });

  // Décision du responsable (11/11) : la porte juge les ADR que la story produit, pas l'existant. La
  // phase 7.0 du plugin est retirée ; la porte ne reçoit plus les sources (e2e-s3 le vérifie).
  it("un ADR rejeté, ou une mention dans les alternatives, ne ratifie pas la couche anticorruption de la story", () => {
    const docs = { ...input().docs, "context-map.md": carte("`Bolus` → `Patient` : ACL") };
    const rejete = [{ path: "docs/adr/adr-001-decision-1.md", md: adr(1, { status: "Rejected", decision: "Couche anticorruption." }), isNew: false }, input().adrs[1]!];
    expect(checkDesign(input({ docs, adrs: rejete }))).toHaveLength(1);
    const ecarte = [input().adrs[0]!, { path: "docs/adr/adr-002-decision-2.md", md: adr(2, { alternatives: "Couche anticorruption : écartée." }), isNew: true }];
    expect(checkDesign(input({ docs, adrs: ecarte }))).toHaveLength(1);
  });

  it("une commande ou un événement du modèle sans section dans contracts.md : rejet (phase 8)", () => {
    const docs = { ...input().docs, "contracts.md": "## Commande `CapBolus`\n- dose : `MaxBolus`\n" };
    expect(checkDesign(input({ docs }))).toEqual([
      "contracts.md : l'événement `BolusCapped` n'a pas de section « ## Événement `BolusCapped` » (sa charge utile).",
    ]);
  });

  it("un dépôt sans couche, ou dans l'infrastructure : rejet ; domaine ou application : accepté (phases 6 et 8)", () => {
    const avec = (couche: string) => ({ ...input().docs, "contracts.md": `${input().docs["contracts.md"]}\n## Dépôt \`BolusCalculationRepository\`\n${couche}- Save(\`BolusCalculation\`)\n` });
    const dm = { "domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`, dépôt `BolusCalculationRepository`." };
    expect(checkDesign(input({ docs: { ...avec(""), ...dm } }))).toEqual([
      "contracts.md : le dépôt `BolusCalculationRepository` ne déclare pas sa couche (« Couche : Domaine » ou « Couche : Application »).",
    ]);
    expect(checkDesign(input({ docs: { ...avec("Couche : Infrastructure\n"), ...dm } }))).toEqual([
      "contracts.md : le dépôt `BolusCalculationRepository` est déclaré dans l'infrastructure. Une interface est un contrat : elle appartient au domaine ou à l'application, l'infrastructure ne fait que l'implémenter.",
    ]);
    expect(checkDesign(input({ docs: { ...avec("Couche : Domaine\n"), ...dm } }))).toEqual([]);
  });
});

/**
 * Les noms du modèle donnés à l'architecte qui décide (08/11) : sa consigne disait de ne citer que des
 * noms du modèle, et il citait ceux du code existant (`SommeDesArticles`, `PrixUnitaire`). Le code lui
 * donne la liste que la porte de cohérence acceptera, calculée par la même règle.
 */
describe("Noms du modèle dans le dossier de l'architecte qui décide", () => {
  it("noms des deux documents, d'un seul mot compris, une fois chacun, et la conduite à tenir", () => {
    const docs = { "event-model.md": "Commande `ChiffrerLePanier` → événement `PanierChiffre`.\n", "domain-model.md": "### Agrégat `Panier`\nObjet-valeur `Montant`, et encore `Panier`.\n" };
    expect(ligneNomsDuModele("us-2", docs)).toBe(
      "Noms définis par le modèle (`.skraft/us-2/design/event-model.md`, `.skraft/us-2/design/domain-model.md`) : `ChiffrerLePanier`, `PanierChiffre`, `Panier`, `Montant`. " +
        "`contracts.md`, `diagrams.md` et les ADR ne citent que ceux-là : un autre nom sera refusé. Ajoute-le d'abord au modèle, ou ne le cite pas.",
    );
  });

  it("modèle encore vide : rien à dire", () => {
    expect(ligneNomsDuModele("us-2", {})).toBe("");
  });

  it("la liste est exactement ce que la porte accepte : un nom de la liste cité dans un ADR passe", () => {
    const docs = { "domain-model.md": "### Agrégat `Panier`\n" };
    expect(ligneNomsDuModele("us-2", docs)).toContain("`Panier`");
  });
});

// Un motif va à l'agent qui a produit le fichier en cause (11/11) : un refus sur un ADR ne relance pas
// le modélisateur, qui n'écrit pas d'ADR.
describe("Routage des motifs d'un refus de DESIGN", () => {
  const adr = "Numérotation des ADR : ADR-001 est déjà pris par docs/adr/0001-x.md : docs/adr/adr-001-y.md doit prendre le prochain numéro libre, ADR-079.";
  const modele = "Document manquant : .skraft/us-12/design/event-model.md.";
  const croise = "`BolusLimited` cité dans contracts.md n'existe pas dans event-model.md.";
  const neutre = "Question de la revue (cold-reader) : x — Réponse de l'utilisateur : y";
  it("un motif sur un ADR ou un document de décision ne va qu'à l'architecte qui décide", () => {
    expect(routerMotifsDeDesign([adr, "[architecture#1.1, major, deliverable] Contrat flou (.skraft/us-12/design/contracts.md:3)"])).toEqual({ modele: [], decisions: [adr, "[architecture#1.1, major, deliverable] Contrat flou (.skraft/us-12/design/contracts.md:3)"] });
  });
  it("un motif sur le modèle ne va qu'au modélisateur ; un motif qui lie les deux, ou ne nomme aucun fichier, va aux deux", () => {
    expect(routerMotifsDeDesign([modele, croise, neutre])).toEqual({ modele: [modele, croise, neutre], decisions: [croise, neutre] });
  });
});
