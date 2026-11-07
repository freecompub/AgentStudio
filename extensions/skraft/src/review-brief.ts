/**
 * Dossiers des lentilles (SPEC-skraft §9.1, §9.2), construits par le code. Pur.
 * - Faits établis : présentés comme acquis, les lentilles ne les revérifient pas.
 * - `cold-reader` ne reçoit aucun contexte du producteur ; `test-integrity` reçoit critères, tests,
 *   code et faits ; `architecture` reçoit les ADR ratifiés, le code, les tests et les faits.
 */
import { precisions } from "./review-thread.js";
import type { Evidence } from "@agent-studio/extension-api";
import type { LensName } from "./difficulty.js";
import type { ArtifactRecord, Phase, SkraftState } from "./model.js";
import type { LensDefect } from "./review.js";

const short = (h: string) => h.slice(0, 12);

/**
 * Livrables du dernier essai validé : la liste de l'état est en ajout seul (invariant 4), mais un
 * rollback de réessai efface les fichiers des essais précédents. Dernière empreinte par chemin.
 */
/** Livrables du run en cours de la phase : ceux d'un run effacé par un rembobinage sont ignorés (D6 de docs/12). */
export function artifactsDuRun(state: SkraftState, phase: Phase): ArtifactRecord[] {
  return state.artifacts[phase].slice(state.debutDuRun?.[phase] ?? 0);
}

export function latestArtifacts(records: ArtifactRecord[]): ArtifactRecord[] {
  const last = Math.max(0, ...records.map((a) => a.attempt));
  const byPath = new Map<string, ArtifactRecord>();
  for (const a of records) if (a.attempt === last) byPath.set(a.path, a);
  return [...byPath.values()];
}

export function reviewFacts(state: SkraftState, phase: Phase, evidence: Evidence[]): string[] {
  const facts: string[] = [];
  for (const a of latestArtifacts(artifactsDuRun(state, phase))) facts.push(`Livrable ${a.path} : porte de ${phase} validée à l'essai ${a.attempt} (sha256 ${short(a.sha256)}).`);
  if ((phase === "DISTILL" || phase === "DELIVER") && state.acceptanceHash)
    facts.push(
      // Le gel n'est définitif qu'au commit de DISTILL : la revue peut encore faire corriger un test (D1 de docs/12).
      phase === "DELIVER"
        ? `Tests d'acceptance gelés, empreinte ${short(state.acceptanceHash)}, vérifiée inchangée à chaque pas de DELIVER.`
        : `Empreinte des tests d'acceptance prise (${short(state.acceptanceHash)}) : le gel devient définitif au commit de DISTILL.`,
    );
  for (const r of state.regressions) facts.push(`Test d'acceptance requalifié en non-régression, avec justification dans test-plan.md : ${r}.`);
  if (phase === "DELIVER")
    for (const x of state.derogations ?? [])
      facts.push(`Dérogation de mutation (${x.par}) : ${x.file}:${x.line} (${x.operator}) — ${x.raison}. Mutant exempté de la porte de mutation après arbitrage.`);
  if (phase === "DELIVER")
    for (const x of state.derogationsCouverture ?? []) facts.push(`Ligne exemptée de la couverture du diff (humain) : ${x.file}:${x.line} — ${x.raison}.`);
  if (phase === "DELIVER")
    for (const x of state.ecartsAuPlan ?? [])
      facts.push(`Écart au plan déclaré par ${x.par} (scénario ${x.scenario}, critère ${x.criterion}) : prévu ${x.planned} → ${x.actual} — règle : ${x.rule}. Vérifié contre la matrice du plan de test ; à juger sur sa règle.`);
  const last = evidence.filter((e) => e.source === "gate" && e.phase?.startsWith(phase)).at(-1);
  if (last)
    facts.push(
      `Dernière exécution des tests par le code (${last.phase}) : ${last.counts.passed} réussi(s), ${last.counts.failed} en échec, ${last.counts.skipped} ignoré(s)${last.timedOut ? ", délai dépassé" : ""}.`,
    );
  if (phase === "DELIVER" && state.deliver) {
    for (const sc of state.deliver.scenarios.filter((x) => x.status === "done")) {
      if (sc.role === "regression") facts.push(`Scénario ${sc.id} : non-régression, vert dès DISTILL (${sc.acceptanceTestId}).`);
      else
        facts.push(
          `Scénario ${sc.id} : test d'acceptance vert (${sc.acceptanceTestId}) ; tests unitaires ajoutés, chacun rouge puis vert dans les preuves : ${sc.unitTests?.length ? sc.unitTests.join(", ") : "aucun"}.`,
        );
    }
    facts.push(...(state.deliver.facts ?? []));
    facts.push(...state.deliver.notes.map((n) => `À noter : ${n}`));
  }
  return facts;
}

export interface LensFiles {
  /** Livrables de la phase (documents, ADR, scénarios). */
  artifacts: string[];
  /** Fichiers de production modifiés pendant la phase. */
  code: string[];
  /** Fichiers de test modifiés pendant la phase. */
  tests: string[];
}

/**
 * Consignes de phase (option A de docs/15 §4.5) : en DESIGN et en DISTILL, les lentilles jugent des
 * documents, pas du code. Repris des lentilles internes des relecteurs de skraft-plugin v1.6.1
 * (`solution-architect-reviewer`, `acceptance-designer-reviewer`), pour la part qui demande un
 * jugement ; ce qui se vérifie mécaniquement est dans les portes (`design.ts`, `distill.ts`).
 * Entre parenthèses dans les commentaires : la porte d'origine.
 */
const CONSIGNES_DE_PHASE: Partial<Record<Phase, Partial<Record<LensName, string[]>>>> = {
  DESIGN: {
    "cold-reader": [
      "Le vocabulaire du modèle (commandes, événements, agrégats) est celui de la story : une personne du métier s'y retrouve sans connaître le code.",
    ],
    "test-integrity": [
      // G7
      "Chaque critère d'acceptation a son déclencheur dans event-model.md : une commande s'il change l'état, une requête s'il ne fait que lire.",
      "Chaque résultat attendu par un critère est observable dans le modèle (événement ou vue) : on pourra l'écrire en test d'acceptance.",
      // Phase 4 de solution-architect
      "Chaque déclencheur forme une tranche verticale : le déclencheur, l'événement qu'il produit, la vue que lit l'utilisateur.",
    ],
    architecture: [
      // G1
      "Chaque engagement structurel visible dans les diagrammes (agrégat, contexte, CQRS, Event Sourcing, saga, couche anticorruption) est justifié par un ADR.",
      // G3, G4 ; couche des dépôts selon solution-architect, phase 6 (le relecteur, G4, ne cite que
      // l'application : le plugin se contredit, l'architecte fait foi)
      "Les interfaces de dépôt et de passerelle sont déclarées dans le domaine ou dans l'application, jamais dans l'infrastructure, et l'ADR de l'agrégat justifie ce choix ; domaine et application ne dépendent ni de l'infrastructure ni de l'API.",
      // G5
      "Chaque agrégat garantit ses propres invariants ; il n'en référence un autre que par son identifiant.",
      // Phase 3 de solution-architect
      "Les agrégats, contextes et cas d'usage existants relevés par la recherche sont réutilisés ou étendus, pas dupliqués.",
      // Phase 7 : déclencheurs obligatoires d'ADR (le code ne vérifie que l'existant et la couche anticorruption)
      "Chaque déclencheur obligatoire d'ADR présent dans la conception a son ADR : CQRS avec bus, Event Sourcing, saga, agrégat qui franchit une frontière existante, découpage ou fusion de contextes, couche anticorruption, changement transverse (erreurs, validation, transactions).",
      // STRUCTURAL_DRIFT, sens « document → ADR » (le sens « ADR → modèle » est vérifié par le code)
      "Chaque agrégat introduit par les documents (modèle, contrats, diagrammes) est nommé par un ADR, nouveau ou existant, qui le justifie ; un dépôt, en tant que tel, n'en demande pas.",
      // G9, G11
      "Aucun agrégat, contexte ou patron sans critère de la story qui le justifie ; un patron coûteux cite une force mesurée et évalue l'option « sans le patron ».",
      // G15
      "Aucun ADR ne ratifie une règle que le projet impose déjà (linter, test d'architecture, convention).",
    ],
  },
  DISTILL: {
    "cold-reader": [
      // G3
      "Chaque scénario se lit par une personne du métier, sans connaissance technique.",
    ],
    "test-integrity": [
      // G2
      "Chaque cas limite ou négatif tranché par les critères a son scénario.",
      // G5
      "Chaque étape est non ambiguë et implémentable telle quelle.",
      "Chaque test d'acceptance vérifie le résultat métier de son scénario, pas un détail d'implémentation.",
    ],
    architecture: [
      // G7
      "Chaque scénario entre par le cas d'usage de la couche Application nommé dans contracts.md.",
      // G11
      "Le plan de test place chaque scénario à la bonne couche ; un cas d'usage nouveau est testé au niveau Application, pas seulement de bout en bout.",
    ],
  },
  DELIVER: {
    "test-integrity": [
      // docs/15 §4.7 : la matrice de couverture de DISTILL fait foi pour la couche et la doublure
      "Chaque test respecte la couche et la doublure que la matrice de .skraft/<slug>/distill/test-plan.md prévoit pour son critère ; un écart non déclaré est un défaut, un écart déclaré dans les faits se juge sur sa règle.",
    ],
    // ADR 0067 : un critère sans test fidèle à sa ligne, sauf écart déclaré (quality-gates-lens du plugin, v1.15.1)
    "quality-gates": ["Chaque critère de la matrice du plan de test a au moins un test qui respecte sa ligne, sauf écart déclaré dans les faits."],
  },
};

const list = (title: string, xs: string[]) => (xs.length ? [title, ...xs.map((x) => `  - ${x}`)] : []);

export function lensBrief(lens: LensName, state: SkraftState, phase: Phase, files: LensFiles, facts: string[], history: string[] = []): string {
  const lines = [`Revue de la phase ${phase}.`, ...history];
  const factBlock = list("Faits établis par le code (acquis : ne les revérifie pas) :", facts);
  switch (lens) {
    case "cold-reader":
      lines.push(
        "Tu n'as aucun contexte du producteur : juge uniquement ce que disent les fichiers ci-dessous.",
        ...list("Livrables :", files.artifacts),
        ...list("Code :", files.code),
        ...list("Tests :", files.tests),
      );
      break;
    case "test-integrity": {
      const criteria = state.story?.criteria.map((c) => `${c.n}. ${c.text}`) ?? [];
      // Le code de production aussi : un test miroir du code ne se voit qu'en lisant les deux (4.1 de docs/15).
      lines.push(...list("Critères d'acceptation :", criteria), ...list("Tests :", files.tests), ...list("Code :", files.code), ...list("Livrables :", files.artifacts), ...factBlock);
      break;
    }
    case "architecture": {
      const adrs = state.adrs.filter((a) => a.status === "Accepted").map((a) => `${a.id} : ${a.path}`);
      // Les tests aussi : une doublure dans le domaine se voit dans les tests (4.2 de docs/15).
      lines.push(...list("ADR ratifiés :", adrs), ...list("Code :", files.code), ...list("Tests :", files.tests), ...list("Livrables :", files.artifacts), ...factBlock);
      break;
    }
    case "quality-gates":
      // Observatrice : elle ne reçoit ni code ni tests, seulement les faits et les livrables.
      // Lui donner le code l'inviterait à rejuger ce que les portes ont déjà mesuré.
      lines.push("Tu n'exécutes rien.");
      if (facts.length)
        lines.push("Les faits ci-dessous sont établis par le code et font foi : vérifie que les livrables leur sont fidèles, et signale ce qu'ils passent sous silence.", ...factBlock);
      // Filet (ADR 0028) : une stack sans outil de couverture, un DISTILL sans exécution de tests.
      // Sans cette phrase, la lentille cherche de la matière ailleurs et invente un grief hors de
      // son mandat — c'est ce qui a fait tourner DESIGN en rond le 28/09.
      else
        lines.push(
          "**Aucune mesure n'existe à ce stade de la tâche** : ni test exécuté, ni couverture, ni mutation, ni lint.",
          "Un écart que tu ne peux confronter à aucune mesure n'est pas de ton ressort — n'invente pas de défaut pour avoir quelque chose à dire.",
          "Il te reste une chose à chercher, et une seule : un livrable qui **se prévaut** d'une qualité que rien n'a mesurée. S'il n'y en a pas, approuve sans défaut.",
        );
      lines.push(...list("Livrables :", files.artifacts));
      break;
  }
  lines.push(...list(`Points à examiner en ${phase} :`, (CONSIGNES_DE_PHASE[phase]?.[lens] ?? []).map((x) => x.replace("<slug>", state.slug ?? "<slug>"))));
  return lines.join("\n");
}

/**
 * Dossier du réfutateur (ADR 0069) : les défauts à juger, numérotés par le code, puis les **mêmes
 * entrées** que la lentille qui les a signalés — ni plus, ni moins, et sans ses consignes.
 */
export function refuterBrief(lens: LensName, state: SkraftState, phase: Phase, files: LensFiles, facts: string[], defects: LensDefect[]): string {
  const ou = (d: LensDefect) => (d.file ? ` (${d.file}${d.line ? `:${d.line}` : ""})` : "");
  const lines = [
    ...list(`Défauts signalés par la lentille « ${lens} » en revue de la phase ${phase} :`, defects.map((d) => `[${d.id}] (${d.severity}) ${d.description}${ou(d)}${precisions(d)}`)),
    "Entrées de la lentille :",
  ];
  const faits = list("Faits établis par le code :", facts);
  const criteria = state.story?.criteria.map((c) => `${c.n}. ${c.text}`) ?? [];
  const adrs = state.adrs.filter((a) => a.status === "Accepted").map((a) => `${a.id} : ${a.path}`);
  switch (lens) {
    case "cold-reader":
      lines.push(...list("Livrables :", files.artifacts), ...list("Code :", files.code), ...list("Tests :", files.tests));
      break;
    case "test-integrity":
      lines.push(...list("Critères d'acceptation :", criteria), ...list("Tests :", files.tests), ...list("Code :", files.code), ...list("Livrables :", files.artifacts), ...faits);
      break;
    case "architecture":
      lines.push(...list("ADR ratifiés :", adrs), ...list("Code :", files.code), ...list("Tests :", files.tests), ...list("Livrables :", files.artifacts), ...faits);
      break;
    case "quality-gates":
      lines.push(...faits, ...list("Livrables :", files.artifacts));
      break;
  }
  return lines.join("\n");
}
