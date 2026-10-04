/**
 * skraft décrit comme une fonctionnalité téléversable (`fonctionnalites/skraft/`, docs/08).
 *
 * Trois garanties, tant qu'aucun code de production ne charge ce format :
 * 1. la recette respecte le schéma du format (propriétés fermées) ;
 * 2. elle est cohérente : tout nom appelé existe, au catalogue ou dans la recette, avec ses
 *    paramètres ; toute référence vise une entrée, un fait, un réglage déclarés ; rien de mort ;
 * 3. les scripts Python qui remplacent le code propre à skraft rendent **la même chose** que les
 *    fonctions TypeScript dont ils sont le portage (tests de parité). Sautés sans Python 3.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { renderAdr, setAdrStatus } from "../src/adr.js";
import { planScenarios } from "../src/deliver.js";
import { checkDesign } from "../src/design.js";
import { computeIndicators, DEFAULT_THRESHOLDS, gradeDifficulty, type DifficultyIndicators } from "../src/difficulty.js";
import { checkAcceptanceRed, checkValues, type AcceptanceResult } from "../src/distill.js";
import { repositoryShape } from "../src/effects.js";
import { checkGherkin } from "../src/gherkin.js";
import { checkResearch, RESEARCH_SECTIONS } from "../src/research.js";
import { parseStory, slugOf } from "../src/story.js";
import { declaredIdentifiers } from "../src/text-analysis.js";

const RACINE = fileURLToPath(new URL("../../../fonctionnalites/", import.meta.url));
const SKRAFT = join(RACINE, "skraft");
const SCRIPTS = join(SKRAFT, "scripts");
const EXTENSION = fileURLToPath(new URL("../", import.meta.url));

type Obj = Record<string, any>;
const lireYaml = (p: string): Obj => parse(readFileSync(p, "utf8"));
const recette = lireYaml(join(SKRAFT, "skraft.yaml"));
const catalogue = lireYaml(join(RACINE, "catalogue.yaml"));
const schema = JSON.parse(readFileSync(join(RACINE, "fonctionnalite.schema.json"), "utf8"));

describe("Recette skraft : schéma du format", () => {
  it("respecte fonctionnalite.schema.json (aucune propriété hors liste)", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const valide = ajv.compile(schema);
    const ok = valide(recette);
    expect(ok ? [] : valide.errors!.map((e) => `${e.instancePath} ${e.message} ${JSON.stringify(e.params)}`)).toEqual([]);
  });

  it("le schéma refuse une propriété inconnue, où qu'elle soit", () => {
    const valide = new Ajv2020({ strict: false }).compile(schema);
    const copie = structuredClone(recette);
    copie.taches["livrer-story"].methodes[0].etapes[0].avecc = {};
    expect(valide(copie)).toBe(false);
    const copie2 = structuredClone(recette);
    copie2.sessions.developpeur.herite = "testeur";
    expect(valide(copie2)).toBe(false);
  });
});

describe("Recette skraft : cohérence", () => {
  const actions: Obj = recette.actions;
  const taches: Obj = recette.taches;
  const ops: Obj = { ...catalogue.operations };
  const prims: Obj = catalogue.primitives;
  const verifs: Obj = catalogue.verifications;
  const scripts = Object.fromEntries(Object.entries(actions).filter(([, a]) => a.type === "script"));
  const problemes: string[] = [];
  const utilises = new Set<string>([recette["tache-racine"]]);

  const parametresDe = (nom: string): Obj | null =>
    taches[nom]?.parametres ?? actions[nom]?.parametres ?? ops[nom]?.parametres ?? prims[nom]?.parametres ?? (taches[nom] || actions[nom] ? {} : null);

  function verifierAvec(ou: string, cible: string, avec: Obj | undefined, params: Obj) {
    for (const k of Object.keys(avec ?? {})) if (!(k in params)) problemes.push(`${ou} : paramètre inconnu « ${k} » pour ${cible}`);
    for (const [k, p] of Object.entries(params)) if ((p as Obj).obligatoire && !(k in (avec ?? {}))) problemes.push(`${ou} : paramètre obligatoire « ${k} » absent pour ${cible}`);
  }

  function etape(ou: string, e: Obj) {
    const params = parametresDe(e.faire);
    if (params === null) return problemes.push(`${ou} : « ${e.faire} » n'existe ni dans la recette ni au catalogue`);
    utilises.add(e.faire);
    verifierAvec(ou, e.faire, e.avec, params);
    const avecEtapes = prims[e.faire]?.etapes === true;
    if (e.etapes && !avecEtapes) problemes.push(`${ou} : « etapes » réservé à boucle, pour-chaque, en-parallele`);
    if (avecEtapes && !e.etapes) problemes.push(`${ou} : la primitive ${e.faire} n'a pas d'étapes`);
    if (e.retenir && !(e.retenir.split(".")[0] in recette.faits)) problemes.push(`${ou} : fait non déclaré « ${e.retenir} »`);
    (e.etapes ?? []).forEach((s: Obj, i: number) => etape(`${ou}.etapes[${i}]`, s));
  }

  for (const [nom, t] of Object.entries(taches))
    (t as Obj).methodes.forEach((m: Obj, i: number) => m.etapes.forEach((e: Obj, j: number) => etape(`taches.${nom}.methodes[${i}].etapes[${j}]`, e)));

  for (const [nom, a] of Object.entries(actions)) {
    for (const [i, c] of ((a as Obj).controles ?? []).entries()) {
      const params = verifs[c.verification]?.parametres ?? scripts[c.verification]?.parametres;
      if (!params) problemes.push(`actions.${nom}.controles[${i}] : vérification inconnue « ${c.verification} »`);
      else verifierAvec(`actions.${nom}.controles[${i}]`, c.verification, c.avec, params);
      if (scripts[c.verification]) utilises.add(c.verification);
    }
    if ((a as Obj).session && !recette.sessions[(a as Obj).session]) problemes.push(`actions.${nom} : session inconnue`);
    if ((a as Obj).type === "script") {
      if (!recette.interpreteurs[(a as Obj).interpreteur]) problemes.push(`actions.${nom} : interpréteur non déclaré`);
      if (!existsSync(join(SKRAFT, (a as Obj).fichier))) problemes.push(`actions.${nom} : script absent ${(a as Obj).fichier}`);
    }
  }
  for (const [nom, s] of Object.entries(recette.sessions as Obj)) {
    if (!existsSync(join(SKRAFT, s.agent))) problemes.push(`sessions.${nom} : agent absent ${s.agent}`);
    for (const k of [...(s["skills-injectes"] ?? []), ...(s["skills-a-la-demande"] ?? [])])
      if (!existsSync(join(SKRAFT, "skills", k.split("#")[0], "SKILL.md"))) problemes.push(`sessions.${nom} : skill absente ${k}`);
    for (const o of s.outils ?? []) if (!catalogue.outils.includes(o)) problemes.push(`sessions.${nom} : outil hors catalogue ${o}`);
  }
  for (const [nom, e] of Object.entries(recette.entrees as Obj)) if (e.lecteur) (scripts[e.lecteur] ? utilises.add(e.lecteur) : problemes.push(`entrees.${nom} : lecteur inconnu`));
  for (const a of Object.values(recette.reglages.relecteurs as Obj)) (actions[a as string] ? utilises.add(a as string) : problemes.push(`relecteur inconnu ${a}`));
  utilises.add("arbitrer-desaccord"); // passé à la primitive revue par son nom

  // Toutes les chaînes : chaque référence vise ce qui est déclaré.
  const ids = new Set<string>();
  const parcourir = (x: unknown, f: (s: string, chemin: string) => void, chemin = ""): void => {
    if (typeof x === "string") f(x, chemin);
    else if (Array.isArray(x)) x.forEach((y, i) => parcourir(y, f, `${chemin}[${i}]`));
    else if (x && typeof x === "object")
      for (const [k, v] of Object.entries(x)) {
        if (k === "id" && typeof v === "string") ids.add(v);
        parcourir(v, f, `${chemin}.${k}`);
      }
  };
  parcourir(recette.taches, () => {});
  const CONTEXTE = new Set(["depot", "stack", "barre", "modeles"]);
  parcourir(recette, (s, chemin) => {
    for (const m of s.matchAll(/\$([a-z][a-z0-9-]*)/g)) if (!(m[1]! in recette.entrees)) problemes.push(`${chemin} : entrée non déclarée $${m[1]}`);
    for (const m of s.matchAll(/(?<![\w.-])faits\.([a-z][a-z0-9-]*)/g)) if (!(m[1]! in recette.faits)) problemes.push(`${chemin} : fait non déclaré ${m[1]}`);
    for (const m of s.matchAll(/(?<![\w.-])reglages\.([a-z][a-z0-9-]*)/g)) if (!(m[1]! in recette.reglages)) problemes.push(`${chemin} : réglage non déclaré ${m[1]}`);
    for (const m of s.matchAll(/(?<![\w.-])sorties\.([a-z][a-z0-9-]*)/g)) if (!ids.has(m[1]!)) problemes.push(`${chemin} : aucune étape d'id ${m[1]}`);
    for (const m of s.matchAll(/(?<![\w.-])contexte\.([a-z][a-z0-9-]*)/g)) if (!CONTEXTE.has(m[1]!)) problemes.push(`${chemin} : contexte inconnu ${m[1]}`);
  });

  it("tout nom appelé existe, avec des paramètres connus et complets ; toute référence est déclarée", () => {
    expect(problemes).toEqual([]);
  });

  it("aucune tâche ni action déclarée n'est inutilisée", () => {
    const morts = [...Object.keys(taches), ...Object.keys(actions)].filter((n) => !utilises.has(n));
    expect(morts).toEqual([]);
  });

  it("les prompts et les skills copiés sont identiques à ceux de l'extension", () => {
    const differents: string[] = [];
    const comparer = (rel: string) => {
      if (readFileSync(join(SKRAFT, rel), "utf8") !== readFileSync(join(EXTENSION, rel), "utf8")) differents.push(rel);
    };
    for (const s of Object.values(recette.sessions as Obj)) comparer(s.agent);
    for (const k of ["architecture-patterns", "bdd-methodology", "test-design-mandates", "outside-in-tdd", "craft-discipline"]) comparer(`skills/${k}/SKILL.md`);
    expect(differents).toEqual([]);
  });
});

// ── Parité des scripts ─────────────────────────────────────────────────────────────────────────

const PYTHON = ["python3", "python"].find((p) => spawnSync(p, ["--version"]).status === 0);

function script(nom: string, params: unknown, cwd: string = mkdtempSync(join(tmpdir(), "skraft-"))): { code: number; motifs: string[]; sorties: Obj } {
  const r = spawnSync(PYTHON!, [join(SCRIPTS, nom)], { input: JSON.stringify(params), cwd, encoding: "utf8" });
  if (r.status !== 0 && r.status !== 1) throw new Error(`${nom} : code ${r.status}\n${r.stderr}`);
  const out = JSON.parse(r.stdout);
  return { code: r.status, motifs: out.motifs, sorties: out.sorties };
}

function depot(fichiers: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "skraft-depot-"));
  for (const [p, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), contenu);
  }
  return dir;
}

const US12 = `# US-12 — Plafonner le bolus proposé

En tant que patient, quand le calcul propose une dose de bolus supérieure au plafond défini par mon médecin,
je veux que la dose proposée soit limitée à ce plafond et qu'une alerte m'explique pourquoi.

## Critères d'acceptation
1. Plafond de 10 U, calcul à 6 U : dose proposée 6 U, pas d'alerte.
2. Plafond de 10 U, calcul à 12,5 U : dose proposée 10 U, alerte « Dose plafonnée à 10 U ».
3. Aucun plafond configuré : dose proposée égale au calcul, pas d'alerte.

## Questions ouvertes
- Le plafond s'applique-t-il par prise ou par jour ?
`;

const STORIES = [
  US12,
  US12.replace(/\n/g, "\r\n"),
  `# FEAT_7-3 – Glycémie\n\nTexte.\n\n## Criteres d'acceptation\n1. Seuil à 180 mg/dL, "Hyper" affiché.\n2. Remise de 12 % au-delà de 3 articles, “Remise appliquée”.\n3. Entre 3 à 5 jours, version 1.2.3 et 70 kg.\n\n### Détail\n4. Pas un critère de section ?\n`,
  `# US-3 — Sans question\n\n## Critères d'acceptation\n1. Total 0,5 € pour 2,25 € payés.\n`,
  "# Plafonner\n\n## Critères d'acceptation\n1. x",
  "# US-1 — X\n\nTexte.",
];

describe.skipIf(!PYTHON)("Parité des scripts avec le code de skraft", () => {
  it("lire_story ↔ parseStory", () => {
    for (const md of STORIES) {
      const ts = parseStory(md);
      const py = script("lire_story.py", { texte: md });
      if (!ts.ok) {
        expect(py.code).toBe(1);
        expect(py.motifs).toEqual(ts.errors);
        continue;
      }
      expect(py.code).toBe(0);
      expect(py.sorties).toEqual({
        id: ts.story.id,
        titre: ts.story.title,
        slug: slugOf(ts.story.id),
        enonce: ts.story.statement,
        criteres: ts.story.criteria.map((c) => ({ n: c.n, texte: c.text, litteraux: c.literals })),
        "questions-ouvertes": ts.story.openQuestions,
        brut: md,
      });
    }
  });

  it("mesurer_indicateurs ↔ computeIndicators ; proposer_difficulte ↔ gradeDifficulty", () => {
    const fichiers = [
      ["src/Bolus/BolusCalculator.cs", "src/Alertes/AlertService.cs", "Sources/Domain/Plafond.swift", "README.md", "packages/core/src/index.ts"],
      ["src/Panier/Panier.cs", "src/Api/StripeClient.cs"],
      [],
    ];
    const storyApi = `# US-9 — Paiement\n\nPayer via l'API REST du prestataire Stripe pour le panier.\n\n## Critères d'acceptation\n1. Le panier est payé.\n2. Un échec affiche « Refusé ».\n3. a\n4. b\n5. c\n6. d\n`;
    for (const md of [US12, storyApi, STORIES[2]!]) {
      const ts = parseStory(md);
      if (!ts.ok) throw new Error(ts.errors.join());
      const story = script("lire_story.py", { texte: md }).sorties;
      for (const f of fichiers) {
        const attendu = computeIndicators(ts.story, repositoryShape(f));
        const py = script("mesurer_indicateurs.py", { story, fichiers: f });
        expect(py.sorties).toEqual({
          criteres: attendu.acceptanceCriteria,
          "modules-touches": attendu.modulesTouched,
          "integration-externe": attendu.newExternalIntegration,
          "questions-ouvertes": attendu.openBusinessQuestions,
        });
      }
    }
    const grille = recette.reglages.grille;
    expect(grille).toEqual({
      "challenging-modules": DEFAULT_THRESHOLDS.challengingModules,
      "challenging-questions": DEFAULT_THRESHOLDS.challengingQuestions,
      "hard-criteres": DEFAULT_THRESHOLDS.hardCriteria,
      "hard-modules": DEFAULT_THRESHOLDS.hardModules,
      "medium-criteres": DEFAULT_THRESHOLDS.mediumCriteria,
      "medium-modules": DEFAULT_THRESHOLDS.mediumModules,
    });
    for (const criteres of [1, 3, 5, 6])
      for (const modules of [0, 2, 3])
        for (const questions of [0, 1, 2])
          for (const externe of [false, true]) {
            const i: DifficultyIndicators = { acceptanceCriteria: criteres, modulesTouched: modules, newExternalIntegration: externe, openBusinessQuestions: questions };
            const py = script("proposer_difficulte.py", {
              indicateurs: { criteres, "modules-touches": modules, "integration-externe": externe, "questions-ouvertes": questions },
              grille,
            });
            expect(py.sorties.niveau, JSON.stringify(i)).toBe(gradeDifficulty(i, DEFAULT_THRESHOLDS));
          }
  });

  it("verifier_recherche ↔ checkResearch", () => {
    const dir = depot({ "src/a.ts": "1\n2\n3\n", "docs/guide.md": "x\n" });
    const complet = (reco: string, relais: string, extra = "") =>
      RESEARCH_SECTIONS.map((s) => `## ${s}\n\n${s === "Recommandation" ? reco : s === "Passage de relais" ? relais : `Voir \`src/a.ts:1-3\`. ${extra}`}\n`).join("\n");
    const docs = [
      complet("- Utiliser un objet-valeur.", "### Questions ouvertes\n- Faut-il arrondir ?\n- Quel plafond ?\n"),
      complet("- A\n- B", "Le plafond est-il journalier ?\nSuite.", "Aussi `src/absent.ts`, `src/a.ts:2-9`, `src/a.ts:3-1`, `docs/guide.md:1` et https://exemple.fr/x. et http://sans-point/ et https://ok.example.com:99999/."),
      "## Perimetre et criteres de succes\n\nVide.\n## Recommandation\n\n",
      complet("1. Seule", "Rien.", "Version 1.2.3, `.skraft/us-1/x.md`, `fichier.md`, `../hors.ts`."),
    ];
    let motifs = 0;
    for (const md of docs) {
      writeFileSync(join(dir, "research.md"), md);
      const lignes = (p: string) => {
        if (p.split("/").includes("..") || !existsSync(join(dir, p))) return null;
        return readFileSync(join(dir, p), "utf8").replace(/\n$/, "").split("\n").length;
      };
      const ts = checkResearch(md, { lineCount: lignes });
      const py = script("verifier_recherche.py", { document: "research.md" }, dir);
      expect(py.motifs).toEqual(ts.reasons);
      expect(py.sorties["questions-ouvertes"]).toEqual(ts.openQuestions);
      motifs += ts.reasons.length;
    }
    expect(motifs).toBeGreaterThan(10); // les cas d'essai rejettent vraiment : la parité n'est pas vide
  });

  it("verifier_conception ↔ checkDesign", () => {
    const adr = (n: number, over: Obj = {}) =>
      renderAdr(n, { title: `Décision ${n}`, status: "Proposed", context: "c", decision: "d", consequences: "q", alternatives: "a", ...over } as never, "2026-09-23");
    const design = {
      ".skraft/us-1/design/event-model.md": "Commande `CapBolus` → événement `BolusCapped`.\n```\nTaux.AppliqueA(x)\n```",
      ".skraft/us-1/design/domain-model.md": "Agrégat `BolusCalculation`, objet-valeur `MaxBolus`.",
      ".skraft/us-1/design/contracts.md": "`CapBolus` produit `BolusCapped` ; `MaxBolus` est validé ; `AppliqueA` ; `Inconnu` aussi.",
      ".skraft/us-1/design/diagrams.md": "`BolusCalculation` émet `BolusCapped`.",
    };
    const cas: { fichiers: Obj; existants: string[]; supersessions?: string }[] = [
      { fichiers: { "docs/adr/adr-001-decision-1.md": adr(1), "docs/adr/adr-002-decision-2.md": adr(2) }, existants: ["docs/adr/adr-001-decision-1.md"] },
      {
        fichiers: {
          "docs/adr/adr-001-decision-1.md": adr(1),
          "docs/adr/adr-003-choix-accepted.md": adr(3, { status: "Accepted", title: "Éviter les singletons", supersedes: ["ADR-001"] }),
          "docs/adr/adr-004-sans-titre.md": "pas un ADR\n",
        },
        existants: ["docs/adr/adr-001-decision-1.md"],
        supersessions: "- ADR-004 remplace ADR-001\n",
      },
      { fichiers: { "docs/adr/adr-002-a.md": adr(2), "docs/adr/adr-005-b.md": adr(5), "docs/adr/adr-005-c.md": adr(5) }, existants: ["docs/adr/adr-002-a.md"] },
    ];
    let motifs = 0;
    for (const c of cas) {
      const fichiers = { ...design, ...c.fichiers, ...(c.supersessions ? { "docs/adr/supersessions.md": c.supersessions } : {}) };
      const dir = depot(fichiers);
      const docs = Object.fromEntries(Object.entries(design).map(([p, md]) => [p.split("/").at(-1)!, md]));
      const adrs = Object.keys(c.fichiers).sort().map((path) => ({ path, md: c.fichiers[path], isNew: !c.existants.includes(path) }));
      const ts = checkDesign({ docs, adrs, supersessions: c.supersessions ?? "", modifiedExistingAdrs: [] });
      const py = script("verifier_conception.py", { dossier: ".skraft/us-1/design", "adr-existants": c.existants }, dir);
      expect(py.motifs).toEqual(ts);
      motifs += ts.length;
    }
    expect(motifs).toBeGreaterThan(6);
  });

  it("verifier_gherkin ↔ checkGherkin ; verifier_valeurs ↔ checkValues", () => {
    const feature = [
      "# langue : fr",
      "@ac-1 @happy-path",
      "Scénario: dose sous le plafond",
      "  Étant donné un plafond de 10 U",
      "  Quand le calcul propose 6 U",
      "  Alors la dose proposée est 6 U",
      "",
      "@ac-2 @api",
      "Scenario: plafonné",
      "  Given un plafond de 10 U et un calcul à 12.5 U via POST /api/v1/doses",
      "  When le CalculDuPanier tourne",
      "  Quand la base de données répond",
      "  Then ça marche",
      "  Et la dose proposée est 10 U",
      "  Et l'alerte « Dose plafonnée à 10 U » s'affiche",
      "  Et a",
      "  Et b",
    ].join("\n");
    const test = "class BolusAcceptanceTests {\n  void Ac1_sous_plafond() { Assert(6, Calcule(10, 6)); }\n  void ac_2_plafonne() { Assert(10, Calcule(10, 12.5)); Assert(\"Dose plafonnée à 10 U\"); }\n}\n";
    const dir = depot({ "features/bolus.feature": feature, "tests/Acceptance/BolusAcceptanceTests.cs": test });
    const features = [{ path: "features/bolus.feature", content: feature }];
    expect(checkGherkin(features).length).toBeGreaterThan(4);
    expect(script("verifier_gherkin.py", { features: ["features/**/*.feature"] }, dir).motifs).toEqual(checkGherkin(features));

    const ts = parseStory(US12);
    if (!ts.ok) throw new Error();
    const criteres = script("lire_story.py", { texte: US12 }).sorties.criteres;
    const attendu = checkValues({ criteria: ts.story.criteria, features, acceptanceTests: [{ path: "tests/Acceptance/BolusAcceptanceTests.cs", content: test }] });
    const py = script("verifier_valeurs.py", { criteres, features: ["features/**/*.feature"], "tests-acceptance": ["tests/Acceptance/**/*.cs"] }, dir);
    expect(attendu.length).toBeGreaterThan(0);
    expect(py.motifs).toEqual(attendu);
  });

  it("verifier_rouge_acceptance ↔ checkAcceptanceRed", () => {
    const plan = "- @ac-3 non-régression, justification : déjà couvert par la v1\n";
    const jeux: AcceptanceResult[][] = [
      [],
      [{ id: "Tests.Bolus.Calcule", file: "t", status: "passed" }],
      [
        { id: "Tests.Ac1_sous_plafond", file: "t", status: "failed", failureKind: "assertion" },
        { id: "Tests.ac_2_plafonne", file: "t", status: "failed", failureKind: "other_error", message: "NullReference\nà la ligne 3" },
        { id: "Tests.ac-3", file: "t", status: "passed" },
        { id: "Tests.testAc4Plafond", file: "t", status: "passed" },
        { id: "Tests.ac5", file: "t", status: "skipped" },
      ],
    ];
    for (const resultats of jeux) {
      const ts = checkAcceptanceRed({ criteria: [], testPlan: plan, results: resultats });
      const dir = depot({ "test-plan.md": plan });
      const py = script("verifier_rouge_acceptance.py", { "plan-de-test": "test-plan.md", resultats }, dir);
      expect(py.motifs).toEqual(ts.reasons);
      expect(py.sorties["non-regressions"] ?? []).toEqual(ts.regressions);
    }
  });

  it("planifier_scenarios ↔ planScenarios", () => {
    const plan = "1. Commencer par @ac-3, puis ac-1.\n2. Voir AC-3 encore.";
    const ids = ["T.ac-1_a", "T.ac-2", "T.ac-3_x", "T.ac-1_b", "T.Bolus"];
    const resultats = ids.map((id) => ({ id, file: "f", status: id === "T.Bolus" ? "passed" : "failed", failureKind: "assertion" }));
    const dir = depot({ "impl-plan.md": plan });
    const py = script("planifier_scenarios.py", { plan: "impl-plan.md", resultats, "non-regressions": ["T.ac-2"] }, dir);
    const ts = planScenarios({ implPlan: plan, acceptanceTestIds: ids, regressions: ["T.ac-2"] });
    expect(py.sorties.scenarios).toEqual(ts.map((s) => ({ id: s.id, ac: s.ac, "test-acceptance": s.acceptanceTestId, role: s.role, statut: s.status })));
    const rouge = script("planifier_scenarios.py", { plan: "impl-plan.md", resultats: [...resultats, { id: "T.Bolus2", file: "f", status: "failed" }].filter((r) => r.id !== "T.Bolus") }, dir);
    expect(rouge.code).toBe(1);
  });

  it("contrat ↔ declaredIdentifiers, et refus d'une disparition", () => {
    const contrat = [
      "```",
      "public readonly record struct Taux",
      "{",
      "    public decimal Valeur { get; }",
      "    public static Taux De(decimal valeur); // lève ArgumentOutOfRangeException",
      "}",
      "public sealed class GrilleDePaliers { public Palier? PalierApplicable(Quantite quantite); }",
      "public Montant ATPayer => SommeDesArticles.Soustrait(Remise);",
      "```",
    ].join("\n");
    const code = "public readonly record struct Taux { public decimal Valeur { get; } public static Taux De(decimal v) => new(v); }\nclass GrilleDePaliers {}";
    const dir = depot({ "contracts.md": contrat, "src/Domaine/Taux.cs": code });
    const attendu = declaredIdentifiers(contrat).filter((id) => new RegExp(`\\b${id}\\b`).test(code));
    const releve = script("contrat.py", { contrat: "contracts.md", sources: ["src/**/*.cs"] }, dir);
    expect(releve.sorties.noms).toEqual(attendu);
    writeFileSync(join(dir, "src/Domaine/Taux.cs"), "class GrilleDePaliers {}");
    const apres = script("contrat.py", { contrat: "contracts.md", sources: ["src/**/*.cs"], reference: releve.sorties.noms }, dir);
    expect(apres.code).toBe(1);
    expect(apres.motifs.join()).toMatch(/Taux/);
  });

  it("appliquer_statuts_adr ↔ setAdrStatus ; un amendement n'écrit rien", () => {
    const md = renderAdr(2, { title: "Monnaie", status: "Proposed", context: "c", decision: "d", consequences: "q", alternatives: "a" }, "2026-10-04");
    const dir = depot({ "docs/adr/adr-002-monnaie.md": md });
    const element = { id: "ADR-002", path: "docs/adr/adr-002-monnaie.md" };
    const amende = script("appliquer_statuts_adr.py", { ratifications: [{ element, sortie: { choix: "demander-un-amendement", commentaire: "préciser l'arrondi" } }] }, dir);
    expect(amende.code).toBe(1);
    expect(readFileSync(join(dir, element.path), "utf8")).toBe(md);
    script("appliquer_statuts_adr.py", { ratifications: [{ element, sortie: { choix: "accepter" } }] }, dir);
    expect(readFileSync(join(dir, element.path), "utf8")).toBe(setAdrStatus(md, "Accepted"));
  });
});
