// Converti en JavaScript le 2026-10-10 depuis extensions/skraft-workflow/src/workflow.ts (ADR 0055).
/**
 * skraft en workflow (ADR 0055) : la description qui suit est lue par la plateforme SANS exécuter
 * ce fichier ; elle doit rester une valeur littérale (ni variable, ni appel, ni calcul). C'est
 * aussi ce que l'utilisateur voit avant de donner son accord.
 */
export const meta = {
  name: "skraft-workflow",
  description: "Livre une user story : recherche, conception avec ADR, scénarios d'acceptance, TDD, revues.",
  commande: "skraft-workflow",
  entrees: {
    story: { type: "fichier", obligatoire: true, aide: "La user story (« # US-2 — Titre », critères numérotés)." },
    auto: { type: "booleen", defaut: false, aide: "Retenir la difficulté proposée sans la faire confirmer." },
    archi: { type: "texte", aide: "Skill d'architecture du projet, par son nom ou son langage (--archi java) ; sans elle, ou inconnue, la clean architecture par défaut." },
  },
  phases: {
    "DÉBUT": "Préparation et difficulté",
    INIT: "Lecture de la story",
    CLASSIFY: "Évaluation de la difficulté",
    CONFIRM_DIFFICULTY: "Difficulté à confirmer",
    ROUTE: "Questions ouvertes",
    REVIEW: "Revue",
    ARBITRATION: "Arbitrage à rendre",
    RATIFICATION: "ADR à ratifier",
    BLOCKED: "Question d'un agent",
    ESCALATED: "Escalade",
    DONE: "Terminé",
    LECONS: "Leçons tirées des erreurs",
    RESEARCH: "Enquête sur le code existant",
    DESIGN: "Conception",
    DISTILL: "Scénarios d'acceptance",
    DELIVER: "Implémentation en TDD",
  },
  // Tout ce que le script et ses agents peuvent écrire. `revert` : les phases rembobinent à l'escalade.
  permissions: {
    ecriture: [".skraft/**", "docs/adr/**", "docs/adr/adr-???-*.md", "docs/adr/supersessions.md", ".agent-studio/lecons/**", "@stack:acceptanceTests", "@stack:unitTests", "@stack:sources"],
    tests: true,
    git: ["branche", "commit", "revert"],
  },
  // Outils apportés aux agents (ADR 0082) : la porte que le code rejoue, consultable pendant le tour.
  outils: {
    verifier_recherche: { description: "Vérifie ta recherche avec la porte des citations du code : sections, fichiers cités et plages de lignes, existant réutilisable. Sans argument : le code lit lui-même ton document." },
    verifier_scenarios: { description: "Vérifie tes scénarios, ton plan de test et tes tests d'acceptance avec les portes du code (gherkin, valeurs, plan de test). Sans argument : le code lit lui-même tes fichiers." },
  },
  agents: {
    "skraft-lecons": {
      prompt: "agents/skraft-lecons.agent.md",
      consignes: "Le dossier de passation, construit par l'orchestrateur, donne les groupes d'erreurs à classer et les catalogues avec leurs sections. Rends une leçon par groupe avec l'outil submit_lecons ; le code vérifie chaque référence de catalogue, chaque source et l'exemple.",
      classe: "light",
      sortie: "submit_lecons",
    },
    "skraft-classifier": {
      prompt: "agents/skraft-classifier.agent.md",
      consignes: "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.\nRends le niveau et sa justification avec l'outil submit_difficulty.",
      classe: "light",
      sortie: "submit_difficulty",
    },
    "skraft-researcher": {
      prompt: "agents/skraft-researcher.agent.md",
      consignes: "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.\nAvant de rendre ton travail, appelle `verifier_recherche` : il rend ce que la porte des citations dirait de ton document, avec les mêmes règles que le code appliquera après ton tour. Corrige chaque motif, puis vérifie de nouveau.",
      classe: "standard",
      sortie: "report_phase",
      ecriture: [".skraft/**"],
      outils: ["list_files", "verifier_recherche", "report_blocker"],
    },
    "skraft-architect-model": {
      prompt: "agents/skraft-architect-model.agent.md",
      consignes: "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.",
      classe: "strong",
      reasoningEffort: "high",
      contextTier: "long_context",
      sortie: "report_phase",
      ecriture: [".skraft/**"],
      outils: ["list_files", "report_blocker"],
      skills: { obligatoires: ["architecture-patterns"], aLaDemande: ["architecture-decisions", "clean-architecture-dotnet", "clean-architecture-java", "clean-architecture-python", "clean-architecture-react"] },
    },
    "skraft-architect-decide": {
      prompt: "agents/skraft-architect-decide.agent.md",
      consignes: "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.\nRédige chaque ADR dans docs/adr/, un fichier par décision, nommé adr-NNN-titre.md (NNN : le numéro que te donne le dossier de passation, sur trois chiffres ; titre en minuscules, mots séparés par des tirets), avec ce gabarit :\n# ADR-NNN — Titre\n\n- Statut : Proposed\n- Date : AAAA-MM-JJ\n\n## Contexte\n\n…\n\n## Décision\n\n…\n\n## Conséquences\n\n…\n\n## Alternatives\n\n…\nS'il en remplace un autre, ajoute « - Remplace : ADR-NNN » sous la date, et la ligne « - ADR-XXX remplace ADR-NNN » dans docs/adr/supersessions.md.\nPour amender un ADR que tu as proposé pour cette story, modifie son fichier. Ne modifie jamais un ADR décidé ni celui d'une autre story, et ne touche pas à la ligne « Story », que l'orchestrateur ajoute lui-même.\nLe modèle (event-model.md, domain-model.md, context-map.md) est écrit par le modélisateur : tu ne peux pas l'écrire. S'il lui manque un nom ou s'il a un défaut, décris-le dans le champ `modelDefects` de report_phase, une remarque par défaut : l'orchestrateur relance le modélisateur avec tes remarques, puis te relance sur le modèle corrigé.",
      classe: "strong",
      reasoningEffort: "high",
      contextTier: "long_context",
      sortie: "report_phase",
      // Le nom d'un ADR est vérifié dès l'écriture : un fichier mal nommé, que l'architecte ne
      // pourrait pas supprimer, n'existe jamais (11/11).
      ecriture: [".skraft/**", "docs/adr/adr-???-*.md", "docs/adr/supersessions.md"],
      outils: ["list_files", "report_blocker"],
      skills: { obligatoires: ["architecture-decisions", "adr-eligibility-gate"], aLaDemande: ["architecture-patterns", "clean-architecture-dotnet", "clean-architecture-java", "clean-architecture-python", "clean-architecture-react"] },
    },
    "skraft-acceptance": {
      prompt: "agents/skraft-acceptance.agent.md",
      consignes: "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.\nLes skills décrivent aussi des étapes que l'orchestrateur exécute lui-même (commits, portes, mutation) : ne les fais pas.\nPour la forme du code, le linter du projet fait foi : en cas d'écart avec les seuils d'une skill (Object Calisthenics), suis le linter.\nL'emplacement des tests d'acceptance du projet est indiqué dans le dossier de passation. Le code vérifie ensuite chaque valeur\nrecopiée et la raison de chaque rouge : un écart est rejeté avec son motif.\nAvant de rendre ton travail, appelle `verifier_scenarios` : il rend ce que les portes gherkin, valeurs et plan de test diraient de tes fichiers, avec les mêmes règles que le code appliquera après ton tour. Corrige chaque motif, puis vérifie de nouveau.",
      classe: "standard",
      sortie: "report_phase",
      ecriture: [".skraft/**", "@stack:acceptanceTests", "@stack:sources"],
      outils: ["list_files", "run_tests", "verifier_scenarios", "report_blocker"],
      skills: { obligatoires: ["bdd-methodology", "test-design-mandates"], aLaDemande: ["outside-in-tdd", "craft-discipline", "clean-architecture-testing", "bdd-step-definitions"] },
    },
    "skraft-test": {
      prompt: "agents/skraft-test.agent.md",
      consignes: "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.\nLes skills décrivent aussi des étapes que l'orchestrateur exécute lui-même (commits, portes, mutation) : ne les fais pas.\nPour la forme du code, le linter du projet fait foi : en cas d'écart avec les seuils d'une skill (Object Calisthenics), suis le linter.\nLe scénario en cours, son test d'acceptance et les tests déjà écrits sont dans le dossier de passation. Les tests d'acceptance\nsont gelés : toute écriture y est refusée.\nLe plan de test est `.skraft/<slug>/distill/test-plan.md`. Un écart à sa matrice se déclare dans le champ planDeviations de report_phase (ADR 0067) : le code le vérifie contre la matrice et refuse le pas s'il ne reprend pas la ligne du critère.",
      classe: "standard",
      sortie: "report_phase",
      ecriture: ["@stack:unitTests"],
      outils: ["list_files", "run_tests", "run_lint", "report_blocker"],
      skills: { obligatoires: ["test-design-mandates", "outside-in-tdd#RED"], aLaDemande: ["test-refactoring-catalog", "clean-architecture-testing", "clean-architecture-dotnet", "clean-architecture-java", "clean-architecture-python", "clean-architecture-react"] },
    },
    "skraft-dev": {
      prompt: "agents/skraft-dev.agent.md",
      consignes: "Le dossier de passation, construit par l'orchestrateur, donne la story, le dossier de travail (`.skraft/<slug>/`) et le résultat des phases précédentes.\nLes skills décrivent aussi des étapes que l'orchestrateur exécute lui-même (commits, portes, mutation) : ne les fais pas.\nPour la forme du code, le linter du projet fait foi : en cas d'écart avec les seuils d'une skill (Object Calisthenics), suis le linter.\nLe test à faire passer est indiqué dans le dossier de passation. Tous les tests sont gelés pendant ton tour : une modification,\nmême hors des outils d'écriture, est détectée par empreinte et annule le tour.\nLe plan de test est `.skraft/<slug>/distill/test-plan.md`. Un écart à sa matrice se déclare dans le champ planDeviations de report_phase (ADR 0067) : le code le vérifie contre la matrice et refuse le pas s'il ne reprend pas la ligne du critère.",
      classe: "standard",
      sortie: "report_phase",
      ecriture: ["@stack:sources"],
      outils: ["list_files", "run_tests", "run_lint", "report_blocker"],
      skills: { obligatoires: ["craft-discipline", "outside-in-tdd#SYNTHESIZE-GREEN"], aLaDemande: ["clean-architecture-testing", "test-refactoring-catalog", "clean-architecture-dotnet", "clean-architecture-java", "clean-architecture-python", "clean-architecture-react"] },
    },
    "skraft-mutation-arbiter": {
      prompt: "agents/skraft-mutation-arbiter.agent.md",
      consignes: "Rends ta décision avec l'outil submit_lens_verdict : lens « mutation-arbiter », verdict APPROVED, aucun défaut, et pour\nchaque défaut de mutation listé un arbitrage (rulings) : accepted si le mutant est équivalent, maintained sinon, avec ta raison.",
      classe: "standard",
      sortie: "submit_lens_verdict",
    },
    "skraft-finding-refuter": {
      prompt: "agents/skraft-finding-refuter.agent.md",
      consignes: "Rends ta décision avec l'outil submit_lens_verdict : lens « finding-refuter », verdict APPROVED, aucun défaut, et pour\nchaque défaut listé un arbitrage (rulings) : accepted s'il est réfuté, avec le passage `chemin:ligne` qui le montre dans ta raison ;\nmaintained sinon, avec ta raison.",
      classe: "strong",
      sortie: "submit_lens_verdict",
    },
    "skraft-lens-cold-reader": {
      prompt: "agents/skraft-lens-cold-reader.agent.md",
      consignes: "Tu fais partie d'une revue à plusieurs lentilles ; chacune travaille isolée et la synthèse est calculée par le code.\nRends ton verdict avec l'outil submit_lens_verdict.\nUn comportement vérifié par un test d'acceptance n'appelle pas de test unitaire qui le duplique : avant de signaler un test\nmanquant, cherche-le dans les tests d'acceptance du projet. S'il y est, ce n'est pas un défaut (choix du projet, ADR 0045).\nDonne à chaque défaut sa cible (target) : test, code ou deliverable. Un défaut, un seul sujet : scinde celui qui touche à la fois\nun test et le code. Pour chaque défaut, dis pourquoi il a cette gravité (severityReason, une phrase) ;\ns'il se répète ailleurs, donne les autres endroits (occurrences, chemin:ligne) au lieu d'un défaut par endroit. Un défaut sur une ligne que la phase n'a pas modifiée est noté pour l'humain,\nsans renvoyer le travail. Si le dossier liste tes défauts précédents contestés par l'agent, rends pour chacun un arbitrage (rulings) :\naccepted si sa raison te convainc, maintained sinon, avec ta raison ; ne les relance pas dans tes défauts.\nSi juger demande une décision métier que ni la story ni les réponses de l'utilisateur ne tranchent, pose la question avec\nreport_blocker au lieu de deviner. Une question déjà tranchée te sera renvoyée avec sa réponse.",
      classe: "standard",
      sortie: "submit_lens_verdict",
      outils: ["report_blocker"],
      skills: { aLaDemande: ["adversarial-review-lenses", "acceptance-review-criteria", "architecture-review-criteria"] },
    },
    "skraft-lens-test-integrity": {
      prompt: "agents/skraft-lens-test-integrity.agent.md",
      consignes: "Tu fais partie d'une revue à plusieurs lentilles ; chacune travaille isolée et la synthèse est calculée par le code.\nRends ton verdict avec l'outil submit_lens_verdict.\nUn comportement vérifié par un test d'acceptance n'appelle pas de test unitaire qui le duplique : avant de signaler un test\nmanquant, cherche-le dans les tests d'acceptance du projet. S'il y est, ce n'est pas un défaut (choix du projet, ADR 0045).\nDonne à chaque défaut sa cible (target) : test, code ou deliverable. Un défaut, un seul sujet : scinde celui qui touche à la fois\nun test et le code. Pour chaque défaut, dis pourquoi il a cette gravité (severityReason, une phrase) ;\ns'il se répète ailleurs, donne les autres endroits (occurrences, chemin:ligne) au lieu d'un défaut par endroit. Un défaut sur une ligne que la phase n'a pas modifiée est noté pour l'humain,\nsans renvoyer le travail. Si le dossier liste tes défauts précédents contestés par l'agent, rends pour chacun un arbitrage (rulings) :\naccepted si sa raison te convainc, maintained sinon, avec ta raison ; ne les relance pas dans tes défauts.\nSi juger demande une décision métier que ni la story ni les réponses de l'utilisateur ne tranchent, pose la question avec\nreport_blocker au lieu de deviner. Une question déjà tranchée te sera renvoyée avec sa réponse.",
      classe: "standard",
      sortie: "submit_lens_verdict",
      outils: ["report_blocker"],
      skills: { aLaDemande: ["adversarial-review-lenses", "acceptance-review-criteria", "architecture-review-criteria"] },
    },
    "skraft-lens-architecture": {
      prompt: "agents/skraft-lens-architecture.agent.md",
      consignes: "Tu fais partie d'une revue à plusieurs lentilles ; chacune travaille isolée et la synthèse est calculée par le code.\nRends ton verdict avec l'outil submit_lens_verdict.\nUn comportement vérifié par un test d'acceptance n'appelle pas de test unitaire qui le duplique : avant de signaler un test\nmanquant, cherche-le dans les tests d'acceptance du projet. S'il y est, ce n'est pas un défaut (choix du projet, ADR 0045).\nDonne à chaque défaut sa cible (target) : test, code ou deliverable. Un défaut, un seul sujet : scinde celui qui touche à la fois\nun test et le code. Pour chaque défaut, dis pourquoi il a cette gravité (severityReason, une phrase) ;\ns'il se répète ailleurs, donne les autres endroits (occurrences, chemin:ligne) au lieu d'un défaut par endroit. Un défaut sur une ligne que la phase n'a pas modifiée est noté pour l'humain,\nsans renvoyer le travail. Si le dossier liste tes défauts précédents contestés par l'agent, rends pour chacun un arbitrage (rulings) :\naccepted si sa raison te convainc, maintained sinon, avec ta raison ; ne les relance pas dans tes défauts.\nSi juger demande une décision métier que ni la story ni les réponses de l'utilisateur ne tranchent, pose la question avec\nreport_blocker au lieu de deviner. Une question déjà tranchée te sera renvoyée avec sa réponse.",
      classe: "standard",
      sortie: "submit_lens_verdict",
      outils: ["report_blocker"],
      skills: { aLaDemande: ["adversarial-review-lenses", "acceptance-review-criteria", "architecture-review-criteria"] },
    },
    "skraft-lens-quality-gates": {
      prompt: "agents/skraft-lens-quality-gates.agent.md",
      consignes: "Tu fais partie d'une revue à plusieurs lentilles ; chacune travaille isolée et la synthèse est calculée par le code.\nRends ton verdict avec l'outil submit_lens_verdict.\nUn comportement vérifié par un test d'acceptance n'appelle pas de test unitaire qui le duplique : avant de signaler un test\nmanquant, cherche-le dans les tests d'acceptance du projet. S'il y est, ce n'est pas un défaut (choix du projet, ADR 0045).\nDonne à chaque défaut sa cible (target) : test, code ou deliverable. Un défaut, un seul sujet : scinde celui qui touche à la fois\nun test et le code. Pour chaque défaut, dis pourquoi il a cette gravité (severityReason, une phrase) ;\ns'il se répète ailleurs, donne les autres endroits (occurrences, chemin:ligne) au lieu d'un défaut par endroit. Un défaut sur une ligne que la phase n'a pas modifiée est noté pour l'humain,\nsans renvoyer le travail. Si le dossier liste tes défauts précédents contestés par l'agent, rends pour chacun un arbitrage (rulings) :\naccepted si sa raison te convainc, maintained sinon, avec ta raison ; ne les relance pas dans tes défauts.\nSi juger demande une décision métier que ni la story ni les réponses de l'utilisateur ne tranchent, pose la question avec\nreport_blocker au lieu de deviner. Une question déjà tranchée te sera renvoyée avec sa réponse.",
      classe: "light",
      sortie: "submit_lens_verdict",
      outils: ["report_blocker"],
      skills: { aLaDemande: ["adversarial-review-lenses", "acceptance-review-criteria", "architecture-review-criteria"] },
    },
  },
};
/**
* skraft écrit en workflow rejouable (ADR 0052, `docs/09` §14 étape 4). Extension indépendante de
* `extensions/skraft` : elle n'en importe rien, et `/skraft` reste intacte.
*
* Commande `/skraft-workflow` : pour l'instant la préparation, la difficulté, RESEARCH, les
* questions ouvertes et DESIGN, puis arrêt avec le dossier de passation de DISTILL. Le comportement reproduit
* celui du réducteur de skraft. Si le script n'est pas nettement plus simple que la partie du
* réducteur qu'il remplace, on s'arrête là (ADR 0052, conséquences).
*/
import { essayer, PanneEnvironnement, Escalade, TourInterrompu, problemesTestsExistants, correspond, bddNonDeclare, estUnManifeste } from "@agent-studio/workflow";
import { buildBrief, ecrirePassation } from "./brief.mjs";
import { computeIndicators, DEFAULT_THRESHOLDS, gradeDifficulty, isDifficulty, levelEffects, shift } from "./difficulty.mjs";
import { preselectFiles } from "./preselect.mjs";
import { citesDansLaRecherche, extraireInventaire, motifsDeLaRecherche, verifierRecherche } from "./research.mjs";
import { skillDArchitecture } from "./architecture.mjs";
import { parseStory, slugOf } from "./story.mjs";
import { concevoir } from "./conception.mjs";
import { distiller, motifsDesScenarios, texteDeVerification } from "./distillation.mjs";
/**
* Outils apportés aux agents (ADR 0082) : fonctions pures, sur les fichiers que l'hôte a lus. La
* porte appelle le même calcul après le tour : l'agent est jugé comme il s'est vérifié.
*/
export const outils = {
  verifier_recherche: verifierRecherche,
  verifier_scenarios: ({ fichiers, donnees }) => texteDeVerification(motifsDesScenarios({ fichiers, ...donnees })),
};
import { livrer, barreDeQualite } from "./livraison.mjs";
import { checkCoverage } from "./deliver.mjs";
import { commitMessage, creerDossiers, GELÉS, LEVEL_LABELS, repositoryShape } from "./support.mjs";
import { ecrireLeRegistre, ligneDuRegistre, nouveauRegistre, ouvrirLeRegistre, suivreLesRefus } from "./registre.mjs";
import { chargerLaMemoire, leconsPour, ligneDesLecons, tirerLesLecons } from "./lecons.mjs";
import { noterLEtat, proposerLaReprise, releveDeDepart, restaurer } from "./reprise.mjs";
const RELANCER_OU_ABANDONNER = [
  { id: "relancer", label: "Relancer" },
  { id: "abandonner", label: "Abandonner" },
];
export default async function skraft(w0, entree) {
  // Registre des erreurs commises (LEC-1) : les refus de porte comptés sont relevés au moment où le
  // code les trace ; le reste du script ne voit aucune différence.
  const registre = nouveauRegistre();
  const w = suivreLesRefus(w0, registre);
  const { story, slug, indicateurs, base } = await preparer(w, entree.story);
  // Une session précédente sur la branche de la story : continuer ou l'écraser, au choix de l'utilisateur
  // (ADR 0089). Le registre est ouvert ensuite : le retour au commit de phase a pu changer le disque.
  const reprise = await proposerLaReprise(w, story, slug, base);
  if (reprise)
    await creerDossiers(w, slug);
  await ouvrirLeRegistre(w, registre, slug);
  // Les leçons validées du projet, données aux agents de leur rôle au début de leur phase (LEC-3).
  const memoire = await chargerLaMemoire(w);
  // Session continuée : les tests d'acceptance de la story sont rouges en attendant DELIVER (ADR 0089).
  const run = releveDeDepart(await w.lancerTests({ etiquette: "INIT_BASELINE" }), reprise);
  // BDD non déclaré (08/11) : un composant muet qui en montre les signes partirait dans le mauvais mode.
  const racinesMuettes = (await w.disposition()).bddNonDecide ?? [];
  const tousLesFichiers = racinesMuettes.length ? await w.listerFichiers() : [];
  const manifestes = [];
  for (const path of tousLesFichiers.filter(estUnManifeste))
    manifestes.push({ path, content: await w.lireFichier(path).catch((e) => (e instanceof PanneEnvironnement ? Promise.reject(e) : "")) });
  const problems = [...problemesTestsExistants(run), ...bddNonDeclare(racinesMuettes, tousLesFichiers, manifestes)];
  if (problems.length) {
    await w.informer(`Lancement skraft bloqué avant tout appel d'agent :\n${problems.map((p) => `- ${p}`).join("\n")}`);
    throw new PanneEnvironnement(problems.join(" ; "));
  }
  const disp = await w.disposition();
  const { barre, notes } = await barreDeQualite(w, disp);
  const sources = (await w.listerFichiers()).filter((p) => correspond(disp.sources, p));
  const warnings = run.coverage ? checkCoverage(run.coverage, sources, barre) : ["Couverture initiale non mesurée : la commande de test du projet n'en produit pas."];
  if (warnings.length || notes.length)
    await w.informer(`Précontrôle skraft — avertissement non bloquant sur le code existant :\n${[...warnings, ...notes].map((p) => `- ${p}`).join("\n")}\nLes seuils de couverture de livraison portent uniquement sur les lignes ajoutées ou modifiées.`);
  const qualityCheckpoint = await w.checkpoint(`skraft ${slug} : qualité initiale`);
  // Skill d'architecture transmise à l'appel ; absente ou inconnue : la clean architecture par défaut.
  const architecture = skillDArchitecture(entree.archi);
  if (architecture.avertissement)
    await w.informer(architecture.avertissement);
  const niveau = reprise?.niveau ?? (await evaluerDifficulte(w, story, indicateurs, !entree.auto, registre));
  const effets = levelEffects(niveau);
  // Ce que le dossier de passation raconte, tenu à jour au fil du script.
  const vue = {
    story,
    slug,
    base,
    niveau,
    registre,
    memoire,
    injectees: [],
    phasesFaites: [],
    phasesSautees: effets.skipResearch ? ["RESEARCH"] : [],
    architecture: architecture.skill,
    // Les nombres des critères ne sont plus soumis à l'utilisateur (ADR 0090, remplace l'ADR 0080).
    questions: story.openQuestions.map((text, i) => ({ id: `q${i + 1}`, text })),
    reponses: [],
    adrs: [],
    regressions: [],
    acceptanceHash: null,
    // Tests au relevé d'INIT : ceux des stories précédentes (ADR 0074 §4). RESEARCH et DESIGN n'écrivent
    // aucun test : c'est encore la suite au début de DISTILL.
    testsAvant: run.results.map((r) => ({ id: r.id, status: r.status })),
    // Tests d'acceptance de la story, relevés à la porte de DISTILL : DELIVER n'en fait pas d'autres scénarios.
    testsDeLaStory: null,
    qualityCheckpoint,
    // Mutants reconnus équivalents par arbitrage, exemptés de la porte de mutation (ADR 0065).
    derogations: [],
    // Lignes exemptées de la couverture du diff par l'humain, après contestation du testeur.
    derogationsCouverture: [],
    // Tests existants déclarés obsolètes à l'escalade d'un scénario (ADR 0066).
    testsObsoletes: [],
    // Phases approuvées dont le commit a échoué, continuées sans commit (D19 de docs/12).
    nonCommitees: [],
    // Matrice du plan de test (DISTILL) et écarts déclarés en DELIVER, vérifiés contre elle (ADR 0067).
    planDeTest: null,
    ecartsAuPlan: [],
  };  // Session continuée (ADR 0089) : les phases approuvées et ce qu'elles ont laissé, relus du disque.
  if (reprise)
    restaurer(vue, reprise);
  const dejaFaite = (phase) => vue.reprise?.phases.includes(phase) ?? false;

  // Les questions de la story sont tranchées avant RESEARCH (décision du 08/11, ADR 0014 révisé) :
  // le chercheur reçoit leurs réponses, au lieu de s'arrêter pour les poser lui-même.
  await trancher(w, vue, story.id);
  if (!effets.skipResearch && !dejaFaite("RESEARCH")) {
    // `w.phase` rend `undefined` si l'humain saute la phase : la fonction rend donc une valeur.
    const faite = await w.phase("RESEARCH", async (_cp, relance) => {
      await rechercher(w, vue, effets.maxAttempts, relance);
      // L'état de la phase, commité avec elle : une relance de la story le retrouve (ADR 0089).
      await noterLEtat(w, vue, "RESEARCH");
      return true;
    }, {
      commit: commitMessage("RESEARCH", slug),
      // Commit impossible, continué par l'humain : le bilan le dit (D19 de docs/12).
      commitManque: () => void vue.nonCommitees.push("RESEARCH"),
      // Git ne suit pas les dossiers vides : le rembobinage les emporte (ADR 0037).
      apresRembobinage: () => creerDossiers(w, slug),
    });
    if (faite === undefined)
      vue.phasesSautees = [...vue.phasesSautees, "RESEARCH"];
    else
      vue.phasesFaites = [{ phase: "RESEARCH", fichiers: [`.skraft/${slug}/research/research.md`] }];
  }
  // Celles que la recherche a levées sont tranchées avant DESIGN.
  await trancher(w, vue, story.id);
  // Une phase approuvée dans la session continuée n'est pas refaite (ADR 0089).
  for (const [phase, faire] of [["DESIGN", concevoir], ["DISTILL", distiller], ["DELIVER", livrer]]) {
    if (dejaFaite(phase) || vue.phasesSautees.includes(phase))
      continue;
    if (await faire(w, vue, effets.lenses, effets.maxAttempts))
      vue.phasesFaites = [...vue.phasesFaites, { phase, fichiers: [] }];
    else
      vue.phasesSautees = [...vue.phasesSautees, phase];
  }
  // Le registre de la story est écrit, puis commité seul : sa trace reste dans l'historique (LEC-1).
  await ecrireLeRegistre(w, registre);
  if (registre.erreurs.length)
    await w.commiter(`docs(skraft): registre des erreurs de ${slug}`, [registre.chemin]);
  // Leçons tirées des erreurs répétées (LEC-2), à jour pour le run suivant.
  vue.lecons = await tirerLesLecons(w, slug, vue.injectees, registre.erreurs);
  await w.etape("DONE");
  await w.informer(bilan(vue, !entree.auto));
  return {
    slug,
    niveau,
    acceptanceHash: vue.acceptanceHash,
    regressions: vue.regressions,
    phases: vue.phasesFaites.map((p) => p.phase),
    adrs: vue.adrs,
    livraison: vue.livraison ?? null,
    // Les leçons données à chaque dossier de passation (LEC-3, critère 7).
    leconsInjectees: vue.injectees,
  };
}
/**
* Défauts relevés hors du changement de la story (06/11) : les bloquants d'abord, à corriger après
* la fin du cycle, puis les autres remarques.
*/
function notesDuBilan(notes, testsObsoletes = []) {
  const ligne = (n) => `- ${n.file}${n.line ? `:${n.line}` : ""} (${n.lens}, ${n.severity}) : ${n.description}`;
  const bloquants = notes.filter((n) => n.severity === "blocker");
  const autres = notes.filter((n) => n.severity !== "blocker");
  return [
    ...rappelDesTestsObsoletes(testsObsoletes),
    ...(bloquants.length ? ["**À corriger après le cycle** — défauts bloquants hors du changement de la story :", ...bloquants.map(ligne)] : []),
    ...(autres.length ? ["Remarques hors du changement de la story :", ...autres.map(ligne)] : []),
  ];
}
/** Tests déclarés obsolètes (ADR 0066) : à mettre à jour après le cycle, comme les défauts hors du changement. */
function rappelDesTestsObsoletes(tests) {
  if (!tests.length)
    return [];
  return ["**À corriger après le cycle** — tests existants déclarés obsolètes, sortis des portes :", ...tests.map((x) => `- mettre à jour ${x.test} : déclaré obsolète au scénario ${x.scenario}${x.raison ? ` (${x.raison})` : ""}.`)];
}
function bilan(d, confirmee) {
  const adrs = d.adrs.map((a) => `${a.id} (${a.status})`).join(", ") || "aucun";
  return [
    `Pipeline skraft terminé pour **${d.story.id}** (branche skraft/${d.slug}).`,
    `Difficulté : ${d.niveau} (${confirmee ? "confirmée" : "automatique"}).`,
    `Phases exécutées : ${d.phasesFaites.map((p) => p.phase).join(", ") || "aucune"} ; sautées : ${d.phasesSautees.join(", ") || "aucune"}.`,
    `ADR : ${adrs}.`,
    ...[ligneDuRegistre(d.registre)].filter((l) => l !== null),
    ...[ligneDesLecons(d.lecons)].filter((l) => l !== null),
    ...(d.verifications?.length ? [`Vérifications par les agents (ADR 0082) : ${d.verifications.map((v) => `${v.phase} ${v.agent} ${v.appels} appel(s)`).join(" ; ")}.`] : []),
    ...(d.derogationsCouverture?.length
      ? [`Lignes exemptées de la couverture du diff : ${d.derogationsCouverture.length} (détail dans .skraft/${d.slug}/deliver/derogations.md).`]
      : []),
    ...(d.nonCommitees?.length ? [`Phases non commitées : ${d.nonCommitees.join(", ")} (commit impossible ; leurs fichiers sont inclus dans le commit suivant, ou restent à commiter).`] : []),
    ...(d.derogations?.length
      ? [`Dérogations de mutation : ${d.derogations.length} (détail dans .skraft/${d.slug}/deliver/derogations.md).`, ...d.derogations.map((x) => `- ${x.file}:${x.line} (${x.operator}), par ${x.par} : ${x.raison}`)]
      : []),
    ...(d.ecartsAuPlan?.length
      ? [`Écarts au plan de test : ${d.ecartsAuPlan.length} (détail dans .skraft/${d.slug}/deliver/ecarts-au-plan.md).`, ...d.ecartsAuPlan.map((x) => `- ${x.criterion} (${x.par}) : ${x.planned} → ${x.actual} — ${x.rule}`)]
      : []),
    ...notesDuBilan(d.notesHorsChangement ?? [], d.testsObsoletes ?? []),
  ].join("\n");
}
/**
* Questions ouvertes sans réponse, posées toutes à la fois. Étapes annoncées avec le vocabulaire de
* l'extension skraft : les deux se comparent (docs/10 §3). Comme l'extension, ROUTE n'existe que s'il
* reste des questions (D11 de docs/12) ; une question tranchée n'est jamais reposée.
*/
async function trancher(w, vue, storyId) {
  const ouvertes = vue.questions.filter((q) => q.answer === undefined);
  if (!ouvertes.length)
    return;
  await w.etape("ROUTE");
  const reponses = await poserLesQuestions(w, ouvertes, storyId, vue.registre);
  const reponseDe = new Map(ouvertes.map((q, i) => [q.id, reponses[i]]));
  vue.questions = vue.questions.map((q) => {
    const d = reponseDe.get(q.id);
    if (!d)
      return q;
    return { ...q, answer: d.decision === "defer" ? "(question reportée par l'utilisateur)" : d.commentaire?.trim() || "(réponse vide)" };
  });
}
/**
* Questions ouvertes, posées toutes à la fois, hors de toute phase. Une panne à la création d'une
* demande (D17 de docs/12) escalade : « Relancer » repose les seules questions en échec ; il n'y a
* pas de phase à sauter.
*/
async function poserLesQuestions(w, questions, storyId, registre) {
  const reponses = new Array(questions.length);
  let restantes = questions.map((_, i) => i);
  for (;;) {
    const issues = await Promise.allSettled(restantes.map((i) => poser(w, questions[i], storyId)));
    const pannes = [];
    issues.forEach((r, j) => {
      if (r.status === "fulfilled")
        reponses[restantes[j]] = r.value;
      else if (r.reason instanceof PanneEnvironnement)
        pannes.push({ i: restantes[j], motif: r.reason.message });
      else
        throw r.reason;
    });
    if (!pannes.length)
      return reponses;
    await w.etape("ESCALATED");
    const d = await w.humain("escalade", "Pipeline skraft bloqué (ROUTE)", [
      { id: "relancer", label: "Relancer : reposer les questions" },
      { id: "abandonner", label: "Abandonner" },
    ], { detail: `Panne pendant les questions ouvertes : ${pannes.map((p) => p.motif).join(" ; ")}` });
    if (d.decision === "abandonner") {
      await ecrireLeRegistre(w, registre);
      w.echec(`Abandon pendant les questions ouvertes : ${pannes[0].motif}`);
    }
    await w.etape("ROUTE");
    restantes = pannes.map((p) => p.i);
  }
}
/** Une question ouverte, à réponse libre. */
function poser(w, q, storyId) {
  return w.humain("question-ouverte", `Question ouverte (${storyId})`, [{ id: "answer", label: "Répondre" }, { id: "defer", label: "Reporter" }], { detail: q.text, texteLibre: true });
}
/** Lecture de la story, branche et arborescence (effet `init` du réducteur). */
async function preparer(w, chemin) {
  await w.etape("INIT");
  for (;;) {
    let motifs;
    try {
      const lue = parseStory(await w.lireFichier(chemin));
      if (lue.ok) {
        const slug = slugOf(lue.story.id, lue.story.title);
        // Le point de départ de la session : une nouvelle session y recrée la branche (ADR 0089).
        const base = await w.tete();
        await w.brancher(`skraft/${slug}`);
        await creerDossiers(w, slug);
        const indicateurs = computeIndicators(lue.story, repositoryShape(await w.listerFichiers()));
        return { story: lue.story, slug, indicateurs, base };
      }
      motifs = lue.errors;
    }
    catch (e) {
      motifs = [e instanceof PanneEnvironnement ? `Panne d'environnement : ${e.message}` : `Story introuvable : ${chemin}`];
    }
    await relancerOuAbandonner(w, `Story invalide : ${motifs.join(" ; ")}`);
  }
}
/** Classifieur, budget compté par le code (D24), puis confirmation humaine si demandée. */
async function evaluerDifficulte(w, story, indicateurs, confirmer, registre) {
  await w.etape("CLASSIFY");
  const grille = gradeDifficulty(indicateurs, DEFAULT_THRESHOLDS);
  const consigne = [`Story : ${story.id} — ${story.title}`, `Indicateurs : ${JSON.stringify(indicateurs)}`, `Niveau proposé par la grille : ${grille}`].join("\n");
  let propose;
  for (;;) {
    try {
      await essayer(w, { max: 3 }, async () => {
        const r = await w.agent("skraft-classifier", consigne);
        if (!r.sortie)
          return { motifs: [`Blocage inattendu : ${r.blocage.question}`], porte: "classifieur" };
        if (!isDifficulty(r.sortie.level))
          return { motifs: [`Niveau de difficulté inconnu : ${r.sortie.level}`], porte: "classifieur" };
        propose = { level: r.sortie.level, justification: r.sortie.justification };
        return [];
      });
      break;
    }
    catch (e) {
      if (!(e instanceof Escalade || e instanceof PanneEnvironnement))
        throw e;
      await relancerOuAbandonner(w, e.message, registre);
    }
  }
  if (!confirmer)
    return propose.level;
  const niveaux = [...new Set([propose.level, shift(propose.level, 1), shift(propose.level, -1)])];
  await w.etape("CONFIRM_DIFFICULTY");
  const d = await w.humain("confirmer-difficulte", `Difficulté de ${story.id} : ${LEVEL_LABELS[propose.level]} ?`, niveaux.map((l) => ({ id: l, label: l === propose.level ? `Confirmer : ${LEVEL_LABELS[l]}` : LEVEL_LABELS[l] })), { detail: propose.justification });
  return isDifficulty(d.decision) ? d.decision : propose.level;
}
/** Un essai de RESEARCH : le chercheur, ses questions bloquantes, puis la porte citations (§7.1). */
function rechercher(w, vue, max, relance) {
  // Relancée après une escalade : le premier essai reçoit son motif (D15 de docs/12).
  return essayer(w, { max, motifs: relance }, async (motifs) => {
    for (;;) {
      await w.etape("RESEARCH");
      const fichiers = await w.listerFichiers();
      const utiles = preselectFiles(vue.story, fichiers);
      await ecrirePassation(w, vue);
      const consigne = buildBrief(vue, "RESEARCH", motifs, leconsPour(vue, "RESEARCH", "skraft-researcher")) + (utiles.length ? `\nFichiers utiles (présélection) :\n${utiles.map((f) => `  - ${f}`).join("\n")}` : "");
      // Le chercheur vérifie son document avec la porte que le code rejouera (ADR 0082).
      const document = `.skraft/${vue.slug}/research/research.md`;
      const r = await w.agent("skraft-researcher", consigne, { lectureSeule: GELÉS, verification: { outil: "verifier_recherche", fichiers: [document], donnees: { chemin: document } } });
      if (r.verification)
        vue.verifications = [...(vue.verifications ?? []), { phase: "RESEARCH", agent: "skraft-researcher", appels: r.verification.appels }];
      if (r.sortie)
        break;
      // Question bloquante (D31) : l'humain répond, l'agent repart avec la réponse dans son dossier, et le même motif (D9 de docs/12).
      const choix = r.blocage.choix.length ? r.blocage.choix : ["Répondre"];
      await w.etape("BLOCKED");
      const d = await w.humain("blocage", "Question de l'agent (RESEARCH)", choix.map((c) => ({ id: c, label: c })), { detail: r.blocage.question });
      vue.reponses = [...vue.reponses, { question: r.blocage.question, answer: d.commentaire ? `${d.decision} (${d.commentaire})` : d.decision }];
    }
    return { motifs: await porteCitations(w, vue), porte: "citations" };
  });
}
async function porteCitations(w, vue) {
  const chemin = `.skraft/${vue.slug}/research/research.md`;
  let md;
  try {
    md = await w.lireFichier(chemin);
  }
  catch (e) {
    if (e instanceof PanneEnvironnement || e instanceof TourInterrompu)
      throw e;
    return [`Document de recherche absent : ${chemin}`];
  }
  const existants = new Set(await w.listerFichiers());
  const contenus = new Map();
  for (const cite of citesDansLaRecherche(md))
    if (existants.has(cite))
      contenus.set(cite, await w.lireFichier(cite));
  // Le même calcul que l'outil `verifier_recherche` du chercheur (ADR 0082).
  const { reasons, openQuestions } = motifsDeLaRecherche(md, contenus);
  if (reasons.length)
    return reasons;
  const connues = new Set(vue.questions.map((q) => q.text));
  const nouvelles = openQuestions.filter((q) => !connues.has(q));
  vue.questions = [...vue.questions, ...nouvelles.map((text, i) => ({ id: `q${vue.questions.length + i + 1}`, text }))];
  // Transmise à DESIGN et DISTILL par le dossier de passation (skraft-plugin v1.15.1).
  vue.recherche = extraireInventaire(md);
  return [];
}
async function relancerOuAbandonner(w, motif, registre) {
  await w.etape("ESCALATED");
  const d = await w.humain("escalade", "Pipeline skraft bloqué", RELANCER_OU_ABANDONNER, { detail: motif });
  if (d.decision !== "relancer") {
    // Le run s'arrête : le registre de la story est écrit avant (LEC-1).
    if (registre)
      await ecrireLeRegistre(w, registre);
    w.echec(`Abandon : ${motif}`);
  }
}
