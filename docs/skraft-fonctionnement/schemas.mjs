// Définition des organigrammes du document, générés en deux variantes (pc, mobile).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { organigramme, legende } from "./diagrammes.mjs";

const ICI = new URL(".", import.meta.url).pathname;

const SCHEMAS = {
  pipeline: {
    titre: "Pipeline skraft, de la story au code livré",
    etapes: [
      { id: "init", type: "code", titre: "INIT : lecture de la story, précontrôle des tests", detail: "branche skraft/<slug>, dossiers .skraft/<slug>/" },
      { id: "cls", type: "agent", titre: "CLASSIFY : skraft-classifier propose un niveau", detail: "entrée : indicateurs et niveau de la grille" },
      { id: "conf", type: "humain", titre: "CONFIRM_DIFFICULTY : niveau confirmé", detail: "sauf mode --auto" },
      { id: "res", type: "etat", titre: "RESEARCH (sauf niveaux simple et medium)", detail: "agent skraft-researcher, porte citations, commit" },
      { id: "route", type: "humain", titre: "ROUTE : questions ouvertes", detail: "story et recherche ; répondre ou reporter" },
      { id: "des", type: "etat", titre: "DESIGN, puis RATIFICATION des ADR", detail: "architectes, porte cohérence, revue, architecte humain" },
      { id: "dis", type: "etat", titre: "DISTILL", detail: "skraft-acceptance, 4 portes, revue, gel des tests d'acceptance" },
      { id: "del", type: "etat", titre: "DELIVER", detail: "scénario par scénario en TDD, portes de fin, revue" },
      { id: "fin", type: "code", titre: "DONE : rapport final publié" },
    ],
    sorties: [
      { de: "init", type: "humain", titre: "Story invalide ou tests rouges : relancer ou abandonner" },
      { de: "des", type: "humain", titre: "Toute phase : escalade relancer, sauter, abandonner" },
    ],
  },
  phase: {
    titre: "Cycle commun d'une phase (RESEARCH, DESIGN, DISTILL)",
    etapes: [
      { id: "cp", type: "code", titre: "Checkpoint de phase", detail: "point de retour pour une escalade" },
      { id: "brief", type: "code", titre: "Dossier de passation construit par le code", detail: "story, phases faites, ADR décidés, réponses, rejet précédent" },
      { id: "agent", type: "agent", titre: "Spécialiste de la phase : un tour, session neuve", detail: "écrit ses livrables, rend report_phase" },
      { id: "porte", type: "code", titre: "Porte de la phase", detail: "contrôles déterministes sur les fichiers et les tests" },
      { id: "revue", type: "agent", titre: "Revue : lentilles en parallèle", detail: "chacune rend submit_lens_verdict ; RESEARCH n'a pas de revue" },
      { id: "synth", type: "code", titre: "Synthèse du verdict par le code" },
      { id: "commit", type: "code", titre: "Commit de la phase", detail: "rapports de revue écrits avant" },
    ],
    boucles: [
      { de: "porte", vers: "agent", libelle: "rejet : relance ciblée avec le motif" },
      { de: "synth", vers: "agent", libelle: "changements demandés : réessai" },
    ],
    sorties: [
      { de: "porte", type: "humain", titre: "Budget épuisé : rembobinage, escalade" },
      { de: "synth", type: "humain", titre: "REJECTED : escalade" },
    ],
  },
  research: {
    titre: "RESEARCH",
    etapes: [
      { id: "pre", type: "code", titre: "Présélection de 20 fichiers au plus", detail: "mots de la story, score sur les chemins" },
      { id: "ag", type: "agent", titre: "skraft-researcher écrit research.md", detail: "8 sections exigées" },
      { id: "porte", type: "code", titre: "Porte citations", detail: "sections, fichiers et plages cités, URL, une seule recommandation, inventaire de l'existant vérifié" },
      { id: "q", type: "code", titre: "Extraction des questions ouvertes", detail: "section Passage de relais" },
      { id: "commit", type: "code", titre: "Commit : docs(skraft): research de <slug>", detail: "pas de revue par lentilles" },
    ],
    boucles: [{ de: "porte", vers: "ag", libelle: "rejet : motif exact, relance" }],
    sorties: [{ de: "porte", type: "humain", titre: "Budget épuisé : escalade" }],
  },
  design: {
    titre: "DESIGN et RATIFICATION",
    etapes: [
      { id: "model", type: "agent", titre: "skraft-architect-model", detail: "event-model, domain-model, context-map" },
      { id: "decide", type: "agent", titre: "skraft-architect-decide", detail: "contracts, diagrams ; ADR via render_adr" },
      { id: "porte", type: "code", titre: "Porte cohérence", detail: "event-model présent, noms cités définis, commande → événement, contextes classés, contrats complets, matrice de cohérence, engagements ratifiés, ADR bien formés, append-only" },
      { id: "revue", type: "agent", titre: "Revue (sans quality-gates)", detail: "cold-reader, test-integrity, architecture" },
      { id: "rat", type: "humain", titre: "Ratification, une demande par ADR", detail: "architecte : accepter, rejeter, amender" },
      { id: "commit", type: "code", titre: "Commit : docs(skraft): design de <slug>" },
    ],
    boucles: [
      { de: "porte", vers: "model", libelle: "rejet : les deux architectes rejoués" },
      { de: "rat", vers: "decide", libelle: "amendement : decide seul, sans essai consommé" },
    ],
    sorties: [{ de: "revue", type: "humain", titre: "REJECTED ou budget épuisé : escalade" }],
  },
  distill: {
    titre: "DISTILL",
    etapes: [
      { id: "ag", type: "agent", titre: "skraft-acceptance", detail: "Gherkin @ac-N, test-plan, impl-plan, tests d'acceptance" },
      { id: "g", type: "code", titre: "Porte gherkin", detail: "pas de détail technique, une seule action, assertions précises" },
      { id: "v", type: "code", titre: "Porte valeurs", detail: "chaque valeur des critères recopiée" },
      { id: "p", type: "code", titre: "Porte plan de test", detail: "matrice couche et doublure, un walking skeleton, une étape par critère avec son test" },
      { id: "r", type: "code", titre: "Porte RED d'acceptance", detail: "le code lance la suite : chaque test rouge pour une bonne raison" },
      { id: "h", type: "code", titre: "Empreinte des tests d'acceptance prise" },
      { id: "revue", type: "agent", titre: "Revue par lentilles" },
      { id: "commit", type: "code", titre: "Commit : le gel devient définitif" },
    ],
    boucles: [{ de: "r", vers: "ag", libelle: "rejet d'une porte : motif, empreinte effacée" }],
    sorties: [{ de: "revue", type: "humain", titre: "REJECTED ou budget épuisé : escalade" }],
  },
  deliverPlan: {
    titre: "DELIVER : planification et scénarios",
    etapes: [
      { id: "gel", type: "code", titre: "Vérification du gel et de la suite", detail: "empreinte inchangée, tests existants verts" },
      { id: "plan", type: "code", titre: "Plan des scénarios", detail: "ordre de impl-plan.md, un scénario par test d'acceptance" },
      { id: "sc", type: "code", titre: "Scénario suivant : checkpoint", detail: "déjà vert : directement sa porte de fin" },
      { id: "tdd", type: "etat", titre: "Boucle TDD du scénario", detail: "pas test, puis pas de code : voir « La boucle TDD »" },
      { id: "ps", type: "code", titre: "Porte de fin de scénario" },
      { id: "fin", type: "code", titre: "Portes de fin de DELIVER", detail: "livrables, suite finale, couverture, mutation" },
      { id: "revue", type: "agent", titre: "Revue par lentilles" },
      { id: "commit", type: "code", titre: "Commit : feat(<slug>): livraison de la story" },
    ],
    boucles: [
      { de: "ps", vers: "sc", libelle: "scénario suivant" },
      { de: "ps", vers: "tdd", libelle: "échec : scénario repris" },
    ],
    sorties: [
      { de: "gel", type: "humain", titre: "Gel rompu ou suite rouge : panne, escalade" },
      { de: "fin", type: "etat", titre: "Échec : correction ciblée" },
    ],
  },
  tdd: {
    titre: "Boucle TDD d'un scénario",
    etapes: [
      { id: "test", type: "agent", titre: "Pas test : skraft-test", detail: "un nouveau test unitaire rouge, ou coveredBy" },
      { id: "red", type: "code", titre: "Porte RED", detail: "un seul nouveau test, rouge pour une bonne raison, ajouts seulement" },
      { id: "dev", type: "agent", titre: "Pas vert : skraft-dev", detail: "le code minimal ; en sessions séparées, puis nettoyage" },
      { id: "green", type: "code", titre: "Porte GREEN (puis REFACTOR)", detail: "tests gelés, production modifiée, suite verte" },
      { id: "acc", type: "code", titre: "Acceptance du scénario verte ?", detail: "sinon nouveau cycle, 20 au plus" },
    ],
    boucles: [
      { de: "red", vers: "test", libelle: "pas refusé : retour au point sûr" },
      { de: "green", vers: "dev", libelle: "pas refusé : retour au point sûr" },
      { de: "acc", vers: "test", libelle: "rouge : cycle suivant" },
    ],
    sorties: [{ de: "acc", type: "etat", titre: "Verte : porte de fin de scénario" }],
  },
  correction: {
    titre: "Correction ciblée (revue ou portes de fin)",
    etapes: [
      { id: "fils", type: "code", titre: "Défauts en fils, numérotés par le code", detail: "cible test ou code ; un essai consommé" },
      { id: "rb", type: "code", titre: "Retour au dernier vert" },
      { id: "ft", type: "agent", titre: "fix-test : skraft-test", detail: "ajoute un test, ou conteste, ou renvoie" },
      { id: "arb", type: "agent", titre: "Mutants contestés : skraft-mutation-arbiter" },
      { id: "hum", type: "humain", titre: "Humain : mutants refusés, couverture contestée" },
      { id: "fix", type: "agent", titre: "fix : skraft-dev", detail: "corrige, ou conteste chaque défaut" },
      { id: "ps", type: "code", titre: "Porte de fin de scénario, puis revue" },
    ],
    boucles: [{ de: "ps", vers: "ft", libelle: "échec : correction reprise depuis son entrée" }],
  },
  revue: {
    titre: "Revue par lentilles",
    etapes: [
      { id: "faits", type: "code", titre: "Dossier de chaque lentille", detail: "fichiers de la phase, faits mesurés, historique de ses défauts" },
      { id: "lent", type: "agent", titre: "Lentilles en parallèle, sessions neuves", detail: "verdict, défauts, arbitrages" },
      { id: "num", type: "code", titre: "Numérotation et routage des défauts" },
      { id: "synth", type: "code", titre: "Synthèse du verdict", detail: "questions pondérées ; une question sans lentille interdit l'approbation" },
      { id: "issue", type: "code", titre: "Issue : approuver, corriger, escalader" },
    ],
    sorties: [
      { de: "lent", type: "humain", titre: "Question d'une lentille : réponse de l'humain" },
      { de: "num", type: "humain", titre: "Désaccord persistant : arbitrage humain" },
    ],
  },
  flux: {
    titre: "Données transmises d'une étape à l'autre",
    etapes: [
      { id: "story", type: "donnee", titre: "Story : critères, questions ouvertes" },
      { id: "res", type: "donnee", titre: "research.md, nouvelles questions" },
      { id: "rep", type: "donnee", titre: "Réponses de l'humain" },
      { id: "des", type: "donnee", titre: "Modèle, contrats, ADR décidés" },
      { id: "dis", type: "donnee", titre: "Gherkin, tests d'acceptance, plans, empreinte, régressions" },
      { id: "del", type: "donnee", titre: "Code, tests unitaires, dérogations, rapport final" },
    ],
  },
};

for (const variante of ["pc", "mobile"]) {
  const dossier = join(ICI, "schemas", variante);
  mkdirSync(dossier, { recursive: true });
  for (const [nom, def] of Object.entries(SCHEMAS)) writeFileSync(join(dossier, `${nom}.svg`), organigramme(def, { compact: variante === "mobile" }));
  writeFileSync(join(dossier, "legende.svg"), legende());
}
console.log(Object.keys(SCHEMAS).length, "schémas");
