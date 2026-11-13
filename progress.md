# Journal de progression

Pour le prochain moi. Texte libre : ce qui a été fait, pourquoi, et surtout ce qui m'a piégé.
À mettre à jour après chaque tâche, en même temps que `features.json`.

---

## 13/11 — Plus de profil : aucune action réservée (ADR 0087)

- **Demande du responsable** : enlever toutes les restrictions par profil, dans tout le code, puis
  supprimer le profil lui-même. Branche `feat/sans-restriction-de-profil`, partie de `main`.
- **Fait** :
  - cœur : `Role`, `Profile`, `profileFor`, `ROLE_LABELS` supprimés ; `requiredRoles` retiré ;
    `respond` sans identité ; l'arbitre prend `permissionPolicy` ;
  - workflow : `meta.humains` retiré, refusé avec sa raison ; plus de question à déclarer ;
  - extension et workflow skraft, serveur MCP (questions et leçons), application (`admin:get`
    remplace `profile:get`), scripts d'essai et répondeur du banc ;
  - `admin.json` : `permissionPolicy` et `defaultMode` à la racine.
- **Piège évité** : un `admin.json` existant qui posait `profile.permissionPolicy: "prudente"` aurait
  été ignoré, et le poste serait passé en « souple ». L'ancienne forme est donc relue (rôle technique :
  souple et avancé ; sinon prudente et simple). Vérifié en cassant la ligne.
- **Numéro d'ADR** : 0087, parce que 0086 est pris sur `feat/revue-lentilles`, qui n'est pas encore
  mergée.
- **Prochaine étape** : pousser et ouvrir la PR quand le responsable le demande.
## 12/11 — Revue : les lentilles en parallèle

- **Demande du responsable** : paralléliser les lentilles, puis retirer celles qui n'apportent rien
  à leur phase.
- **Fait** (branche `feat/revue-lentilles`, ADR 0086) : la tâche de workflow regroupe les tours
  d'agents en lecture seule en attente ensemble en un seul effet `agents`, qui les lance en même
  temps et rend `RESULTATS`. « En lecture seule » est déduit du `meta` (`agentsEnLectureSeule`) :
  ni écriture, ni `run_tests`, ni `run_lint`.
- **Piège** : le `Promise.all` du script ne suffisait pas. Chaque appel devient un effet, et le
  moteur de tâches (`drain`) les exécute un par un.

## 12/11 — LEC-3 : les leçons réinjectées au début de chaque phase

- **Demande du responsable** : continuer après LEC-2 (freecompub/AgentStudio#34, ADR 0085).
- **Fait** (branche `feat/lec-3-reinjection`, partie de `feat/lec-2-lecons`) :
  - `sectionDesLecons`, `vigilanceDesLecons`, `recidivesMalgreLecons`, `ligneDesRecidives` (purs) ;
  - leçons chargées au début du run (`chargerLaMemoire`) ; `leconsPour` donne la section et note
    l'injection ; `buildBrief` reste pur et la reçoit ; lentilles par `lensBrief` (`vigilance`) ;
  - récidives comptées à la fin du run ; `leconsInjectees` dans la valeur finale.
- **Choix provisoires** : dernière occurrence = rang dans `stories.jsonl` (le registre ne date pas) ;
  trace = valeur finale du run.
- **Piège** : la valeur finale d'un workflow est rangée par référence (`fin.valeur.ref` dans `contenus`)
  dès qu'elle dépasse la taille en clair.
- **Essais réels d'US-2 sur l'exemple .NET (12/11)**, même story, même pile, mêmes réponses :
  - sans leçons : 22 min 36 s, 6,49 $ ; 3 refus de revue en DISTILL et une correction en DELIVER ;
    4 erreurs enregistrées, 4 leçons candidates (dont deux doublons, L-01 et L-03, sur la même
    nouvelle entrée de catalogue) ;
  - avec ces leçons, validées à la main dans une copie locale : 18 min 37 s, 7,10 $ ; DISTILL et
    DELIVER du premier coup ; un faux positif de la porte de cohérence en DESIGN (2,61 $).
  - Le premier essai a été tué faute de mémoire (machine de 7,7 Go sans swap, `/tmp` en tmpfs plein
    de clones d'essai) : nettoyer `/tmp/essai-mcp-skraft-*` entre les essais.
- **Corrigé** : les récidives ne comptent que les erreurs du run (le registre gardait celles du run
  précédent de la même story) ; la porte de cohérence n'exige pas dans le modèle un nom suivi de sa
  référence dans le dépôt.
- **Prochaine étape** : fusionner deux leçons qui visent la même entrée de catalogue (doublons) ;
  merger LEC-1, LEC-2 puis LEC-3, dans l'ordre.

## 12/11 — LEC-2 : les leçons tirées des erreurs répétées

- **Décisions du responsable** : le classement tourne à la fin de chaque run ; la ratification d'une
  leçon est réservée au profil déclaré dans la configuration du serveur MCP. (Il a d'abord compris
  « agent de classement » comme `skraft-classifier`, le classifieur de difficulté : les deux noms se
  confondent, à éviter dans les questions.)
- **Fait** (branche `feat/lec-2-lecons`, partie de `feat/lec-1-registre`) :
  - registre : chaque erreur a un identifiant `<story>#<rang>`, qui continue le fichier à une relance ;
  - cœur : outil terminal `submit_lecons` ; `sortie` du meta et du manifeste l'acceptent ;
  - `catalogues.mjs` : les titres des cinq catalogues, recopiés (le script ne lit pas le dossier du
    workflow) et comparés aux fichiers des skills par un test ;
  - `lecons.mjs` : vérification d'une leçon (critères 3 à 5), rôle (6), statuts (7 à 10), puis la fin
    de run `tirerLesLecons` (un second tour avec les motifs ; un échec ne fait pas échouer le run) ;
  - agent `skraft-lecons` ; leçons et ordre des stories (`stories.jsonl`) commités après le registre.
- **Piège** : chaque run appelle maintenant l'agent des leçons s'il a des erreurs ; le banc doit le
  simuler (`submit_lecons` vide par défaut), sinon l'essai attend 60 s.
- **Fait aussi** : l'outil MCP `skraft_lecons` (critères 11 à 14), sa commande `/skraft-lecons`, et
  l'ADR 0084. Le profil vient d'`admin.json` (`admin.profile.role`), déjà passé au serveur.
- **Piège** : ouvrir le projet par l'enveloppe `outil` du serveur exige une pile ; `skraft_lecons` ne
  fait que résoudre le dossier du projet, puis lit le fichier.
- **Prochaine étape** : reporter les décisions dans l'issue #33 ; puis LEC-3, la réinjection.

## 11/11 — LEC-1 : le registre des erreurs commises

- **Demande du responsable** : coder LEC-1 (freecompub/AgentStudio#32) directement. Il a tranché quatre
  questions : LEC-1 seule ; motif normalisé comme le disjoncteur ; seuls les refus qui consomment un
  essai ; un défaut donné à l'agent par l'humain n'est pas enregistré (ADR 0083).
- **Fait** (branche `feat/lec-1-registre`, partie de `main`, sans la PR #37) :
  - `workflows/skraft/registre.mjs` : erreurs, signature, contenu, regroupement (pur), puis collecte et
    écriture ;
  - `normaliserMotifs` exportée du cœur et de la bibliothèque des scripts ;
  - enveloppe de `w` au début du script pour relever les refus ; défauts relevés à chaque succès de
    phase et avant chaque rembobinage ; écriture à l'escalade, avant un abandon hors phase et à la
    fin, commit seul ; `.agent-studio/lecons/**` dans `GELÉS`.
- **Choix provisoires**, à faire trancher : tâche annulée sans écriture (le script ne tourne plus),
  relance en ajout, champs en français.
- **Piège** : le statut d'une tâche abandonnée est `finished` ; l'échec se lit dans `state.fin.statut`.
- **Piège** : après un rembobinage, le registre revient au checkpoint ; ce n'est pas une modification
  par un agent (`apresRembobinage: true`).
- **Prochaine étape** : reporter dans l'issue #32 les décisions du 11/11 ; puis LEC-2.

## 11/11 — Essai réel de LEC-1 sur AgentStudio, et la porte de DESIGN ne juge plus l'existant

- **Essais sur les vraies issues d'AgentStudio** :
  - #33 (LEC-2), bloquée par #32 : refusée. Le message nomme le bloqueur.
  - #32 (LEC-1), au format et sans commentaire : reprise telle quelle et commitée sur
    `skraft/lec-1`, sans agent.
- **Run complet de LEC-1** (Claude, `scripts/essai-mcp-skraft.ts --installer`, pile cadrée dans un
  clone : la commande de test ne lance que `acceptance/`, `lecons*` et les canaris, car les deux
  projets entiers prennent 5 min 44 la passe) :
  - RESEARCH en 4 min, avec cinq questions ouvertes pertinentes, auxquelles le répondeur a donné
    « l'option la plus simple ». **À trancher par le responsable** avant le prochain run : run
    annulé, escalade en attente, défaut accepté par l'humain, run rembobiné, second run sur une même
    story ;
  - DESIGN bloquée 36 min, en cinq essais, pour **21,27 $**, puis arrêtée : la porte réclamait un ADR
    de rattrapage pour « CQRS avec bus », trouvé dans les skills de skraft, et ne reconnaissait pas
    les ADR d'AgentStudio (`# ADR 0001 —`).
- **Décision du responsable** : la porte juge les ADR que la story produit, pas l'existant.
  - La phase 7.0 du plugin (`engagementsSansAdr` sur les sources) est retirée des deux copies.
  - La porte ne lit plus les sources.
  - La consigne « ADR de rattrapage » est retirée du prompt de l'architecte qui décide.
  - La couche anticorruption de la carte de la story reste à ratifier.
  - `docs/15` §4.6 le note.
- **Run 2 de LEC-1**, arrêté en DESIGN (20,54 $) : « ADR-001 manque … ADR-078 manque ». La porte
  ne lisait que les `docs/adr/adr-NNN-*.md`, et les ADR d'AgentStudio (`0078-….md`,
  `# ADR 0078 —`) lui étaient invisibles. Le répondeur a choisi de renuméroter, mais l'architecte ne
  peut pas supprimer de fichier : un ADR mal nommé restait, refusé à chaque essai.
- **Demande du responsable** : dire à l'architecte la bonne raison, et dès sa sortie.
  - La porte lit tout `docs/adr/` (sauf `supersessions.md`). Un ADR existant compte par son
    numéro, même hors convention (`numeroAdr`), et la story numérote après lui.
  - Deux motifs distincts : « ADR-005 manque : aucun fichier de docs/adr/ ne porte ce numéro », ou
    « ADR-079 existe (chemin) mais ne suit pas la convention skraft : fichier attendu …, titre
    attendu … » (`suitLaConvention`, `conventionAdr`).
  - Workflow : le périmètre de l'architecte qui décide passe à `docs/adr/adr-???-*.md` et
    `docs/adr/supersessions.md`. Un nom hors convention est refusé par la garde à l'écriture, donc
    n'existe jamais. Le titre est contrôlé à la fin de son tour (`controlerAdrs`), avant la porte.
    Les ADR existants hors convention sont désormais protégés eux aussi (restaurés s'ils sont touchés).
  - Extension : `render_adr` nomme déjà les fichiers ; seule la lecture de la porte change.
- **Run 3 de LEC-1**, arrêté à la main en DESIGN, essai 4 (28 min, 12,44 $). Les ADR d'AgentStudio
  étaient reconnus, mais l'architecte numérotait depuis 001 (`adr-001-couche-anticorruption-….md`).
  La porte répondait « ADR-001 en double », sans dire avec quoi, et il ne pouvait pas supprimer
  son fichier pour renuméroter.
- **Fait (ADR 0079)** :
  - le code calcule le numéro (`numerotationAdrs`) : `render_adr` le prend, le workflow le donne
    dans le dossier de passation (`ligneNumerotation`) ;
  - les numéros pris sont en lecture seule pendant le tour de l'architecte (`motifsNumerosPris`,
    paramètre `lectureSeule` de `specialiste`) ;
  - un doublon nomme le fichier qui tient le numéro et le prochain numéro libre ; un doublon entre
    ADR du projet n'est pas reproché ;
  - le message de `readOnlyGuard` devient générique (tests gelés, ou fichier interdit par le
    dossier de passation).
- **Piège** : le moteur de workflow n'a pas de suppression de fichier. Toute erreur de nom ou de
  numéro doit être empêchée à l'écriture, pas réparée après coup.
- **Pas fait** : les PDF de `docs/pdf/skraft-fonctionnement-*` ne sont pas régénérés (Typst absent
  de la machine) ; seule leur source `skraft.typ` est à jour.
- **Run 4 de LEC-1** (1 h 23, 30,12 $), arrêté à la main en DISTILL, essai 7. RESEARCH du premier
  coup ; DESIGN terminée, ADR-079 à 081 numérotés à la suite et ratifiés : le correctif des ADR tient.
  DISTILL a bouclé :
  - la porte des valeurs exigeait « 0069 », tiré de « (ADR 0069) » dans le critère 3 ;
  - « Q2 : voir décision 2 », question de RESEARCH qui renvoie à une décision absente : l'agent a
    inventé un thème, la revue l'a refusé ;
  - deux refus de revue « changements demandés » sans défaut bloquant ni majeur (`revue.mjs:162`),
    donc rien à corriger : deux escalades, relancées par le répondeur.
- **Fait (ADR 0080, décision du responsable)** : une référence d'ADR ou d'issue n'est plus une
  valeur ; un nombre seul est soumis à l'humain en ROUTE (« Valeur à tester », questions `v1`…), qui
  le garde (première option, ce que prend un répondeur) ou le retire de son seul critère. Réponse
  dans la passation, ligne au bilan (`ligneValeursRetirees`). Remplacer la porte par une lentille a
  été écarté : c'est un contrôle mécanique.
- **Run 5 de LEC-1** (47 min, 26,43 $), arrêté à la main en DISTILL, essai 3 : aucune porte du code
  n'a refusé, ni en DESIGN ni en DISTILL ; trois refus de revue sur des défauts majeurs fondés.
  Anomalie à vérifier : l'état affichait « essai 3 » en DESIGN avant tout refus, juste après deux
  questions bloquantes.
- **Fait (ADR 0081)** : hors DELIVER, une revue sans défaut bloquant ni majeur à corriger est
  approuvée (mineurs au rapport), ou escaladée sans essai si une lentille est REJECTED ou une
  question sans lentille (`revueSansDefautCorrigible`).
- **Fait (ADR 0082, décision du responsable, révise le point 3 de l'ADR 0055)** : l'agent se vérifie
  avec l'outil de sa porte.
  - Cœur : `avantSortie`, contrôle facultatif de l'outil terminal (un motif refuse, l'agent continue).
  - Hôte : `verification: { outil, fichiers, donnees }` dans `ctx.agents.run` ; l'hôte lit les
    fichiers, compte les appels, garde l'empreinte, refuse une fois la sortie ; le résultat rapporte
    `verification: { appels, dernier }`. Le contexte traverse le RPC d'une extension isolée.
  - Moteur de workflow : `meta.outils`, `export const outils`, exécutés par le processus enfant
    (`rejoueur.outil`) ; `w.agent(…, { verification })` journalisé.
  - skraft : `verifier_scenarios` pour l'agent d'acceptance (`motifsDesScenarios`, même calcul que
    la porte, dans les deux copies) ; bilan « Vérifications par les agents ».
- **Run 6 de LEC-1**, arrêté à la main en DESIGN (7 min, 2,41 $) : RESEARCH refusée une fois sur
  `docs/adr/00NN-titre.md`, un gabarit cité comme un fichier ; le chercheur n'avait pas d'outil pour
  le voir avant de rendre.
- **Fait** : `verifier_recherche` pour le chercheur (même calcul que la porte, `motifsDeLaRecherche`).
  La porte ne sait qu'après lecture quels fichiers lire : un outil de workflow reçoit `lire(chemin)`,
  servi par l'hôte, qui ne rend que les fichiers de la liste du dépôt (ceux que voit la porte), sinon
  `null`. Dans l'extension, l'outil lit par `ctx.workspace`.
- **Run 7 de LEC-1**, arrêté à la main en DELIVER (1 h 05, 17,46 $) : premier run arrivé en DELIVER.
  RESEARCH, DESIGN et DISTILL sans aucun refus de porte ; un refus de revue en DISTILL (7 défauts
  majeurs, tous maintenus par le réfutateur, corrigés en un tour). Le langage technique des scénarios
  vient des critères de LEC-1, eux-mêmes techniques.
- **Fait** : un refus de DESIGN est routé vers son auteur (`routerMotifsDeDesign`) ; après le premier
  essai, le modélisateur n'est relancé que si un motif le concerne.
- **Fait (11/11, branche `feat/design-retour-au-modele`)** : l'architecte qui décide signale les défauts
  du modèle (`modelDefects`) ; le modèle lui est en lecture seule ; le code relance le modélisateur
  avec ses remarques, une seule fois par essai, sans en consommer un. Sa consigne ne l'autorise plus
  à « ajouter d'abord au modèle ».
  - Workflow : `specialiste` rend la sortie de l'agent ; l'aller-retour vient après `controlerAdrs`,
    pour que les ADR écrits avant soient marqués de leur story.
  - Extension : drapeau `retourAuModele`, remis à faux à chaque essai et à chaque phase ; les
    remarques arrivent au modélisateur sous « Rejet précédent », préfixées « Remarque de
    l'architecte qui décide sur le modèle ».
- **Instable** : « l'architecte qui décide reçoit les noms du modèle écrit juste avant lui » a échoué
  une fois sous charge (3,9 s), puis passé seul et en suite complète.
- **Proposé, non tranché** : préciser la consigne de l'agent d'acceptance pour un critère technique
  (le traduire en langage métier, chemins et noms de champs dans le test) ; refuser par la porte
  gherkin un identifiant entre accents graves ou un chemin dans une étape.
- **Piège** : le RPC rend `undefined` pour un `null` ; `lire` le normalise côté enfant.
- **Piège** : le rappel refuse le premier `report_phase` de tout agent qui ne vérifie pas. Les
  agents simulés des bancs (`ignoreLeRappel`) le rappellent, comme un agent réel qui ignore le
  rappel ; `rappelsVus` permet aux essais de le constater.
- **Piège** : changer `synthesize` aurait été plus simple, mais l'ADR 0062 règle déjà DELIVER
  autrement (mineurs corrigés de façon ciblée). Sept tests de DELIVER l'ont rappelé.
- **Prochaine étape** :
  - `verifier_conception` (DESIGN), sur le modèle de `verifier_scenarios` ;
  - faux positif de la porte des citations : un gabarit (`docs/adr/00NN-titre.md`, `<…>`, `{…}`, `*`)
    n'est pas une citation ;
  - refuser une question ouverte qui renvoie à un élément absent (« voir décision 2 ») ;
  - un critère coupé sur plusieurs lignes, dans une story donnée par fichier, n'est lu que sur sa
    première ligne : le refuser, comme pour une issue ;
  - faire trancher par le responsable les questions de RESEARCH de LEC-1 (issue #32), puis relancer.
- **Reste ouvert** : les ADR produits gardent la convention skraft, pas celle du projet (option B,
  une section `adr` dans `projet.yaml`, non tranchée).

---

## 10/11 — La story d'une issue commitée avant le run

- **Demande du responsable** : commiter la story avant le premier test, pour lire le diff.
- **Vérifié dans le code** : les portes et les revues ne voyaient pas la story dans leur diff,
  parce qu'un checkpoint capture aussi les fichiers non suivis (`snapshotTree`). Mais la story
  n'avait pas de commit à elle, et partait mêlée au premier commit de phase.
- **Fait** : la préparation passe sur `skraft/<slug>` et commite les deux seuls fichiers de la story
  (`repo.commit` avec `paths`).
- **Essai réel** sur le clone de `exemple-dotnet-tdd` : commit `docs(us-7): …` de deux fichiers,
  arbre propre.
- **Limite** : `repo.commit` ajoute ces chemins, mais commite tout ce qui est déjà indexé ; un
  fichier que l'utilisateur aurait mis en index partirait avec.

---

## 10/11 — Outils d'un composant de monorepo

- **Vu sur l'autre poste** : la découverte de la pile d'un monorepo (applications `souscription-dab` et
  `shell`) a été refusée trois fois. L'agent proposait `outils: [../../node_modules/.bin]` pour
  atteindre le `node_modules` partagé, et la règle des chemins du profil refusait tout `..`.
- **Cause** : la règle jugeait les chemins contre la racine du composant, alors que la vraie limite
  est le projet.
- **Fait** : `outils` accepte `..`, et `parseStackProfile` (option `racine`) juge le chemin résolu
  contre la racine du projet. La racine du composant passe aux composants du projet, à une pile
  fournie et à la découverte (`lirePile(yaml, racine)`). Le prompt de l'agent le dit. Les autres
  champs gardent la règle sans `..`.
- **À faire sur l'autre poste** : relancer `/skraft-pile` sur le monorepo.

---

## 10/11 — Une US donnée par une issue GitHub (ADR 0078)

- **Décidé par le responsable** :
  - lire l'US et toutes ses dépendances, après avoir vérifié `gh` ;
  - les commentaires font partie de l'US ;
  - lire les issues et écrire les PR ;
  - une US bloquée par une issue ouverte ne démarre pas.
- **Fait** :
  - `github-auth/issues.ts` : vérification de `gh`, lecture en lecture seule (issue, commentaires,
    parente, sous-issues, bloquée par, bloque, citées ; un niveau, dix au plus), `bloqueursOuverts`,
    `rendreContexte` ;
  - `mcp-skraft/us-github.ts` : refus si bloquée, écriture du contexte et de la story. La story est
    reprise telle quelle, ou mise en forme par un agent (`redacteur-us.ts`, qui n'écrit que ce
    fichier), puis vérifiée par le code avec `parseStory` et `extractLiterals` du workflow ;
  - `skraft_demarrer` accepte une issue, préparée seulement après l'accord sur le workflow.
- **Pièges** :
  - un 404 sur `parent` veut dire « pas de parente », mais un 404 sur une liste veut dire « API
    absente » ;
  - `extractLiterals` ne garde pas « € » comme unité : le motif dit « 750 ».
- **Essai réel** : `cli/cli#14996`, 73 s, story de 19 critères vérifiée.
- **PR à la fin, faite** : `skraft_pr` (`/skraft-pr`, `pr-github.ts`).
  - Le run doit être fini et sa story une issue.
  - L'utilisateur accepte par le client, à chaque fois.
  - `origin` doit être le dépôt de l'issue ; le push passe par l'aide d'identification de `gh` ; une
    PR déjà ouverte est rendue.
  - Testé avec `git` et `gh` doublés. Aucune vraie PR ouverte : ce serait une publication, à faire
    avec le responsable.
- **Essai sur le dépôt d'exemple** : issue créée à la demande du responsable,
  `freecompub/exemple-dotnet-tdd#2`, « US-7 — Livraison offerte au-delà d'un seuil », en prose, avec
  un commentaire du PO qui tranche « après remises ». Trois défauts vus et corrigés :
  - l'identifiant venait du numéro de l'issue (`US-2`, qui existe déjà dans ce dépôt). Un
    identifiant en tête du titre l'emporte désormais, pour la story comme pour le titre de la PR ;
  - l'agent coupait des critères sur deux lignes, et `parseStory` n'en lit que la première. C'est
    désormais refusé, et le prompt le dit ;
  - « - Aucune : … » sous « Questions ouvertes » aurait été posée comme une question. Une question
    ouverte doit finir par « ? », sinon c'est refusé.
  - Résultat final en 20 s : cinq critères d'une ligne, la décision du commentaire intégrée.
- **Reste** :
  - l'application de bureau ;
  - un run complet sur une issue.

---

## 10/11 — Faux rejet des ADR historiques et contexte DESIGN

- **Demande** : corriger ensemble, sur une nouvelle branche, le faux rejet de cohérence ADR et la
  saturation du contexte de DESIGN.
- **Fait** (branche `fix/design-context-options`) :
  - les deux parseurs ADR (extension et workflow indépendant) reconnaissent les titres historiques
    `# ADR-NNN: titre`. Aucun ADR existant n'est réécrit ; les portes gardent leurs contrôles de
    statut `Proposed`, doublons, trous créés par la phase et liens de supersession ;
  - les options facultatives `reasoningEffort` et `contextTier` traversent le workflow, l'extension,
    le cœur et les deux runtimes ;
  - les architectes `skraft-architect-model` et `skraft-architect-decide` demandent `high` et
    `long_context` dans les deux versions de skraft ;
  - Copilot refuse l'ouverture si le modèle choisi ne déclare pas l'effort demandé et un tier long
    d'au moins 1M tokens. Claude Code reçoit `--effort high` et `sonnet[1m]` ou `opus[1m]` ; un
    autre alias est refusé pour ne pas annoncer un contexte non garanti.
- **Validation** : 242 tests ciblés verts (13 fichiers), `pnpm typecheck` vert, JSON valide et
  `git diff --check` propre. Aucun run réel Copilot n'a été lancé ; le token limit effectivement
  rapporté reste à confirmer sur une session réelle.
- **À retenir** : les erreurs de statut ou de registre relevées pour les nouveaux ADR demeurent de
  vrais défauts à corriger par l'agent ; seul le faux manque des anciens numéros est éliminé.
- **Revue du 10/11, corrigé** :
  - échouer quand le modèle ne peut pas honorer une option arrêtait DESIGN à chaque run Copilot
    sans modèle explicite. C'est la configuration par défaut du serveur MCP (`modeles: {}`) et de
    l'application ;
  - le même échec frappait un modèle `strong` sans contexte long ; côté Claude, tout modèle autre
    que `sonnet` ou `opus` ;
  - désormais l'option est abandonnée avec un avertissement (`options de modèle ignorées`,
    `contexte long ignoré`), et la session s'ouvre. C'est un choix provisoire, consigné par une
    révision de l'**ADR 0077** (`0077-parametres-de-modele-par-role.md`). La revue l'avait cru
    absent, à tort : la commande de revue avait coupé la première ligne de la liste des fichiers ;
  - le cas « trou déjà présent » de la porte de cohérence est rétabli, et un cas pour l'ADR
    historique `ADR-NNN:` est ajouté dans les deux copies.

---

## 10/11 — Déployer le serveur MCP : un script, et le paquet npm en option

- **Fait** : `pnpm --filter @agent-studio/mcp-skraft deployer` (`scripts/deployer.mjs`).
  - Il construit le serveur, l'inscrit dans Copilot CLI (`copilot mcp add`) et dans Claude Code
    (`claude mcp add -s user`), puis pose les commandes.
  - Une inscription existante différente n'est remplacée qu'avec `--remplacer`.
  - `--npm <dossier>` prépare le paquet et le compresse ; `--publier` seul le publie.
- **Pièges vus en préparant** :
  - les deux clients refusent une seconde inscription du même nom ;
  - `claude mcp get` lance le serveur pour tester la connexion ;
  - `COPILOT_HOME` et `CLAUDE_CONFIG_DIR` déplacent la configuration. Le script des commandes les
    ignorait, il les respecte désormais.
- **Essais** :
  - réel, dans des configurations isolées : inscription dans les deux clients, relance sans rien
    toucher ;
  - le paquet installé hors du dépôt démarre (`skraft-mcp`).
- **Quel client** : le script cherche `copilot` et `claude` dans le PATH. Le serveur **et** les
  commandes ne sont posés que pour les clients trouvés, ou pour celui de `--client`. Jusque-là, les
  commandes allaient aux deux clients, même absents. La désinstallation sans `--client` retire nos
  liens chez les deux, pour nettoyer d'anciens liens.
- **Désinstaller** : `deployer -- --desinstaller`.
  - Il retire l'inscription si elle pointe vers ce serveur (sinon seulement avec `--forcer`), et
    nos liens seuls.
  - Les données sont gardées sauf `--donnees`.
  - Essai réel : rien ne reste, un skill étranger gardé.
- **Défaut corrigé** : un échec d'inscription laissait le script sortir en succès. Vu parce que
  Copilot refuse un `COPILOT_HOME` accessible en écriture au groupe.
- **Avant de publier** :
  - une vraie version (`0.0.0` aujourd'hui) ;
  - un nom disponible (le scope `@agent-studio` demande une organisation npm, sinon `--nom`) ;
  - un compte npm ;
  - la licence : GPL-3.0-or-later, parce que le paquet embarque le workflow skraft.

## 10/11 — Les commandes `/skraft-…` dans Copilot CLI

- **Pourquoi** (demande du responsable) : il n'y avait aucune commande, seulement des outils que le
  LLM appelle quand on le lui demande.
- **Vérifié avec Copilot CLI 1.0.107**, par un serveur de diagnostic dans tmux, sans requête :
  - un prompt MCP n'apparaît pas en commande ;
  - un skill de projet (`.github/skills/`) apparaît en `/<nom>`.
- **Fait** : `apps/mcp-skraft/skills/`, un skill par outil, et un test qui exige un skill pour chaque
  outil, ni plus ni moins. Chaque skill nomme son outil, dit comment lire les arguments, et laisse
  les questions à l'utilisateur.
- **Essai** : les neuf commandes listées ; `/skraft-etat` appelle l'outil et résume.
- **Partagées avec Claude Code** : `pnpm --filter @agent-studio/mcp-skraft commandes`.
  - Le script pose des liens vers `skills/` dans `~/.claude/skills` et `~/.copilot/skills`, ou dans
    `<projet>/.claude/skills` avec `--projet` : les deux clients lisent ce dossier.
  - `--retirer` retire nos liens, et eux seuls.
  - Vérifié : Copilot suit un lien dans `.claude/skills/`.
  - Pour Claude Code, seulement sa documentation : le lancer dans tmux a été refusé à
    l'approbation.

## 10/11 — État et prochaine étape

- **Mergé dans `main`** (PR #27, 09/11) :
  - les questions à l'utilisateur par le client MCP (ADR 0075) : dépôt, programme, écriture du
    profil ;
  - `outils` dans le profil ;
  - la pile découverte par un agent, vérifiée par le code, et la réponse à sa question (ADR 0076) ;
  - le classement des assertions pytest en junit-xml ;
  - l'interdiction de l'assertion sur un booléen calculé.
- **Doc mise à jour le 10/11** :
  - README racine : serveur MCP, pile, organisation, état ;
  - `CLAUDE.md` ;
  - SPEC §6.5, §8.5, §8.6 et O12 ;
  - README du serveur : inscription dans Copilot CLI, ce que Copilot en fait, `skraft_pile` dans le
    déroulé.
- **Prochaine étape**, au choix du responsable :
  - essayer la PR sur le poste Mac, projet uv, compte d'entreprise (`hostname`) ;
  - la découverte en arrière-plan, si la limite de 3 minutes de Copilot gêne ;
  - le lecteur JUnit de `node --test` (`missing_symbol` mal classé), sur une vraie sortie ;
  - les défauts reportés de skraft : relation `context-map`, escalade sur revue sans défaut
    majeur, cold-reader et valeurs recopiées, citations de la recherche.

## 09/11 — La pile découverte par un agent, vérifiée par le code (ADR 0076)

- **Pourquoi** (demande du responsable) : les règles du code ne reconnaissaient que deux modèles.
  Pour tout autre projet, il fallait écrire la pile à la main.
- **Fait** :
  - un agent `agent-studio/decouvreur-de-pile`, en lecture seule, qui rend sa proposition par
    `submit_pile` (une pile par racine) ou pose une question (`report_blocker`). Son prompt est une
    constante (`decouverte-de-pile-agent.ts`) et ne nomme aucun langage ni outil. Lanceurs BDD et
    lecteurs de rapport arrivent dans la demande, tirés des tables du code ;
  - les détections du code deviennent des **indices** (`indicesPourLAgent`) : fichiers,
    dépendances, arborescence bornée, modèle reconnu, BDD détecté ;
  - la vérification par le code (`verifierPiles`) : racine, programmes (accord avant toute
    exécution), schéma, BDD, diagnostic, puis canaris réels dans une copie. Des canaris impossibles
    à lancer comptent comme un refus. Trois essais au plus ; un refus repart avec ses motifs ;
  - `/stack init` passe par l'agent quand les services en ont un (bureau et MCP). Sans
    `decouverte`, l'ancien chemin par les règles reste, et ses tests aussi ;
  - `skraft_pile` exige une connexion pour proposer.
- **Tests** : les tests des services et du serveur font tourner de **vrais canaris** sous
  `node --test` (support partagé `test/support/pile-node.ts`), dans un dossier temporaire qui tient
  lieu de worktree.
- **Essais réels** (Copilot CLI) : un projet uv (19 s), et un projet `node --test` inconnu des règles.
  Tous deux sont vérifiés et écrits.
- **Réponse à l'agent** : `/stack init --reponse <phrase>` ou l'argument `reponse` de `skraft_pile`.
  La réponse prend la fin de la ligne et arrive à l'agent avec ses indices, en une phrase qui se
  suffit à elle-même. Essai Copilot sur un projet ambigu : 53 s.
- **Pièges vus à l'essai réel, corrigés** :
  - « cette fois » était redemandé à chaque essai ; la question attendait, et Copilot a abandonné
    l'appel à **3 minutes** (`Request timed out`). Désormais l'accord vaut tant que les services
    vivent ;
  - les motifs de refus n'étaient pas journalisés ; ils le sont, comme chaque proposition.
- **À surveiller** :
  - la limite de 3 minutes de Copilot : trois essais avec un utilisateur lent peuvent la dépasser.
    La parade serait une découverte en arrière-plan, suivie comme un run ;
  - avec le reporter JUnit de `node --test`, le canari `missing_symbol` est classé `other_error`.
    L'agent est passé à TAP, mais le lecteur JUnit mériterait une vraie sortie de `node` en fixture.

---

## 09/11 — Commandes et autorisations du serveur MCP : point 0, le refus d'un programme s'explique

- **Pourquoi** : sur un autre poste (Copilot CLI, projet Python géré par uv), trois blocages. Le projet
  a été refusé, hors des roots et de `autorises`. `uv` puis `make` ont été refusés comme programmes de
  pile. Il n'y avait aucun profil de pile.
- **Ce que le code a montré** (et que j'avais mal dit à l'utilisateur) :
  - `admin.json` se lit à un emplacement **système** (`/Library/Application Support/agent-studio/`
    sur macOS, `/etc/agent-studio/` sur Linux) ou à `AGENT_STUDIO_ADMIN_CONFIG`, jamais dans
    `~/.agent-studio`. Le fichier posé là n'était pas lu ;
  - `allowedPrograms` remplace la liste : `["uv"]` aurait fait refuser `pytest` ;
  - le vrai besoin de `uv` vient de ce qu'un profil lance son programme par le PATH, et que `pytest`
    d'un projet uv est dans `.venv/bin`.
- **Fait** (branche `feat/autorisations-mcp`) :
  - `AdminConfig.origineDesProgrammes` : une phrase qui dit d'où vient la liste (fichier lu, clé absente,
    fichier absent à tel endroit, fichier refusé) ;
  - `ParseOptions.origine` ; le refus d'un programme cite la liste en vigueur et cette origine ;
  - les services passent liste et origine ensemble (`programmes: ParseOptions`) ;
  - README du serveur : les emplacements, la règle de remplacement, la liste par défaut complète.
- **Le plan qui suit**, révisé après lecture du code :
  - **Point 1, abandonné : accepter `uv run X` ou `npx X` si X est autorisé.** Chaque lanceur a ses
    options (`uv run --with`), et `npx` télécharge.
  - **Point 1, à la place** : le profil déclare où vivent les outils du projet (`outils: [.venv/bin]`).
    Le programme reste jugé par son nom.
  - **Point 3, fait (ADR 0075)** : un dépôt hors des dossiers permis est accepté par l'utilisateur.
    - Le serveur pose la question par le client (*elicitation*), si celui-ci l'annonce
      (`confirmerParLeClient`, `src/confirmation.ts`).
    - « Oui, cette fois » vaut pour ce serveur. « Oui, toujours » est retenu dans
      `~/.agent-studio/mcp-skraft/depots-acceptes.json` (`src/depots.ts`).
    - Sans elicitation annoncée, ou sur un « non », le dépôt reste refusé.
    - L'idée du dossier de lancement comme borne est abandonnée : le code la refusait déjà
      (`projet.test.ts`, « pas accepté d'office »).
  - **Point 2, fait (ADR 0075 §5)** : un programme hors liste est demandé à l'utilisateur à
    l'ouverture du projet (`accepterLesProgrammes`, `workspace-services.ts`). La question passe par le
    client MCP (elicitation) ou par la fenêtre du bureau, jamais par un argument d'outil.
    - « Toujours » est retenu par projet dans `programmes-acceptes.json` (dossier des tâches).
    - L'administrateur l'interdit par `programConsent: false`.
    - Un nom avec chemin n'est jamais demandé.
  - **Essai réel avec Copilot CLI 1.0.107 (09/11)** : `-p` ne montre rien, il refuse toute question.
    Le mode interactif se pilote par **tmux** (`new-session -d`, `send-keys`, `capture-pane`) : un
    pseudo-terminal nu ne suffit pas, Copilot attend des réponses du terminal avant de s'afficher.
    - Copilot demande d'abord s'il fait confiance au dossier.
    - Puis nos deux questions (le dépôt, puis `uv`), acceptées : la pile du projet est retenue.
    - Une réponse après 75 s aboutit.
    - `HOME` posé dans le bloc `env` du serveur isole ses données de la vraie configuration.
    - Coût : environ 8 AIC pour les deux essais.
  - **Point 1, fait (ADR 0075 §8)** : `outils` dans le profil (`.venv/bin`…), en tête du PATH de
    chaque commande (`envDesOutils`) et du diagnostic. `/stack init` le propose pour `uv.lock`.
    - **Piège vu à l'essai réel** : les canaris tournent dans un worktree, sans `.venv` (ignoré par
      Git), d'où « aucun rapport lisible ». Ils prennent les outils du projet d'origine
      (`racineDesOutils`).
    - **Défaut trouvé et corrigé** : avec un vrai pytest (junit-xml), le canari `assertion` était
      classé `other_error`. pytest ne met que l'expression dans `message` (« assert 1 == 2 ») et le
      type d'exception sur la dernière ligne du corps. Le classement lit maintenant `type`, le
      message et cette dernière ligne (`XunitCase.raison`), jamais le corps entier : pytest y recopie
      le code du test. Fixture réelle `fixtures/pytest-9.2.xml`. Diagnostic réel ensuite : aucun
      problème, quatre canaris sur quatre.
    - Le défaut « `Assert.True` avec message personnalisé » est traité autrement, à la demande du
      responsable : **l'assertion sur un booléen calculé est interdite**. Une comparaison faite dans
      le test puis vérifiée « vraie » ne dit, en échouant, ni l'attendu ni l'obtenu.
      - Elle est interdite dans `skraft-test` et `skraft-acceptance` (définitions d'étapes comprises).
      - La lentille `test-integrity` la relève en `major`.
      - Les deux copies sont faites (extension et workflow).
      - La règle ne nomme aucun langage. Un test vérifie qu'aucun agent ne nomme `Assert.True`,
        `assertTrue`… (`assertions-booleennes.test.ts`, dans les deux suites).
      - Ce n'est qu'une consigne au LLM, aucune porte ne la vérifie : une porte devrait reconnaître
        l'assertion dans chaque langage, donc passer par le profil. Pas d'essai réel, il faudrait un
        run complet.
  - **Point 4, fait (ADR 0075 §6)** : `skraft_pile` reprend `/stack init` (`proposer`) et
    `/stack doctor` (`diagnostiquer`).
    - L'écriture se fait après la question du client (`confirmerProgrammes`).
    - Sans pile, le projet est ouvert pour ce seul appel, repli permis (`repliPermis`,
      `Projets.pourLaPile`), puis refermé pour être relu.
    - **Piège** : sans cela, `AucunePile` empêchait d'ouvrir le projet, précisément quand il faut
      proposer sa pile.
    - Les consignes « Rouvrez le projet », « `/stack doctor` » sont réécrites pour le client
      (`consignes.ts`). Un test vérifie qu'aucun `/stack` ne reste.
    - Essai Copilot : profil écrit ; le diagnostic dit `pytest` introuvable, absent de cette machine.
      C'est le cas d'un projet uv : d'où le point 1.
- **Le SDK Copilot ne change rien aux commandes** : nos agents n'ont aucun shell (`task-agent-guard.ts`),
  les commandes de la pile sont lancées par notre code (`run_tests`), sans shell. Le serveur n'a aucun
  canal vers l'humain (`SANS_FENETRE`) : l'accord ne peut venir que du client MCP.
- **Essai Copilot CLI, d'abord refusé par le mode automatique de Claude Code, fait ensuite à la demande du responsable** (voir point 2) ; questions de départ :
  à faire par l'utilisateur) : Copilot déclare-t-il des roots, dans quel dossier lance-t-il le serveur,
  gère-t-il l'elicitation ? Et, sur l'autre poste, la connexion du SDK à l'hôte d'entreprise
  (`hostname`, `GH_HOST`).

---

## 09/11 — Le serveur MCP tient l'utilisateur au courant : `skraft_attendre` et la ligne de progression

- **Pourquoi** (demande du responsable) : le serveur ne pousse rien, la progression ne se voyait que si
  l'hôte pensait à rappeler `skraft_etat`, et en JSON à interpréter.
- **Fait** (`apps/mcp-skraft`, branche `feat/mcp-progression`, partie de `main`) :
  `progression.ts`, pur : `ligneDeProgression` (titre · phase, étape · statut · durée · coût · dernier
  rejet · questions ; coût omis s'il vaut 0, Copilot) et `changements(avant, après, tache?)` (run lancé,
  phase, étape, rejet, fin, question à poser, réponse reçue, message). `skraft_etat` porte `progression`
  par run (durée et coût lus dans la trace, `etapesDuRun`). Nouvel outil **`skraft_attendre`** (`tache`,
  `delai` ≤ 120 s) : attend un changement (scrutation toutes les 500 ms), rend les changements, la
  progression, les questions sous la forme de `skraft_etat` (options comprises) et `termine` ; réponse
  immédiate si le run est fini ; sa description dit à l'hôte de tout rapporter et de rappeler l'outil.
- **Piège** (vu par le test de bout en bout) : comparé à l'état **du moment de l'appel**, l'outil perdait ce
  qui arrive entre deux appels (une réponse, la fin du run). Il compare désormais au **dernier état rendu à
  l'hôte**, gardé par projet et par run suivi.
- **Vu au premier run réel suivi par l'outil (09/11)** : le client MCP abandonne un appel au bout de 60 s
  (délai par défaut du SDK) ; avec `delai: 120`, RESEARCH sans changement pendant plus d'une minute a fait
  tomber le script, et le serveur avec lui. L'attente est bornée à **50 s** (30 par défaut). Corrigés
  aussi : un coût sous le centime s'affiche « < 0,01 $ » au lieu de « 0,00 $ » ; la ligne commence par la
  **story** donnée à `skraft_demarrer` (la carte d'une tâche de workflow ne porte que le nom du workflow).
  `scripts/essai-mcp-skraft.ts` gagne `--suivi=attendre`.
- **Second run suivi** (`docs/runs/2026-11-09-us-2-bdd-claude-suivi/`) : fini, 22m39, 5 rejets, 6,62 $ ;
  le suivi a tenu, mais **aucun rejet ni essai n'était signalé** : la carte d'une tâche de workflow ne porte
  ni `feedback` ni `step`. Corrigé : `vueDeTache(carte, étapes de la trace, story)` lit rejets (comptés,
  pour voir un rejet au texte répété), dernier rejet (« porte : premier motif »), essai de la phase (pas
  pendant une revue : `REVIEW` est l'étiquette de toutes les revues, son compteur n'est pas un essai),
  durée et coût. Vérifié en rejouant la trace réelle du run.
- **Troisième run suivi** (même dossier) : 21m13, 5 rejets, 6,51 $ ; **5 rejets signalés sur 5**. Corrigés
  ensuite : motif long coupé au milieu (début et fin, où est la cause) ; pas de double point final.
  **À analyser** (skraft) : rouge d'acceptance refusé pour un `Assert.True` à message personnalisé
  (classé au texte) ; escalade sur une revue « changements demandés » sans défaut grave ; conflit entre
  cold-reader et la recopie mot pour mot des valeurs de la story.
- Notifications poussées par MCP (journal, progression, ressources) : non faites, leur affichage par
  Claude Code et Copilot CLI n'est pas vérifié.
- Tests : `test/progression.test.ts` (9), `serveur.test.ts` (1 de bout en bout, plus la liste des outils),
  `stdio.test.ts` (liste des outils) ; vus rouges. 52 tests verts.

## 08/11 — État du BDD et suite (ADR 0074, révisé)

- **Principe rappelé par le responsable** : skraft ne connaît aucun langage. Tout ce qui dépend de
  la pile passe par le profil et l'adaptateur ; un skill ou une porte qui nomme un langage ou un
  lanceur est à refuser. ADR 0074 §3 révisé en ce sens (le « skill par lanceur » est abandonné).
- **Fait** : 3a, réglage `bdd` du profil (`8c605e8`) ; 3b, DISTILL et DELIVER en BDD dans
  l'extension et le workflow (`5831500`) : `.feature` au projet, titres `AC-n` vérifiés, gel des
  dossiers `features` et `etapes`. Constat sur un premier lanceur (Reqnroll 3.3.4) : le nom du
  test vient du titre, le tag n'arrive pas au rapport JUnit, d'où le lien par le titre. Un autre
  lanceur peut se comporter autrement : c'est au canari de le dire, pas à une hypothèse.
- **Reste, pour passer le critère `bdd-par-composant` à `true`** :
  1. ~~**Canari BDD**~~ **fait** (voir l'entrée suivante).
  2. ~~**Skill `bdd-step-definitions`**~~ **fait** (voir l'entrée suivante).
  3. **Détection par `/stack init`** : lanceur nommé dans un manifeste, dossiers `.feature` et
     d'étapes ; un couple complet est confirmé, une moitié fait demander l'autre.
  4. **Run réel** sur un projet BDD (le premier : la version BDD d'`exemple-dotnet-tdd`), avec
     l'accord du responsable.
- **Ne pas commiter** `docs/Growing Object-Oriented Software, Guided by Tests.pdf` (sous droits).
- **Branches** : `feat/composants` (briques 1 et 2 des composants), puis `feat/bdd` (ADR, 3a, 3b),
  partie de la précédente. Rien de poussé.

## 08/11 — Troisième run réel US-2 en BDD (`docs/runs/2026-11-08-us-2-bdd-claude-3/`)

- Demandé par le responsable (« On lance le test ») ; serveur reconstruit à `991df12` (PR #25).
- **Fini : 15m05, 2 rejets, 5,12 $** (second : 16m13, 1 rejet, 5,18 $) ; DESIGN 2,94 $ ; ADR-003 ratifié ;
  US-1 intacte ; `dotnet test` 10/10.
- **Vérifié en réel** : aucun refus « nom cité absent du modèle » (liste des noms) ; aucune question
  bloquante du chercheur (question de la story posée avant RESEARCH) ; note « ac-3 déjà vert » émise.
- **Nouveau défaut de porte** (**reporté par le responsable le 09/11**, solution décidée mais non faite) :
  la porte de cohérence lit comme une relation entre contextes une phrase qui dit qu'il n'y en a pas
  (« aucune flèche `A` → `B` à qualifier ») : patron manquant, contextes `A` et `B` non classés. Coût :
  le second essai de DESIGN (1,58 $). **Origine** : la consigne de l'architecte du modèle donne l'exemple
  « `A` → `B` » et « `A` : Core » (`skraft-architect-model.agent.md:28-31`), repris tel quel.
  **Solution proposée** : (1) `RELATION` (`design.mjs:267`, `design.ts`) ne lit qu'une ligne qui
  **commence** par la relation (directement, ou après `-`, `*`, `|`), pas la prose ; (2) la consigne
  écrit `<Contexte>` → `<Autre contexte>` : <patron>, et dit de n'écrire une flèche entre deux noms que
  pour déclarer une relation. Deux copies, TDD (premier test : la phrase du run ne produit aucun refus).
- **Cause secondaire** du même rejeu : après un refus de cohérence, l'essai relance les deux architectes,
  même si un seul fichier est en cause ; le second a passé un tour à ne rien changer (trace, 23:27:20).
  À examiner.
- Erreur d'agent : citation à chemin incomplet en RESEARCH (`Steps/ChiffrageDuPanierSteps.cs`) ; la porte a
  raison. Piste : proposer le chemin complet dans le motif quand un seul fichier y correspond.

## 08/11 — L'architecte qui décide reçoit les noms du modèle

- **Pourquoi** : hors le défaut `Panier`, tous les refus de DESIGN des deux runs du jour étaient des noms
  cités par les contrats sans être dans le modèle (`SommeDesArticles`, `FraisDePort`, `PrixUnitaire`,
  `ArgumentNullException`), souvent pris dans le code existant de son dossier. La consigne le disait
  déjà (ADR 0043 : une règle sans fait sous les yeux ne tient pas).
- **Fait, extension et workflow** : `ligneNomsDuModele(slug, docs)` (`design.ts`, `design.mjs`), avec la
  même règle que la porte (`nomsDuModele`) : la liste des noms des deux documents, et la conduite à tenir.
  Ajoutée au dossier de `skraft-architect-decide` (extension `runSpecialist`, workflow `unEssai` de
  `conception.mjs`, recalculée à chaque essai). Consigne de l'agent (deux copies) : chemins complets des
  deux documents, et « même nommage, y compris pour un nom du code existant ».
- Demandé par le responsable (chemins dans la consigne) et accepté (la liste calculée par le code).
- Tests : 3 de `ligneNomsDuModele` par copie, 1 de bout en bout par implémentation (le dossier de
  l'architecte qui décide contient la liste), vus rouges.
- **Suite décidée** (pas commencée) : bilan des rejets entre les runs (`skraft_bilan`), puis un agent de
  synthèse en fin de run qui **propose** des leçons, validées par l'humain avant d'entrer dans les
  consignes (ADR à écrire). Motif : une leçon tirée d'un faux refus (`Panier`) aurait été nuisible.

## 08/11 — Un BDD muet ne démarre pas (ADR 0074 §6)

- **Pourquoi** (remarque du responsable) : une détection partielle écrivait le profil sans `bdd`, et
  `bdd` absent valait « pas de BDD » : un projet BDD partait dans le mauvais mode, en silence. Même effet
  par une pile donnée au serveur MCP sans `bdd`.
- **Fait** : `parseStackProfile` rend `bdd: false` en liste vide (choix déclaré) ; `StackAdapter.bddNonDecide`
  (profil sans `bdd` : `["."]` ; adaptateur composé : racines ramenées au projet ; adaptateur TypeScript
  intégré : `["."]`), exposé par les deux hôtes d'extension et `w.disposition()`. `bddNonDeclare(racines,
  fichiers, manifestes)` (`detection-bdd.ts`, une seule copie, offert par `extension-api` et la
  bibliothèque des workflows avec `estUnManifeste`) rend un motif par composant muet qui montre un
  lanceur cité ou des `.feature`. INIT (extension `effects.ts`, workflow `workflow.mjs`) l'ajoute aux
  problèmes de la suite de départ : « Lancement skraft bloqué avant tout appel d'agent ».
- Tests : profil et composants (2), adaptateur intégré (1), hôtes et disposition (3), `bddNonDeclare` (4),
  bout en bout dans les deux implémentations (2 chacune : bloqué ; `bdd: false` démarre). Vus rouges sauf
  la garde `bdd: false`. Suite entière : 2378 tests. Serveur MCP reconstruit.
- **Fait ensuite (point 1)** : `/stack init` demande la moitié manquante. Rien n'est écrit ; le message
  dit ce qui est trouvé, ce qui manque, et la relance : `--lanceur`, `--features`, `--etapes`
  (combinables), ou `--sans-bdd` (écrit `bdd: false`). `completerBdd` vérifie ce qui est donné (lanceur
  connu, dossier non vide), `partiesManquantes` et `partiesTrouvees` décrivent l'état (`detection-bdd.ts`).
  Choix : les **arguments de la commande** servent de réponse libre, la confirmation n'admettant qu'un
  oui ou un non (une saisie libre aurait demandé une boîte de dialogue dans l'interface Electron).
  Composants : une moitié arrête l'écriture, le message dit de compléter la pile à la main.
  `proposeProfileEtBdd` retiré. Tests : 5 de `stack-command` (dont l'ancien « commentaire » remplacé),
  vus rouges.

## 08/11 — Détection du BDD par `/stack init` et `/stack doctor` (ADR 0074 §5) ; critère `bdd-par-composant` à `true`

- **Fait** : `detecterBdd` et `blocBdd` (`stack-adapters/src/profile/detection-bdd.ts`, purs) : lanceur
  lu comme un nom entier dans le texte des manifestes (table de marques par lanceur, table des noms de
  manifestes), dossier des `.feature` (parent commun), dossier des étapes (unique dossier au nom usuel).
  `proposeProfileEtBdd` ajoute la section `bdd` (couple complet) ou un commentaire « à compléter »
  (une moitié) ; `/stack init` l'emploie à la racine et pour chaque composant. `diagnoseProfile` vérifie
  les couples déclarés (`.feature` présents, dossier d'étapes, lanceur cité). `IndicesDuProjet` gagne
  `arborescence` et `manifestes`, remplis par `workspace-services` (`sous`, `manifestesSous`, aussi
  pour `diagnostiquer`).
- **Choix** : la confirmation n'admet qu'un oui ou un non, la moitié manquante n'est donc pas demandée
  mais dite en commentaire, sans rien deviner.
- **Vérifié en vrai** sur la copie du `main` BDD d'`exemple-dotnet-tdd` : `reqnroll`,
  `tests/Tarification.UnitTests/Features`, `…/Steps`, le couple écrit à la main pour les runs.
- **Limite** : `/stack init` ne propose de profil que pour TypeScript et Python (pas .NET).
- Tests : `test/detection-bdd.test.ts` (12), `stack-command.test.ts` (3), `workspace-services.test.ts` (3),
  vus rouges. Suite entière : 2364 tests.
- **Critère `bdd-par-composant` passé à `true`** après son verify : tout l'ordre de mise en œuvre de
  l'ADR 0074 est fait, et deux runs réels l'ont confirmé.

## 08/11 — Questions ouvertes de la story posées avant RESEARCH (ADR 0014 révisé)

- **Pourquoi** : aux deux runs du jour, le chercheur s'arrêtait (`blocker`) pour poser une question
  que la story annonçait ; un tour de plus (≈ 0,20 $). Demandé par le responsable : poser les
  questions de la story avant la recherche.
- **Fait** : extension, `route` du réducteur sans l'exception « sauf avant RESEARCH » ; workflow,
  `trancher` (questions sans réponse seulement) appelée avant RESEARCH et avant DESIGN.
- Tests : réducteur (3 réécrits, 3 attentes mises à jour, l'aide `toFirstPhase` répond à la question
  quand RESEARCH a lieu) ; bout en bout S2 dans les deux implémentations (question posée avant
  RESEARCH, réponse dans le dossier du chercheur, seule la question de la recherche ensuite), vus
  rouges avec l'ancien ordre ; deux tests `--auto` reçoivent le répondeur.
- **Le réfutateur** : il ne juge que les défauts `blocker`/`major` des lentilles (ADR 0069), jamais
  une porte du code ; au second run, défauts mineurs seulement, il n'a pas été appelé.
- **Rejet `ArgumentNullException` (DESIGN, second run) : pas un faux positif**, lu dans la trace.
  `contracts.md` promettait des gardes contre les nuls (lignes 23, 85, 94) ; l'architecte du modèle a
  vérifié que le projet n'en a aucune (`Nullable` activé, avertissements bloquants,
  `Directory.Build.props:4, 7-8`), l'a documenté, et le contrat a été corrigé. **Décision du
  responsable : porte inchangée**, à revoir seulement si un rejet sans enjeu de conception apparaît
  (un nom du framework cité en passant). N'exiger que les noms déclarés aurait laissé passer celui-ci.

## 08/11 — Aucun test unitaire en DELIVER : règle de l'ADR 0045 gardée, scénario déjà vert noté

- **Constat** (second run) : ce n'est ni un défaut ni une faute d'agent. Le testeur a usé de `coveredBy`
  (ADR 0045, option A du 03/10) pour `ac-2` ; le développeur a écrit toute la remise en un pas ; `ac-3`
  était déjà vert (code écrit sans test rouge qui le demande). La mutation des lignes de la story est
  passée : les scénarios tuent ses mutants.
- **Décision du responsable** : garder la règle 1 (le scénario peut tenir lieu de rouge) ; les tests
  unitaires complètent quand les scénarios ne suffisent pas, ce que font déjà les portes de fin (mutant
  survivant → testeur ; ligne non couverte → testeur si le projet a un seuil de couverture, aucun par
  défaut). ADR 0045 complété.
- **Fait** : note « Scénario ac-n : déjà vert avant son premier pas ; … » quand un scénario pilote est
  vert à son tour (extension `deliver-machine.ts`, workflow `livraison.mjs`). Test du réducteur et trois
  attentes exactes de bout en bout (S1, S5 ; ordre : après les notes de la porte du scénario précédent)
  vues rouges puis vertes.
- Précision donnée au responsable : en DISTILL, l'agent d'acceptance **peut** écrire dans les sources
  (signatures minimales pour compiler) ; le code borne l'emplacement, pas le contenu (pas de logique :
  consigne seulement). Au second run : `BaremeDeRemises` vide, deux types-valeurs, un constructeur.

## 08/11 — Second run réel US-2 en BDD (`docs/runs/2026-11-08-us-2-bdd-claude-2/`)

- Demandé par le responsable (« Aller on relance »), après les quatre corrections du jour ; même
  départ, pile complétée (`mutation` Stryker, `format`). Serveur MCP reconstruit.
- **Fini : 16m13, 1 rejet, 5,18 $** (premier : 23m28, 8 rejets, 12,18 $). DESIGN 3,20 $ (au lieu de
  7,98) sans refus sur `Panier`, ADR-003 ratifié ; DISTILL en un essai, `.feature` de l'US-1 intact ;
  5 scénarios pour 5 critères ; mutation mesurée, 5 survivants anciens de `Montant.cs` notés hors du
  changement ; `dotnet test` 10/10.
- **À examiner** : (1) le seul rejet, `ArgumentNullException` exigé dans le modèle parce que cité par
  `contracts.md` (type du framework, faux positif probable) ; (2) **aucun test unitaire écrit** en
  DELIVER, pour la seconde fois (« TDD toujours ») ; (3) notes : commentaire de `Facture` périmé,
  justification de requalification devenue fausse après DELIVER.
- Branche du run (`skraft/us-2`, clone `/tmp/essai-mcp-skraft-R89Ove`) non poussée.

## 08/11 — Mutation : vérifiée en vrai, puis jugée sur les lignes modifiées (ADR 0049 révisé)

- **Pourquoi** : le run BDD n'avait pas mesuré la mutation ; la pile fournie (reprise de `a7cf6db`)
  n'en déclarait pas, alors que le `main` BDD a Stryker.NET 4.14.1 (`dotnet-tools.json`,
  `stryker-config-core.json`). Mon oubli.
- **Vérifié sans LLM** sur une copie du `main` : `dotnet tool restore`, puis la mutation par notre
  adaptateur (`[dotnet, stryker, --config-file, stryker-config-core.json, --output, "{dossier}"]`,
  `stryker-json`) : 57 s, score et survivants lus ; `format` (`dotnet format --verify-no-changes`)
  répond. La pile de l'essai (scratchpad `run-bdd/pile.yaml`) a désormais `mutation` et `format`.
- **Constat** : le code de l'US-1 est à 62 % (`Montant.cs`), 60 % (`Quantite.cs`) ; la barre par défaut
  exige 100 % (domaine, application, en fin de DELIVER) et la porte jugeait le fichier entier.
- **Décision du responsable** (option 1) : juger les seules lignes modifiées, comme la couverture.
- **Fait** : lecteur Stryker, `killedLines` ; `restreindreAuChangement` (extension, workflow) appliqué
  avant `checkMutation` aux deux portes (fin de scénario, fin de DELIVER), qui reçoivent les lignes de
  `fichiersModifies` ; survivants hors des lignes modifiées → note « Mutation hors du changement ».
  Sans `killedLines` ou sans lignes, l'ancienne règle (fichier entier).
- Tests : lecteur (1), restriction (4 par copie), bout en bout S5 (1 par implémentation : survivant
  ancien sur la ligne 1 d'un fichier touché à la ligne 2) ; vus rouges, le bout en bout en neutralisant
  la restriction (escalade « à 50 % (minimum 100 %) »). Une attente exacte de `profile-adapter.test.ts`
  complétée par `killedLines`.

## 08/11 — DISTILL ne juge que le Gherkin de la story (ADR 0074 §4)

- **Défaut** (run BDD du 08/11) : la porte des titres `AC-n` jugeait tous les `.feature` du dossier,
  dont celui de l'US-1 ; l'agent a renommé ses scénarios. Trouvé aussi en lisant le code : DELIVER
  prenait le premier scénario `@ac-n` du dossier, donc celui de l'US-1 (`panier-chiffrage` avant
  `panier-remise`).
- **Fait, extension et workflow** : `gherkinDeLaStory(avant, après)` (`gherkin.ts`, `gherkin.mjs`)
  découpe chaque fichier en en-tête et blocs de scénario ; nouveaux blocs = la story (rendus avec
  l'en-tête du fichier) ; bloc existant modifié ou supprimé, ou en-tête modifié = refus (porte
  `gherkin`). Relevé `avant` : workflow, au début du callback de `w.phase("DISTILL")` dans `d` ;
  extension, dans l'effet `checkpointPhase` de DISTILL, porté par `PHASE_CHECKPOINTED.gherkinAvant`
  jusqu'à l'état (`SkraftState.gherkinAvant`, schéma zod). Portes et DELIVER passent par
  `gherkinDuDisque` + `gherkinDeLaStory`.
- Décision du responsable : un scénario d'une story précédente **doit** être refusé s'il est touché.
- Tests : 6 de `gherkinDeLaStory` dans chaque copie, et 3 de bout en bout dans chaque
  implémentation (US-1 déjà en BDD : livrée sans juger ses titres ; renommer un scénario de l'US-1
  refusé, motif exact ; DELIVER reçoit le scénario de la story). Tous vus rouges pour la bonne raison ;
  le refus vérifié en le retirant.
- **Fait ensuite, même entrée** : les tests d'une story précédente. Relevé de la suite d'INIT gardé
  (`testsAvant` : workflow dans `d`, extension par `INITIALIZED` jusqu'à l'état) ; aucune exécution de
  plus, RESEARCH et DESIGN n'écrivant aucun test. `checkAcceptanceRed(… avant)` ne compte que les tests
  nouveaux, refuse un test existant passé au rouge, et dit « aucun nouveau test d'acceptance » si tous
  les marqués existaient ; `testsDeLaStory` est gardé à la porte (workflow `d`, extension `GATE_OK` de
  DISTILL), remis à zéro avec les régressions, et `planScenarios` de DELIVER n'en sort pas. Tests : 3
  de porte dans chaque copie, 1 de bout en bout dans chaque implémentation (test de l'US-1 vert : ni
  « passe déjà », ni scénario `ac-1#2`), vus rouges (escalade « passe déjà », exactement le run) ; le
  filtrage de DELIVER vérifié en le retirant.
- Piège de test : le lanceur simulé fait échouer tout test d'acceptance tant que la story n'est pas
  livrée ; l'enveloppe qui rend vert le test de l'US-1 doit aussi recalculer `exitCode`, sinon INIT
  refuse de démarrer (« Exécution des tests existants en erreur »).

## 08/11 — Porte de cohérence de DESIGN : un nom d'un seul mot n'était jamais reconnu dans le modèle

- **Défaut** (trouvé en lisant les refus du run BDD) : `conceptsAbsentsDuModele` comparait les noms
  qu'un ADR classe (`classements`, tout nom en capitale initiale : `Panier`) aux noms du modèle relevés
  par `extractCodeIdentifiers`, qui ne garde que les noms **composés** (`PASCAL` : `GrilleDePaliers`).
  « Agrégat `Panier` » écrit dans `domain-model.md` n'y figurait donc jamais.
- **Effet** : runs du 07/11 et du 08/11, « `Panier`, Agrégat dans ADR-003, n'existe ni dans… »
  répété ; le 08/11, deux essais (4,36 $), disjoncteur, escalade, puis l'ADR-003 **abandonné** par
  l'architecte pour passer la porte. L'« incohérence entre les deux architectes » du 07/11 était en
  partie ce défaut.
- **Correction**, extension et workflow : `nomsDuModele` ajoute aux noms composés les noms d'un seul
  mot écrits entre accents graves ou dans un bloc de code. `extractCodeIdentifiers` n'est pas
  touché (il sert aussi aux citations).
- **Vérifié** : test rouge puis vert dans les deux copies, garde « nom d'un seul mot absent : rejeté » ;
  rejoué sur l'instantané réel de l'essai 3 (`traces/…/DESIGN rembobinage`) : l'ancien code redonne
  le refus mot pour mot, le nouveau aucun.
- Les autres refus de DESIGN du run (`SommeDesArticles`, `FraisDePort`, `PrixUnitaire` : champs du
  code cités par les contrats, absents du modèle) relèvent de la règle, pas d'un défaut. Question
  laissée au responsable : exiger ces champs existants dans le modèle est-il trop strict ?

## 08/11 — Run réel US-2 en BDD, Claude, par le serveur MCP (`docs/runs/2026-11-08-us-2-bdd-claude/`)

- Départ : `main` GitHub d'`exemple-dotnet-tdd` (`19583a4`, US-1 déjà en BDD Reqnroll), pile
  donnée par l'argument `pile` (`--pile=` ajouté à `scripts/essai-mcp-skraft.ts`). Demandé par le
  responsable (« Lance un test l'exemple à partir de sa branche main »).
- Résultat : **fini, 23m28, 8 rejets, 12,18 $**, `dotnet test` 10/10. Le `.feature` va au projet,
  titres `AC-n`, étapes dans `Steps/` : le chemin BDD fonctionne de bout en bout.
- **Défaut de DESIGN** : `Panier` refusé à tort (nom d'un seul mot), **corrigé** (entrée précédente).
- **Deux défauts de nos portes, à corriger avant de passer `bdd-par-composant` à `true`** :
  1. ~~la porte des titres `AC-n` juge **tous** les `.feature` du dossier~~ **corrigé** (ADR 0074 §4) ;
  2. ~~les marqueurs `ac-n` de deux stories se confondent~~ **corrigé** (ADR 0074 §4) : les scénarios renommés de l'US-1
     sont pris pour des tests de l'US-2 (« passe déjà »), requalifiés en régression ; 8 scénarios
     pour 5 critères. Le défaut existe aussi hors BDD, dès qu'une story précédente laisse des
     tests `Ac<n>_…`.
- Autres constats : aucun test unitaire écrit en DELIVER (un seul pas) ; DESIGN 7,98 $ sur 12,18
  (même incohérence entre architectes qu'au 07/11) ; RESEARCH refusé pour des citations venues de
  l'ADR-002 périmé du projet.
- Branche du run (`skraft/us-2`, clone `/tmp/essai-mcp-skraft-zqGCsb`) **non poussée**.

## 08/11 — Plusieurs rapports de tests pour une commande (`{rapports}`, ADR 0072 révisé)

- **Trouvé en préparant le run BDD** (vérification gratuite, sans LLM, avant de lancer) : le
  `main` BDD d'`exemple-dotnet-tdd` a deux projets de test (`Tarification.UnitTests` : Reqnroll ;
  `Tarification.Tests` : xUnit). Avec `LogFilePath={rapport}`, le second rapport écrasait le
  premier : 3 tests relevés sur 5, et les canaris `missing_symbol` et `syntax` « pas vus ». Le run
  aurait jugé DELIVER sans ses tests unitaires.
- **Fait** (`stack-adapters` seulement ; l'extension, le workflow et le serveur MCP en profitent) :
  jeton `{rapports}` (dossier, tous les fichiers réunis) ; erreurs de compilation **ajoutées** aux
  rapports présents ; couvertures **réunies** par ligne ; `executerTests` (`execution-tests.ts`)
  partagé par l'adaptateur et les canaris, qui recevaient `{couverture}` vide.
- **Vérifié en vrai** (`dotnet`, copie du `main` GitHub) : 5 tests relevés, six constats `ok`
  (dont le canari BDD), couverture réunie de 5 fichiers.
- **Piège** : avant, `lireCouverture` gardait le premier rapport Cobertura (« le premier lisible
  fait foi ») : avec deux projets, la porte de couverture aurait vu la moitié des lignes.
- **Remarqué, non traité** : les fichiers de la couverture .NET sortent sans `src/`
  (`Tarification.Domaine/Panier.cs`), comme avant ce changement.
- Tests : `test/rapports-multiples.test.ts` (12) ; vus rouges sauf deux qui passaient déjà
  (acceptation du jeton ; dossier vide lu comme absent, par accident). L'ajout des erreurs de
  compilation et la fusion de couverture vérifiés en les cassant.
- Pile de l'essai BDD : `LogFilePath={rapports}/{assembly}.xml`, `unitTests` dans
  `tests/Tarification.Tests`, `acceptanceTests: []` plus le couple `bdd` Reqnroll.

## 08/11 — Skill `bdd-step-definitions` (ADR 0074 §3)

- **Quoi** : `skills/bdd-step-definitions/SKILL.md`, dans l'extension et le workflow (copies
  identiques). Écrit pour agent-studio, en français, à partir des idées de *GOOS* (Freeman et
  Pryce, ch. 5, 8, 10, 11, 21 à 23, 27), reformulées, provenance en commentaire. Aucun langage ni
  lanceur : exemples en Gherkin et pseudo-code. Contenu partageable (ADR 0024), aucun outil
  d'agent-studio nommé.
- **Contenu** : trois étages (scénario, étapes, pilotes) ; étape en une ligne ; pilotes en langage
  métier (impératif pour agir, description pour vérifier) ; faux systèmes externes minimaux, ne
  doubler que ses types ; builders à valeurs par défaut (le scénario ne porte que les valeurs du
  critère, intactes jusqu'au pilote) ; contexte neuf par scénario ; un rouge sur la vérification
  métier, jamais une étape sans définition ; attendre un effet, jamais une durée ; une étape qui
  résiste fait poser la question.
- **Branchement** : à la demande de l'agent d'acceptance (`ROLE_SKILLS.acceptance`, `meta.agents`
  du workflow), et `ligneBdd` dit de la charger avant d'écrire les étapes. Ajoutée à `SKILLS` avec
  un commentaire qui la distingue des reprises de skraft-plugin.
- Tests : `brief.test.ts` (deux copies) et `agents-skills.test.ts` vus rouges ; nouveau
  `tests/workflow-skraft/test/skills.test.ts`, dont la garde d'existence (une skill accordée doit
  exister) passait déjà et a été vérifiée en retirant la copie.

## 08/11 — Canari BDD de `/stack doctor` (ADR 0074 §3)

- **Quoi** : pour chaque couple `bdd` du profil, `runCanaries` écrit lui-même
  `<features>/<marque>.feature` (Gherkin, `# language: en` imposé), dont l'étape n'a aucune
  définition, lance la commande de test et juge le résultat (`jugerCanariBdd`, `canaries.ts`).
  Rien n'est à déclarer dans le profil : Gherkin ne dépend d'aucun langage.
- **Oracle** : la porte de DISTILL ne refuse que `other_error` et les tests ignorés. Le canari est
  donc `ok` pour ces deux-là ; `probleme` si le scénario est réussi, classé `assertion`,
  `missing_symbol` ou non classé (le pire l'emporte) ; `avertissement` s'il est absent du rapport
  (dossier non découvert, ou lanceur qui n'exécute un .feature que chargé par ses étapes, comme
  jest-cucumber ou pytest-bdd) ou s'il n'y a aucun rapport.
- **Piège** : la marque est cherchée **sans casse**. Vérifié en vrai (Reqnroll 3.3.4, xUnit,
  JunitXml) : le test s'appelle `…C1A2B3C4CanaryFeature.C1A2B3C4Canary`, et l'échec
  `XUnitPendingStepException … No matching step definition found` est classé `other_error`
  par notre lecteur → `ok`. Les autres lanceurs ne sont pas vérifiés : c'est le canari qui le dira
  sur leur projet.
- Tests : `packages/stack-adapters/test/canari-bdd.test.ts` (13 ; 12 vus rouges, le 13e — « sans
  BDD, aucun .feature » — est une garde ; la recherche sans casse vérifiée en la cassant).

## 08/11 — BDD (ADR 0074), brique 3b : DISTILL et DELIVER en BDD, extension et workflow

- Les couples BDD atteignent les extensions et les workflows : `ctx.stack.bdd` (en processus, et
  isolée par la requête d'activation) et `w.disposition().bdd`.
- Fonctions pures en deux copies (`gherkin.ts` / `gherkin.mjs`, `brief.ts` / `brief.mjs`) :
  `dossiersDesFeatures` (dossiers `features` des couples, sinon `.skraft/<slug>/distill/features`),
  `checkTitresBdd` (titre d'un scénario `@ac-<n>` qui commence par `AC-<n>`, casse et séparateur
  libres), `ligneBdd` (consigne du dossier de passation de DISTILL).
- Branché des deux côtés : la porte `gherkin` de DISTILL lit les `.feature` du projet et refuse un
  titre sans critère ; le dossier de passation de DISTILL dit où écrire le `.feature` et ses étapes ;
  DELIVER lit le scénario dans le projet. Le gel et l'empreinte n'ont rien demandé : les dossiers BDD
  sont déjà dans `acceptanceTests` (brique 3a).
- Agent d'acceptance (deux copies) : le cas BDD mentionné, sans nommer d'outil d'agent-studio.
- Tests de bout en bout des deux côtés (`e2e-bdd`) vus rouges puis verts : story livrée, `.feature`
  commité dans le projet et rien dans `.skraft/` ; titres sans critère refusés par la porte `gherkin`.
- **Reste** : détection BDD par `/stack init` (lanceur dans les manifestes, dossiers `.feature` et
  étapes) ; skill par lanceur (Reqnroll d'abord) ; run réel sur la version BDD d'`exemple-dotnet-tdd`.

## 08/11 — BDD (ADR 0074), vérification sur Reqnroll et brique 3a : le réglage `bdd`

- **Vérifié sur la version installée** (clone du `main` BDD d'`exemple-dotnet-tdd`, Reqnroll 3.3.4,
  xUnit, JunitXml.TestLogger 4.1.0, .NET 10) : le nom du test vient du titre du scénario
  (`LeClientChiffreUneLigneDePlusieursArticles`, classe `…ChiffrerUnPanierLigneALigneFeature`) ; le tag
  `@ac-1` devient `Trait("Category","ac-1")` dans le `.feature.cs` généré, mais **l'enregistreur JUnit
  n'écrit aucun attribut** (sa documentation le dit). Un titre « AC-1 Le client… » donne
  `AC_1LeClient…`, que `acOf` reconnaît déjà. Le Gherkin du projet est en français.
- **Décisions du responsable (08/11)** : le `.feature` de DISTILL va au projet, tel quel ; le titre de
  chaque scénario commence par son critère (`AC-n`) ; le code vérifie à chaque porte que le `.feature`
  du projet est exactement celui de DISTILL (empreinte).
- **Brique 3a** : `bdd` dans le profil de pile (`false` = absent ; liste de couples `{ lanceur,
  features, etapes }`, lanceurs connus : Reqnroll, SpecFlow, Cucumber-JS, jest-cucumber,
  Cucumber-JVM, pytest-bdd, behave). Les dossiers d'un couple rejoignent `acceptanceTests` : le gel
  de DISTILL et `isTestFile` les couvrent. `StackAdapter.bdd` expose les couples ; l'adaptateur
  composé les ramène à la racine du projet. **Piège** : une union zod (`false` ou liste) perdait le
  chemin de l'erreur (« bdd — Invalid input ») ; `false` est ramené à « absent » avant la validation.

## 07/11 — Composants (ADR 0074), brique 2 : /stack, /stack doctor, /stack init, serveur MCP

- `/stack` dit les composants (nom, pile, racine) ; `/stack doctor` en fait un diagnostic chacun,
  relu dans sa racine (emplacements, fichiers de détection), canaris dans la racine du composant au
  sein de la copie isolée.
- `/stack init` cherche les sous-projets jusqu'à **4 niveaux** (dépendances installées et dossiers
  cachés écartés : `node_modules`, `bin`, `obj`, `target`, `dist`, `vendor`, `.*`). Un seul reconnu à
  la racine : la section `pile`, comme avant ; plusieurs, ou un seul hors de la racine : la section
  `composants`, montrée, confirmée en nommant les programmes, écrite par
  `ecrireComposantsDansProjet` (commentaires et `qualite` gardés, `pile` retirée). Composants déjà
  déclarés : rien n'est écrasé.
- Lecture des composants unifiée (`profilsDesComposants`, `pileComposee`) : projet, `/stack` et pile
  fournie par le client passent par les mêmes contrôles. L'argument `pile` du serveur MCP accepte
  `composants:`.
- **Limite connue** : `proposeProfile` ne reconnaît toujours que TypeScript (Vitest) et Python ; un
  sous-projet .NET n'est pas proposé (`exemple-dotnet-tdd` a son profil écrit à la main).
- Tests vus rouges puis verts (`stack-command`, `workspace-services`, `pile`).

## 07/11 — Composants (ADR 0074), brique 1 : adaptateur composé, section composants, branchement

- `createComposedAdapter` (`stack-adapters/src/composants.ts`) : les composants derrière le port
  `StackAdapter`. Emplacements réunis et ramenés à la racine du projet ; `isTestFile` délègue au
  composant qui contient le fichier ; tests lancés dans chaque racine, identifiants préfixés
  (`services/api: …`), fichiers et couverture ramenés à la racine du projet ; lint et format ne
  reçoivent que les fichiers de leur composant ; format attesté seulement si tous les composants
  touchés l'ont ; mutation fusionnée (score pondéré par le nombre de fichiers) ; règle de dépendance
  en chemins ramenée à la racine de son composant. Une opération qu'aucun composant n'a reste absente.
- `projet.yaml` : section `composants` (`nom`, `racine`, `pile`), exclusive de `pile`. Racine
  normalisée (`./services/api/` → `services/api`), relative, sans `..` ; noms uniques ; racines qui se
  chevauchent refusées (`.` avec d'autres compris).
- `project-services` : un projet à composants obtient l'adaptateur composé (chaque pile validée comme
  une pile seule, contre la liste de l'administrateur) ; une pile refusée est nommée par son
  composant, et la détection reprend la main. `pile()` donne les composants (nom, racine, id).
- Tests vus rouges puis verts. Trois branches de l'adaptateur (format, mutation, imports) codées avant
  leur test : chacun vu rouge en cassant la ligne qu'il protège.
- **Reporté par le responsable** : composants touchés seulement aux portes (une économie de temps ;
  piège noté dans l'ADR : la liste des tests verts est remplacée à chaque pas). **Reste** : `/stack init` et
  `/stack doctor` par composant ; argument `pile` du serveur MCP au format composants ; écriture de
  `pile` par `/stack init` quand le projet a des composants.

## 07/11 — ADR 0074 accepté : composants d'un projet, BDD par composant (rien d'implémenté)

- Question du responsable : donner le choix TDD ou BDD, et traiter les dépôts qui mélangent les
  technologies. Vérifié dans le code : une seule pile par projet (`selectStackAdapter`, une section
  `pile`) ; le Gherkin de DISTILL n'est jamais exécuté ; `/stack init` ne lit que la racine.
- Lu dans skraft-plugin v2 (`integration/v2-next`, 07/11) : composants (racine, pile, commandes),
  portes par composant touché, `bdd` par composant (`false`, couples `{ runner, features, steps }`,
  non décidé → run refusé), détection du lanceur dans les manifestes des sous-projets.
- ADR 0074 **proposé** : section `composants` dans `projet.yaml` (`pile` seule reste valable),
  adaptateur composé derrière le port `StackAdapter`, portes par composant touché ; puis `bdd` par
  composant, `.feature` et étapes écrits en DISTILL et gelés, scénario relié à son test par `@ac-<n>`.
  Différence voulue avec la v2 : `bdd` absent ne bloque pas les projets existants. **Décidé par le
  responsable : le TDD toujours, le BDD au choix** (un composant qui ne dit rien n'est pas en BDD).
- Critères `composants-d-un-projet` et `bdd-par-composant` (false). ADR **accepté** par le responsable
  (détection des sous-projets jusqu'à 4 niveaux). Prochaine étape : les composants (brique 1).

## 07/11 — Run de mesure US-2 avec Claude (`docs/runs/2026-11-07-us-2-mcp-claude/`)

- But : mesurer le réfutateur (ADR 0069), le disjoncteur (ADR 0073) et `passation.md`. Même départ que
  les runs du 05/11 et du 06/11 (`a7cf6db`), serveur MCP reconstruit le jour même, runtime Claude.
- Résultat : **fini**, 26m10, 40 tours, 7 rejets, **13,83 $**, `dotnet test` 10/10 ; aucun ADR au final.
  Le 06/11 : 18m24, 34 tours, 4 rejets ; son coût (2,27 $) était sous-estimé, pas comparable.
- **DESIGN coûte 10,4 $ sur 13,8** : 8 essais, une escalade au budget, une correction de revue. La porte
  de cohérence refuse 4 fois pour des noms cités dans `contracts.md` ou un ADR et absents des modèles :
  les deux architectes ne restent pas alignés. C'est la piste d'économie principale, avant les revues
  (2,26 $, 20 tours dont le réfutateur).
- `passation.md` : 5 réponses écrites et commitées ; une seule question bloquante dans tout le run.
  Disjoncteur : sans effet (le refus répété tombait au 3e essai, celui du budget). Réfutateur : 2
  appels, aucune réfutation.
- Branche du run poussée sur `exemple-dotnet-tdd` : `tests/us-2/mcp-claude-2` (`5fe93b0`).

## 07/11 — Questions ouvertes tranchées ; réponses humaines citables (passation.md)

- **Décisions du responsable** : (1) gel des tests d'acceptance **absolu**, aucune retouche même
  mécanique ; (2) qualité de forme au-delà du formatage : état des outils noté dans `features.json`
  (rien de prêt pour C#) ; (3) budget de questions des agents **mis de côté** ; (4) réponses humaines
  écrites et **commitées** (le gel pour les agents se décidera plus tard).
- **Fait (4), extension et workflow** : `passationMd`, `reponsesDeLUtilisateur`, `ecrirePassation`
  (deux copies, `brief.ts` / `brief.mjs`). Le code écrit `.skraft/<slug>/passation.md` avant chaque
  tour d'agent (RESEARCH, spécialistes, pas de DELIVER), une réponse par ligne ; le dossier de
  passation y renvoie comme source à citer ; le fichier part dans les commits de la phase.
- **Piège** : écrit pendant un pas de DELIVER, le fichier comptait parmi les fichiers modifiés par
  l'agent : la porte RED refusait le pas (« Seuls des tests unitaires… »), et pire, la porte verte
  aurait pu le prendre pour du code de production. Les portes des pas l'écartent (`horsPassation`).
- **Second piège** : le workflow n'écrivait le fichier qu'en début de pas ; une réponse donnée en
  cours de pas n'y entrait qu'au pas suivant, et le test passait même sans l'exception — il ne prouvait
  rien. Écrit désormais juste avant chaque appel à l'agent, comme l'extension. Les deux tests de bout
  en bout sont vus rouges sans l'exception, verts avec.

## 07/11 — Lot [1] des reprises de skraft-plugin v2 : deux tâches mises en attente

Décidé par le responsable, après le disjoncteur (PR #19). Les deux restent à faire, dans l'extension
et le workflow, en TDD ; critères `lentilles-informees-des-portes-jugees` et
`skills-disent-ce-que-le-code-verifie` (à `false`, verify à écrire avec le code).

1. **Dire aux lentilles ce que les portes ont déjà jugé** (« Not yours to report » de la v2) : le
   dossier de chaque lentille liste les portes déjà passées par le code (tests, couverture, lint,
   format, règles de dépendance…), pour qu'elle ne reproche pas ce qui est vérifié. But : moins de
   défauts redondants, donc moins de tours de correction.
2. **Nos skills disent ce que le code vérifie déjà** : celles reprises de v1 décrivent encore des
   étapes faites par les portes. Contenu partageable (ADR 0024) : ne nommer aucun outil
   d'agent-studio.

Restent aussi, hors du lot [1] : re-revue incrémentale et désaccord isolé (lot [2], à mesurer par un
run réel) ; lentilles spécialisées, boucle de mutation par fichier, contrôle du patch pendant une
correction, « accepter les défauts restants » (lot [3]).

## 07/11 — Disjoncteur des réessais (ADR 0073, proposé)

- Repris de l'idée de skraft-plugin v2 (lot [1]) : deux refus **identiques de suite** — même porte,
  même ensemble de motifs, à l'ordre et aux espaces près — escaladent aussitôt, motif préfixé
  « Même refus deux fois de suite : » (une seule fois, même quand il remonte du pas au scénario).
- Où : portes de phase (workflow `essayer` et boucle de phase de DELIVER ; extension `failure`), pas
  de DELIVER (`pas` ; `stepFailure`), reprises de scénario et de correction (`scenario`, correction ;
  `scenarioFailure`). Ne comptent pas et **rompent la suite** : un tour interrompu (délai) et un essai
  garanti. Côté extension, « de suite » s'appuie sur le numéro d'essai (`dernierRefusDePhase`),
  côté workflow sur l'oubli du refus précédent.
- `memeRefus` et `disjoncte` vivent une fois dans le cœur (`packages/core/src/retries`) : l'extension
  les a par `extension-api`, le workflow par sa bibliothèque (`bibliotheque.ts`, `pour-les-scripts.ts`).
- **Piège** : sept tests (réducteur, e2e-s2 des deux côtés) épuisaient un budget en répétant le même
  refus. Ceux qui visaient le budget ont reçu des motifs différents ; e2e-s2 attend maintenant
  l'escalade au deuxième essai, ce que voulait le changement.
- Test du workflow vu rouge en remettant l'ancien `livraison.mjs`, puis vert.
- ADR 0073 (portée ci-dessus) : **accepté** par le responsable le 07/11.

## 07/11 — Profils de pile (ADR 0072), brique 3 : analyse des imports

- Section `architecture` du profil : `fichiers`, motif `import` (groupe `module`, appliqué ligne à
  ligne), `modules` (nom → motifs de chemin ; le premier qui correspond l'emporte ; un fichier hors
  module n'est pas jugé). `analyserImports` (`profile/architecture.ts`) rend le rapport attendu par
  les portes (`modules`, `violations`) : la règle de dépendance redevient vérifiable, elle ne
  l'était plus nulle part depuis le retrait de Swift.
- Règle visée par **nom** de module ou par **chemin** (`src/domain`, comme dans l'exemple de la
  section qualite) ; interdit égal, préfixe suivi de `.`, `/`, `:`, ou segment égal — jamais une
  sous-chaîne (`Infra` n'enfreint pas `Infrastructure`). **Ajout en cours de route** : un import
  relatif est résolu depuis le fichier, sans quoi une règle en chemins ne voyait aucun import
  TypeScript (`../infrastructure/db.js`).
- Garde des motifs mise en commun avec `buildErrors` (`motif-sur.ts` : longueur, quantificateur
  imbriqué, lignes bornées) ; tests de `buildErrors` inchangés et verts.
- `profiles/typescript.yaml` déclare la section ; le test qui disait « un profil ne sait pas » exige
  maintenant que la règle de sa section qualite soit vérifiée. `/stack doctor` avertit sans section.
- Limite assumée : analyse textuelle (un import en commentaire compte).

## 07/11 — Profils de pile (ADR 0072), brique 2 : lecteur TAP

- `parseTap` (`reports/tap.ts`), `report: tap` pour la section `tests`. Écrit d'après une **vraie
  sortie** de `node --test --test-reporter=tap` (Node 22.22), gardée en `fixtures/node-test.tap`.
- Constats sur cette sortie, qui ont fixé le lecteur : les blocs `describe` sont aussi des lignes de
  résultat, écrites **après** leurs enfants (écartés : un résultat qui a des enfants n'est pas un
  test) ; `location` n'est donné **qu'aux échecs** (un test sans fichier prend celui du bloc parent
  qui le donne, sinon vide) ; un symbole absent arrive en `ReferenceError … is not defined`. La
  classification passe `name: message` à `classifyFailure`.
- TAP lu sur la **sortie standard** quand la commande ne nomme pas `{rapport}` (`prove`, `bats`).
- **Piège** : `node --test tests/` (un dossier) échoue sous Node 22 (« Cannot find module ») ; sans
  chemin, node trouve les fichiers lui-même. Noté dans le README des profils, avec le fait que
  `node` n'est pas autorisé par défaut (interpréteur).
- Tests vus rouges puis verts, dont un contre le vrai `node --test`.

## 07/11 — Profils de pile (ADR 0072), brique 1 : détection au contenu

- `detect` accepte `{ fichier, contient }` en plus d'un nom de fichier : le fichier existe et
  contient la sous-chaîne (pas d'expression régulière, chemin relatif sans `..`, 1 Mo au plus).
  Un élément suffit, comme avant. Fonction commune `detecte` (adaptateur de profil et `/stack doctor`,
  qui ne comparait que des noms) ; `libelleDetect` pour les messages du doctor.
- `profiles/typescript.yaml` et le modèle TypeScript de `/stack init` exigent `"vitest"` dans
  `package.json`, comme l'adaptateur écrit à la main.
- ADR 0072 (forme des trois sections) : **accepté** par le responsable le 07/11, après la PR #17.
- Tests vus rouges puis verts (`detection-contenu.test.ts`, modèles livrés).

## 07/11 — Distribution et mise à jour du serveur MCP : paquet npm (décidé, pas fait)

- **Constat** : le serveur MCP tourne depuis `apps/mcp-skraft/dist/`, non versionné (`.gitignore`),
  fabriqué par `pnpm --filter @agent-studio/mcp-skraft build`. Ce build **recopie**
  `workflows/skraft/` dans `dist/workflows/skraft/`, et le serveur charge le workflow depuis cette
  copie. Un `dist/` déjà construit garde donc l'ancien workflow tant qu'on ne relance pas le build,
  puis le client MCP (Claude Code, Copilot CLI). Rien ne signale un `dist/` en retard.
- **Décidé par le responsable** : distribuer le serveur en **paquet npm versionné**, sur GitHub
  Packages, privé à l'organisation `freecompub`. Le client le déclare une fois :
  `npx -y @freecompub/mcp-skraft@1`. Mise à jour : une nouvelle version publiée ; `npx` prend la
  dernière `1.x` au démarrage suivant du client (ou une version fixée pour la figer). Écartés : une
  archive dans les releases GitHub (mise à jour manuelle, facile à oublier) ; le serveur livré avec
  l'application de bureau (elle n'a pas encore de mise à jour).
- **À faire, dans l'ordre** :
  1. fixer la licence du reste du paquet (le workflow est GPL-3.0-or-later, livré en sources) ;
  2. `package.json` : nom `@freecompub/mcp-skraft`, retirer `"private": true`, champ `files`
     (`dist/`), version semver ;
  3. le serveur dit sa version (journal et `skraft_etat`) ; aujourd'hui `0.0.0` ;
  4. CI : build puis publication à chaque tag de version ;
  5. README : installation par `npx`, mise à jour, version fixée ;
  6. ADR qui consigne ce choix.

## 07/11 — Escalade d'un scénario selon sa cause (ADR 0066, accepté et révisé)

- **Décisions du responsable** : option A (aucun agent ne réécrit un test existant), puis, plutôt que
  « rejouer DISTILL » ou « mettre en pause », le principe des défauts hors du changement : l'humain
  déclare le test obsolète, il sort des portes, le cycle se termine, le bilan rappelle de le mettre à
  jour. **Piège évité** : la pause aurait laissé l'humain corriger, puis un retour au début de DELIVER
  (rollback Git : `read-tree --reset`, `clean`) aurait effacé sa correction.
- **Cause connue du code**, dans les deux implémentations : chaque refus porte les tests en échec vus
  (`rouges`) et, à la porte du scénario, les lignes sous le seuil (`lignes`). Un rouge qui passait au
  début de DELIVER (`avantDeliver`) est candidat à l'obsolescence. Fonctions pures en deux copies :
  `causeDEchec`, `optionsSelonLaCause`, `texteDeLaCause`, `sansTestsObsoletes`.
- **Escalade** : « Déclarer ces tests obsolètes et continuer » (`obsolete`), « Exempter ces lignes et
  continuer » (`exempt` / `exempter` dans le workflow), puis relancer, sauter, abandonner. Le scénario
  reprend ; l'agent reçoit l'avis « tests déclarés obsolètes : ne les modifie pas ».
- **Effets** : tests obsolètes retirés des résultats que lisent les portes de DELIVER (les preuves
  gardent l'exécution complète). **Piège trouvé par le test** : la porte « suite finale » lit aussi le
  code de sortie, resté à 1 ; il est rendu à 0 quand les seuls échecs retirés étaient obsolètes. Les
  lignes exemptées sortent désormais du calcul **à la porte du scénario** aussi (avant : fin de
  DELIVER seulement). `derogations.md` a une section « Tests existants déclarés obsolètes » ; le bilan,
  un rappel « À corriger après le cycle ».
- **Trace** : troisième décision d'arbitrage, « obsolète » (cœur, moteur de tâches, workflow) ; avant,
  le moteur rangeait toute décision inconnue en « à corriger ».
- Rembobinage de toute la phase DELIVER : tests obsolètes oubliés avec les dérogations.
- Le chemin de correction de revue escalade avec les mêmes options, dans les deux implémentations.

## 07/11 — Runtime Claude, brique D : documentation ; critère rempli

- ADR 0070 : section « Mise en œuvre dans l'application » (réglage, connexion sans GitHub,
  modèles, suppression des sessions, mode d'essai). `CLAUDE.md` : deux adaptateurs, projet Vitest
  `runtime-claude`, arborescence.
- Critère `runtime-claude-cli` passé à `true` après son `verify` (runtime, contrôleur, réglages,
  interface, connexion du serveur MCP).
- Prochaine étape : essayer l'application **à l'écran** avec un vrai Claude (choisir Claude, ouvrir
  un projet, un tour de conversation, puis une tâche) ; ce n'est couvert que par les doubles.

## 07/11 — Runtime Claude, brique C : choix du runtime dans l'interface

- L'application lit `runtime:status` au démarrage. Avec Claude, elle n'attend que la connexion de
  Claude Code : GitHub n'est pas demandé, et l'utilisateur affiché est « Claude » si GitHub n'est
  pas connecté.
- Écran de connexion : si Claude est disponible, un choix « Quels agents ? » (GitHub Copilot ou
  Claude). Avec Claude, l'écran dit de lancer `claude auth login` dans un terminal (ou d'installer
  Claude Code), puis propose « Vérifier la connexion ». Avec Copilot seul, rien ne change.
- Conversation, en mode avancé : un sélecteur « Agents ». Changer de runtime ferme la conversation
  côté principal ; la clé du `ChatScreen` la rouvre sur le nouveau. Avec Claude, le bouton « Se
  déconnecter », qui déconnecte de GitHub, est masqué.
- Essais Electron (`xvfb-run -a pnpm e2e`) verts : le mode d'essai ne propose pas Claude. Sans
  `xvfb-run`, Electron ne démarre pas sur cette machine (pas d'affichage) : ce n'est pas un défaut.
- **Test intermittent corrigé** : « blocker sur un fichier non touché… » (`extensions/skraft/test/
  e2e-notes.test.ts`), vu en local puis en CI de la PR #15 (`bilan` à `undefined`). Le bilan est
  publié par un effet **après** la transition vers DONE ; le test le cherchait aussitôt. Il l'attend
  maintenant (`until`), comme `e2e-s1`. Le jumeau du workflow n'a pas ce défaut : son bilan est dit
  avant la fin du run. Course non reproduite à la demande : la cause est lue dans l'erreur et le code.

## 07/11 — Runtime Claude, brique B : choix du runtime dans l'application (processus principal)

- Réglage `runtime` (`copilot` par défaut, ou `claude`) dans `settings.json` ; canaux IPC
  `runtime:status` (choisi, disponibles, état de la connexion Claude) et `runtime:set`.
- Avec Claude, la conversation ne demande **pas** GitHub : la connexion est celle de Claude Code
  (`claude auth status`). Non connecté ou absent : la conversation ne démarre pas, et le message dit
  quoi taper (`claude auth login`) ; l'échec n'est pas retenu.
- Changer de runtime ferme la conversation et arrête l'ancien runtime (comme une déconnexion) ;
  même runtime : rien n'est fermé.
- Modèles : `listModels` de Claude rend les alias du CLI (`fable`, `opus`, `sonnet`, `haiku`,
  « alias for the latest model » dans `claude --help`). `modelFor` : les défauts `MODELES_CLAUDE`
  par classe, un réglage de classe l'emporte ; un identifiant Copilot resté dans les réglages du
  projet est écarté par la liste du runtime (les réglages de modèle sont par projet, pas par runtime).
- `index.ts` : Claude proposé hors mode d'essai seulement (les essais Electron ne lancent aucun CLI).
  Le SDK MCP du relais est intégré au bundle principal (`pnpm build` vérifié).
- Piège TDD : le schéma des réglages avait été modifié avant son test ; retiré le temps de voir le
  test rouge, puis remis.

## 07/11 — Runtime Claude, brique A : suppression des sessions, connexion partagée

- `deleteSession(id)` applique la stratégie du 06/11 : `<projectsDirectory>/*/<id>.jsonl` et le
  dossier `<id>/`, rien d'autre. Un identifiant qui n'est pas un UUID n'est pas à nous : ignoré
  (journalisé), et retiré du registre. Une session absente compte comme supprimée. Dossier des
  sessions inconnu : échec, pour que le registre réessaie au démarrage suivant (`task-agent-runner`).
- `projectsDirectory` vient de `claude auth status`, désormais une méthode du lanceur (`statut`).
- `etatConnexionClaude(lanceur)` et `MODELES_CLAUDE` passent du serveur MCP à `runtime-claude` :
  l'application s'en servira ; le serveur garde ses messages (« appelle skraft_connexion »).
- Tests vus rouges puis verts (suppression : dossier jetable qui imite celui de Claude Code, avec la
  mémoire et une session de l'utilisateur, qui doivent survivre).

## 07/11 — Fichier de projet (ADR 0071) : l'exemple livré au nouveau format

- `profiles/typescript.yaml` est désormais un `projet.yaml` complet : section `pile` (l'ancien
  profil, plus `format: [prettier, --check, "{fichiers}"]`) et section `qualite` commentée (cœur,
  couverture, mutation, dépendances). Le README de `profiles/` décrit les deux sections, la
  transition et la porte de format ; SPEC (profil de stack) renvoie à l'ADR 0071.
- **`prettier` ajouté aux programmes autorisés par défaut** (`admin-config`), sans quoi l'exemple
  serait refusé. Choix fait ici, à signaler : un outil de format peut réécrire les fichiers du
  projet (`--write`), comme `eslint --fix` déjà autorisé ; il ne sort pas du projet. Les autres
  formateurs courants passent par un programme déjà autorisé (`dotnet format`, `cargo fmt`,
  `ruff format`). Un test vérifie maintenant que la copie de la liste dans les tests de
  `stack-adapters` reste égale à la vraie (elle avait pu diverger sans que rien ne le dise).
- Les trois tests qui lisent l'exemple livré (profils, lint et canaris contre les vrais outils)
  passent par `test/support/profil-livre.ts`.
- Documentation alignée : ADR 0049 (points 1 et 2 revus par 0071), ADR 0068 (pile du serveur
  MCP) et description de l'argument `pile` de `skraft_demarrer`, SPEC §8.5, `docs/16`, en-têtes de
  `quality-bar.ts` et des deux `deliver`. Les plans et bilans datés restent tels qu'écrits.
- `/stack init`, quand rien n'est reconnu, ne parle plus de « deux exemples » (il n'en reste qu'un
  depuis le retrait de Swift).

## 07/11 — Fichier de projet (ADR 0071), brique 3 : porte de format

- Profil de pile : commande facultative `format` (`dotnet format --verify-no-changes`,
  `prettier --check "{fichiers}"`), sans rapport ; son programme est vérifié contre la liste
  autorisée comme les autres. L'adaptateur ne lit que le **code de sortie** : 0 au format, autre
  hors format (fin de la sortie jointe, 4000 caractères) ; outil absent, délai ou code nul : non
  mesuré (`available: false`), jamais « au format ».
- Exposée comme le lint : `ctx.stack.format` (permission `shell:test`, `null` si la pile n'en
  déclare pas), hôte isolé (`stack.format`), workflow (`w.format`, appel journalisé `format`).
- `checkFormat(report, scenarioId)` → `{ motifs, faits, notes }`, en deux copies (`deliver.ts`,
  `deliver.mjs`), appelée en fin de scénario juste après le lint. Un écart est un motif de rejet du
  scénario, donc une correction pour le développeur ; sans commande, la note « Format non mesuré ».
- Piège : les e2e comparent la liste exacte des notes ; la nouvelle note s'y ajoute (e2e-s1, e2e-s5
  des deux côtés). Pas d'outil ajouté pour les agents : le code juge, l'agent reformate.
- Prochaine étape : exemples de `profiles/` au format `projet.yaml` ; pousser `feat/fichier-projet`.

## 07/11 — Fichier de projet (ADR 0071), brique 2 : `/stack init` écrit la section pile

- `ecrirePileDansProjet(existant, pile)` (`stack-adapters`, pur) : ajoute ou remplace la section
  `pile` de `projet.yaml` avec l'API `Document` de `yaml`, en gardant le reste **commentaires
  compris** ; un fichier existant illisible n'est pas écrasé (erreur, rien d'écrit).
- `/stack init` (dépendances de `project-services`) écrit `.agent-studio/projet.yaml` et nomme ce
  fichier dans ses messages ; toujours après confirmation de l'utilisateur.
- Tests vus rouges puis verts : écriture pure (3), `/stack init` (emplacement, et section `qualite`
  d'un `projet.yaml` existant gardée). Le faux Workspace du test lit désormais le disque.
- Non fait : les exemples commentés de `profiles/` restent au format de l'ancien `stack.yaml` (une
  section `pile` sans l'en-tête).

## 07/11 — Fichier de projet `.agent-studio/projet.yaml` (ADR 0071), brique 1 : lecture

- Branche `feat/fichier-projet`, partie de `main` après la fusion de la PR #13.
- Décidé par le responsable : regrouper `stack.yaml` et `quality.yaml` dans **un seul**
  `.agent-studio/projet.yaml`, avec **deux sections validées chacune selon ses règles** (`pile` :
  schéma du profil et programmes autorisés ; `qualite` : schéma strict de la barre). Revient sur les
  points 1 et 2 de l'ADR 0049 ; le reste de l'ADR 0049 tient.
- `lireFichierProjet` (`stack-adapters`) sépare les sections (clé de premier niveau inconnue
  refusée, nommée) ; `parseQualityBar({ projet })` lit la section `qualite` en priorité.
- **Transition** : sans `projet.yaml`, `stack.yaml` et `quality.yaml` (puis `.skraft/quality.json`)
  sont lus avec un avertissement « regroupe-le dans projet.yaml » ; avec `projet.yaml`, les anciens
  fichiers sont ignorés, et c'est dit s'ils sont encore là. Messages d'erreur : fichier **et section**.
- Branché partout : pile (`project-services`, `lireSourceDuProfil`), barre (workflow `livraison.mjs`,
  extension `deliver-effects.ts`), `GELÉS` (deux côtés).
- Conséquence voulue : une barre lue dans l'ancien `quality.yaml` porte désormais un avertissement ;
  deux tests qui l'attendaient sans (un test de mutation de l'extension, et e2e-s5 des deux côtés) ont
  été adaptés — e2e-s5 passe au nouveau format plutôt que d'attendre l'avertissement.
- Reste : la porte de format (brique 3).

## 07/11 — Runtime Claude : mémoire automatique coupée, version minimale du CLI

- **Vérifié par un mot-témoin** (projet jetable, `haiku`) : avec nos arguments du 06/11, la
  **mémoire automatique** de Claude Code (`<projectsDirectory>/<dossier encodé>/memory/MEMORY.md`)
  **est lue** par l'agent. En run réel, c'est celle des sessions de l'utilisateur sur son dépôt :
  elle entrait dans le contexte de nos agents.
- Deux moyens la coupent, **sans `--bare`** (qui imposerait une clé API) — noms vérifiés dans le
  binaire installé, puis essayés : `--settings '{"autoMemoryEnabled": false}'` et
  `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` ; dans les deux cas l'agent répond INCONNU et `memory_paths`
  disparaît de l'init. Appliqués **tous les deux** : le réglage dans `argumentsDuTour` (testé), la
  variable dans le lanceur.
- Données de l'essai supprimées (`~/.claude/projects/…-memoire-projet`, seulement ce projet jetable).
- **Version minimale** : `VERSION_MINIMALE = "2.1.319"` (celle des essais) ; `start` refuse une
  version plus ancienne (« il faut au moins 2.1.319, `claude update` ») ou illisible ; une plus récente
  est acceptée — le flux reste couvert par les tests de contrat sur les sorties enregistrées.
- Tests vus rouges puis verts (26) ; `pnpm smoke:claude` réussi avec les nouveaux arguments.

## 06/11 — Runtime Claude : les deux défauts de mesure du coût corrigés

- **Cumul à la reprise** : le runtime retient, par session, le cumul déjà compté et n'émet que
  l'écart (`coutDejaCompte`). Limite assumée : une session reprise après un redémarrage du serveur
  compte une fois le cumul de ses tours d'avant, qu'on ne connaît pas.
- **Ligne finale perdue** : attente par défaut portée de 5 s à **60 s** après l'outil terminal ; la
  réponse de l'outil terminal ajoute « Tour terminé : n'écris plus rien. » pour que le CLI rende
  vite sa ligne finale.
- Tests vus rouges puis verts (24 dans `runtime-claude`) ; `scripts/smoke-claude.ts` fait désormais
  deux tours sur la même session : 0,0016 $ puis 0,0003 $ (l'écart, pas le cumul), les deux clos.

## 06/11 — Run réel US-2 avec Claude par le serveur MCP (`docs/runs/2026-11-06-us-2-mcp-claude/`)

- `scripts/essai-mcp-skraft.ts` : `--runtime=claude`, `--base=<commit>`, source par adresse Git ;
  tableau des étapes en fin de run (une par phase et par rejeu : début, fin, durée, tours, rejets avec
  porte et motifs, coût, modèles).
- Le `main` GitHub d'`exemple-dotnet-tdd` n'a plus de `.agent-studio/stack.yaml` ni de
  `.skraft/quality.json` (converti à skraft-plugin v2 : `skraft-config.json`, BDD) : le serveur
  **refuse de démarrer sans pile** (ADR 0068, point 8) — vu en réel, rien consommé. Run refait depuis
  `a7cf6db`, le commit du run Copilot, décidé par le responsable.
- Résultat : **fini**, 18 min 24 s, 34 tours, **4 rejets** (citations en RESEARCH, cohérence en DESIGN,
  revue en DISTILL, correction ciblée en DELIVER), ADR-003 ratifié, `dotnet test` 10/10. Le
  **réfutateur** a réfuté un défaut major ; des défauts de DELIVER ont été rangés en **notes**.
- Branches poussées sur `freecompub/exemple-dotnet-tdd` (demandé par le responsable) :
  `tests/us-2/mcp-copilot-1` (run Copilot du 05/11) et `tests/us-2/mcp-claude-1`.
- **Deux défauts de mesure du coût** dans `runtime-claude`, vus dans la trace : (1) avec `--resume`,
  `total_cost_usd` est **cumulé** sur la session → additionné, il compte plusieurs fois ; (2) après
  l'outil terminal, le CLI met **plus de 5 s** à écrire sa ligne finale (opus) → arrêté avant, coût
  perdu (chercheur, architectes, réfutateur). Le total de 2,27 $ n'est pas fiable ; borne basse ≈ 1,26 $.
  À corriger : coût par différence avec le cumul précédent de la session, et attente plus longue (ou
  sans arrêt) de la ligne finale.

## 06/11 — Runtime Claude : stratégie de suppression des sessions (décidée, pas implémentée)

- Constat (vérifié sur les sessions des essais) : une session `claude -p` tient dans **un seul
  fichier**, `<projectsDirectory>/<dossier de travail encodé>/<id>.jsonl` ; aucune autre trace dans
  `~/.claude` ni `~/.claude.json`. `projectsDirectory` est donné par `claude auth status`. Le nom du
  dossier vient du dossier de travail (`/home/moi/Projets/x` → `-home-moi-Projets-x`).
- **Ce dossier n'est pas à nous** : en run réel, le dossier de travail est le dépôt de l'utilisateur,
  donc nos sessions sont rangées avec **ses** sessions Claude Code et la mémoire automatique du
  projet (`memory/`). Dans les essais, il n'était qu'à nous parce que le projet était jetable.
- **Stratégie retenue** : `deleteSession(id)` supprime `<projectsDirectory>/*/<id>.jsonl` (et un
  dossier `<id>/` s'il existe), **jamais le dossier du projet ni `memory/`** ; l'identifiant doit
  être un UUID (pas de chemin détourné) ; on ne touche qu'aux sessions que nous avons créées
  (identifiants tirés par nous, `--session-id`) ; une session absente compte comme supprimée (comme
  Copilot). Le nettoyage vient du registre des sessions, qui purge les orphelines au démarrage
  (ADR 0053) en appelant `deleteSession`.
- Écartés : `--no-session-persistence` (plus de reprise, dont on a besoin : réessai dans la même
  session, continuité des lentilles) ; `claude purge` (efface toutes les données Claude Code du
  projet, conversations de l'utilisateur comprises).
- À vérifier au run US-2 : la mémoire automatique du projet, partagée avec l'utilisateur, est-elle
  **lue** par nos agents ? (L'écriture y est refusée par la garde : hors du projet.)

## 06/11 — Runtime Claude (ADR 0070), brique 4b : choix du runtime dans le serveur MCP

- `mcp-skraft.json` : `runtime: "copilot" | "claude"` (Copilot par défaut) et `modeles` par classe
  (`strong`, `standard`, `light`) ; runtime inconnu refusé.
- `connexion-claude.ts` : connexion lue par `claude auth status` (JSON `loggedIn`) ; interactive, donc
  `skraft_connexion` dit de lancer `claude auth login` ; CLI absent : dit de l'installer. Modèles par
  défaut avec Claude : `strong` → opus, `standard` → sonnet, `light` → haiku (surchargés par la
  configuration).
- Sans duplication : `runtimeParesseux` (démarrer une fois, après vérification, échec non retenu),
  commun à la connexion Copilot (refaite dessus) et Claude.
- `assemblage.ts` choisit connexion et runtime selon la configuration ; `modelFor` passé aux services
  (avec Copilot, seulement les modèles que la configuration nomme).
- Essai stdio du paquet construit avec `runtime: "claude"` : démarre, répond, journal
  `"runtime":"claude"` — écrit après le code (composition), pas vu rouge.
- Reste : l'application de bureau (réglage, connexion, interface) ; un run réel sur US-2 avec Claude
  (accord du responsable).

## 06/11 — Runtime Claude (ADR 0070), brique 4a : coût en dollars dans la trace et les rapports

- L'événement `usage` du port porte `costUsd` (runtime Claude) ; l'exécuteur d'agents le trace
  (`coûtUsd` de l'entrée `usage`) ; `resumerTrace` l'additionne par étape, par phase et au total ;
  `skraft_rapport` le donne par étape (`coutUsd`, 0 avec Copilot, qui garde `aiu`).
- Le test de l'exécuteur a d'abord été mal écrit (option `trace` passée dans la spécification au
  lieu des options de `run`) : il échouait **avec et sans** le correctif — revu, vu rouge sans,
  vert avec. Aucun test ne couvrait jusque-là la trace d'usage écrite par l'exécuteur.

## 06/11 — Runtime Claude (ADR 0070), brique 3 : le runtime, et un essai réel réussi

- `createClaudeRuntime` (`packages/runtime-claude/src/claude-runtime.ts`), port `AgentRuntime` :
  une session = un relais MCP + deux fichiers privés (prompt système, configuration MCP avec le
  jeton) ; un tour = un processus `claude -p` (`--session-id` au premier, `--resume` ensuite ;
  `resumeSession` reprend d'emblée) ; le prompt système rappelle les noms MCP de nos outils
  (`report_phase` → `mcp__agent-studio__report_phase`) ; permissions → événements `permission` et
  `tool-denied` ; `start` vérifie le CLI (message qui dit quoi faire) ; `deleteSession` sans effet
  (les sessions restent dans le dossier du CLI). Lanceur réel : `createLanceurClaude` (processus
  enfant, sortie ligne par ligne, entrée fermée aussitôt).
- **Outil terminal (D18)** : le tour est clos à la ligne finale du CLI, ou au plus tard
  `delaiApresTerminalMs` (5 s) après la réussite de l'outil, et le CLI arrêté. **Piège vu à l'essai
  réel** : clos aussitôt, le CLI n'écrivait jamais sa ligne finale, qui porte le **coût** (0 $
  rapporté) ; corrigé, et testé.
- Tests (22) avec un faux `claude -p` qui appelle vraiment le relais (permission, outil terminal).
- **Essai réel** `scripts/smoke-claude.ts` (`pnpm smoke:claude`, hors CI, `haiku`) avec la **vraie
  garde** des agents de tâche (`createTaskAgentGuard`, périmètre `src/**`) : écriture dans `src/`
  faite, `interdit/non.ts` refusé avec le message de la garde, `CLAUDE.md` du projet ignoré, rapport
  reçu par `report_phase`, tour clos ; ≈ 0,0009 $, 6 s.
- Reste : choix du runtime (application, serveur MCP), connexion Claude, modèles par classe,
  coût en dollars dans l'usage et les rapports ; puis un run réel sur US-2.

## 06/11 — Runtime Claude (ADR 0070), brique 2 : relais MCP HTTP local

- `packages/runtime-claude/src/relais.ts` : un serveur MCP HTTP par session sur `127.0.0.1` (port
  libre), protégé par un jeton `Bearer` tiré au hasard ; sert nos `ToolSpec` (schéma JSON tel quel,
  serveur MCP bas niveau `Server`) et l'outil `permission` (demande normalisée → garde →
  `{behavior: allow|deny}`) ; signale chaque décision (ADR 0032) et la réussite d'un outil terminal
  (pour clore le tour, D18) ; une exception d'outil devient une erreur de l'outil. `configuration()`
  rend le JSON à donner à `--mcp-config`.
- Sans duplication : `decideSafely` (refus si la garde lève ou dépasse son délai, D28) déplacé de
  `runtime-copilot` vers le cœur (`packages/core/src/guards/decide-safely.ts`), utilisé par les deux
  adaptateurs ; tests Copilot inchangés (43).
- Piège : `http.close` attend les connexions gardées ouvertes par le client MCP — fermer avec
  `closeAllConnections()` d'abord, sinon les tests restent bloqués au nettoyage.

## 06/11 — Runtime Claude (ADR 0070), brique 1 : arguments, flux, permissions

- Nouveau paquet `packages/runtime-claude` (projet Vitest `runtime-claude`). Briques pures, testées
  sur deux **vrais flux** `stream-json` enregistrés pendant les essais (chemins anonymisés, dont le
  dossier de mémoire automatique de Claude Code) :
  - `argumentsDuTour` : isolement (`--setting-sources ""`, `--disable-slash-commands`,
    `--strict-mcp-config`), prompt système **par fichier** (`--system-prompt-file`) et prompt du tour
    par l'entrée standard (limite de 32 767 caractères d'une ligne de commande sous Windows),
    `--tools` sans Bash, nos outils autorisés, outil de permission caché et chargé des demandes,
    `--session-id` puis `--resume`, modèle et `--max-budget-usd` facultatifs.
  - `createTraducteur` : appels et résultats d'outils (refus compris, avec le message), messages,
    raisonnement, **usage compté une fois par message** (le flux le répète pour chaque bloc), coût en
    dollars au résultat, `idle` ou `error` (plafond de coût, etc.) ; toute autre ligne = activité.
  - `versDemande` / `reponsePermission` : demandes normalisées comme Copilot (la garde ne lit que
    `kind` et le chemin ; une demande `mcp` est refusée par défaut — nos outils, autorisés d'avance,
    n'en posent pas).
- Changé pour la conception : **toute** demande de permission passe par notre garde (comme Copilot),
  sans règles par chemin à côté ; et le relais devient un **serveur MCP HTTP local** servi par notre
  processus (`127.0.0.1`, port libre, jeton `Authorization: Bearer`), vérifié par un essai : plus de
  script relais en stdio.
- Port `AgentRuntime` : `costUsd` facultatif sur l'événement `usage`.
- Mémoire automatique de Claude Code toujours active sans `--bare` (dossier listé à l'init) : ses
  écritures passeraient par `Write`, donc par notre garde, qui refuse hors du projet.

## 06/11 — Essais de `claude -p` comme runtime (ADR 0070 accepté)

Question du responsable : donner le choix entre Copilot et Claude. Voie étudiée : le CLI de Claude
Code en mode non interactif plutôt que le Claude Agent SDK (aucune authentification nouvelle, aucun
SDK, plafond de coût par tour). Essais dans le dossier temporaire de la session, projet Git jetable,
mini serveur MCP (SDK du dépôt) qui journalise ses appels ; 5 appels `--model haiku`, ≈ 0,005 $.

| Vérifié (Claude Code 2.1.319) | Résultat |
|---|---|
| `CLAUDE.md` du projet | Chargé par défaut ; **`--system-prompt` ne l'écarte pas** (mot-témoin ressorti) ; **`--setting-sources ""` l'écarte**, sans `--bare` (qui imposerait une clé API) |
| Nos outils par MCP | `--mcp-config` + `--strict-mcp-config` : `report_phase` appelé avec les bons arguments, vu par le modèle sous `mcp__spike__report_phase` |
| Isolement | `--disable-slash-commands` : aucune skill ni commande ; `--tools` : seuls les outils donnés ; agents intégrés listés mais sans outil pour les lancer |
| Périmètre fixé d'avance | `--allowedTools "Write(allowed/**)"` + `--permission-prompts none` : écriture permise dans `allowed/`, **refusée avant l'écriture** ailleurs |
| Garde dynamique | **`--permission-prompt-tool mcp__…`** (absent de la liste des options de l'aide, mais accepté) : le CLI demande l'accord à notre outil pour chaque écriture non couverte, avec `tool_name` et `input` ; notre refus bloque, son message revient au modèle. `--disallowedTools` cache l'outil au modèle, le CLI s'en sert toujours |
| Flux `stream-json --verbose` | init (outils, serveurs MCP, modèle, session), appels et résultats d'outils, usage par étape ; résultat : `total_cost_usd`, `modelUsage`, `permission_denials` |

- Piège : sans `< /dev/null`, `claude -p` attend 3 s sur l'entrée standard (« no stdin data received »).
- Non vérifié : reprise (`--session-id`, `--resume`), interruption, `--json-schema`, relais réel du
  serveur MCP vers notre processus (dans l'essai, le serveur décidait seul).
- ADR 0070 **accepté** le 06/11 par le responsable ; critère `runtime-claude-cli` (false). Effort estimé :
  1,5 à 2 semaines. Rien ne change pour Copilot (adaptateur séparé, défaut inchangé).

## 06/11 — Temps par rejeu : une étape par phase et par essai (resumerTrace, skraft_rapport)

- Question du responsable : a-t-on, pour chaque phase et chaque rejeu, le début et la fin ? Avant :
  par phase oui (étapes de `resumerTrace`), par rejeu seulement quand la phase reprenait après une
  revue ; un rejeu après un rejet de porte restait **dans la même étape**.
- `resumerTrace` (`packages/core/src/trace/run-summary.ts`) : après un `rejet`, la prochaine activité
  de la même phase ouvre une **nouvelle étape** ; chaque étape porte `essai` (rang parmi les étapes de
  sa phase) et `fin` (début de la suivante, ou dernier événement). Le rejet appartient à l'essai qui a
  échoué (avant : à l'étape « qu'on va rejouer »). `parPhase` cumule et garde la fin du dernier essai.
- Choix : fait dans le résumé, commun à tout (extension, workflow, banc, MCP), plutôt que tracer un
  numéro d'essai que l'état d'un workflow n'a pas (`essaisMax` reste à 0 pour un workflow).
- Un test existant attendait l'ancien comportement (deux tours dans une étape après un rejet) : mis à
  jour, c'est le changement demandé. Le test du banc qui construit des étapes reçoit `essai` et `fin`.
- `WorkspaceServices.etapesDuRun(taskId)` (project-services) ; `skraft_rapport` ajoute `etapes`
  (`phase, essai, debut, fin, dureeMs, tours, rejets, aiu, modeles` ; `aiu` = `nanoAiu / 1e9`, qui a
  concordé avec la réserve sur le run du 05/11).
- Non fait : une colonne « Essai » dans le tableau des rapports du banc (`mesure-skraft.ts`) ; les
  lignes y sont déjà une par étape, donc une par rejeu désormais.

## 06/11 — Défauts hors du changement rangés en notes, extension et workflow

- Décidé par le responsable : un défaut hors du changement de la story ne renvoie pas le travail ;
  un **blocker** hors du changement est **notifié** — message immédiat, puis rappel dans le bilan
  sous « **À corriger après le cycle** » —, sans question ni blocage : sa correction se fait après la
  fin du cycle skraft (le run travaille sur sa branche, ses checkpoints supposent d'être seuls).
- `rangerHorsChangement` (deux copies de `review-thread`) : un défaut est une note si **aucun** de ses
  emplacements (ligne, occurrences) n'est à **3 lignes** (`TOLERANCE_HORS_CHANGEMENT`) d'une ligne
  modifiée depuis le checkpoint de la phase ; fichier non touché → note ; fichier sans lignes connues
  → tout le fichier compte ; défaut sans fichier → reste. Lentille REJECTED non touchée ;
  CHANGES_REQUESTED sans blocker ni major restant → APPROVED.
- Câblage : workflow `revue.mjs` (`fichiersDePhase` rend aussi `changements` ; `juger` range **avant
  le réfutateur**, `noterHorsChangement` accumule dans `d.notesHorsChangement` et informe pour un
  blocker, une fois) ; extension `effects.ts` (`runReview`, `changedFiles` du checkpoint de la
  phase ; les notes voyagent dans les verdicts gardés par l'état, `finalReport` les relit — le
  réducteur ne change pas). Rapports : « - note (hors du changement) : … » ; relecture JSON.
- Consigne des lentilles complétée (le défaut hors du changement est noté pour l'humain).
- En DESIGN et DISTILL, les livrables sont nouveaux : presque tout y est « dans le changement » ; la
  règle sert surtout en DELIVER et pour les fichiers existants cités.
- **Tests instables sous charge**, vus pendant ce travail, verts seuls (3 et 4 fois) :
  `extensions/skraft/test/e2e-s2.test.ts` › « recherche sans document : rejet explicite » et
  `e2e-s3.test.ts` › « incohérence rejetée… » (déjà à surveiller). Un test différent à chaque suite
  complète de l'extension : à surveiller, pas lié aux revues pour e2e-s2 (RESEARCH n'a pas de revue).

## 06/11 — Contrat de défaut enrichi (raison de la gravité, occurrences), extension et workflow

- `submit_lens_verdict` (`packages/core/src/agents/terminal-tools.ts`) : chaque défaut porte
  `severityReason` (**obligatoire**, 1 à 600 caractères) et `occurrences` (facultatif, `chemin:ligne`,
  20 au plus). Noms anglais, comme les champs voisins (`severity`, `target`). Un seul changement pour
  l'extension et le workflow (même outil).
- `verifierOccurrences` (deux copies de `review-thread`) : une occurrence vers un fichier absent est
  retirée, et c'est noté (`occurrencesNote`). Appelée dans la revue **avant** le réfutateur ; la
  liste des fichiers n'est lue qu'une fois (`juger`, `runReview`).
- La raison et les occurrences suivent le défaut : fil (`reviewRound`), retour au producteur
  (« — gravité : … — aussi : … », `precisions`), dossier du réfutateur, rapport `.md` ; conservées au
  rejeu (`lireVerdicts`, schéma zod).
- Consigne ajoutée aux quatre lentilles (`meta` du workflow, `roles.ts`) ; les `.agent.md` ne
  changent pas (ADR 0024).
- Piège : le champ obligatoire a cassé 23 tests de 14 fichiers dont les lentilles scriptées signalent
  des défauts ; complétés (`severityReason: "raison d'essai"`). Le schéma refuse désormais tout défaut
  sans raison : c'est voulu.
- Pièges d'édition : `review.mjs` et `review-brief.mjs` du workflow n'avaient **aucun** import ;
  l'import de `precisions` est en ligne 2.
- **Non fait**, dit au responsable : fusionner en un fil les défauts de lentilles différentes au même
  endroit — l'arbitrage d'un fil appartient à sa lentille (ADR 0046) ; à reprendre avec la re-revue
  incrémentale si besoin.

## 06/11 — Réfutateur des défauts de revue (ADR 0069), extension et workflow

- Décidé par le responsable (« on l'intègre chez nous ») ; idée de skraft-plugin v2, réimplémentée
  sans copie (prompt écrit à neuf). ADR 0069.
- **Règle pure**, dans les deux copies de `review-thread` : `defautsARefuter` (blocker et major, par
  lentille ; ni les minor, ni une lentille REJECTED) et `appliquerRefutations` (le code décide : une
  réfutation `accepted` ne compte que si sa raison cite `chemin:ligne` d'un fichier **qui existe** ;
  sinon, ou sans arbitrage, le défaut reste ; une lentille CHANGES_REQUESTED sans blocker ni major
  restant approuve ; les réfutés vont dans `refuted`, avec la raison).
- **Dossier** : `refuterBrief` (deux copies de `review-brief`) — défauts numérotés, puis les **mêmes
  entrées** que la lentille (cold-reader sans faits, quality-gates sans code ni tests), sans ses
  consignes.
- **Câblage** : workflow `revue.mjs` (`juger` → `refuter`, un appel par lentille en parallèle) ;
  extension `effects.ts` (`runReview` → `refuter`) : le **réducteur ne change pas**, il reçoit des
  verdicts filtrés. Réfutateur muet ou interrompu : rien n'est réfuté.
- **Agent** `skraft-finding-refuter` (classe `strong`, sortie `submit_lens_verdict` avec `rulings`,
  comme l'arbitre de mutants) : déclaré dans le `meta` du workflow et le manifeste de l'extension ;
  même fichier `.agent.md` des deux côtés (aucun nom d'outil, ADR 0024).
- **Rapports** : les réfutés figurent dans le JSON et le `.md` de la revue (« - réfuté : … — raison »),
  et survivent au rejeu depuis le JSON (`replayReview`, schéma zod et `lireVerdicts`).
- **Harnais** des deux côtés : un réfutateur par défaut qui **maintient** tout, pour que les tests
  existants gardent leur déroulé.
- Tests vus rouges puis verts : règle pure (5 × 2), dossier (2 × 2), rapport (extension), bout en bout
  (workflow en DESIGN, extension en DELIVER : réfuté avec citation → aucun tour de plus ; sans
  citation → le défaut part au producteur). Un test du manifeste figeait la liste des agents : mis à
  jour.
- **Mesure à faire** (`refutateur-mesure-us2`, accord du responsable) : attention, le run MCP d'US-2
  du 05/11 n'a eu **aucun défaut sérieux en revue** ; le réfutateur n'y aurait pas été appelé. Pour
  mesurer, il faut une story ou un run où les lentilles signalent des défauts.
- Écartés pour l'instant (ADR 0069) : réfuter les minor, désaccord isolé, ne pas rejuger un défaut
  déjà réfuté au même endroit.

## 06/11 — skraft-plugin v2 et AgentStudio : comparatif lentilles, portes, revue (plan, rien d'implémenté)

Suite de `docs/16` (v2 = `integration/v2-next`, commit `0425f031`, 2.0.0-alpha.63 ; nous = workflow
`workflows/skraft/` et extension `extensions/skraft/`, mêmes agents et skills). Colonne « Mieux » :
qui fait mieux, `v2`, `nous` ou `=`. Colonne « Suite » : lot de priorité — [1] simple, code pur ;
[2] coût des revues, ADR puis mesure sur US-2 (run Copilot avec l'accord du responsable) ;
[3] utile, moins urgent ; `garder` : on garde le nôtre ; `non` : on ne reprend pas. Reprises **à
partir des idées**, sans copie (la v2 n'est pas couverte par l'autorisation, versions < v2.0.0),
valables pour **l'extension et le workflow**, en TDD.

### Lentilles

| Point | skraft v2 | AgentStudio | Mieux | Suite |
|---|---|---|---|---|
| Nombre et spécialisation | 11 lentilles spécialisées par phase (DESIGN 3, DISTILL 4, DELIVER 3) + 2 conditionnelles (mocks, contrats) | 4 généralistes (cold-reader, test-integrity, architecture, quality-gates) avec des « points à examiner » par phase | v2 (critères nets) ; nous (moins de tours) | [3] après mesure du réfutateur |
| Sélection | Par le graphe ; lentilles `when=` déclenchées par le contenu du patch | Par le niveau de difficulté (2 ou 4 lentilles) et la phase (`quality-gates` retirée en DESIGN) | = | — |
| Entrées par lentille | Fixées par le code (`blind`, portée, patchs par portée) | Fixées par le code (`lensBrief` : cold-reader sans faits, etc.) | = | — |
| Contrat de sortie | YAML validé ; `severityReason`, `drift`, `occurrences` obligatoires ; 20 défauts au plus ; `pass` avec un défaut grave refusé | `submit_lens_verdict` à schéma ; identifiants et cibles fixés par le code ; pas de raison de gravité ni d'occurrences | v2 | [1] contrat enrichi, regroupement par ligne |
| Ce que le code a déjà vérifié | Dit aux lentilles (« Not yours to report », findings du moteur à ne pas répéter) | Non dit : une lentille peut reprocher ce qu'une porte a déjà jugé | v2 | [1] lister les portes jugées dans le dossier de chaque lentille |
| Plafond de gravité de cold-reader | `medium` au plus (consigne) | `major` au plus, **appliqué par le code** | nous | garder |
| Confronter aux mesures | Supprimé (`quality-gates-lens`) : les portes sont exécutées par le moteur | `quality-gates` confronte les livrables aux faits mesurés | nous | garder |
| Question d'une lentille | Interdite ; `inconclusive` → run BLOCKED, question à l'humain | Question de revue à l'humain, 2 par phase au plus, sans coût pour le producteur (ADR 0063) | nous | garder |
| Modèle | Palier `economy` par défaut, configurable | Classe par lentille (`standard`, `light` pour quality-gates), ADR 0048 | = | — |

### Portes

| Point | skraft v2 | AgentStudio | Mieux | Suite |
|---|---|---|---|---|
| Exécution | Le moteur lance les commandes de `skraft-config.json` (build, format, lint, test, architecture, coverage), par composant touché | Le code lance les tests et le linter par l'adaptateur de pile ; preuves produites par notre handler `run_tests` | = | — |
| Format | Porte à part | Absente | v2 | [3] si le profil déclare `format` |
| Gel des tests d'acceptance | **Aucune porte** : brief et lentille seulement ; l'ingénieur écrit dans `tests` | Empreinte au commit de DISTILL ; tests unitaires gelés dès leur rouge | nous | garder ; à proposer en amont |
| RED / GREEN | Convention de commits + **rejeu de chaque commit rouge** dans un worktree | Un seul nouveau test rouge par pas, rouge pour une bonne raison, suite verte, vérifiés au moment du pas | v2 (preuve après coup) ; nous (au pas) | non pour l'instant (nos preuves viennent du handler) |
| Couverture | Ce que dit la commande de l'équipe, aucun seuil dans le code | Couverture **du diff** avec seuil, lignes exemptées tracées | nous | garder ; à proposer en amont |
| Mutation | 100 % core / 80 % boundary **figés** ; « core » reconnu au nom du dossier ; survivants par fichier, plan validé par l'humain, arrêt sans progrès | Seuils de `quality.yaml` ; arbitre de mutants plafonné à 2 dérogations, humain au-delà (ADR 0065) | v2 (boucle par fichier, arrêt) ; nous (seuils, dérogations) | [3] boucle par fichier et arrêt sans progrès, en plus de l'arbitre |
| Cohérence DESIGN | Matrice **déclarée** par l'architecte (`consistency-gate: PASS`), présence vérifiée | Matrice **calculée** par le code (G10) et porte de cohérence (G6, G8, STRUCTURAL_DRIFT…) | nous | garder ; à proposer en amont |
| Plan de test, écarts | C12 « Every test is planned » (skill), jugé par test-integrity | Matrice couche/doublure, walking skeleton, écarts vérifiés par le code (ADR 0067) | nous | garder |
| Scans du patch | En code : `skip`/`only` ajoutés, test supprimé, assertions retirées ; placement des tests | Gel et règles de modification des tests (ajouts seulement) | v2 (en complément) | [3] pour les tests modifiés pendant un correctif |
| Périmètre d'écriture | Contrôlé **après** l'étape | Bloqué **avant** l'écriture (`onPreToolUse`) | nous | garder |
| Réessais | `max_attempts` + **disjoncteur** (deux échecs identiques → arrêt) | Budget `essayer({max})`, consommé jusqu'au bout | v2 | [1] disjoncteur |
| Panne d'environnement | Code 127/9009 → question à l'humain | `ENV_FAILURE` → escalade immédiate | = | — |

### Revue

| Point | skraft v2 | AgentStudio | Mieux | Suite |
|---|---|---|---|---|
| Qui calcule le verdict | Le moteur (`verdict.mjs`) | Le code (`synthesize`, repris de v1) | = | — |
| Faux positifs | **Réfutateur** sur chaque défaut avant le verdict (`confirmed`, `refuted` avec `path:line`, `unverifiable` qui compte) | Le producteur conteste, la lentille arbitre, puis l'humain : un tour du producteur par faux positif | v2 | **fait le 06/11** (ADR 0069), blocker et major seulement |
| Désaccord isolé | Une seule lentille contre les autres → le réfutateur reçoit toutes les entrées | Aucune règle | v2 | [2] avec le réfutateur |
| Relances entre rondes | Seules les lentilles dont les entrées ont changé ou qui avaient un défaut ; un défaut réfuté au même endroit n'est pas rejugé | Toutes les lentilles, à chaque ronde | v2 | [2] re-revue incrémentale |
| Défaut hors du changement | Devient une **note** : rapporté, ne renvoie pas le travail | Renvoie le travail comme les autres | v2 | [1] notes |
| Défaut mineur | Renvoie le travail (même `low`) | N'empêche pas l'approbation ; corrigé en fin de DELIVER (ADR 0062) | nous | garder |
| Rejet net | Supprimé | REJECTED (2 lentilles) → escalade | nous | garder |
| Plafond | `max_visits=3` par arête, puis question : ACCEPT (défauts acceptés dans le rapport) si seulement medium/low, sinon instruction ou STOP | Budget de 2 ou 3 essais, revue garantie à sa première ronde, puis escalade | v2 (sortie ACCEPT) | [3] « accepter les défauts restants », refusé s'il reste un blocker |
| Arbitrage humain | Au plafond seulement | Fil de défauts : contesté, recontesté, persistant → ARBITRATION, tous à la fois | nous (plus fin) | garder |
| Coût | Journalisé, aucun plafond | Journalisé (trace, usage), aucun plafond | = | — |
| Doc et code | Décalage (message du commit 27c2e656 contre `verdict.mjs` ; skill qui décrit une synthèse pondérée abandonnée) | Skills v1 qui décrivent encore de la procédure faite par le code | = | [1] mentions « le code le vérifie déjà » dans nos skills |

**Pourquoi cet ordre** : sur le run MCP d'US-2, 11 des 20 tours d'agent étaient des lentilles ; les
lots [1] et [2] visent ce coût. À ne pas reprendre en bloc : journal signé, multi-composants,
publication. Prochaine étape : le lot [1], ou directement le réfutateur, au choix du responsable.

## 05/11 — Analyse de skraft-plugin v2 (docs/16)

- `docs/16-skraft-plugin-v2.md` : agents, skills, lentilles, revue et portes de la branche
  `integration/v2-next` (commit `0425f031`, 2.0.0-alpha.63) face à v1.15.1 et à AgentStudio. Lu en
  lecture seule dans `~/Projets/skraft-plugin` (seule la branche a été récupérée).
- Constat principal : la v2 passe d'un orchestrateur-prompt à un **moteur** qui parcourt un graphe
  DOT ; revue en code avec un **réfutateur** de findings et un verdict calculé ; portes exécutées par
  le moteur ; agents et skills fortement réduits. Même direction qu'AgentStudio.
- Vérifié moi-même dans le code v2 : findings `low` qui renvoient le travail (`verdict.mjs`, en
  contradiction avec le message du commit 27c2e656) ; `MUTATION_BARS` figé à 100/80 ; aucune porte
  de gel des tests d'acceptance trouvée.
- **Licence** : la v2 n'est pas couverte par l'autorisation (versions < v2.0.0). Le responsable est
  contributeur de skraft-plugin depuis le 05/11 ; extension de l'autorisation **non** demandée ni
  consignée à ce jour.
- Décisions proposées (§9.1) : autorisation v2, réfutateur à mesurer dans le workflow, re-revue
  incrémentale, défauts mineurs, lentilles par phase. Contributions possibles en amont (§9.3).

## 05/11 — Les rejets des workflows manquaient à la trace (project-services)

- Constat sur le run MCP d'US-2 : un rejet de cohérence en DESIGN (journal : `rejections: 1`), mais
  aucune entrée `rejet` dans la trace — ni transition, ni effet : seulement les tours d'agent.
- Cause : `workspace-services.ts` créait le moteur **sans** `trace` ; seul l'exécuteur d'agents la
  recevait. Le moteur n'écrit transitions, effets, rejets et arbitrages (ADR 0032, 0065) que s'il
  l'a. Touchait aussi l'**application de bureau** (même assemblage). `mesure-skraft.ts` passe la
  trace à son propre moteur : les rapports du banc ne le montraient pas.
- Corrigé : `trace: traceStore` au moteur. Test vu rouge puis vert : un workflow qui rejette laisse
  une entrée `rejet` (porte, motifs) et des transitions dans la trace
  (`packages/project-services/test/workflows.test.ts`).
- Suite complète : 2064 tests. **Probable test instable, à surveiller** :
  `apps/desktop/test/app-controller.test.ts` › « installation depuis un fichier : accord demandé
  dans la fenêtre, puis services rechargés » — un échec dans une suite complète chargée (plus de
  600 s), puis vert quatre fois (trois seul, une dans la suite). Il utilise des doublures de
  services, pas `project-services`. Détail de l'échec non conservé.

## 05/11 — Serveur MCP : run réel avec Copilot sur US-2 (critère serveur-mcp-skraft passé)

- Hôte d'essai `scripts/essai-mcp-skraft.ts` (hors CI, consomme des requêtes) : lance le serveur
  construit en stdio sur un **clone** du projet, donne l'accord, suit `skraft_etat`, répond avec le
  répondeur commun du banc (`scripts/banc/repondeur.ts`, pas de copie), lit `skraft_rapport`. Config
  propre à l'essai : seul le clone autorisé, profil `architecte`, `PATH` avec `~/.dotnet`.
- **Premier essai échoué avant tout agent** (aucune requête) : l'enfant des workflows gardait
  `esbuild` en import externe ; sous `--permission`, Node refuse de lire `node_modules`. Mes tests
  ne rejouaient aucun workflow avec l'enfant **construit**. Corrigé (`external: []` pour l'enfant,
  comme `build-extensions.mjs`) et testé (`stdio.test.ts` : l'enfant construit rejoue skraft).
- Second essai sur `exemple-dotnet-tdd` / US-2 : **fini**, 19 min 24 s, **≈ 374 requêtes premium** (trace : 373,8 unités, 128 appels
  `claude-sonnet-5` ; réserve : 0 → 373), toutes les
  phases, livrable vérifié à part (`dotnet test` : 10/10). Compte rendu :
  `docs/runs/2026-11-05-us-2-mcp/`. Accord en deux appels, questions et réponses par MCP, rapport :
  tout le parcours de l'hôte a fonctionné en réel.
- Constat à suivre dans le **workflow** (pas le serveur) : la même question ouverte a été posée deux
  fois (avec et sans guillemets) — doublon à l'extraction des questions.
- **Piège** : `usage.requests` de la carte (et de `skraft_etat`) compte les **tours d'agent** (20 ici),
  pas les requêtes facturées ; je l'ai d'abord annoncé comme le coût. Le coût réel se lit dans la
  trace (`nanoAiu` des événements `usage`) ou dans la réserve. Plus rapide que le run du 10/10
  (55 min), mais plus cher (264,3) : un seul run, pas une mesure.
- `serveur-mcp-skraft` passe à `true`. Reste hors critère : la distribution (registre, licence).

## 05/11 — Serveur MCP, brique 7 : point d'entrée stdio, bundle, reprise hors Electron

- `config.ts` : `~/.agent-studio/mcp-skraft.json` (ou `SKRAFT_MCP_CONFIG`) — `autorises` (chemins
  absolus, `~` développé) et `hostname` ; absent : valeurs prudentes ; invalide : le serveur s'arrête,
  raison sur stderr. Profil et programmes autorisés : `admin.json`, comme l'application.
- `assemblage.ts` : la composition réelle (gh, Copilot, Workspace, adaptateur TypeScript,
  `sansRepli`, lanceur Node isolé, workflow livré dans le paquet). Données dans
  `~/.agent-studio/mcp-skraft/` : `tasks/`, `piles/`, `verrous/`, `copilot/`, `logs/`.
  **Le journal va dans un fichier** : stdout est le canal du protocole.
- **Verrou hors du dépôt** (ADR 0068 précisé) : les checkpoints font `git add -A` et le rollback
  `clean -fdq` ; dans `.agent-studio/`, le verrou entrerait dans les checkpoints et les diffs que
  contrôlent les portes. Il est dans `verrous/<empreinte du chemin>.lock`.
- `main.ts` : transport stdio ; fermeture (stdin fermé, SIGINT, SIGTERM) libère services et verrous.
- `scripts/build.mjs` (`pnpm --filter @agent-studio/mcp-skraft build`) : `dist/main.mjs` (paquets
  internes intégrés), `dist/workflow-child.mjs`, `dist/workflows/skraft/` (sources et LICENSE) ;
  externes : `@github/copilot-sdk` (CLI Copilot, binaires par plateforme) et `esbuild` (natif,
  compile le workflow à l'activation), déclarés en dépendances. `dist/` n'est pas versionné.
- `skraft_etat` donne aussi le workflow et son accord (`accordRetenu`).
- Tests : `stdio.test.ts` construit le paquet et le lance en vrai processus (outils, workflow
  skraft activé, pile détectée, projet hors des dossiers autorisés refusé, configuration invalide,
  journal hors de stdout) — sans GitHub ni Copilot ; écrit après le code (composition), pas vu rouge.
  « Reprise hors Electron » (`serveur.test.ts`) : stockages JSON réels, serveur fermé pendant une
  question, un autre relit le disque et mène le run au bout, sans relancer l'agent : **le point 4
  de docs/14 §5 est levé**.
- `apps/mcp-skraft/README.md` : construire, prérequis, inscription, configuration, outils, données.
- Suite complète : 2061 tests, typecheck.
- **Reste** : un run avec des agents Copilot réels (accord du responsable) ; la distribution (registre, licence du paquet hors skraft).

## 05/11 — Serveur MCP, brique 6 : pile fournie par le client (point 8)

- `project-services` : le choix de la pile gagne une troisième source. Ordre : profil du projet, puis
  détection, puis `pileFournie` (argument des services, YAML au format de `stack.yaml`, mêmes
  contrôles : schéma et `allowedPrograms`). Fournie alors que le projet a la sienne : ignorée, et
  c'est dit. `sansRepli` (config) : aucune pile lève `AucunePile` au lieu du repli averti sur le
  premier adaptateur ; l'application de bureau garde son repli. `services.pile()` : `{ id, source }`
  (`projet`, `detection`, `client`, `repli`). Tests : `packages/project-services/test/pile.test.ts`.
- `apps/mcp-skraft` : argument `pile` de `skraft_demarrer` ; pile retenue gardée par le serveur dans
  son dossier de données (`piles.ts`, un fichier par projet, hors du dépôt), relue à l'ouverture
  suivante — une reprise par un autre serveur retrouve la même pile. Une autre pile remplace la
  précédente, sauf pendant un run. Sans pile : `AucunePile`, avec l'indication de l'argument `pile`.
  La pile et sa source figurent dans `skraft_etat`.
- Ouverture d'un projet qui échoue (pas de pile) : le verrou est libéré, rien n'est gardé.
- Le test du remplacement de pile a été écrit après le code : il n'a pas été vu rouge.

## 05/11 — Serveur MCP, brique 5 : rapport d'un run (skraft_rapport)

- `packages/workflow/src/rapport.ts` : `rapportDuWorkflow(etat)`, fonction pure sur l'état persisté
  de la tâche — statut (`en-cours`, `fini` avec la valeur rendue par le script, `echec` avec le motif,
  `annule`), messages du script (`w.informer` déjà exécutés, dont le bilan final de skraft, relus du
  magasin de contenus), dernier rejet, arbitrages. Rien n'est relancé ni relu sur le disque du projet.
- `WorkspaceServices.rapportWorkflow(taskId)` : `null` pour une tâche inconnue ou qui n'est pas un
  workflow (nom `workflow.<nom>/…`). Outil `skraft_rapport` : le rapport en JSON.
- Pourquoi pas les seuls messages de `skraft_etat` : ils sont en mémoire, par projet, et limités aux
  20 derniers ; le journal de la tâche est durable et propre au run.

## 05/11 — Serveur MCP, brique 4 : connexion à GitHub sans fenêtre (point 7)

- `apps/mcp-skraft/src/connexion.ts`, sur `GitHubAuth` (`gh`, comme l'application) :
  - `verifier()` : connecté, et jeton accepté par Copilot (pas de jeton personnel classique) ;
  - `connecter()` (outil `skraft_connexion`) : lance le flux d'appareil et rend **aussitôt** le code
    et l'adresse ; pendant l'attente, le même code (pas de second flux) ; ensuite « Connecté » ; un
    échec est dit une fois, puis l'appel suivant relance ;
  - `runtime(fabrique)` : runtime démarré une fois, au premier besoin, avec le jeton ; un échec
    n'est pas retenu.
- `skraft_demarrer`, `skraft_repondre`, `skraft_reprendre` exigent la connexion (ils font travailler
  les agents) et renvoient vers `skraft_connexion` ; `skraft_etat` et `skraft_arreter`, non.
- Le jeton ne va qu'à la fabrique du runtime : testé absent de toutes les réponses.

## 05/11 — Serveur MCP, briques 2 et 3 : paquet apps/mcp-skraft, projet, verrou, outils

- Nouveau paquet `apps/mcp-skraft` (projet Vitest `mcp-skraft`), SDK `@modelcontextprotocol/sdk` 1.32.2.
  - `projet.ts` : projet de l'appelant (argument, puis premier root du client, puis dossier courant),
    jugé sur sa cible réelle (liens résolus) ; refusé s'il n'est pas un dépôt Git ou s'il est hors
    des roots du client et des dossiers autorisés de la configuration.
  - `verrou.ts` : `.agent-studio/mcp-skraft.lock`, création exclusive (`wx`), PID du détenteur ;
    repris si le détenteur est mort ou le fichier illisible ; libéré seulement s'il est encore à nous.
  - `projets.ts` : un jeu de services par projet ; le verrou **avant** les services, et `demarrer()`
    (purge des sessions, reprise des tâches) seulement en mode pilote.
  - `services.ts` : les services de `project-services`, sans fenêtre (confirmeur qui refuse tout ;
    l'accord du workflow vient de l'appel, point 9), messages du chat vers le journal du projet.
  - `serveur.ts` : `skraft_demarrer`, `skraft_etat` (JSON : mode, tâches, questions, messages),
    `skraft_repondre` (profil de `admin.json`), `skraft_reprendre`, `skraft_arreter`.
- Testé de bout en bout par un vrai client MCP en mémoire (`InMemoryTransport`), vrais services,
  workflow isolé, `ScriptedRuntime` : accord requis puis lancé, question puis réponse jusqu'au bout,
  refus de profil, deux serveurs (consultation, reprise de la main à la mort du premier), arrêt,
  projet hors des roots.
- Piège trouvé par les tests : les entrées deviennent une ligne de commande découpée aux espaces.
  `story: "deux mots.md"` faisait de `mots.md` le skill d'architecture (entrée positionnelle) et le
  run partait sur `deux`. `story` et `archi` refusent donc tout espace.
- Piège : les options d'une question de workflow sont préfixées du numéro d'appel (`3:oui`) ; l'hôte
  doit reprendre l'identifiant rendu par `skraft_etat`.
- **Écart à l'ADR 0068, point 5 — tranché le 05/11 par le responsable : le refus est gardé**, ADR
  corrigé ; chaque serveur donne son PID et celui du pilote (`skraft_etat` : `pid`, `detenteur` ;
  messages de refus), pour savoir depuis quelle fenêtre répondre. Constat d'origine : l'ADR dit qu'un serveur en consultation « peut
  répondre aux questions enregistrées ». Or répondre passe la décision au moteur du serveur qui
  répond (`interactions.respond` → `engine.dispatch`) : le run reprendrait **dans le serveur en
  consultation**, en parallèle du pilote. Implémenté de façon sûre : en consultation,
  `skraft_repondre` et `skraft_arreter` sont refusés, avec le PID du pilote.
- Reste : voir la brique 7.

## 05/11 — Serveur MCP, brique 1 : lancer un workflow avec un accord donné d'avance

- ADR 0068 complété (point 9) : sans fenêtre, l'accord sur le workflow se donne **dans l'appel**.
  `skraft_demarrer` rendra « accord requis » et le résumé, puis l'hôte rappelle avec
  `accord: "une-fois" | "toujours"`. SDK retenu : `@modelcontextprotocol/sdk` (1.32.2, compatible zod 4).
- `WorkspaceServices` gagne `workflows()` (nom, syntaxe, `accordRetenu`, résumé de l'accord) et
  `lancerWorkflow(nom, args, { accord? })`, qui valide les arguments (`lireEntrees`), lance la
  commande et dit ce qui a **réellement** démarré (identifiant de tâche, ou motif). `proposer_workflow`
  s'appuie dessus : un seul chemin de lancement pour l'agent principal et le serveur MCP.
- L'accord donné d'avance passe par un confirmeur enveloppé : il répond à la seule demande d'accord
  du lancement, puis tombe dans tous les cas (`finally`) ; un appel refusé (arguments invalides) ne
  le laisse pas au suivant. Testé dans `packages/project-services/test/workflows.test.ts`.

## 17/10 — Paquet project-services : les services d'un projet hors de l'application de bureau

- Pour que le serveur MCP (ADR 0068) ne duplique pas l'assemblage des services d'un projet, il est
  sorti de `apps/desktop/src/main` vers `packages/project-services` (`@agent-studio/project-services`),
  par `git mv` : `workspace-services.ts`, `stack-command.ts`, `admin-config.ts`, les interfaces
  `WorkspaceServices*` et `RouteOutcome` (`protocols.ts`), et les schémas des cartes de tâche et des
  interactions (`dto.ts`, exporté aussi en `@agent-studio/project-services/dto`, zod seul).
- L'application importe le paquet ; `ipc-contract.ts` réexporte les schémas, `protocols.ts` les
  interfaces : aucun autre fichier de l'application n'a changé. Les tests (et leur fixture
  d'extension tierce) suivent le code, dans le projet Vitest `project-services`.
- Vérifié : suite complète identique (2012 tests), typecheck, `pnpm build` (paquet intégré au bundle
  du main et du renderer, pas externalisé).
- Piège : le preload n'importe que des **types** du contrat IPC ; s'il en importait des valeurs, le
  paquet devrait être intégré au bundle du preload, qui ne l'exclut pas de l'externalisation.
- `scripts/mesure-skraft.ts` importait `admin-config` par un chemin profond dans l'application : il
  importe le paquet. Il assemble encore lui-même ses services : à rapprocher plus tard.

## 17/10 — Branche feat/mcp-skraft : ADR 0068 accepté (skraft en serveur MCP local)

- Branche `feat/mcp-skraft`, partie de `feat/workflow-rejouable` (PR #12).
- ADR 0068 **accepté** le 17/10. Décidé par le responsable : runtime **Copilot** pour l'instant (adaptateur
  existant) ; Claude plus tard, par le port `AgentRuntime`. Aussi : le serveur orchestre le
  **workflow** (option A de docs/14), transport **stdio** (le client lance le serveur), outils
  courts, **verrou par projet** (deux instances de client = deux serveurs sur le même disque),
  projet détecté (argument, roots MCP, dossier courant) et **borné** (dépôt Git, root du client ou
  dossier autorisé).
- Authentification (décidée) : jeton de `gh` s'il est connecté ; sinon outil `skraft_connexion`
  (flux d'appareil, code et adresse rendus à l'hôte MCP). Jeton jamais rendu à l'hôte ni journalisé.
- Pile (décidée) : profil `.agent-studio/stack.yaml`, sinon détection, sinon profil fourni par le
  client dans `skraft_demarrer` (mêmes contrôles : schéma, liste de l'administrateur ; gardé avec le
  run, pas écrit dans le dépôt). Aucune des trois : refus de démarrer.
- À vérifier avant de s'y fier : dossier courant donné au serveur par Claude Code et Copilot CLI,
  leur support des roots MCP, la reprise hors Electron, l'accord sur le workflow sans fenêtre.
- Prochaine étape : un essai du serveur avec le `ScriptedRuntime`, sans Copilot réel (critère
  `serveur-mcp-skraft`).

## 17/10 — Revue de la PR #12 : sept constats corrigés

- **Lien symbolique d'un workflow** (sécurité) : la compilation vérifie le chemin **réel** de chaque
  fichier chargé et refuse une cible hors du dossier ; l'empreinte du dossier compte chaque lien et
  sa cible. Avant, un lien vers l'extérieur contournait l'accord « toujours » et le gel.
- **Projet rouvert** (installation d'une extension) : `WorkspaceServices.demarrer()` sépare purge
  des sessions et reprise des tâches de la construction ; le contrôleur l'appelle après avoir
  libéré les anciens services. Avant, la purge des anciens supprimait les sessions des nouveaux.
- `lireEntrees` : une entrée nommée répétée, ou déjà donnée par position, ne retire plus une autre
  positionnelle (`indexOf` à -1).
- `pour-les-scripts.ts` exporte `couvertureDuDiff` et `problemesTestsExistants` ; un test vérifie
  que chaque nom importé de `@agent-studio/workflow` par le workflow est défini sous Vitest.
- Connexion GitHub : `gh` reçoit `GH_BROWSER` sans effet ; seule l'application ouvre la page.
- `proposer_workflow` : réponse fidèle (tâche créée ou « Rien n'a démarré ») et une seule demande
  (l'accord du workflow tient lieu de confirmation tant qu'il n'est pas donné pour toujours).
- `deleteSession` (adaptateur Copilot) : une session introuvable (`getSessionMetadata` →
  `undefined`) est tenue pour supprimée ; elle ne reste plus au registre.

## 16/10 — À faire : mesurer sur des runs Copilot, puis décider de trois évolutions du plugin

- **Runs réels** (avec l'accord du responsable du projet, requêtes premium consommées) : au moins
  deux runs, extension et workflow, d'une story qui va jusqu'à DELIVER, par
  `scripts/mesure-skraft.ts`. Leur rapport contient la section « Coût des revues et des
  corrections » ; reporter les chiffres dans docs/15 §5. Les runs du 10/10 sont antérieurs aux
  évolutions du 14 au 16/10 (portes de DESIGN et DISTILL, consignes de phase, inventaire de la
  recherche, skill d'architecture, écarts au plan) : leurs chiffres ne valent plus pour décider.
- **Puis décider**, critère par critère dans `features.json` (tous à `passes: false`) :
  `re-revue-selective`, `patch-partage-aux-lentilles`, `mode-rework`. Chacun dans l'extension et
  le workflow, en TDD.
- Repères des runs du 10/10 : re-revue sélective, au plus 8,4 requêtes premium sur 64,3 de
  revues ; lectures des lentilles 151 et 111, 31 % et 21 % des tokens d'entrée ; après la 1re revue
  de DELIVER, 4 exécutions de tests et une revue relancée (17,9 requêtes premium).

## 16/10 — Mesures du coût des revues et des corrections (docs/15 §5)

- Section « Coût des revues et des corrections » du rapport du banc (`scripts/banc/revues.ts`,
  branchée dans `mesure-skraft.ts`, non lancé) : coût par tour et par lentille (appels, requêtes
  premium, tokens, lectures, verdict, défauts) ; re-revue sélective (coût des lentilles relancées
  après avoir approuvé sans défaut, borne haute) ; patch partagé (lectures, part des tokens) ; mode
  rework (exécutions de tests du code et revues relancées après la 1re revue de DELIVER).
- `pnpm banc:revues docs/runs/<run>` recalcule la section sur un run enregistré, sans requête.
  Chiffres des runs du 10/10 dans docs/15 §5.
- Piège : une lentille **garde sa session** d'une revue à l'autre ; mesurer par session écrasait
  les revues précédentes. Chaque `tour-début` ouvre une mesure. Le verdict vient de la sortie du
  `tour-fin`, pas des rapports de revue du projet.
- `vitest.global-setup.ts` ajouté au typecheck.

## 15/10 — Écarts au plan de test (ADR 0067, PLAN_DEVIATION de skraft-plugin v1.15.1)

- `report_phase` (cœur) gagne `planDeviations` (critère, prévu, réel, règle). DISTILL garde la
  matrice (`planDeTest`) ; en DELIVER, `verifierEcarts` refuse le pas si le critère n'est pas dans
  la matrice ou si le prévu ne reprend pas sa ligne. L'écart est gardé avec la porte du pas, effacé
  avec ses tests (scénario repris, DELIVER rembobinée), donné en fait à la revue, commité dans
  `deliver/ecarts-au-plan.md`, cité dans le rapport final. E et W.
- Lentilles DELIVER : `test-integrity` (écart non déclaré = défaut, écart déclaré jugé sur sa
  règle), `quality-gates` (chaque critère a un test fidèle à sa ligne, sauf écart déclaré).
- Piège (ADR 0024) : le contenu partagé des agents ne nomme ni `report_phase` ni un dossier
  `.skraft/` hors de son périmètre ; la partie outil va dans la consigne d'orchestration
  (`ECARTS_AU_PLAN` dans `roles.ts`, `consignes` dans `workflow.mjs`).
- Reste au §5 de docs/15 : re-revue sélective, patch partagé, mode rework (à mesurer d'abord).

## 15/10 — Skill d'architecture transmise à l'appel, pile dans le dossier

- Skills reprises de v1.15.1 : `clean-architecture-{dotnet,java,python,react}`, et mise à jour de
  `architecture-patterns` et `clean-architecture-testing`. Indispensable : notre
  `architecture-patterns` v1.6.1 disait « dépôt dans l'application, jamais dans le domaine »,
  contraire à nos consignes et à la v1.15.1 (« domaine ou application »).
- `/skraft <story> --archi <skill>` (nom ou langage) ; absente ou inconnue : clean architecture
  par défaut (`architecture-patterns`), avec avertissement si inconnue (`architecture.ts`,
  `architecture.mjs`). Les quatre skills sont à la demande pour les architectes, le testeur et le
  développeur ; le dossier de DESIGN, DISTILL et DELIVER nomme celle à charger.
- Ligne « Pile du projet » (adaptateur et emplacements) en DESIGN, DISTILL et DELIVER.
- Plateforme : `lireEntrees` accepte `--nom valeur` pour une entrée texte ; `disposition()` rend
  `pile` ; `StackApi.id` (extension-api, hôte en processus et isolé).
- Piège : un import ajouté conditionnellement a été sauté parce que « import » figurait dans un
  commentaire ; et un double appel journalisé à `w.disposition()` a été évité.
- Reste au §5 de docs/15 : `PLAN_DEVIATION`, re-revue sélective, patch partagé, mode rework.

## 15/10 — La recherche, entrée de DESIGN et DISTILL (repris de skraft-plugin v1.15.1)

- Porte « citations » (E et W) : sous-section « ### Existant réutilisable » du passage de relais,
  une ligne « `Nom` → `chemin` » par élément (ou « aucun ») ; **chaque nom doit figurer dans le
  fichier cité** (ajout par rapport au plugin). `FileIndex` gagne `contains`.
- Non repris de v1.15.1 : les commandes de build et de test dans les conventions. L'adaptateur de
  pile en est l'autorité, et le contrat du cœur interdit aux agents de les lancer
  (`agent-prompts.ts`) : les faire déclarer par le LLM créerait une seconde source. Les
  emplacements des tests et des sources sont déjà injectés par le code (DISTILL, DELIVER).
- Le code garde l'inventaire (`extraireInventaire` ; E : `GATE_OK.recherche` → `state.recherche` ;
  W : `vue.recherche`) et le recopie dans le dossier de DESIGN et DISTILL, borné à 2 000
  caractères par partie. RESEARCH sautée : le dossier le dit.
- Prompts du chercheur, du modélisateur et de l'agent d'acceptance mis à jour (provenance v1.15.1).
- Piège : la fixture S2 réécrivait `bolus-calculator.ts` en 55 lignes de commentaires, sans le nom
  inventorié ; la première ligne déclare maintenant la classe.
- Reste au §5 de docs/15 : `PLAN_DEVIATION`, skills clean-architecture par langage, re-revue
  sélective, patch partagé, mode rework.

## 15/10 — Écarts du chapitre 11 du PDF traités

- Workflow : un défaut de travail de l'arbitre de mutation (muet, délai) n'était pas rattrapé ;
  il laisse maintenant chaque mutant à l'humain, comme l'extension (`arbitrerMutants`). Test
  « arbitre muet » dans les deux, celui du workflow échouait avant.
- Workflow : la mutation de la porte de scénario reçoit les dérogations (`d.derogations`), comme
  l'extension. Sans test de bout en bout : les dérogations naissent en fin de DELIVER, où la
  mutation par scénario ne tourne pas ; le cas suppose une barre changée pendant le run.
- Extension : `VERDICT_GATE` documenté transitoire (ADR 0013) dans `model.ts` ; S3 de `docs/12`
  marqué conforme.
- PDF : chapitre 11 réécrit, tous les écarts traités.

## 15/10 — Fuite de dossiers temporaires des tests corrigée

- Cause : les harnais compilent le processus enfant (et l'extension) dans `tmpdir()` « une fois
  pour la suite », en fait une fois **par fichier** (Vitest isole les fichiers), sans jamais les
  supprimer ; certains tests n'avaient pas de `rm` ; et une tâche qui écrit après le `rm` de son
  dossier le recrée. Environ 115 Mo par lancement, dans un /tmp en tmpfs de 3,8 Go.
- Correctif : `vitest.global-setup.ts`, déclaré dans `vitest.config.ts`, crée un dossier
  `agent-studio-tests-*` par lancement, le met dans `TMPDIR` (hérité par les processus de test et
  leurs enfants) et le supprime en entier à la fin.
- Vérifié : sans lui, `e2e-commit-workflow` laisse `agent-studio-workflow-runtime-*` ; avec lui,
  la suite complète (1943 tests) ne laisse aucun dossier `agent-studio-*`.

## 15/10 — Gel gardé quand le commit de DISTILL échoue (extension)

- Défaut introduit par D19 : `escalate` appelait `leverGelDistill` avant de reconnaître une panne de
  commit. DISTILL approuvée perdait son empreinte et ses non-régressions, que l'humain relance le
  commit **ou** continue sans : DELIVER ne vérifiait plus le gel, sans avertissement (`sansGel` ne
  vise que DISTILL sautée), et le dossier de passation ne disait plus « gelés ».
- Correctif : le stade COMMIT est testé avant de lever le gel (`reducer.ts`, `escalate`). Tests :
  réducteur (relancer et continuer), bout en bout dans l'extension (échoue sans le correctif) et
  contrôle dans le workflow, qui gardait déjà l'empreinte.
- PDF : l'écart est retiré du chapitre 11.

## 15/10 — Autorisation de reprise étendue à toutes les versions < v2.0.0

- Déclaration du responsable du projet, consignée dans `docs/licences/autorisation-skraft.md`
  (même nature de trace que les précédentes). Plus récente au 15/10 : `v1.15.1` (`1e41a98`).
- Une reprise cite le tag exact d'où elle vient ; `v2.0.0` et au-delà ne sont pas couverts.
- Conséquence : les évolutions du plugin listées au §5 de `docs/15` peuvent être reprises.

## 15/10 — Plan de test de DISTILL (docs/15 §4.7)

- Code (E et W), porte « plan de test » : matrice de couverture dans `test-plan.md` (une ligne par
  critère, couche, doublure, walking skeleton) ; une étape par critère dans `impl-plan.md` qui
  nomme son fichier de test. Les harnais ont `testPlanDe` et `implPlanDe` pour écrire des plans
  conformes.
- Prompt de `skraft-acceptance` réécrit (matrice, étapes, conventions de la recherche) ; skill
  `clean-architecture-testing` à la demande ; consigne DELIVER de `test-integrity` (couche et
  doublure du plan). Le workflow passe maintenant `slug` au contexte des lentilles.
- Piège : `/tmp` (tmpfs de 3,8 Go) était plein à 80 % de dossiers `agent-studio-*` laissés par les
  tests ; la suite échouait par fichiers entiers. Supprimés à la main le 15/10 ; fuite corrigée
  ensuite (`vitest.global-setup.ts`).
- **À surveiller** : « ADR accepté pendant que l'autre est amendé » (e2e-s3 de l'extension) a
  échoué une fois, dans la suite complète lancée juste avant la saturation de /tmp ; l'assertion
  en échec n'a pas été relevée. Passé depuis seul trois fois et dans toutes les suites complètes
  après le nettoyage. Cause probable : /tmp plein (corrigé). Fragilité réelle : jusqu'à quatre
  attentes de 60 s sous un plafond de 120 s. S'il revient : le relancer en boucle sous charge et
  capturer l'assertion avant de toucher au code.
- Reste : docs/15 §5 ; G7 en code (proposé) ; défaut du gel perdu en DISTILL (extension).

## 15/10 — Méthode de DESIGN reprise du plugin (docs/15 §4.6)

- Code, porte « cohérence » (E et W) : contexte non classé Core/Supporting/Generic ; commande,
  requête ou événement du modèle sans section dans `contracts.md` ; dépôt sans « Couche : Domaine /
  Application » ou dans l'infrastructure ; engagement déjà dans le code (bus CQRS, event store,
  saga : signatures de la phase 7.0 du plugin) ou couche anticorruption de la carte sans ADR
  valable (ni Rejected, ni Superseded, ni Deprecated, hors Alternatives).
- La porte lit maintenant les **sources de production** du projet (`DesignInput.sources`).
- Prompts : démarche en quatre temps pour le modélisateur (réutilisation, Event Modeling, DDD
  stratégique, DDD tactique) ; format des contrats et déclencheurs obligatoires d'ADR pour le
  décideur. Lentilles : réutilisation et déclencheurs (architecture), tranches verticales
  (test-integrity).
- Piège : les fixtures écrivaient des contrats en prose ; elles portent maintenant les sections
  (`SECTIONS` dans `design-gate.test.ts`, S3 de bout en bout). Le test D15 du workflow utilise le
  modèle du harnais, dont le décideur par défaut écrit un contrat sans sections.
- Reste : docs/15 §4.7 et §5 ; G7 en code (annotations `ac-N` dans le modèle), proposé.

## 14/10 — Revue de DESIGN et de DISTILL : portes en code, puis consignes de phase (docs/15 §4.5)

- Option C (code), E et W :
  - DESIGN, porte « cohérence » : chaque « Commande `X` » a un événement (« `X` → … `Y` » ou ligne
    de tableau) ; chaque relation « `A` → `B` » de `context-map.md` nomme son patron.
  - DISTILL, porte « plan de test », **avant** l'exécution des tests : `impl-plan.md` présent et
    citant chaque `ac-N` ; `test-plan.md` avec au moins une ligne « - @ac-N : walking skeleton — … ».
- Option A (jugement) : `CONSIGNES_DE_PHASE` ajoute « Points à examiner en DESIGN / DISTILL » au
  dossier des lentilles ; rien en DELIVER.
- Prompts : `skraft-architect-model` et `skraft-acceptance` annoncent les formats vérifiés.
- Les skills `*-review-criteria` restent à la demande : elles contiennent la dérivation du verdict
  du plugin, que notre code remplace.
- Piège : les harnais de test écrivaient des plans vides ; ils citent maintenant chaque critère et
  un walking skeleton (E et W, `support/harness.ts`, `e2e-s4*`).
- PDF régénérés (porte cohérence, porte plan de test, consignes de phase, organigrammes).
- Matrice de cohérence (G10) **construite par le code** : catégorie de chaque nom relevée par
  libellé (« Commande `X` »…), refus des paires incompatibles du plugin, `consistency-matrix.md`
  écrite par la porte cohérence à chaque essai et commitée. Le décideur ne l'écrit plus.
- Piège : le drapeau `i` sur la regex faisait accepter un nom en minuscules (`onClick`) ; le
  libellé est décliné en minuscule, majuscule initiale et capitales, le nom reste `[A-Z]`.
- `STRUCTURAL_DRIFT` du plugin : sens « ADR → modèle » en code (`conceptsAbsentsDuModele`, hors
  section Alternatives) ; sens « agrégat → ADR » laissé à la lentille architecture (décision du
  responsable : un essai en code aurait demandé un ADR par agrégat, y compris existant).
- Consigne de la lentille architecture corrigée : les interfaces de dépôt vont dans le domaine **ou**
  l'application, jamais l'infrastructure (solution-architect, phase 6). Piège : le relecteur du
  plugin (G4) ne cite que l'application ; le plugin se contredit, l'architecte fait foi.
- Reste : docs/15 §4.6 (démarche dans le prompt, engagements existants sans ADR, déclencheurs
  obligatoires d'ADR, format des contrats), 4.7 et §5.

## 14/10 — Lentilles : chacune reçoit ce que son prompt annonce ; cold-reader plafonnée (docs/15 §4.1 à 4.4)

- `test-integrity` reçoit maintenant le code de production ; `architecture` reçoit les tests
  (une doublure du domaine se voit dans les tests). Extension (`review-brief.ts`) et workflow
  (`review-brief.mjs`).
- Prompts : `cold-reader` ne parle plus de « faits fournis » et annonce sa gravité maximale ;
  `architecture` dit recevoir code et tests. Les deux copies d'agents restent identiques.
- Plafond repris du plugin v1.6.1 : appliqué par le **code** dans `numberDefects` (E et W), pas
  seulement dans le prompt. `blocker` → `major`, `REJECTED` → `CHANGES_REQUESTED`, champ
  `severityNote` (schéma de relecture E et lecteur W).
- Piège : quatre tests de bout en bout faisaient rejeter DESIGN par `cold-reader` ; ils font
  maintenant rejeter `test-integrity` (le scénario testé est le même : deux lentilles rejettent).
- PDF régénérés (tableau des lentilles, écart test-integrity retiré du chapitre 11).
- Reste : docs/15 §4.5 à 4.7 et §5, à décider.

## 14/10 — Constat : nos agents face à ceux de skraft-plugin (v1.6.1 et main 1.15.1)

- Document : `docs/15-agents-face-a-skraft-plugin.md`. Aucune correction faite.
- Globalement équivalents ; la procédure (commits, preuves, portes, ratification, synthèse) est
  dans notre code, comme prévu par `docs/licences/autorisation-skraft.md`.
- À corriger (E et W) : `test-integrity` ne reçoit pas le code de production alors que son prompt
  l'annonce ; `architecture` doit juger les doublures sans recevoir les tests ; `cold-reader`
  annonce des faits qu'elle ne reçoit pas ; pas de plafond `medium` pour `cold-reader`.
- À décider : revue propre à DESIGN et DISTILL, méthode de DESIGN, plan de test de DISTILL,
  reprise des évolutions de main (l'autorisation ne couvre que la v1.6.1).
- Piège : le plugin a beaucoup bougé depuis la reprise (v1.6.1 → 1.15.1) ; comparer aux deux.

## 13/10 — Étude : skraft en serveur MCP local (aucune décision)

- Document : `docs/14-skraft-en-serveur-mcp.md`. Pas d'ADR tant que l'option n'est pas choisie.
- Conclusion : faisable si le serveur MCP **orchestre** et lance ses propres agents (option A) ;
  exposer seulement les portes au LLM de l'hôte (option B) casse « le code décide ».
- Vérifié : le moteur (`workflow`, `core`, `task-engine`, `runtime-copilot`, `extension-host`) et
  `apps/desktop/src/main/workspace-services.ts` n'importent pas Electron ; un lanceur Node existe.
- Non vérifié : la reprise (tâches et journal de rejeu) hors Electron.
- Prochaine étape proposée : ADR (option A, workflow seulement), puis essai avec `ScriptedRuntime`.

## 13/10 — À faire : escalade d'un scénario selon sa cause (ADR 0066, proposé)

- Document de travail : `docs/13-escalade-de-scenario-selon-sa-cause.md`. Il contient le
  problème, les décisions, la proposition, le point à trancher et le plan.
- Il y a deux causes qu'aucune option d'escalade actuelle ne résout :
  - **un test existant devenu rouge**, parce que la story change ce comportement. Personne ne
    peut le mettre à jour (développeur, testeur depuis D10, agent d'acceptance) ;
  - **des lignes non couvertes** écrites pendant un scénario. La porte du scénario les refuse sans
    défaut à contester.
- **Décisions du responsable du projet** :
  - présenter le problème à l'humain, avec « rejouer DISTILL » (DELIVER effacée) ou « mettre en
    pause » (puis lui demander d'où repartir) ;
  - pour la couverture, l'humain tranche.
- **Point ouvert** (§4 du document) : qui met à jour un test **unitaire** obsolète, puisque
  l'agent d'acceptance n'écrit pas les tests unitaires. L'option A est recommandée : la pause
  seule, l'humain corrige.
- Deux critères ajoutés à `features.json`, à `false` : `escalade-de-scenario-test-existant-obsolete`
  et `escalade-de-scenario-lignes-non-couvertes`.

Prochaine étape : trancher le §4, passer l'ADR 0066 à « accepté », puis coder selon le plan
(§5), dans les deux implémentations.

---

## 13/10 — Couverture du diff contestée : l'humain tranche (suite de D22)

- En fin de DELIVER, une contestation de couverture va directement à l'humain : dérogation sur les
  lignes précises (retirées du calcul, tracées, commitées dans `derogations.md`), ou « à tester »
  sans recours. Les défauts de couverture portent maintenant leur fichier et leurs lignes.
- **Limite découverte en testant** : la couverture est aussi mesurée à la porte de **chaque
  scénario**. Une ligne écrite pendant un scénario fait échouer le scénario, puis il y a escalade,
  sans défaut à contester. L'arbitrage ne vaut donc que pour les sources écrites hors des
  scénarios (en DISTILL, par exemple). Même structure pour la « suite finale » : un test existant
  cassé est refusé dès le pas vert.
- **Décision du responsable du projet** pour le test existant devenu obsolète : remonter à
  l'humain avec deux options. « Rejouer DISTILL » efface DELIVER. « Mettre en pause » demande
  ensuite d'où repartir. À concevoir (ADR à venir).

---

## 11/10 — D1 terminé : gel annoncé quand il est définitif, DISTILL sautée signalée

- Le fait de revue de DISTILL disait « Tests d'acceptance gelés », alors que la revue peut encore
  faire corriger un test : le gel n'est définitif qu'au commit. Il est reformulé dans les deux.
- DISTILL sautée : il n'y a pas d'empreinte, donc la vérification du gel passait en silence.
  DELIVER prévient maintenant l'utilisateur dans le fil, et la note va aux lentilles.
- Tous les défauts D1 à D23 de l'audit sont traités. D13 ne se reproduit plus depuis D4 et D5,
  il n'a pas été modifié.

Prochaine étape : l'arbitrage des contestations de couverture et de suite finale (ouvert depuis
D22), puis les écarts de spécification S1 à S5 (décisions à prendre).

---

## 11/10 — D21 : tous les rejets de l'extension comptés et tracés

- Trois rejets échappaient au compteur `rejections`, donc à la trace : le plafond de 20 cycles,
  le nettoyage refusé et la relance du classifieur. Le workflow les tracait déjà : la comparaison
  sur banc (ADR 0054) était faussée en faveur de l'extension.
- Les noms de porte sont repris du workflow : « scénario ac-N », « pas refactor (ac-N) »,
  « classifieur ». Le motif du classifieur est effacé dès que la difficulté est fixée, pour ne pas
  devenir le « Rejet précédent » de la première phase (piège de D18).
- **Tests instables corrigés** : trois tests de l'extension (`e2e-arbitrage-mutation`,
  `e2e-commit`, `e2e-s1`) lisaient le rapport final dès le stade DONE. Or ce rapport est publié par
  un effet **après** cette transition, ce qui crée une course sous charge. Ils attendent maintenant
  sa publication.

Prochaine étape : restes de D1, S1 à S5.

---

## 11/10 — D20 : une escalade de DELIVER fait aussi oublier les sessions (extension)

- Les deux escalades de la sous-machine DELIVER (budget d'échecs du scénario et panne) émettaient
  un `rollback` seul. Au « relancer », le testeur et le développeur se souvenaient d'un code effacé
  (ADR 0050). `rembobinerScenario` émet maintenant la paire avec `forgetSessions`.
- Les reprises **sans** escalade (pas refusé, scénario repris automatiquement) gardent leur
  session, qui reçoit le motif « tour annulé ». Ce cas n'est pas visé par l'audit.
- Le workflow n'a pas ce défaut : `w.rembobiner` oublie toujours (ADR 0053). Le test de contrôle a
  été vérifié en désactivant cet oubli : il échoue alors.
- Instabilité vue une fois sous charge (`e2e-arbitrage-mutation`, cas « équivalent ») : passe seul
  et à la suite complète suivante. À surveiller.

Prochaine étape : D21 (E), restes de D1, S1 à S5.

---

## 11/10 — D19 : commit de phase en échec

- Avant, une panne au commit rembobinait une phase **approuvée**, et « relancer » la refaisait
  entièrement (revue, ratification). Le workflow avait le même défaut, et il terminait la tâche
  sur une erreur imprévue (la nature « erreur » n'est pas attrapée par `w.phase`).
- Maintenant, dans les deux, il n'y a aucun rembobinage. L'humain choisit :
  - « Relancer le commit » : le commit seul. Cela marche aussi si l'utilisateur a commité
    lui-même entre-temps ;
  - « Continuer sans commiter » : tracé en rejet `commit` et signalé au bilan. Les fichiers
    partent dans le commit suivant (`git add -A`) ;
  - « Abandonner ».
- **Décision du responsable du projet** : l'utilisateur doit pouvoir continuer sans commiter.
- Rien ne dépend du sha d'un commit de phase ; les checkpoints photographient l'arbre de travail.
- Un hook de pré-commit ne peut pas être la cause : le dépôt commite avec `--no-verify`. Causes
  réalistes : verrou `.git/index.lock`, disque plein, droits.
- Extension : le rejet `commit` est tracé à la transition, puis effacé au checkpoint de la phase
  suivante, pour ne pas devenir le « Rejet précédent » d'une autre phase.

Prochaine étape : D20, D21 (E), restes de D1, S1 à S5.

---

## 11/10 — D18 : une phase sautée ne transmet plus son motif ni ses défauts (extension)

- « Sauter » vide `lastRejection` et `reviewThreads`, comme le commit d'une phase. Pas dans
  `oublierLaPhase` : « relancer » réutilise le motif, et les fils survivent à une relance
  (ADR 0046).
- Le workflow n'a pas ce défaut : un suivi par phase et une `relance` vide après un saut. Un test
  de contrôle le confirme (il passe d'emblée).
- Test : RESEARCH sans document, donc la porte citations échoue jusqu'à l'escalade, puis
  « sauter ». Le décideur de DESIGN ne doit pas recevoir « Document de recherche absent ».

Prochaine étape : D19 à D21 (E), restes de D1, S1 à S5.

---

## 11/10 — D17 : panne pendant les questions ouvertes (ROUTE)

- Extension : l'escalade proposait « relancer » et « sauter », qui ne faisaient rien hors phase.
  Elle a maintenant ses propres options, « relancer » et « abandonner ». Workflow : les questions
  sont posées hors de `w.phase`, donc une panne terminait la tâche en échec.
- « Relancer » repose les seules questions dont la demande n'a pas été créée :
  - extension : `askQuestion` rend `QUESTION_ASKED`, noté à tout stade (une autre question a pu
    faire escalader entre-temps) ;
  - workflow : `Promise.allSettled`.
- Piège trouvé en testant : une question déjà posée pouvait recevoir sa réponse **pendant**
  l'escalade, et l'extension l'ignorait (la réponse était perdue, et la question n'avait plus de
  demande en attente). Les réponses aux questions sont maintenant acceptées en ESCALATED depuis
  ROUTE.
- Le workflow ne reconnaît que la panne (`PanneEnvironnement`) : une erreur imprévue d'effet
  (nature « erreur ») y reste fatale, par conception de la bibliothèque. Le script s'en sert pour
  les fichiers absents.

Prochaine étape : D18 à D21 (E), restes de D1, S1 à S5.

---

## 11/10 — D16 : un nettoyage ne change pas le comportement

- Décision du responsable du projet (option B, dans les deux) : un nettoyage qui fait passer
  l'acceptance du scénario de vert à rouge est refusé. On revient au vert et le nettoyage est
  annulé, sans escalade (SPEC §8.3). Le workflow prend en plus le résultat du nettoyage, comme
  l'extension.
- Avant : le workflow rembobinait tout le scénario à la porte de fin ; l'extension continuait le
  cycle sur un code cassé.
- Test : la pile « par marques » casse l'acceptance (marque `// ac-1` retirée) sans casser les
  tests unitaires. Le mode sessions séparées correspond au niveau `challenging`.

Prochaine étape : D17 à D21 (E), restes de D1, S1 à S5.

---

## 11/10 — D14 : une panne pendant une correction ne rembobine plus toute la phase

- Workflow : `corriger` attrape aussi `PanneEnvironnement`. Il rembobine à l'entrée de la
  correction, restaure `L` et les fils, puis escalade (`escaladeScenario`). « Relancer » reprend la
  boucle de correction, sans essai consommé.
- **L'audit se trompait sur l'extension**. Elle rembobinait au bon point, mais « relancer »
  replanifiait DELIVER, parce que `retryDeliver` n'est appelé que s'il reste un scénario non
  terminé. Il y avait donc une nouvelle revue et la correction était perdue. `retryFix` reprend
  maintenant la correction.
- Ne pas aligner le workflow sur l'ancien comportement de l'extension : replanifier avec des
  scénarios déjà verts, c'est le chemin de D13 (`dernierVert` reste `null`).
- Piège de test : la pile ne reçoit pas l'étiquette de l'exécution (`opts.evidence` est absent).
  La panne est donc déclenchée au premier lancement de tests après la revue.

Prochaine étape : D16 (W), D17 à D21 (E), restes de D1, S1 à S5.

---

## 11/10 — D22 : arbitrage des mutants équivalents (ADR 0065)

- **Décision du responsable du projet.** Un mutant contesté comme équivalent est jugé par un
  agent dédié, `skraft-mutation-arbiter`, distinct du testeur. S'il est équivalent, c'est une
  dérogation de l'agent. Sinon, ou au-delà de deux dérogations de l'agent, l'humain tranche.
  **Toute décision est tracée.**
- Un défaut par mutant survivant. Une dérogation retire ce seul mutant du score, recalculé avec
  les mutants tués et jugés que donne maintenant le lecteur Stryker.
- La traçabilité couvre l'entrée `arbitrage` de la trace (champ `arbitrages` de l'état, ou
  `w.arbitrage` dans le workflow), `.skraft/<slug>/deliver/derogations.md` commité, les faits
  donnés aux lentilles et le rapport final.
- **Défaut trouvé en route (extension)** : les fils des portes de fin de DELIVER (D5) n'étaient
  pas dans `reviewThreads`, donc les réponses des agents à ces défauts étaient ignorées. Corrigé.
- Pièges de test :
  - *cold-reader* ne reçoit aucun fait (voulu) : pour vérifier les faits de la revue, lire le
    dossier de *test-integrity*.
  - La revue de D22 a montré que le constat de l'audit (« la revue rend APPROVED ») n'était plus
    exact depuis D5 : la porte relancée échoue de nouveau.
- **Reste ouvert** : la contestation d'un défaut de couverture ou de suite finale n'a toujours pas
  d'arbitre.

Prochaine étape : D14, D16 (W), D17 à D21 (E), restes de D1, S1 à S5.

---

## 11/10 — D12, D15, D23 : reprise d'une correction et phase relancée

- D12 : la correction rembobinait le disque mais pas `L` (empreinte, référence, dernier vert). La
  reprise était refusée sans fin (« tests unitaires modifiés »). Correctif ciblé : `L` est
  photographié à l'entrée de `corriger` et restauré. L'aide générale de la bibliothèque n'est pas
  faite et reste à décider.
- L'extension avait la même empreinte périmée, et sa référence de reprise remontait au début du
  scénario (D23). Les deux sont maintenant prises à l'entrée de la correction.
- D15 : la reprise reçoit la cause de l'échec. **API de la bibliothèque** : `w.phase` passe
  `relance` (les motifs de l'escalade) à `fn` au « relancer », et `essayer` accepte `motifs`. Le
  changement est rétrocompatible.
- On ne remet pas l'empreinte à `null` : `null` désactive le contrôle. La mémoire revient au même
  point que le disque.
- Piège : dans un test de la bibliothèque, le script est **rejoué** à chaque pas du moteur. Un
  compteur extérieur au script fausse sa logique ; la décision doit dépendre de ce que le script
  reçoit.

Prochaine étape : D13, D14, D16 (W), puis D17 à D22 (E).

---

## 11/10 — D10 : un test unitaire existant ne s'affaiblit plus en silence

- Cœur : `FileChange.removed`, le nombre de lignes de l'ancien arbre retirées ou remplacées, lu
  dans les hunks `--unified=0` déjà calculés pour `lines`. Zéro veut dire « ajouts seulement ».
- Pas `test` : ajouts seulement aux tests existants. Pas `fix-test` : modification permise pour
  les fichiers cités par un défaut actif adressé au testeur. Une lentille peut demander de
  renforcer un test faible (décision du responsable du projet, option B).
- Preuves des essais effacés (second point) : vérifié sans effet, rien codé. La porte de scénario
  lance ses tests avant de lire les preuves, donc le vert est toujours le sien.
- Piège de test : avec le faux runner, tout passe dès que `src/domain/bolus-cap.ts` existe, et un
  seul scénario n'a pas de cycle. Le test du pas `test` utilise une pile « par marques » (un test
  passe si le code contient `// <nom>`).

Prochaine étape : D12 à D16 (W), D17 à D23 (E).

---

## 11/10 — D9 : après une question bloquante, le motif reste

- L'agent repart avec la réponse **et** son retour : rejet de porte, amendement, question de revue
  ou pas refusé.
- Extension : `lancer(ns, retour)` (`reducer.ts`) remplace les `{ state, effects: [specialist(…)] }`
  et garde `state.retour`. `lastRejection` ne suffisait pas : un amendement n'est pas un rejet.
  En DELIVER, `agent` tient `deliver.feedback`.
- Workflow : les trois boucles (`specialiste`, `agentDuPas`, RESEARCH) ne vident plus leur retour.
- **Décision du responsable du projet** : les réponses humaines sont gardées et réutilisées dans
  tout le processus, même après un rembobinage. Le second point de D9 (les oublier) est écarté.

Prochaine étape : D10, puis D12 à D16 (W) et D17 à D23 (E).

---

## 11/10 — D8 : un rapport par revue, sans écrasement ni résurrection

- Rapport nommé par le **rang** de la revue dans la phase, et non plus par l'essai :
  - un amendement ne consomme pas d'essai, donc ses deux revues écrivaient le même fichier ;
  - après une relance, la réécriture d'avant commit remettait les rapports du run effacé.
- Les listes de revues ne sont pas vidées au rembobinage : leur rang numérote aussi les fils de
  défauts, qui survivent à la relance. On marque à la place le début du run (`debutDuRun` dans le
  suivi du workflow, `debutDesRevues` dans l'état de l'extension).
- L'audit ne citait que le workflow. L'extension avait les deux défauts ; les tests le montrent.
- Piège : le test D3 du workflow contourne la garde, ce qui provoque un rejet et consomme un essai.
  Ses deux revues ont donc des essais différents, et il ne reproduit pas l'écrasement. Il a fallu
  un test d'amendement pur.

Prochaine étape : D9, D10.

---

## 11/10 — D7 : en correction, contester n'oblige plus à modifier le code

- Règle « aucun fichier de production modifié » levée au pas `fix` quand **chaque** défaut actif
  du développeur est `contested` ou `outOfScope` avec une raison (`allDisputed`), et qu'aucun
  test rouge de la correction côté tests n'attend. Sinon, la contestation proposée par la consigne
  était refusée 3 × 3 fois et la lentille n'arbitrait jamais.
- Extension : décision dans le réducteur (`nothingToChange` sur l'effet), l'effet ne fait que la
  lire. Workflow : `porteVerte`, avec les fils transmis par `correction.fils`.
- Pas de garde sur le commit : `commit`/`commiter` rendent `null` sans changement.

Prochaine étape : D8 (rapports de revue écrasés ou ressuscités), D9, D10.

---

## 11/10 — D6 : faits de revue du run en cours, sans rapports de revue

- Rapports `/reviews/` exclus des livrables (workflow : `enregistrerLivrables` ; extension :
  `pasUnRapport` dans les trois portes). Ils sont écrits sur le disque à **chaque** revue, d'où
  leur présence dans les fichiers modifiés de l'essai suivant.
- Au rembobinage : workflow, `suivi.livrables = []` dans `apresRembobinage` ; extension, **pas
  d'effacement** — le test d'invariants (§5.3, invariant 4 : `artifacts` en ajout seul) l'interdit.
  `debutDuRun[phase]` marque le début du run, `artifactsDuRun` ne lit que lui.
- Non remis à zéro : le suivi des revues (collision des identifiants de défauts avec les fils
  conservés). Numérotation des rapports : D8.
- Piège de test : lentilles en parallèle, compteur partagé → course ; un compteur par lentille.

Prochaine étape : D7 à D10, ou D8 (rapports écrasés/ressuscités) qui prolonge celui-ci.

---

## 11/10 — D2 : plus d'ADR fantôme après un rembobinage

- Workflow : la liste des ADR (`d.adrs`) est **relue sur le disque** (`adrsDuDisque`, fichiers de
  `docs/adr/` avec `Story : <slug>`), à la porte cohérence et dans `apresRembobinage` de DESIGN.
  Le disque est rembobiné et porte le statut dès la ratification (ADR 0064) : il dit vrai.
- Extension : `adrsAvantPhase` pris à l'entrée de la phase, restauré par `oublierAdrsDeLaPhase` à
  chaque rembobinage (budget épuisé, escalade, saut) ; au `GATE_OK` de DESIGN, une proposition
  d'un essai précédent qui n'est plus sur le disque disparaît.
- Les deux moitiés se testent séparément : la relance est couverte par la relecture à la porte,
  le saut par la restauration.

Prochaine étape : D6 — fait juste après.

---

## 11/10 — D3 : statut d'un ADR écrit dès sa ratification (ADR 0064)

- Accept/reject écrit le statut dans le fichier aussitôt (extension : `applyAdrStatuses` par
  décision ; workflow : `ratifier`). ADR décidés en lecture seule pour les agents, avec les gelés.
- **Piège** : un ADR décidé reste « ajouté » depuis le checkpoint de DESIGN ; sans l'exclure de
  `isNew`, la porte cohérence le refusait (« statut Accepted, Proposed attendu »).
- Un test lit le source d'`effects.ts` (`readOnly: [...GELÉS]`) : motif élargi à `GELÉS` suivi
  d'autres chemins.
- Lié : D2 (mémoire `adrs` non remise au point d'un rembobinage) — fait juste après.

---

## 11/10 — D4 : question ou silence d'une lentille (ADR 0063)

- **Rectification de l'audit** : les lentilles n'avaient pas `report_blocker` ; la branche
  « Blocage inattendu » était morte. Décision utilisateur (option A) : leur donner l'outil, puis
  appliquer la décision du 10/10.
- Question → humain (« Question de la revue (<phase>, <lentille>) ») → réponse dans celles de la
  story et dans les faits des lentilles → phase rejouée sans essai (workflow : rejet `nonCompte`
  d'`essayer` ; extension : `afterReviewQuestion`, `attempts` intact). DELIVER : revue relancée
  seule. 3e question dans la phase → escalade. Question déjà tranchée → renvoyée une fois.
- Lentille muette ou en délai → relancée seule une fois, puis « revue impossible » (escalade sans
  essai). **Piège** : le moteur d'agents relance déjà une fois un agent sans sortie, dans le même
  appel — une lentille « muette » se simule avec deux tours vides.
- **Piège** : dans l'extension, reconnaître un défaut de travail par le **nom** de l'erreur, pas
  par `instanceof` : en mode isolé, l'erreur est recréée par le runtime de l'hôte.

Prochaine étape : `docs/12` §8 — D2, D3, D6.

---

## 11/10 — D11 : trace comparable entre l'extension et le workflow

- ROUTE annoncé seulement s'il reste des questions (workflow). **Piège / rectification de
  l'audit** : `w.etape` n'écrit rien dans la trace ; ROUTE n'y apparaît que si une question est
  posée pendant l'étape. Le banc ne voyait donc rien de faux. Le test lit le journal
  (`etat.journal`, appels `etape`).
- Verdict REJECTED tracé sous la porte « revue », une ligne par lentille qui rejette, dans les deux
  (workflow : `w.rejet` avant `Escalade` ; extension : `rejections` + `lastRejection`, que le moteur
  lit). Le motif d'escalade cite ces lignes.
- « Plan de test absent » : porte `plan de test` au lieu de `valeurs`, dans les deux.
- Le harnais de l'extension expose maintenant la trace (`app.trace`), comme celui du workflow.

Prochaine étape : D4 (fait juste après, voir au-dessus).

---

## 11/10 — Revue des commits du 10/10, client Copilot réparé, Swift retiré

Revue des trois commits rapatriés (`45680cf`, `036016a`, `f8c2d16`) ; constats complets dans la
conversation, les principaux ci-dessous.

- **Client Copilot** : `env: { GH_HOST }` (ADR 0057) remplaçait tout l'environnement du CLI —
  le SDK fait `options.env ?? process.env`. Plus de PATH, HOME ni proxy pour les agents. Corrigé
  en `{ ...process.env, GH_HOST }` (`sdkCopilotClientOptions` prend l'environnement en paramètre
  pour le test). Piège : le test d'origine figeait le défaut avec `toEqual`.
- **Swift retiré** (ADR 0061, demande utilisateur). Cause : le précontrôle de `036016a` lance les
  tests avant tout agent, et le projet Swift de démonstration déclarait la cible
  `AcceptanceTests` avant que DISTILL n'en crée le dossier. Les 4 tests Swift étaient sautés sous
  macOS et en CI : seule cette machine les voyait échouer. Retirés : adaptateur, lecteurs
  SwiftLint/Muter, profil, modèle `/stack init`, programmes autorisés, `swift test` souple,
  bouts en bout réels. JUnit XML déplacé dans `src/reports/`. Pile simulée skraft en TypeScript.
- Défaut trouvé en passant : `profiles/typescript.yaml` lisait Stryker avec `muter-json`.
- **D5 aggravé par `036016a`** : la porte « couverture du diff » échoue en fin de DELIVER, toute
  la phase est rejouée sans agent destinataire ; tous scénarios verts → même échec jusqu'au
  budget. À corriger avec D5 (`docs/12`, non commité).

- **D5 corrigé en partie** (ADR 0062) : mutation, couverture du diff → testeur ; suite finale →
  développeur, par la correction ciblée de l'ADR 0046, dans les deux implémentations. Piège : le
  test « couverture du diff en isolation » existant échoue sur la porte du *scénario*, pas de fin
  de phase — le vrai cas D5 est un squelette écrit en DISTILL (nouveau test bout en bout). Aide
  `acceptanceWriter` exportée par les deux harnais.
- **Puis le reste de D5** (accord utilisateur) : revue de DELIVER à mineurs seuls → mineurs en fils
  (`minorThreads`), corrigés comme des majeurs ; revue sans aucun défaut ou aucun livrable →
  escalade sans essai (qui rembobine, comme toute escalade). Piège : dans le test bout en bout, le
  faux développeur doit *modifier* le code en correction, sinon la porte refuse le pas (« Aucun
  fichier de production modifié »). Workflow : le motif d'une `Escalade` est dans le **titre** de
  l'interaction (`Phase DELIVER : …`), pas dans `detail`.

Prochaine étape : S5/S6 n'ont plus de bout en bout sur une vraie chaîne — en écrire un (TypeScript
ou .NET) ; puis mettre `docs/12` à jour (D1 corrigé par l'ADR 0059, lignes du workflow
décalées).

---

## 10/10 — Publication des corrections et de la campagne comparative

À la demande utilisateur, publication sur `feat/workflow-rejouable` des corrections
d'environnement et d'authentification, du regel DISTILL, du précontrôle et de la
couverture du diff, puis du banc et des rapports archivés. Aucun changement de main.
Avant publication : typage et contrôle des diffs verts ; 1 279 tests verts et neuf
sautés sur les neuf projets concernés. Deux échecs sous exécution concurrente
(délai du clonage Workspace et observation running/waiting de DESIGN) :
rejeu des deux fichiers avec un seul worker, 12/12 verts. Pas de modification
de tests pour masquer ces échecs ; leur sensibilité à la concurrence reste à surveiller.
Branches des essais réussis déjà vérifiées sur GitHub : workflow-1 b7b6928,
workflow-2 69a9c8a et extension-2 59f2454 dans exemple-dotnet-tdd.

---

## 10/10 — Productions finales à modèles fixés comparées

Analyse du workflow 0b3184b5 contre extension c4433175, code/tests et documents :
§6 de `docs/runs/2026-10-10-comparaison-us-2-modeles-fixes.md`.
Même calcul sur les cinq exemples ; workflow : 19 exemples acceptance, somme
de deux remises positives couverte et invalides dès DISTILL ; extension :
test d'immuabilité et gardes nulles plus explicites. Workflow copie correctement
son barème mais ne teste pas la mutation source exigée par sa matrice DESIGN.
Extension additionne correctement mais ne teste toujours pas deux remises positives.
Taux zéro reste autorisé seulement côté workflow, par choix automatique du banc.
Les revues finales approuvent sans signaler ces trous respectifs. Aucun changement
de code ni de livrable d'essai ; pas de nouveau run.

---

## 10/10 — Workflow à modèles verrouillés terminé DONE

À la demande utilisateur, mêmes modèles par rôle que l'extension c4433175 :
classifieur gpt-6-luna, modélisation claude-sonnet-5.5, autres gpt-6.1-sol.
Exception explicitement choisie : cold-reader fixé à gpt-6.1-sol, alors que le
run extension avait aussi utilisé mai-code-1.1-flash. Le banc accepte désormais
`--modeles-roles`, refuse les rôles non configurés et annule au modèle effectif
différent signalé par usage. Association conservée dans le résumé.
35 tests banc verts et typage vert ; test livraison ajusté pour exactOptionalPropertyTypes.

Run `0b3184b5-d4af-4a9a-8c97-101af6d61ecf`, copie mesure-skraft-pzsXn3 :
**fini / DONE**, 17m58, 29 tours, 111 appels, 335,4 requêtes équivalentes SDK,
un rejet RESEARCH (sections manquantes), aucun silence. Plafond 600 non atteint.
Tous les événements usage ont été comparés aux modèles demandés : aucun écart.
Branche workflow-2 à `69a9c8a9b0cc40c1d1464a8251b6dcb0078354ea`, arbre propre,
main inchangé a7cf6db. Vérification indépendante : 24/24 tests verts, zéro ignoré.
Rapport, trace, preuves et interactions archivés sous
`docs/runs/2026-10-10-us-2-workflow-0b3184b5/`.
Comparaison distincte `docs/runs/2026-10-10-comparaison-us-2-modeles-fixes.md`.

Cette fois le workflow a demandé en DESIGN provenance du barème, déduction dans
ATPayer et validation des configurations. Le répondeur a encore choisi la première
option non configurée : taux [0,100] avec zéro autorisé, contre ]0,100] dans
l'extension. Les modèles verrouillés n'ont donc pas rendu les contrats identiques.
Ne pas attribuer causalement la différence de questions au modèle seul.
Aucun run actif ni nouveau lancement automatique.

---

## 10/10 — Documents US-2 comparés aux deux livraisons

Lecture complète RESEARCH/DESIGN/DISTILL et revues des runs livrés c4433175 et
cffee616, puis tests concernés. Analyse conservée en §6 de
`docs/runs/2026-10-10-comparaison-us-2-extension-600.md`. Aucun artefact de run modifié.
Les cinq critères sont présents dans les deux ; contrats différents hors exemples :
extension valide taux ]0,100] et doublons, workflow les exclut faute de décision.
Les clarifications dites « utilisateur » extension sont des choix du répondeur
automatique (blocages sans règle = premier choix), pas une intervention humaine.

Faiblessse concrète : aucun test extension de deux remises positives à additionner,
alors que le workflow en ajoute un après sa revue. Code extension additionne bien,
mais ses exemples ne protègent pas contre la conservation de la dernière remise.
Le meilleur palier inversé est aussi manqué par sa revue DISTILL puis récupéré
en DELIVER. Invariants et immuabilité du plan extension réalisés seulement après
refus de revue finale. Docs DESIGN parfois laissés en état intermédiaire après
fermeture des contrats. Aucun correctif de code demandé ni réalisé dans cette analyse.

---

## 10/10 — Extension à plafond 600 terminée DONE

Run `c4433175` livré en **17m35**, 35 tours, 128 appels, 232,2 requêtes
équivalentes SDK, 4 rejets ; plafond 600 non atteint, consommation même inférieure
à 350. Réserve 40032 → 39856 (écart 176, relevé retardé). Branche extension-2
à `59f2454eb5388619da67fd1a8d4e4813e6bba8fc`, arbre propre ; main inchangé a7cf6db.
Vérification indépendante `dotnet test` : **21/21**, zéro ignoré ; ac-1 à ac-5 présents.
Rapport, résumé, trace, preuves et interactions archivés sous
`docs/runs/2026-10-10-us-2-extension-c4433175/`.

Comparaison distincte `docs/runs/2026-10-10-comparaison-us-2-extension-600.md`,
sans écraser le couple précédent. Workflow : 55m21 / 264,3 ; extension : 17m35 /
232,2. Ne pas conclure que relever le budget a provoqué cette amélioration :
nouveau run, modèles effectifs et choix métier différents ; plafond différent,
mais aucun des deux runs livrés n'a consommé 350. Aucun silence dans ce run
extension, contrairement aux deux interruptions du workflow. Revue finale :
tests et code complétés pour invariants de configuration, copie défensive et
sélection du meilleur palier. Aucun run actif ; campagne de quatre runs non terminée.

---

## 10/10 — Extension rejouée depuis main, plafond porté à 600

Demande utilisateur : nouveau run complet extension, plafond 600 requêtes
équivalentes SDK. Réinitialisation de `tests/us-2/extension-2` explicitement
autorisée, effectuée avec lease sur `8333982` vers `a7cf6db` ; main inchangé.
L'ancien rapport 521f0098 et sa copie mesure-skraft-LDRZZe sont conservés.

Run **en cours** `c4433175-1600-46f9-98b3-fd407ad00410`, processus
`us2-extension-600`, copie
`/private/var/folders/q0/zz_gtf8x0cb9dvz3q9bfjhs40000gp/T/mesure-skraft-dSODxp`.
Commande banc : `--base=main --hote-copilot=byb.ghe.com --plafond-requetes=600`,
`--pousser --branche-run=tests/us-2/extension-2`. Même répondeur, modèles non
imposés. Précontrôle franchi avec avertissement non bloquant, CLASSIFY terminé,
RESEARCH démarré. Réserve initiale 40032/45000.
Ce run n'a plus le même plafond que le workflow : consigner cet écart dans la
comparaison, sans remplacer le résultat précédent au plafond 350.

---

## 10/10 — Extension arrêtée au plafond, premier couple mesuré

Run `521f0098-3032-4c26-9846-0f2c530be45b` terminé **ABORTED / DISTILL** :
plafond de 350 atteint, 352,5 requêtes équivalentes comptabilisées après l'appel
ayant franchi la limite. Arrêt pendant la revue DISTILL, aucun DELIVER lancé.
16m48, 22 tours, 99 appels, 3 rejets ; réserve 40421 → 40064, écart 357.
DESIGN et ses revues ont consommé 297 requêtes équivalentes, dont une correction
sur l'exception absente du modèle et une demande de marqueur/nom de matrice par
la lentille. Ce dernier grief paraît lié au format amont : à examiner, pas corrigé
pendant la mesure.

Branche `tests/us-2/extension-2` à `8333982a9a9f175a2dd5f900da343dd9e1ef4f64` ;
main vérifié inchangé à `a7cf6db`. Rapport, résumé, trace, preuves et interactions
archivés dans `docs/runs/2026-10-10-us-2-extension-521f0098/`.
Premier tableau produit dans `docs/runs/2026-10-10-comparaison-us-2.md`.
Workflow livré (264,3), extension non livrée au plafond (352,5) : constat de ce
couple, pas conclusion générale. Les modèles n'étaient pas imposés et leurs
associations effectives diffèrent ; le répondeur commun choisit par défaut le
premier choix aux blocages non configurés, donc les précisions métier peuvent
aussi diverger. Ne pas attribuer tout l'écart au moteur sans ces réserves.
Aucun run encore actif ni relance automatique.

---

## 10/10 — Indicateur de livraison du banc corrigé avant le run extension

Run extension **en cours** : tâche `521f0098-3032-4c26-9846-0f2c530be45b`,
processus `us2-extension-2`, copie isolée
`/private/var/folders/q0/zz_gtf8x0cb9dvz3q9bfjhs40000gp/T/mesure-skraft-LDRZZe`.
Précontrôle franchi avec avertissement non bloquant de couverture, classification
confirmée « assez difficile », RESEARCH démarré. Réserve initiale 40421/45000 ;
plafond 350 requêtes équivalentes SDK. Même répondeur que cffee616, modèles laissés
au runtime comme pour le workflow. Base et branche distante vérifiées à `a7cf6db`.
Commande : banc sans `--workflow`, `--base=main --hote-copilot=byb.ghe.com`,
`--plafond-requetes=350 --pousser --branche-run=tests/us-2/extension-2`.
À la fin : archiver le rapport et vérifier le livrable avant comparaison.

Accord utilisateur pour le run extension suivant sur la branche libre
`tests/us-2/extension-2`, depuis main `a7cf6db`, sans réinitialiser extension-1.
Préparation : `workflowLivre` réutilise `relire` du moteur pour lire résultats en
clair ou référencés ; contenu absent = erreur explicite. TDD, 32 tests banc verts,
dont 4 nouveaux ; résultat réel cffee616 relu et confirmé livré. `resume.json`
corrigé à `livre: true` avec annotation de l'ancienne valeur et de la méthode,
rapport mis à jour, trace et preuves inchangées. Le défaut de mesure est résolu.

---

## 10/10 — Mesure workflow terminée : DONE, livrable vert

Run `cffee616-6ba6-4a79-b64a-df8e13c264ed` terminé **fini / DONE** en 55m21 :
35 tours, 185 appels, 264,3 requêtes équivalentes SDK, 5 rejets. Écart de réserve
annoncé : 301 (40773 → 40472), non convertible en crédits à taux fixe.
Branche `tests/us-2/workflow-1` poussée à
`b7b6928e85d362968462ddd6f9131c4ff30f5367`, arbre propre ; `main` vérifié inchangé
à `a7cf6db`. Vérification indépendante : `dotnet test Tarification.sln --no-restore`
vert, 13 tests, zéro ignoré ; les cinq critères ont leurs acceptances.
Rapport, résumé, trace, preuves et interactions archivés dans
`docs/runs/2026-10-10-us-2-workflow-cffee616/`.

Rejets : citations hors plages, revue DISTILL sur le meilleur palier, deux silences
de 300 s en DELIVER (pas test puis dev ac-2), revue finale avec corrections ciblées.
La correction de DISTILL a franchi le gel puis DELIVER ; la dette historique de
couverture n'a pas bloqué. Ne pas confondre livraison et absence de défaut métier :
la revue finale a notamment demandé un test de somme des remises sur deux références.

**Défaut du banc à traiter avant le tableau comparatif** : `resume.json` indique
`livre: false` malgré DONE. Le résultat workflow persisté est une référence
`fin.valeur.ref`, tandis que le banc cherche directement `fin.valeur.clair.phases`.
Le rapport brut est conservé, sans falsifier l'indicateur. La campagne complète reste
non validée ; aucun nouveau run extension lancé automatiquement après cette fin.

---

## 10/10 — Nouvelle mesure lancée, workflow en premier

À la demande de l'utilisateur, lancement complet du workflow skraft depuis `main`
`a7cf6db058fc74fb6b3a72d469ccda5acf06177b`, après les correctifs ADR 0059 et 0060.
Tâche `cffee616-6ba6-4a79-b64a-df8e13c264ed`, processus de session
`us2-workflow-1`, copie isolée
`/private/var/folders/q0/zz_gtf8x0cb9dvz3q9bfjhs40000gp/T/mesure-skraft-8aTs4u`.
Commande : banc `scripts/mesure-skraft.ts`, `--workflow --base=main`,
`--hote-copilot=byb.ghe.com --plafond-requetes=350 --pousser`,
`--branche-run=tests/us-2/workflow-1`. .NET 10.0.400, répondeur commun inchangé,
aucune association de modèles imposée. Réserve annoncée par le banc : 40773/45000.

Précontrôle franchi : avertissement non bloquant sur la couverture existante,
classifieur terminé puis RESEARCH démarré. Première poussée `7d1272b` sur la branche
workflow dédiée ; `main` et les résultats extension précédents sont conservés.
**Run en cours, aucun résultat de livraison encore acquis.** Le workflow est désormais
le premier run de cette nouvelle séquence ; ne pas lancer l'extension en parallèle.
À la fin, lire le rapport automatiquement produit et consigner l'issue réelle avant
de poursuivre la comparaison.

---

## 10/10 — Couverture du code modifié, dette existante notifiée

Décision utilisateur implémentée dans les deux versions (ADR 0060). Avant le premier
agent, les tests existants sont exécutés par le code (`INIT_BASELINE`) : rouge,
ignoré, délai ou sortie en erreur bloquent. Couverture historique insuffisante :
notification non bloquante dans le chat, avec les seuils par couche inchangés.

Le Workspace ajoute les numéros des lignes modifiées au diff, y compris pour les
fichiers non suivis ; le lecteur Cobertura garde les lignes exécutables et leur état.
Les portes croisent ces deux ensembles. Les propriétés historiques ATPayer et Lignes
ne bloquent plus un ajout couvert si elles restent inchangées. Si une ligne modifiée
est non couverte, le rejet donne son numéro. Rapport/détail absent : « non mesurée »,
pas de substitution par le taux global ni de conformité fictive.

Checkpoint qualité initial persisté avant les agents ; contrôle de scénario local,
puis contrôle final de toute la tâche (sources DESIGN/DISTILL incluses). Les anciens
états sans cette référence gardent un contrôle depuis DELIVER avec note de limitation.
Une nouvelle tâche sur les tests d'acceptance déjà rouges du run abandonné sera
bloquée : `--depuis` n'est pas une reprise de l'état persisté. Ne pas relancer ce
dépôt en prétendant reprendre automatiquement la tâche précédente.

Vérifié : suites ext-skraft + workflow-skraft, 659 tests verts, 4 Swift sautés ;
workspace/stack-adapters/extension-api/workflow : 370 verts au premier passage,
5 Swift sautés et un échec de configuration Git préexistant, puis les 11 tests sync
verts isolément. Typage vert. Précontrôles et couverture du diff testés via les
deux hôtes isolés, livraison avec dette inchangée et refus sur ligne modifiée non couverte.
Aucun appel LLM réel ; pas de nouvelle campagne ni modification des rapports archivés.

Pièges : S4 n'avait aucun test à l'initialisation, Vitest rendait code 1 « aucun test » ;
les fixtures jumeaux incluent désormais un test du comportement existant.
`safe.bareRepository=explicit` empêche le test sync de lire son faux distant :
autorisation limitée au processus de validation par `GIT_CONFIG_COUNT=1`,
`GIT_CONFIG_KEY_0=safe.bareRepository`, `GIT_CONFIG_VALUE_0=all`, aucune modification
de la configuration utilisateur. Sous la charge des E2E parallèles, délai de 5 s
dépassé sur sync ; rejoué seul avec `--testTimeout=30000`, vert.

Prochaine étape : choisir une base verte pour une nouvelle mesure réelle, ou traiter
explicitement la reprise de la tâche abandonnée ; ne pas abaisser les seuils.

---

## 10/10 — Essai de reprise terminé : gel franchi, couverture insuffisante

À la demande de l'utilisateur, nouveau run extension lancé depuis l'état conservé `a845e0f`
du premier run, avec `--base=skraft/us-2 --depuis=DISTILL`, plafond 350 et hôte `byb.ghe.com`.
Tâche `eda055a6-f20d-4a10-a316-a3bc08688565`, copie
`/private/var/folders/q0/zz_gtf8x0cb9dvz3q9bfjhs40000gp/T/mesure-skraft-zTVyQi`.
Run terminé **ABORTED / DELIVER**, rapport dans
`docs/runs/2026-10-10-us-2-extension-eda055a6/`. DISTILL et sa revue sont approuvés,
DELIVER démarre réellement : aucune erreur d'empreinte. Le correctif du gel est donc
franchi sur l'exemple réel, sans démontrer une correction de revue dans ce nouveau run.

Blocage suivant, porte de fin du scénario ac-2 : couverture de `CalculDuPanier.cs`
à 75 % (3/4 lignes) et de `Panier.cs` à 87,5 % (7/8), minimum exigé 90 %.
Deux reprises automatiques retrouvent les mêmes motifs, puis le répondeur abandonne.
Mesures de la trace : 11m43, 32 tours, 113 appels, 113,6 requêtes équivalentes SDK,
9 rejets. Aucun dépassement du plafond, aucune poussée GitHub.

C'est une reprise par phase du banc, dans une nouvelle tâche, pas la réouverture de la tâche
ABORTED ni un test de reprise après crash. RESEARCH et DESIGN ne sont pas rejoués ; leurs
livrables restent présents sur disque mais ne sont pas renseignés dans `phasesCompleted`.
DISTILL doit revalider l'ensemble actuel avant DELIVER. Aucun fichier initial modifié,
aucune poussée GitHub demandée ; la copie et les rapports conserveront les résultats.
Cet essai part d'une base avancée : ne pas le compter comme run complet comparable.
Prochaine étape : examiner pourquoi les corrections de scénario ne comblent pas la couverture
requise ; ne pas abaisser silencieusement la barre de qualité ni relancer à l'identique.

---

## 10/10 — Gel de DISTILL corrigé dans l'extension et le workflow

Cause du run `63e98c3d` identifiée : le premier passage des portes enregistrait l'empreinte,
puis un refus de revue autorisait une correction sans invalider cette référence. Le test ajouté
par `skraft-acceptance` était approuvé mais absent de l'empreinte reprise par DELIVER.

ADR 0059 : refus ou interruption de DISTILL = empreinte et non-régressions invalidées avant
correction ; portes rejouées sur l'ensemble corrigé, nouvelle empreinte conservée après
approbation. Même correctif dans le réducteur et le workflow indépendant, avec invalidation
après rembobinage. Un refus en DELIVER ne lève pas le gel.

Vérifié : 230 tests ciblés verts (réducteur, S4 jumeaux, portes DISTILL et DELIVER), typage
du monorepo et `git diff --check`. Les deux scénarios S4 atteignent le premier agent DELIVER
après ajout d'un fichier demandé en revue. Les tests purs couvrent délai, panne, rejet définitif
et budget épuisé. Aucun appel Copilot.

Pièges de validation : les défauts simulés doivent renseigner `target: "test"` ; sinon la revue
échoue sur son schéma, pas sur le gel. Sur macOS, lancer ces tests avec un `TMPDIR` canonique
(`TMPDIR="$(cd "$TMPDIR" && pwd -P)"`) : le compilateur workflow voit `/private/var/…`,
et rejette les imports si le dossier déclaré reste son alias `/var/…`. Défaut de chemins
préexistant, non corrigé ici.

Prochaine étape : reprendre la campagne après décision sur la branche extension-1 déjà
modifiée. Le run échoué reste archivé, aucun nouveau run réel lancé et aucune branche
réinitialisée. Les résultats de campagne restent incomplets.

---

## 10/10 — Run 1 extension terminé : abandon à l'entrée de DELIVER

Run `63e98c3d-fdc4-4059-9e65-3dc3b9d40d75`, rapport archivé dans
`docs/runs/2026-10-10-us-2-extension-63e98c3d/`. RESEARCH, DESIGN et DISTILL ont été
validés après corrections ; aucun agent DELIVER n'a démarré. À son entrée, la vérification
du gel échoue : « Les tests d'acceptance ont changé depuis DISTILL alors qu'ils sont gelés ».
Le répondeur a relancé deux fois, puis abandonné devant la même escalade. Le processus sort
avec succès car il a produit le rapport, mais la tâche est **ABORTED / DELIVER**, non livrée.

Mesures de la trace : 13m59, 26 tours, 96 appels, 196,8 requêtes équivalentes SDK sur
350, 4 rejets, 3 660 717 tokens d'entrée. Le résumé console initial ne compte que certains
tours : utiliser le rapport issu de la trace. La réserve est mise à jour avec retard.
Branche `tests/us-2/extension-1` poussée à `a845e0f` ; `main` reste à `a7cf6db`
(refs distantes vérifiées après le run).

Écart d'empreinte diagnostiqué et corrigé depuis (ADR 0059, entrée ci-dessus).
Conserver ce run comme preuve d'échec.
Ne pas redémarrer un run complet sur extension-1 : sa branche n'est plus au SHA initial et
le banc le refusera. Aucun run workflow n'a encore été lancé.

---

## 10/10 — Connexion confirmée et première réponse Copilot GHE

L'utilisateur confirme que la connexion depuis l'interface fonctionne après le correctif du
code gh. À sa demande, vérification réelle avec le jeton actuel lu par
`gh auth token --hostname byb.ghe.com` et le client corrigé : 23 modèles accessibles, puis
un seul prompt minimal sans outils ni lecture de fichiers. Réponse exacte : `COPILOT_OK`.
Session fermée et supprimée ; aucun jeton affiché ou enregistré. Ce contrôle a envoyé une
inférence réelle, contrairement aux précontrôles précédents. La campagne US-2 reste à lancer.

---

## 10/10 — Connexion dans l'interface : code gh non reconnu et mauvaise page

Le précontrôle SDK précédent utilisait une connexion gh déjà enregistrée ; il ne vérifiait
pas le parcours de connexion depuis l'interface. L'utilisateur a signalé l'absence de code
et de navigateur, puis le délai expiré.

Cause observée sur gh 2.101 sans terminal : `One-time code (…) copied to clipboard`,
pas l'ancien `one-time code: …`. Le lecteur reconnaît maintenant les deux formats et
n'envoie Entrée que si l'invite le demande. L'interface ouvre explicitement la page à
réception du code et affiche aussi son adresse pour une ouverture manuelle. Le canal de
réouverture ne vise plus systématiquement github.com : il conserve l'adresse de la connexion
Enterprise en cours, avant même sa réussite (ADR 0058).

Vérifié : 103 tests ciblés, typage, build et 2 essais Electron réussis. Les tests d'interface
couvrent aussi l'échec du navigateur : code conservé, adresse visible, erreur explicite.
Aucun prompt Copilot. Reste à confirmer la connexion OAuth réelle dans le navigateur par
l'utilisateur après arrêt et relance de l'application dev ; le code de la tentative expirée
ne doit pas être réutilisé.

---

## 10/10 — Authentification Copilot Enterprise Cloud résolue

Le blocage décrit plus bas était un défaut de câblage, pas un défaut d'activation côté
administrateur. `byb.ghe.com` utilise Enterprise Cloud avec résidence des données ; le mode
GHES offline ajouté au premier essai était inadapté. Le SDK accepte le jeton OAuth existant de
`gh` lorsqu'on lui transmet également `env.GH_HOST=byb.ghe.com` (ADR 0057).

Le client associe désormais jeton et hôte, sans variables GHES offline. Le banc, l'essai
Copilot et l'application utilisent ce chemin. Le contrôleur transmet l'hôte courant, pas
seulement celui lu au lancement : une connexion Enterprise faite dans l'interface est prise
en compte au prochain démarrage du runtime.

Vérifié avec le client corrigé et le SDK 1.0.14 : **23 modèles accessibles, création de session
réussie, puis fermeture et suppression**, aucun prompt envoyé. Les 62 tests ciblés, le typage,
le build et les 2 essais Electron passent. Aucun jeton écrit ni affiché.

Prochaine étape : relancer l'application dev pour prendre le correctif, sélectionner
`byb.ghe.com` comme hôte de connexion si nécessaire. La campagne US-2 n'a pas été relancée
pendant cette réparation ; ses quatre runs restent à faire sur les seules branches dédiées.

---

## 10/10 — Build Electron réparé après l'ajout des workflows

Le lancement `pnpm run dev` échouait avec `Unterminated string literal` dans Acorn :
electron-vite 5 détectait un faux import dans une chaîne du parseur et y insérait son shim
CommonJS. Acorn est maintenant une dépendance directe d'exécution de `apps/desktop`, donc
externalisée par la configuration existante. esbuild passe également des dépendances de
développement à celles d'exécution : le moteur de workflows en a besoin à l'exécution et son
binaire doit être résolu depuis son paquet, pas depuis le bundle (ADR 0056).

Vérifié : `pnpm build`, `pnpm e2e` (2 essais : démarrage et ouverture d'un projet) et
`pnpm typecheck` passent, sans requête Copilot. Aucun changement de version des dépendances.
Le cache pnpm ne contenait pas les métadonnées nécessaires à l'installation hors ligne ;
l'installation normale a actualisé le verrou sans télécharger de nouveau paquet.

Pour lancer sans pnpm global, depuis ce dépôt :
`npm exec --yes --package=pnpm@10.34.5 -- pnpm run dev`.
Le blocage d'authentification GHE de la campagne reste distinct et non résolu.

---

## 10/10 — Premier run US-2 bloqué avant Copilot, hôte conservé

Deux tentatives pour le run 1 (`extension-1`), plafond 350, sans limite murale :
1. Sans hôte explicite : arrêt avant tâche, aucune session GitHub.com dans `gh`.
2. Avec `--hote-copilot=byb.ghe.com` : le jeton OAuth est lu et la réserve répond
   (`41 507 / 45 000`, `token_based_billing: true`), mais le SDK refuse le jeton à la création de
   session : `No GitHub OAuth token or Copilot HMAC key provided`. Trois reprises d'escalade
   immédiate, **zéro appel modèle / zéro requête facturée**.

`main` et `tests/us-2/extension-1` sont toujours à `a7cf6db` ; le push final n'a changé aucun
commit. Le report invalide est archivé sous `docs/runs/2026-10-10-us-2-extension-8fd59623/`.
Le banc accepte désormais `--hote-copilot=byb.ghe.com` pour auth et réserve, et passe les variables
`COPILOT_PROVIDER_GHES_HOST`, `COPILOT_PROVIDER_GHES_TOKEN` et `COPILOT_OFFLINE` documentées pour
Copilot CLI sur GHES. Vérification sans prompt : démarrage du SDK réussi, mais `models.list` répond
`Not authenticated`. Aucun appel d'inférence envoyé. Ne pas relancer le pipeline : il faut que
l'administrateur confirme l'activation/configuration Copilot et du fournisseur de modèle sur cet
hôte, ou que le SDK fournisse une authentification supportée.

---

## 10/10 — Campagne bornée à 350 requêtes, sans limite murale

À la demande du responsable : suppression de la limite de durée du banc, plafond par défaut porté à
350 requêtes équivalentes SDK (`nanoAiu / 10⁹`), arrêt au plafond. L'ancien argument positionnel
des minutes est refusé pour éviter de laisser croire qu'il est encore actif. Mis à jour :
`docs/10-plan-comparaison-skraft-workflow.md`, `features.json`.

Une requête équivalente n'est pas un crédit Copilot : GitHub facture désormais en crédits IA selon
le modèle et les tokens ; 1 crédit IA = 0,01 USD. Les 350 requêtes ne se convertissent donc pas en
3 500 crédits. Source officielle : https://docs.github.com/en/billing/concepts/product-billing/github-copilot-billing
et https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing.

---

## 10/10 — Branches isolées pour les runs de comparaison

Le responsable a demandé que les runs ne puissent pas pousser sur `main`. Le banc exige maintenant
`--branche-run` avec `--pousser`, et n'accepte que les quatre noms prévus pour US-2. Avant tout
run, il vérifie que la branche distante existe au même commit de départ ; chaque push utilise un
lease explicite, qui autorise les rembobinages du pipeline mais refuse une mise à jour concurrente.
Les quatre branches dédiées ont été créées sur `freecompub/exemple-dotnet-tdd` depuis `a7cf6db` :
`tests/us-2/extension-1`, `tests/us-2/workflow-1`, `tests/us-2/extension-2`,
`tests/us-2/workflow-2`. Vérifications : 28 tests du banc et `pnpm typecheck` passent ; deux essais
CLI confirment que `--pousser` sans branche et `--branche-run=main` sont refusés. Aucun run Copilot
n'a été lancé.

---

## 10/10 — Campagne US-2 prête, pas lancée

**État.** Tout le banc est écrit (P1 à P6 de `docs/10`) ; aucun run n'a tourné.

**Vérifié le 10/10 dans cet environnement.**
- Dépôt fourni par le responsable : `https://github.com/freecompub/exemple-dotnet-tdd`. `git
  ls-remote` fonctionne ; `gh repo view` ne résout pas ce dépôt, mais ce n'est pas nécessaire au
  clonage.
- Clone local : `/tmp/agentstudio-exemple-dotnet-tdd`, branche `main`, commit `a7cf6db` (même
  référence que le plan), arbre propre avant les tests.
- Avec `PATH=$HOME/.dotnet:$PATH DOTNET_ROOT=$HOME/.dotnet`, `dotnet test Tarification.sln`
  passe : 5 réussis, 0 échec.
- Le chemin d'essai Linux du plan (`/home/diabeo/Projets/...`) n'existe pas sur cette machine ;
  employer le clone local ci-dessus pour les prochains lancements.

**Piège.** Le lancement par l'agent est refusé par le mode automatique de Claude Code (requêtes
Copilot payantes et poussée GitHub). L'utilisateur lance lui-même, ou ajoute une règle de
permission Bash pour `pnpm tsx scripts/mesure-skraft.ts`.

**Écart au protocole.** Le run à blanc (§6 point 1) n'est pas fait : le banc n'a pas de mode
simulé. Le premier run réel sert aussi de vérification du banc ; si le rapport final plante, la
trace JSONL reste et le résumé peut être recalculé.

**Prochaine étape** — quatre runs en alternance, au plus 350 requêtes équivalentes SDK chacun,
sans limite de durée :

```
PATH=$HOME/.dotnet:$PATH DOTNET_ROOT=$HOME/.dotnet pnpm tsx scripts/mesure-skraft.ts \
  /tmp/agentstudio-exemple-dotnet-tdd stories/US-2.md --pousser \
  --branche-run=tests/us-2/extension-1                                           # run 1
# même commande avec --workflow et la branche dédiée                             # runs 2 et 4
tsx scripts/banc/comparer.ts docs/runs/<run1> docs/runs/<run2> …                   # rapport
```

---

## 10/10 — Étapes communes, durée des effets, rapport de comparaison (points 4, 5, 7)

Suite complète : 1 728 tests ; typage propre. Le banc n'a toujours **jamais tourné**.

**Fait.**
- Point 5 (P2), dans le moteur de tâches : `duréeMs` sur chaque transition (rejeu compris pour
  le workflow), entrée `effet` {effet, phase, duréeMs, issue}. Crochet optionnel
  `TaskDefinition.estUnEchec(event)` : sans lui, un effet du workflow qui rend `ERREUR` passait
  pour `ok`. `resumerTrace` donne `agentsMs`, `effetsMs`, `codeMs`, `moteurMs`.
- Point 4 : le workflow appelle `w.etape(...)` avec **les noms de stade de l'extension**, plutôt
  qu'un vocabulaire à lui qu'il aurait fallu traduire. Conséquences sur les jumeaux : les
  questions ouvertes attendent en `ROUTE` (et non plus `RESEARCH`) ; l'usage se lit par
  `CLASSIFY`, `REVIEW`… et non plus `DÉBUT`. `w.phase` annonce `ESCALATED` avant sa question.
  `scripts/banc/etapes.ts` ramène les deux traces au découpage du §3 de `docs/10` ; une revue,
  un arbitrage, une escalade ou un blocage comptent dans l'étape en cours. L'attente humaine
  vient des demandes d'interaction (`createdAt` → `answeredAt`), comptée dans l'étape où la
  question est posée.
- Point 7 (P6) : `scripts/banc/comparer.ts`, pur sauf sa commande.

**Pièges.**
- Les deux implémentations nomment différemment une même porte (`DELIVER` pour un pas refusé
  côté extension, `pas test (s1)` côté workflow ; `DELIVER : mutation` / `mutation`) : la mise
  en regard passe par `famille()`. Une nouvelle porte d'un seul côté apparaîtra « à expliquer ».
- `features.json` : la racine est `{ items: [...] }`, et un texte de notes (« À FAIRE. Planifié
  le 2026-10-08. ») y figure deux fois ; l'éditer par identifiant, pas par texte.

**Prochaine étape** : un run à blanc du banc, puis le premier couple de runs réels (accord du
responsable, réserve Copilot et prix unitaire).

---

## 10/10 — Banc de mesure : mode workflow, répondeur commun, plafond de coût (point 1)

`scripts/mesure-skraft.ts`, typé, **jamais lancé** (il consomme des requêtes Copilot) ; suite
complète : 1 711 tests.

**Fait.**
- `--workflow` : copie `workflows/skraft` dans la copie du projet (`.agent-studio/workflows/`),
  la commite (sinon un rembobinage l'efface), construit le runtime enfant, active le workflow
  (`activerWorkflow`, accord « toujours ») et lance `workflow.skraft-workflow/skraft-workflow`.
  Incompatible avec `--depuis`.
- Répondeur commun pour **les deux modes** (`scripts/banc/repondeur.ts`, `--reponses=`, défaut
  `docs/runs/reponses-us-2.json`) : les questions ouvertes reçoivent enfin leur texte.
- `--plafond-requetes=N` (350 par défaut), compté sur la trace par le SDK ; l'arrêt est dit dans
  le rapport. Rapport et `resume.json` : mode, arrêt, état final propre à chaque mode ; dossier
  `docs/runs/<date>-<story>-<extension|workflow>-<id>/`.
- Le workflow n'a pas d'événement `COMMITTED` : le banc pousse (`--pousser`) dès que HEAD bouge.
- `@agent-studio/workflow` ajouté aux dépendances de développement de la racine (pour `scripts/`).

**Reste avant la campagne** : le découpage commun en étapes (point 4), la durée des effets
(point 5), le rapport de comparaison (P6) ; la réserve et le prix (décision du responsable).

---

## 10/10 — Répondeur commun du banc (point 3 avant la comparaison US-2)

Critère `mesure-repondeur-commun` passé à `true` (7 tests, projet Vitest `banc`).

**Fait.** `scripts/banc/repondeur.ts` : fonction pure `repondre(demande, reponses, memoire)` ;
nature de la demande d'après son titre (difficulté, question ouverte, ratification, arbitrage,
blocage, escalade — les titres des deux implémentations) ; option reconnue par son **action**
(identifiant tel quel, `action:…` ou `…:action`) ; profil : le PO si la demande l'accepte, sinon
le premier requis. Fichier `docs/runs/reponses-us-2.json` (réponses du 03/10).

**Corrigé au passage** : l'ancien répondeur passait le texte des réponses comme **option** (qui ne
correspondait à aucune), donc les questions ouvertes recevaient une réponse vide, dans les deux.

**Suite** : point 1, le banc qui lance l'extension ou le workflow, avec ce répondeur.

---

## 10/10 — Rejets du workflow tracés (point 2 avant la comparaison US-2)

Critère `mesure-workflow-rejets-traces` passé à `true` après son `verify` ; suite : 1 704 tests.

**Fait.**
- `w.rejet(porte, motifs)` : appel journalisé sans effet (comme `w.phase`). L'état du workflow
  expose `rejections` et `lastRejection`, déduits du journal à chaque transition : le moteur, qui
  lit déjà ces champs pour les réducteurs, écrit l'entrée `rejet` de la trace sans changer.
- `essayer` trace chaque essai refusé ; `Rejet` accepte `porte` ; défauts : « revue », « délai »
  (tour interrompu), « porte ».
- Workflow skraft : portes nommées comme dans l'extension (`classifieur`, `citations`, `adr`,
  `cohérence`, `gherkin`, `valeurs`, `RED d'acceptance`) ; DELIVER trace les pas refusés
  (`pas test (ac-1)`…), les scénarios repris, les pannes, les corrections, les corrections
  ciblées (mutation, revue) et les réessais de phase.
- Le harnais de `tests/workflow-skraft` donne une trace au moteur ; deux jumeaux vérifient porte
  et motif exacts.

**Suite** : point 3 (répondeur commun aux deux), puis point 1 (banc qui lance le workflow).

---

## 10/10 — Extension skraft-workflow retirée (convertie en `workflows/skraft/`)

Point 11 de l'ADR 0055 : l'extension `extensions/skraft-workflow` est retirée ; son contenu vit dans
`workflows/skraft/` (lisible dans l'historique Git avant ce commit). Suite complète : 1 702 tests
(232 tests de l'extension retirés ; leur équivalent tourne sur le workflow, projet `workflow-skraft`).

Mis à jour : critères `skraft-*-en-workflow` de `features.json` (même tests, projet
`workflow-skraft`), ADR 0054 (la comparaison porte sur le workflow), `docs/10` P3, `docs/11` §10,
`CLAUDE.md`, README du workflow.

**Suite** : P1 à P6 de `docs/10` (mesure comparée), puis la campagne US-2 avec Copilot.

---

## 10/10 — skraft converti en workflow JavaScript (étape 6 de `docs/11` §11)

Branche `feat/workflow-rejouable`. Critère `workflow-skraft-javascript` passé à `true` après son
`verify` (219 tests) ; suite complète : 1 934 tests.

**Fait.**
- `workflows/skraft/` : conversion de `extensions/skraft-workflow/src` par le compilateur
  TypeScript (commentaires gardés), puis ré-indentation en deux espaces par un script qui ne touche
  pas l'intérieur des littéraux sur plusieurs lignes ; provenance en tête de chaque fichier ;
  `meta` littéral en tête de `workflow.mjs` (agents et consignes repris de `roles.ts`, mot pour
  mot sauf l'architecte des décisions) ; imports remplacés par la bibliothèque (`correspond`,
  `empreinte`, `lireBarreDeQualite`, `couchesManquantes`, `coucheDe`) ; `zod` remplacé par une
  relecture écrite à la main dans `review.mjs`.
- `meta.agents.<nom>.consignes` (nouveau champ, traduit en `role`) : les consignes d'orchestration
  restent hors du fichier d'agent partageable (ADR 0024).
- Point 7 réalisé : plus de `render_adr` ; ligne `Story : <slug>` écrite par le code ; ADR d'une
  autre story ou décidé restauré et tour rejeté.
- `tests/workflow-skraft/` (nouveau projet Vitest, `tests/*` ajouté à pnpm et à Vitest,
  `allowJs` dans `tsconfig.json`) : harnais qui copie le workflow dans `.agent-studio/workflows/`
  du projet d'essai, le commite, l'active et l'exécute isolé ; jumeaux repris ;
  `e2e-adr-story.test.ts` ajouté.

**Défauts trouvés par ces tests, corrigés.**
- Titre de carte de tâche pris dans la description du `meta` (jusqu'à 500 caractères) alors que le
  manifeste interne le limite à 80 : la carte prend le nom.
- `URL` absent du bac à sable (ce n'est pas du langage) : la porte des citations jugeait toute URL
  « mal formée ». `URL` et `URLSearchParams`, purs, sont fournis ; test ajouté.
- Amendement d'ADR par réécriture complète : la ligne `Story` disparaissait et le tour était
  rejeté ; le code la remet.

**Pièges.**
- Les modules du workflow importent `@agent-studio/workflow`, introuvable depuis `workflows/` :
  dans les tests, un greffon Vite le résout vers `pour-les-scripts.ts` **pour ces seuls fichiers**
  (un alias global cassait le harnais, qui a besoin de la vraie API).
- Un workflow de projet **doit être commité** : non suivi, un rembobinage (`git clean`) l'efface.
- Les tests unitaires repris importent du JavaScript sans types : `// @ts-nocheck` avec la raison.

**Suite** : retirer `extensions/skraft-workflow` (converti) ; adapter `docs/10` et l'ADR 0054
(la comparaison porte sur le workflow) ; P1 à P6 de `docs/10` pour la campagne US-2.

---

## 10/10 — Lancement des workflows (étape 5 de `docs/11` §11)

Branche `feat/workflow-rejouable`. Critère `workflow-dossier-lancement` passé à `true` après son
`verify` ; suite complète : 1 714 tests.

**Précisé avec le responsable** : les limites du `meta` (écriture, Git, tests) s'appliquent aux
appels du **script** ; celles des agents sont déjà tenues par la garde du cœur.

**Fait.**
- `packages/workflow/src/hote/activer.ts` : `manifesteDuWorkflow` (le `meta` traduit en
  déclaration interne : `fs:write:<motif>`, `shell:test`, `git:*`, agents, skills, commande,
  tâche), `lireEntrees` et `syntaxeCommande`, `activerWorkflow` (compilation, rejoueur isolé,
  tâche, commande avec accord). Les refus de permission se disent en termes du `meta`.
- Choix d'implémentation : **réutiliser la machinerie des extensions pour exécuter les effets**
  (prompts, gardes, preuves, vérification des permissions à chaque appel) plutôt que de la
  réécrire. Le script n'en voit rien : il est isolé et n'a que `w.*`. L'ADR 0055 est respecté
  côté auteur (un dossier, pas d'extension à écrire) ; c'est un détail interne de la plateforme.
- `apps/desktop` : workflows cherchés à l'ouverture du projet (machine puis projet), écartés ou
  remplacés avec un message, désactivés s'il n'y a pas de confirmateur ; runtime enfant construit
  par `build-extensions.mjs` (`out/workflow-host/workflow-child.mjs`), lanceur `utilityProcess`.
- Agent principal : `proposer_workflow(nom, arguments)` ; confirmation de la proposition, puis
  accord sur le workflow ; refus rendu à l'agent (« ne relance pas sans qu'il le demande »).

**Pièges.**
- Recoller le nom de la commande dans le message d'usage après coup l'a cassé (`/<story>`) : la
  commande est maintenant un paramètre de `lireEntrees`.
- `w.phase` rembobine en cas d'escalade : un workflow qui utilise des phases doit déclarer
  `git: ["revert"]`, sinon l'escalade échoue sur la permission. À rappeler dans le modèle skraft.

**Non éprouvé** : Electron réel (les tests utilisent le lanceur Node).

**Suite** : étape 6, skraft converti en workflow JavaScript, chargé depuis un dossier de projet ;
les jumeaux `e2e-s2` à `e2e-s6` et le test de reprise doivent passer dessus.

---

## 10/10 — Accord par empreinte et gel du dossier (étape 4 de `docs/11` §11)

Branche `feat/workflow-rejouable`. Critère `workflow-dossier-accord` passé à `true` après son
`verify` ; suite complète : 1 699 tests.

**Précisé avec le responsable** : le gel porte sur le **dossier du workflow** (script, contrôles,
agents, skills), pas sur le code du projet.

**Fait.**
- `packages/workflow/src/accord/accords.ts` : magasin JSON des accords (nom + empreinte, écriture
  atomique), `resumeAccord` (ce que l'utilisateur voit), `verifierAccord` (une fois, toujours,
  refuser — même vocabulaire que les permissions, `ConfirmAnswer`).
- Garde du cœur (`task-agent-guard.ts`) : écriture refusée sous `.agent-studio/workflows/` pour
  tout agent, même à périmètre `**`, sans la casse ; `estDossierDeWorkflow` exporté. Vérifiée en la
  neutralisant : son test échoue.
- Script : `w.ecrireFichier` et `w.creerDossier` refusés au même endroit.
- Reprise après modification du dossier : refusée, avec « relance-la avec la nouvelle version ».

**Limite notée** : l'empreinte est prise au chargement ; une modification à la main pendant une
tâche en cours n'est vue qu'à la reprise suivante.

**Suite** : étape 5, lancement — commande, `proposer_workflow` de l'agent principal avec
confirmation, accord demandé à ce moment, bornes `meta.permissions` sur les appels `w.*`, et
branchement dans l'application (chargeur, rejoueur isolé, lanceur Electron).

---

## 10/10 — Exécution isolée des workflows (étape 3 de `docs/11` §11)

Branche `feat/workflow-rejouable`. Critère `workflow-dossier-isole` passé à `true` après son
`verify` (17 tests ; paquet `workflow` : 79 ; suite complète : 1 692).

**Fait** (`packages/workflow/src/hote/`) :
- `compiler.ts` : esbuild, sortie CJS en mémoire ; imports limités au dossier et à
  `@agent-studio/workflow`, motif avec fichier et ligne.
- `bac-a-sable.ts` : `node:vm`, `codeGeneration` interdite ; `Date` et `Math.random` lèvent une
  erreur explicite ; `require` limité à la bibliothèque.
- `bibliotheque.ts` : ce que le script importe — `essayer`, `agir`, erreurs, et les calculs purs
  (`empreinte`, `correspond`, `lireYaml`, barre de qualité, couches).
- `enfant.ts`, `enfant-entree.ts`, `rejoueur.ts` : processus enfant lancé par le lanceur des
  extensions (`--permission`, lecture de son runtime seul) ; le principal lui envoie le code, puis
  l'état à rejouer ; il rend l'état et les entrées nouvelles. Boucle → délai, processus tué, tâche
  en échec ; script invalide → échec motivé ; crash → nouveau processus, rejeu du journal.
- `createWorkflowTaskDepuis({ nom, empreinte, humains, rejoueur })` : la définition de tâche ne
  sait plus où tourne le script ; `createWorkflowTask` garde sa forme (rejoueur local).
- `w.maintenant()` (journalisé) ; agent non déclaré dans le meta refusé à l'appel.
- Dépendances de `packages/workflow` : `@agent-studio/extension-host` (lanceur, RPC),
  `@agent-studio/stack-adapters` (motifs, barre de qualité), `esbuild`, `yaml`.

**Vérifié contre les faux positifs** : en retirant `--permission` du lanceur, le test d'évasion
échoue (le fichier est écrit). **Le bac à sable seul ne protège pas** : `w.lireFichier.constructor
.constructor("return process")()` en sort ; la frontière est le processus.

**Risque résiduel, mesuré** : Node 22 ne restreint pas le réseau (une connexion part sous
`--permission`). Même limite que les extensions ; documenté dans `docs/11` §8.

**Piège** : le code compilé appelle `require("@agent-studio/workflow")` ; un test qui exigeait
`typeof require === "undefined"` était faux — le `require` existe, mais ne connaît que la
bibliothèque.

**Reste pour l'étape 5** : borner les appels `w.*` d'écriture et de Git par `meta.permissions`
(aujourd'hui seuls les agents et les questions déclarés sont contrôlés), et le lanceur Electron
(`utilityProcess`) pour les workflows.

**Suite** : étape 4, accord par empreinte et gel du dossier pendant une tâche.

---

## 09/10 — Chargeur de workflows (étape 2 de `docs/11` §11)

Branche `feat/workflow-rejouable`. Critère `workflow-dossier-chargeur` passé à `true` après son
`verify` (25 tests ; paquet `workflow` : 62).

**Fait** (`packages/workflow/src/chargeur/`) :
- `meta.ts` : lit `export const meta = { … }` avec **acorn**, sans jamais évaluer le script (un
  test le vérifie par un effet de bord qui ne se produit pas). Littéraux seulement ; refus motivé
  avec la ligne : variable, appel, gabarit avec expression, étalement, clé calculée, méthode.
- `schema.ts` : schéma zod **fermé** ; règles croisées : fichier d'agent et skills présents dans
  le dossier, chemin interne, outils de la plateforme seulement, `run_tests`/`run_lint` exigent
  `permissions.tests`, écriture d'un agent incluse **telle quelle** dans `permissions.ecriture`.
- `chargeur.ts` : sous-dossiers à `workflow.mjs` de la machine puis du projet ; projet prioritaire
  (remplacement signalé) ; workflow invalide écarté sans bloquer les autres ; deux workflows ne
  partagent ni un nom dans le même emplacement ni une commande ; empreinte de **tout** le dossier
  (chemins triés et contenus), base de l'accord et du gel.
- Dépendances ajoutées à `packages/workflow` : `acorn` (MIT, déjà présent en dépendance
  indirecte), `zod`.
- Vérifié contre les faux positifs : sans la règle d'écriture, ou sans la priorité du projet, les
  tests correspondants échouent.

**Écart corrigé dans `docs/11` §4** : un agent ou une question appelés par le script sans être
déclarés ne peuvent se voir qu'à l'exécution, pas au chargement ; l'exemple de `meta` déclare
maintenant dans `permissions.ecriture` ce que ses agents écrivent.

**Choix provisoire** : l'inclusion des droits d'écriture se juge sur le texte du motif (pas
d'inclusion de globs : `src/domaine/**` n'est pas accepté sous `src/**`). Simple et sûr ; à
assouplir seulement si un vrai workflow en a besoin.

**Piège** : un commit est parti sans sa documentation (`af96695`) parce que le script d'édition a
échoué sur un texte présent deux fois dans `docs/11` ; complété par le commit suivant.

**Précisé avec le responsable (`docs/11` §8)** : les contrôles de skraft n'utilisent ni heure, ni
hasard, ni réseau, mais des **calculs purs** venus de modules (sha256 par `node:crypto`, motifs de
fichiers, YAML de la barre de qualité) : `@agent-studio/workflow` les fournira. L'**heure** est
ajoutée par un appel journalisé, `w.maintenant()`, identique au rejeu ; `Date` reste interdit.

**Suite** : étape 3, exécution isolée du script (processus dédié, `globalThis` réduit).

---

## 08/10 — Un workflow est un dossier, pas une extension (ADR 0055, `docs/11`)

Décidé **point par point** avec le responsable, après comparaison avec les workflows dynamiques de
Claude Code et de Copilot (vérifiée sur leur documentation). Rien d'implémenté.

**Les décisions, en bref** : écrits par nous, utilisés par l'agent principal ; lancés par commande
ou proposés par l'agent puis confirmés ; un dossier (`workflow.mjs` en JavaScript, `meta` littéral
en tête, agents, skills, contrôles, revue) ; sur la machine ou dans le projet, copie à la main
comprise, le projet l'emporte ; accord par empreinte et gel pendant la tâche ; agents et leurs
droits dans le `meta`, fichiers d'agents réduits au contenu ; plus de `render_adr` : ADR rattaché
à l'US par une ligne `Story : <slug>` écrite par le code, modifiable tant qu'il est « Proposé » ;
skraft-workflow converti, l'extension skraft reste pour la comparaison.

**Ce que la discussion a corrigé en route** (à ne pas refaire) :
- les droits des agents étaient d'abord dans l'en-tête des fichiers d'agents ; le responsable les
  a voulus dans le `meta` — un seul endroit pour la sécurité, et des fichiers d'agents partageables ;
- l'appartenance d'un ADR à son US passait d'abord par la branche ; le responsable a rappelé que
  le slug existe dès la première étape : c'est lui qui fait foi, et c'est le code qui l'écrit ;
- la règle de modification d'un ADR doit tenir après un arrêt et une reprise : elle se lit donc
  dans le fichier, pas dans l'état d'une tâche.

**Remplacé** : ADR 0052 points 4 et 5, `docs/09` §3 et §8, `contributes.workflows`. Le moteur
rejouable reste.

**Suite** (`docs/11` §11) : chargeur et `meta`, exécution isolée, accord et gel, lancement, puis
skraft converti en JavaScript ; la comparaison `docs/10` portera sur ce workflow.

---

## 08/10 — Plan de comparaison skraft / skraft-workflow sur US-2 (`docs/10`)

Demande du responsable : un plan de test complet qui compare les deux approches sur US-2, avec la
**raison de chaque rejeu**, le **temps** et le **coût** de chaque étape. Écrit dans
`docs/10-plan-comparaison-skraft-workflow.md` ; rien n'est lancé.

**Trouvé en préparant le plan** (ce sont les prérequis P1 à P6) :
- le workflow ne trace **aucun** rejet : le moteur lit `rejections` et `lastRejection` dans l'état
  (`TracedState`), que l'état du workflow n'a pas ;
- `scripts/mesure-skraft.ts` ne sait lancer que skraft (il importe l'extension et lit
  `SkraftState`) ;
- son répondeur reconnaît les options par identifiant (`abort`) : ceux du workflow diffèrent
  (`<n>:abandonner`), et les questions ouvertes y reçoivent une réponse vide ;
- la trace ne donne pas la durée des effets de code (tests, mutation) ni des transitions ;
- la barre de qualité du projet d'essai est à l'ancien emplacement (`.skraft/quality.json`).

**Budget** : 150 à 400 requêtes premium par run complet d'après le 03/10 ; quatre runs en
alternance, plafonnés à 250 chacun. Prix unitaire et réserve à valider par le responsable.

**Suite** : P1 et P2 sur une branche `feat/mesure-comparee` (TDD), puis P3 à P6, run à blanc sur
agents simulés, puis la campagne.

---

## 08/10 — Décision : skraft et skraft-workflow coexistent (ADR 0054)

Le responsable choisit de **garder les deux** et de les comparer sur de vraies stories avec Copilot
avant de retirer quoi que ce soit. ADR 0054 : indépendance maintenue, aucun écart du §13 tranché
d'ici là, toute correction d'une copie à reporter à la main (ou à noter).

**Fait.** `extensions/skraft-workflow` s'empaquette et s'installe comme skraft : `pnpm ext:build
extensions/skraft-workflow <sortie>`, puis `pnpm ext:pack <sortie> <fichier.asx>` (paquet non
signé, 56 fichiers) ; `test/install.test.ts` (copié de skraft) passe avec l'installateur réel,
mode développeur exigé.

**Suite** : run réel des deux sur une même story (US-2 ou US-12), avec Copilot ; relever par
phase requêtes, tokens, rejets, interventions humaines ; puis décider (ADR qui remplacera 0054).

---

## 08/10 — DELIVER en workflow : skraft-workflow mène tout le pipeline

Branche `feat/workflow-rejouable`. Critère `skraft-deliver-en-workflow` ajouté et passé à `true`
après son `verify` ; suite complète : 1 646 tests (dont les tests Swift réels, chaîne présente).

**Fait.**
- `src/livraison.ts` : plan (suite de référence, scénarios), par scénario les pas test → code ou
  vert → nettoyage avec leurs portes (RED, GREEN, REFACTOR, couvert par l'acceptance), porte de fin
  de scénario (acceptance, suite, séquence rouge puis vert, mutation par scénario, couverture,
  lint, dépendances), reprise du scénario en sessions séparées puis escalade au niveau du
  scénario ; fin de phase (livrables, mutation de fin), revue, correction ciblée côté tests puis
  côté code avec renvoi d'un défaut à l'autre agent et garde du contrat ratifié (ADR 0046, 0047).
- Moteur : `w.preuves()`, `w.architecture()`, étape des preuves (`lancerTests({ etape })`,
  `agent(..., { preuve })`), modules d'infrastructure dans `w.disposition()`, `SauterPhase`.
- Tests : jumeaux de `e2e-s5` (pile simulée et vraie chaîne Swift) et de `e2e-s6` (bout en bout
  Swift avec correction de revue, usage sur trois stories) ; `e2e-reprise-workflow` : crash pendant
  le tour du développeur, redémarrage de toute la pile, seul ce tour est rejoué.

**Bilan de taille, sans arrondi.** Pipeline complet : 1 015 lignes de code (`workflow.ts` 175,
`conception.ts` 83, `distillation.ts` 64, `revue.ts` 98, `livraison.ts` 595), contre 1 624 dans
skraft (`reducer.ts` 346, `deliver-machine.ts` 299, `effects.ts` 370, `deliver-effects.ts` 340,
`model.ts` 269). Environ 40 % de moins, surtout grâce à la disparition des types d'état,
d'événements et d'effets et des aiguillages. **Sur DELIVER seul, le gain est faible** : 595 lignes
portes comprises contre 639 — les portes sont recopiées presque telles quelles, et la logique
d'échecs (pas, scénario, correction) reste dense, exprimée par exceptions et boucles imbriquées.

**Divergences assumées avec `/skraft`** : rembobiner fait oublier les agents (ADR 0053, décidé) ;
usage par phase (pas d'états CLASSIFY ni REVIEW) ; réessais par phase et `rejections` non
comptés ; « relancer » après une escalade pendant une correction de revue reprend la correction.

**Pièges.**
- La valeur de fin dépasse 512 caractères : elle est dans le magasin de contenus, pas en clair
  (`test/support/fin.ts` la relit).
- Les tests copiés de `deliver-gates.test.ts` qui pilotaient `deliver-effects.ts` et le réducteur
  ne sont pas repris : la couverture de ces portes passe par les jumeaux de bout en bout.

**Suite** : décision du responsable sur la suite de la migration (remplacer `/skraft`, ou garder
les deux) ; `contributes.workflows` et le chargement du script par l'hôte ; retrait des globaux non
déterministes.

---

## 08/10 — DISTILL en workflow dans skraft-workflow

Branche `feat/workflow-rejouable`. Critère `skraft-distill-en-workflow` ajouté et passé à `true`
après son `verify` ; suite complète : 1 616 tests.

**Fait.**
- `src/distillation.ts` : agent d'acceptance (emplacement des tests donné par `w.disposition()`),
  porte gherkin puis porte valeurs, plan de test, RED d'acceptance exécuté par le code
  (`w.lancerTests({ etiquette: "DISTILL_RED" })`), gel des tests d'acceptance (empreinte et
  non-régressions écrites une seule fois), revue avec les faits du réducteur.
- `src/revue.ts` : la revue de DESIGN devient commune (spécialiste, revue, arbitrage, rapports,
  livrables). `conception.ts` tombe à 83 lignes.
- Copies : `distill.ts`, `gherkin.ts` et leurs tests ; agent d'acceptance ; quatre skills.
- Jumeau de `e2e-s4` (vrai Vitest sur un projet TypeScript) ; les jumeaux de S2, S3 et le test de
  revue vont désormais jusqu'à DISTILL.

**Taille.** `workflow.ts` 155 + `conception.ts` 83 + `distillation.ts` 64 + `revue.ts` 98 = 400
lignes de code jusqu'à DISTILL.

**Piège.** Le jumeau de S3 vérifiait que le **dernier** commit était celui de DESIGN : faux dès
que DISTILL commite après lui. On cherche le commit dans l'historique.

**Suite** : DELIVER (sous-machine par scénario, `deliver-machine.ts` et `deliver-effects.ts`,
≈ 800 lignes dans skraft) : la plus grosse phase, et celle où le script doit le plus gagner.

---

## 08/10 — DESIGN en workflow dans skraft-workflow (étape 5 de `docs/09` §14, première phase)

Branche `feat/workflow-rejouable`. Critère `skraft-design-en-workflow` ajouté et passé à `true`
après son `verify` ; suite complète : 1 564 tests.

**Fait.**
- `extensions/skraft-workflow/src/conception.ts` : modélisation et décisions avec les mêmes motifs,
  porte cohérence, revue à lentilles (fils de défauts, réponses des architectes, historique par
  lentille, arbitrage humain des désaccords persistants), ratification de tous les ADR à la fois,
  amendement qui ne relance que les décisions sans consommer d'essai, statuts basculés dans les
  fichiers, rapports de revue réécrits avant le commit.
- Copies (avec provenance) : `design.ts`, `adr.ts`, `render-adr-tool.ts`, `review.ts`,
  `review-thread.ts` et leurs tests ; agents des architectes et des lentilles ; six skills.
  `review-brief.ts` réécrit sans l'état du réducteur, même texte pour les lentilles.
- Moteur : la fonction de `w.phase` reçoit son checkpoint ; `essayer` accepte `garanti` (défaut
  maintenu par l'humain) ; `w.disposition()`.
- Tests : jumeau de `e2e-s3` (processus principal et isolé) ; `e2e-revue-workflow` (contesté,
  maintenu, recontesté, arbitré par l'humain, essai accordé au-delà du budget), vérifié en
  supprimant l'essai accordé : il échoue.

**Taille.** `workflow.ts` 150 + `conception.ts` 172 = 322 lignes de code jusqu'à DESIGN. Le
réducteur pour le même périmètre : de l'ordre de 650 lignes (estimation ; `reducer.ts`,
`effects.ts`, `model.ts` mêlent les phases).

**Différences assumées avec `/skraft`** : plusieurs amendements demandés ensemble sont traités
ensemble (le réducteur ne traitait que le premier et perdait les réponses suivantes) ;
`isTestFile` approché par les emplacements de la stack ; pas de preuve de tests dans les faits de
revue (DESIGN n'en produit pas). Écarts du §13 (1, 2, 3, 8, 9) : non tranchés, réducteur reproduit.

**Pièges.**
- Les fils de défauts, les revues et les livrables doivent être déclarés **hors** de la fonction
  de `w.phase` : le réducteur les garde quand l'humain relance la phase, et « une revue est la
  première » se compte sur toute la phase.
- Les questions humaines du workflow rendent l'option sans le préfixe `<n>:` ; les arbitrages se
  recomposent donc en `accept:<id>` / `maintain:<id>` pour `applyArbitration`.

**Suite** : DISTILL (porte gherkin, porte valeurs, RED d'acceptance, gel des tests d'acceptance),
puis DELIVER.

---

## 08/10 — skraft-workflow devient une extension indépendante de skraft

**Demande du responsable** : « le skraft dans l'extension et le skraft workflow doivent être
totalement indépendants ». Fait :
- `extensions/skraft` est revenue **à l'identique** de son état d'avant le workflow (commit
  `b3e3ce0`) : plus de commande, de tâche, de dépendance ni de remaniement liés au workflow.
- Nouvelle extension `extensions/skraft-workflow` (`agent-studio.skraft-workflow`, GPL comme
  skraft) : son manifeste, ses deux agents (classifieur, chercheur), son script, et des **copies**
  des fonctions pures (story, difficulté, porte citations, analyse de texte, présélection) avec
  leurs tests, plus un `brief.ts` réduit à ce que le workflow produit. Chaque copie porte sa
  provenance en tête ; `README.md` les liste.
- `test/independance.test.ts` refuse tout import de skraft (paquet ou chemin) ; vérifié en
  ajoutant un import exprès.

**Le prix, à connaître** : environ 450 lignes de fonctions pures existent maintenant en deux
exemplaires. Une correction dans une porte de skraft ne se reporte pas seule dans skraft-workflow.
Les tests copiés protègent chaque copie, pas leur accord.

---

## 08/10 — skraft en workflow jusqu'à RESEARCH (`/skraft-workflow`, d'abord dans skraft, étape 4 de `docs/09` §14)

Branche `feat/workflow-rejouable`. Option B retenue par le responsable du projet : une **deuxième
commande** à côté de `/skraft`, qui reste intacte. Critère `skraft-research-en-workflow` passé à
`true` après son `verify` ; suite complète : 1 415 tests.

**Fait.**
- `extensions/skraft/src/workflow.ts` : préparation (story, branche, dossiers, indicateurs),
  classifieur avec budget, confirmation de la difficulté, RESEARCH (`w.phase` + `essayer`,
  présélection, question bloquante, porte citations), questions ouvertes posées toutes à la fois,
  puis publication du dossier de passation de DESIGN. Mêmes fonctions pures que le réducteur
  (`parseStory`, `computeIndicators`, `checkResearch`, `preselectFiles`, `buildBrief`).
- `buildBrief` accepte une vue réduite (`BriefSource`) : même consigne au mot près.
- Moteur : `w.rembobiner` archive les livrables effacés dans la trace (ADR 0038), et `w.phase`
  prend `apresRembobinage` (skraft y recrée ses dossiers, que Git ne suit pas).
- Test jumeau `e2e-s2-workflow.test.ts`, joué dans le processus principal **et en processus
  isolé** (le script tourne alors dans l'utilityProcess, transitions par RPC).

**Mesure pour le critère d'arrêt.** `workflow.ts` : 154 lignes de code. Le même comportement dans
le réducteur : ≈ 430 lignes estimées (cas INIT, CLASSIFY, CONFIRM_DIFFICULTY, BLOCKED, ROUTE,
COMMIT, ESCALATED et leurs aides dans `reducer.ts` ; effets correspondants dans `effects.ts` ;
types d'état, d'événements et d'effets dans `model.ts`). Une partie de ce code sert aussi aux
phases suivantes : le rapport réel ne se saura qu'après DESIGN. Le jugement « nettement plus
simple » revient au responsable.

**Écarts avec `/skraft`** (assumés, pas des décisions sur le comportement) : identifiants
d'options préfixés `<n>:` ; libellé de l'escalade (« Phase RESEARCH : <motif> ») ; le workflow
s'arrête avant DESIGN.

**Pièges.**
- `w.phase` rend `undefined` quand l'humain saute la phase **et** quand `fn` ne rend rien
  (`essayer` rend `void`) : le script croyait RESEARCH sautée. La fonction de phase doit rendre
  une valeur ; documenté dans `protocols.ts`.
- Le critère d'origine (« `e2e-s2` sans modification ») ne pouvait pas tenir : ce test lit
  `stage`, `lastRejection`, `artifacts` du réducteur. Amendé dans `docs/09` §14 et `features.json`.

**Reste.** `contributes.workflows` et le chargement du fichier par l'hôte (le workflow passe pour
l'instant par `ctx.tasks.register` et `contributes.tasks`) ; retrait des globaux non
déterministes ; l'empreinte par défaut ne couvre que la fonction principale du script (une aide
modifiée n'est pas détectée).

**Suite** : décision du responsable sur le critère d'arrêt ; si on continue, DESIGN (revue,
ratification, écarts 1, 2, 3, 7, 8 du §13).

---

## 08/10 — Moteur de workflows rejouables (`packages/workflow`, étape 3 de `docs/09` §14)

Branche `feat/workflow-rejouable`, partie de `fix/sessions-orphelines`. Critère `workflow-rejouable`
passé à `true` après son `verify` (29 tests). Suite complète : 1 410 tests.

**Fait.**
- `createWorkflowTask(declaration)` implémente le `TaskDefinition` existant : aucun nouveau moteur.
  L'état est `{ script, entree, journal, contenus, fin? }`. Un effet ne porte que `{ kind, n }` :
  `runEffect` relit ses arguments dans le journal (`EffectContext.state`), donc `pending` reste petit.
- `rejeu.ts` : relance le script contre le journal. Appel journalisé = résultat rendu ; autres
  arguments = **non-déterminisme**, la tâche s'arrête ; appel absent = inscrit, ne se résout pas.
  Le script est considéré bloqué quand plus aucun appel n'arrive d'un `setImmediate` à l'autre.
- Erreurs journalisées par nature (`tour-interrompu`, `panne`, `erreur`) et relevées sous la même
  classe au rejeu (`TourInterrompu`, `PanneEnvironnement`, `Error`). `runEffect` attrape tout
  lui-même : le moteur ne voit jamais d'exception d'effet, donc l'erreur garde son numéro d'appel.
- Questions humaines : options préfixées `<n>:` pour retrouver l'appel quand plusieurs questions
  attendent ; profils pris dans `declaration.humains`, jamais dans le script ; question non
  déclarée = échec.
- Magasin de contenus dans l'état : au-delà de 512 caractères, valeur rangée sous son empreinte
  sha256 ; un fichier lu deux fois n'est stocké qu'une fois.
- Script modifié (empreinte différente) : la tâche s'arrête en échec avec le motif.
- `w.phase` (checkpoint unique, commit, escalade → rembobine + question relancer/sauter/abandonner),
  `essayer` (budget, motifs transmis, première revue garantie ADR 0042, tour interrompu compté,
  panne remontée sans consommer), `agir` (question bloquante → humain → même agent relancé).
- `w.rembobiner` fait oublier les agents lancés depuis le checkpoint, **déduits du journal**.
- `memoire: "tache" | "tour"` par agent dans le manifeste ; l'hôte ne donne pas de clé de
  continuité à un agent `tour`.

**Vérifié contre de faux positifs** : en cassant la comparaison des arguments, puis l'oubli au
rembobinage, les tests correspondants échouent.

**Pas encore fait (étape 4)** : `contributes.workflows` dans le manifeste, chargement du fichier de
workflow par l'hôte, et le retrait des globaux non déterministes (`Date`, `Math.random`…) prévu
par `docs/09` §6.4. Aujourd'hui, un script qui lit l'heure n'est **détecté** qu'au rejeu suivant.

**Pièges.**
- Un marqueur (`phase`) est journalisé avec un résultat nul dès son premier passage : il doit
  compter dans la numérotation, sinon tous les appels suivants changent de numéro au rejeu.
- `HUMAN_DECISION` ne dit pas à quelle demande il répond ; sans le préfixe `<n>:`, deux
  ratifications simultanées seraient indiscernables.
- `noUncheckedIndexedAccess` : les arguments relus du journal sont typés par une interface `Args`
  plutôt que par `Record<string, …>`.

**Suite** : étape 4, RESEARCH de skraft en workflow ; critère : `e2e-s2` et `research-gate`
inchangés, et un script nettement plus simple que la partie de `reducer.ts` remplacée.

---

## 08/10 — Sessions orphelines corrigées (ADR 0053, étape 2 de `docs/09` §14)

Branche `fix/sessions-orphelines`, partie de `docs/workflows-rejouables`. Critère
`sessions-orphelines-au-redemarrage` passé à `true` après son `verify`.

**Fait.**
- Port `TaskSessionStore` (`packages/core/src/protocols/task-sessions.ts`) et registre JSON
  `createJsonTaskSessionStore` : un fichier `sessions.json` par projet, écriture atomique.
- `task-agent-runner.ts` : chaque session est **inscrite dès son ouverture** (avant le tour : un
  crash au milieu du tour ne la perd pas) et retirée quand le runtime l'a supprimée. Nouvelle
  méthode `releaseAll()` : Map en mémoire + registre. Commentaire d'en-tête périmé (d'avant
  l'ADR 0039) corrigé.
- `workspace-services.ts` : `releaseAll()` lancée **sans attendre** à l'ouverture du projet, avant
  `engine.resumeAll()`, et **attendue** dans `dispose()` (fermeture normale = crash).
- Double `MemoryTaskSessionStore` dans `@agent-studio/core/testing`.
- Tests : `packages/core/test/sessions-orphelines.test.ts` (crash après un tour gardé, crash au
  milieu d'un tour, toutes tâches, fermeture, suppression refusée, écritures simultanées, fichier
  illisible) et un test de branchement dans `apps/desktop/test/workspace-services.test.ts`,
  vérifié en échec quand on retire l'appel de `dispose()`.

**Décisions et raisons.**
- **Registre par projet plutôt que dans le fichier de la tâche** (l'ADR 0053 disait « avec la
  tâche ») : l'exécuteur ne connaît pas le magasin des tâches, et l'inscription doit précéder toute
  transition. La clé `<taskId>/<extension>/<rôle>` garde le lien. Noté dans l'ADR 0053.
- **Purge au démarrage sans attendre** : s'il reste des sessions, elle démarre le runtime Copilot,
  ce qui ne doit pas bloquer l'ouverture du projet. Pas de course : `releaseAll` met la lecture du
  registre en file avant toute inscription des tâches reprises.
- **Suppression refusée = identifiant gardé** : le démarrage suivant réessaie.

**Pièges.**
- Les lentilles ouvrent leurs sessions en parallèle : sans file d'attente sur le registre, deux
  lectures-écritures entrelacées perdaient une inscription (test « inscriptions simultanées »).
- Les tests de `workspace-services` utilisent `tasksDir: "/inutile"` : sans registre injecté, le
  registre par défaut aurait tenté d'écrire là (échec seulement journalisé). Ils injectent désormais
  `MemoryTaskSessionStore`.

**Suite** : étape 3 de `docs/09` §14, `packages/workflow` en TDD.

---

## 08/10 — Retour des échecs à l'agent dans un workflow (documentation seule)

Branche `docs/workflows-rejouables`. Ajout de `docs/09` §5.4 : le workflow ne change rien à ce que
l'agent reçoit après un échec (SPEC §6.6, ADR 0040, 0042, 0046, 0047). Une porte rend des textes ;
la revue rend des **fils de défauts**, que `revue()` garde dans une variable du script, recalculée
au rejeu. `essayer` ne transmet donc pas qu'un `string[]`.

**Piège.** En DESIGN, les deux architectes reçoivent **tous** les défauts de la revue
(`agentFeedback(threads, () => true)`, `reducer.ts`) ; le routage par cible (`target`) n'existe
qu'en DELIVER, entre testeur et développeur. Je l'avais affirmé à tort pour DESIGN avant de relire.

**Aussi discuté, sans rien écrire dans le dépôt** : faire tourner skraft dans Claude Code. Un
workflow Claude Code ne peut ni définir d'outil, ni en attribuer par agent, ni lire un fichier ou
lancer des tests sans passer par un agent ; la reprise ne vaut que dans la même session. Les
outils viendraient d'un serveur MCP livré avec le plugin, mais les preuves resteraient rapportées
par un agent (contraire à D20). Conclusion : on ne vise **pas** la compatibilité du script avec
Claude Code ; le plugin (agents et skills) reste à éprouver (critère `skraft-plugin-autonome`).

**Suite** : inchangée (`docs/09` §14, étape 2 : sessions orphelines sur une branche `fix/`).

---

## 05/10 — YAML abandonné ; l'orchestration s'écrira comme un script rejouable (documentation seule)

**Décision du responsable du projet**, après discussion : on arrête l'approche YAML de la veille et
on documente l'approche « workflow rejouable », inspirée des workflows de Claude Code. **Aucun code
de production** : on écrit d'abord toute la doc. Branche `docs/skraft-planification-hierarchique`
(son nom datait de l'approche abandonnée), renommée `docs/workflows-rejouables`.

**Fait.**
- Retiré : `fonctionnalites/` (schéma, catalogue, recette, scripts Python, copies des agents et
  skills), `extensions/skraft/test/fonctionnalite-generique.test.ts`, les dépendances `ajv` et
  `yaml` d'ext-skraft, la ligne `__pycache__/` du `.gitignore`. `package.json`, `.gitignore` et
  `pnpm-lock.yaml` sont revenus à l'identique de `main`. Tout reste lisible au commit `df4eed3`.
- `docs/08` réduit à une note d'abandon : ce qui était proposé, les cinq raisons, ce qu'on garde.
- `docs/09-workflows-rejouables.md` : le document de référence de la nouvelle approche.
- ADR 0052 (orchestration par script rejouable, **lecture retenue de D16**) et ADR 0053 (mémoire
  déclarée par agent ; crash, redémarrage ou fermeture = toutes les sessions supprimées ; précise
  D17).
- `features.json` : critère YAML retiré ; trois critères à `false` pour les étapes 2 à 4 du plan.

**Pourquoi le YAML est abandonné** (détail dans `docs/08`) : langage déguisé sans outils, deux
comportements de skraft inexprimables (ADR 0042, arbitrage hors budget), fautes de séquence
invisibles au test, portes dupliquées en Python, et personne pour l'écrire. La vraie cause du coût
de skraft est la **forme réducteur** (≈ 820 lignes de machine à états, une quarantaine de champs
« où j'en suis »), pas le TypeScript.

**Décisions prises en discutant, à ne pas rediscuter :**
- le déclaratif (agents, skills, outils, mémoire, entrées, phases, questions et profils) reste
  dans le **manifeste**, pas dans un `meta` en tête du script : un seul endroit vérifié et signé ;
- le script ne choisit **jamais** les skills ni les outils d'un agent ; il peut seulement
  restreindre un tour. Une autre combinaison = un agent de plus dans le manifeste ;
- **pas de nouveau moteur** : `createWorkflowTask(script)` implémente le `TaskDefinition` actuel ;
- la fermeture normale de l'application est traitée comme un crash pour les sessions.

**Trouvé en lisant le cœur** (vrai défaut, indépendant des workflows) : après un crash, les sessions
Copilot restent orphelines sur le disque, car le lien rôle → session ne vit que dans la `Map`
`reprenables` de `task-agent-runner.ts`. Étape 2 du plan.

**Piège.** Les écarts entre la recette YAML et le code (`docs/09` §13, quinze lignes) ne sont **pas**
des décisions : tant qu'un écart n'est pas tranché, le workflow doit reproduire le code actuel.

**Suite** (`docs/09` §14) : étape 2, sessions orphelines, sur une branche `fix/` ; puis étape 3,
`packages/workflow` en TDD ; puis RESEARCH de skraft en workflow, avec `e2e-s2` et
`research-gate` inchangés comme critère.

---

## 04/10 — skraft en fonctionnalité téléversable : recette normalisée, scripts à parité

> **Abandonné le 05/10** (voir ci-dessus et `docs/08`). `fonctionnalites/` n'existe plus.

**Le but, précisé par le responsable du projet en cours de journée** : un utilisateur crée une
fonctionnalité en **téléversant un dossier** dont un YAML décrit tout (entrées, sessions, actions,
contrôles, tâches et méthodes), sans TypeScript. J'avais d'abord compris « extensions importées par
le YAML » : ce n'est pas ça. Branche `docs/skraft-planification-hierarchique`, aucun code de
production.

**Fait.** `fonctionnalites/` : `fonctionnalite.schema.json` (propriétés fermées partout, demandé
explicitement), `catalogue.yaml` (opérations, primitives, vérifications, outils de la plateforme,
avec leurs paramètres), `skraft/skraft.yaml` (skraft complet), `skraft/scripts/*.py` (douze
scripts : le code propre à skraft porté depuis ses portes), prompts et skills copiés.
`docs/08` réécrit. Test `extensions/skraft/test/fonctionnalite-generique.test.ts` : schéma,
cohérence (tout nom et toute référence existent, rien d'inutilisé), **parité** de onze scripts avec
les fonctions TypeScript, et copies identiques. Un script cassé exprès fait échouer la parité
(vérifié). `ajv` et `yaml` ajoutés en dépendances de développement d'ext-skraft.

**Décisions du jour** (à inscrire en ADR) : les sessions sont déclarées dans la fonctionnalité,
`memoire: neuve | conservee`, **toutes détruites à la fin de l'orchestration** (précise D17 après
l'ADR 0039) ; sortie d'agent toujours normalisée ; `creation-seule` remplace `render_adr`.

**Pièges.**
- Moteurs d'expressions régulières : `\w`, `\d`, `\b` sont ASCII en JS, Unicode en Python — tout
  est réécrit en classes explicites. `split` JS ne coupe pas sur une correspondance vide en 0.
  `localeCompare` n'est qu'approché (départage de `planScenarios`).
- **Ma recette avait deux défauts de séquence**, vus en l'écrivant au propre : le diff de
  conception relevé *avant* le tour de l'architecte, et un réessai de phase qui reposait le
  checkpoint (les ADR du premier essai devenaient « existants »). Une phase ouvre donc une fois,
  puis appelle une tâche « travail » seule réessayée. Le test de cohérence ne voit PAS ce genre de
  faute : seule une exécution le prouvera.
- J'ai utilisé une fusion YAML `<<` après l'avoir exclue du format ; retirée.

**Écarts recette / code, à trancher** (docs/08 §7) : classifieur non borné, grille non réglable,
story du chat, amendement qui relance aussi `modeliser`, budget partagé, `render_adr` retiré.

**Suite** : ADR (format, sessions) ; puis un chargeur dans le cœur et l'exécution de
`rechercher-phase` depuis `skraft.yaml`.

---

## 03/10 (soir) — Trois correctifs du 29/09 restés hors de `main`, intégrés

`fix/plafond-duree-tour` portait trois commits poussés **après** la fusion de la PR #9, donc jamais
arrivés dans `main` : à l'escalade, le dépôt et la mémoire reviennent au même point ; un événement
reçu pendant le chargement n'est plus perdu ; un checkpoint n'enregistre pas les fichiers que le
système sème (et `--en-place` pour le banc). Rejoués sur `main`, conflits résolus :
- **Numéros d'ADR en collision** : leurs 0045 et 0046 existaient déjà dans `main` (couvert par
  l'acceptance ; la revue dialogue). Renumérotés **0050** et **0051**, renvois corrigés dans leurs
  seules lignes, et noté dans les messages de commit.
- **Interaction découverte en fusionnant** : `--en-place` + `--pousser` aurait ajouté un remote
  `github` au vrai dépôt de l'utilisateur. En place, le banc pousse désormais par son `origin` ;
  `--base` et `--en-place` sont incompatibles et refusés ensemble.
- `scripts/` entre dans le typecheck (leur commit) : mon banc du 03/10 y passe sans erreur.
- **Piège** : au premier rejeu, j'ai validé `progress.md` avec ses marqueurs de conflit — ma liste
  des fichiers en conflit était tronquée par un `head`. Vu avant de pousser. Après une résolution,
  `git grep "^<<<<<<< "` sur tout le dépôt, pas une liste partielle.

---

## 03/10 — Suivre un run étape par étape, et la porte qui recalait une conception juste

> Synthèse de la journée, problème par problème (symptôme, cause, solution, vérification) :
> `docs/06-run-us-2-problemes-et-solutions.md`. Le récit ci-dessous garde le détail chronologique.

**Fait.** Branche `feat/suivi-run`, partie de `main`. Le banc `scripts/mesure-skraft.ts` annonce en
direct chaque étape, rejet (avec ses motifs) et fin de tour anormale — lignes `§` —, pousse le
travail sur une branche `run/<story>-<date>-<id>` du projet d'essai (`--pousser`, jamais `main`,
jamais l'agent), et verse un rapport dans `docs/runs/`. Le tout est lu dans la **trace** : le bilan
ne peut pas raconter autre chose que ce qui a été enregistré.

**Le trou trouvé en route.** Les entrées `transition` et `rejet` de la trace étaient déclarées
depuis l'ADR 0032, et **rien ne les écrivait**. Le nombre de rejeux d'une phase et leurs motifs
n'étaient lisibles nulle part. Le moteur les écrit maintenant. Un rejet se repère à un compteur
croissant `rejections`, pas à `lastRejection` : les motifs restent posés pendant tout le réessai, et
l'état d'une extension isolée revient sérialisé, donc comparer des références ne marche pas.

**Crédits : `nanoAiu / 1e9` est le nombre exact de requêtes premium.** Mon estimation « une requête
par tour » était fausse d'un facteur 18 : Copilot facture chaque **appel** au modèle, et un tour en
fait des dizaines. Le champ `nanoAiu` que le SDK joint à chaque `usage` donnait déjà la réponse :
35,99 × 10⁹ sur CLASSIFY + RESEARCH, pour un écart de réserve de 36. La réserve
(`/copilot_internal/user`) se met à jour avec retard — CLASSIFY y apparaissait à 0.

**Le run sur US-2 (machine Linux, `claude-sonnet-5`).** RESEARCH en 1 min 52 (1 rejet justifié :
citation `adr-001-...md` abrégée), 36 requêtes. Puis DESIGN rejetée **trois fois** par la porte
cohérence pour `AppliqueA`, environ 200 requêtes, escalade. Arrêté là.
- Essai 1 : le nom manquait vraiment du modèle. Rejet juste.
- Essais 2 et 3 : `domain-model.md` le définissait — signature dans un bloc de code, appel
  `palier.Taux.AppliqueA(SousTotal)`. La porte ne reconnaissait qu'un nom **seul entre backticks**.
→ L'agent avait corrigé dès l'essai 2 ; c'est la porte qui l'a recalé. Corrigé : un nom est
**défini** s'il figure n'importe où dans le code du modèle, il est **cité** s'il est seul entre
backticks. Rejoué sur les trois instantanés (refs `refs/agent-studio/checkpoints/`) : seul l'essai 1
reste rejeté. Les instantanés de checkpoint sont la meilleure source pour rejouer une porte : le
rollback efface l'arbre de travail, pas eux.

**Deux pièges d'environnement.**
- `gh` sur ce Linux était connecté par **PAT classique** : Copilot rend `400 Bad Request` à chaque
  tour, et le banc relançait l'escalade **en boucle**. Le banc refuse désormais de démarrer sans
  jeton accepté, et abandonne au troisième motif d'escalade identique. Les blocages de J1 avaient
  été levés sur le Mac ; ils ne voyagent pas avec le dépôt.
- .NET n'était pas installé : SDK 10 dans `~/.dotnet` (`dotnet-install.sh`, sans sudo). Lancer le
  banc avec `PATH=$HOME/.dotnet:$PATH DOTNET_ROOT=$HOME/.dotnet`.

**La relance, porte corrigée : premier run à atteindre DELIVER.** 14 min, 404 requêtes. RESEARCH
sans rejet (19,9 requêtes) ; DESIGN rejetée une fois, à raison (`PalierApplicable` inventé dans
`contracts.md`), 130,7 ; DISTILL validée du premier coup par ses portes, puis une fois recalée par
la revue (`Facture.ATPayer` ne soustrait pas la remise). Rapport : `docs/runs/2026-10-03-us-2-e05269c1/`.

**Puis DELIVER a refusé de démarrer — l'ADR 0041, une seconde fois.** « La suite est rouge avant
DELIVER » pour `Ac2` et `Ac3`, les tests que DISTILL **doit** laisser rouges. `deliver-effects.ts`
reconnaissait l'acceptance aux globs de chemins appliqués à `r.file`, qu'un rapport JUnit rend comme
un nom de classe. Le correctif du 29/09 n'avait touché que DISTILL ; quatre usages identiques
restaient dans DELIVER. Les tests de bout en bout tournent sur le faux lanceur Swift, qui rend de
vrais chemins : rien ne pouvait le montrer avant un vrai run .NET.
→ Le progress.md du 26/09 le disait déjà : un défaut corrigé à un endroit se réintroduit ailleurs
dans la semaine. Après un correctif de ce genre, **chercher l'idiome dans tout le dépôt** (ici
`grep "r.file"`), pas seulement là où il a mordu.

**Le banc a fait ce qu'on lui demandait** : trois escalades identiques, abandon, zéro requête
gaspillée. Lacune : le rapport ne liste pas les escalades pour panne d'environnement (ce ne sont pas
des rejets de porte) ; seul le suivi en direct les montre.

`--base=<branche>` reprend depuis une branche `run/…` poussée, avec `--depuis=PHASE`, sans repayer
les phases validées.

**Reprise à DELIVER (100 requêtes) : la boucle TDD tourne pour de vrai.** Premier pas complet :
`skraft-test` écrit un test rouge sur assertion, `skraft-dev` le passe au vert, nos portes le
confirment. Puis deux constats :
- **Troisième variante du même défaut chemin ↔ classe.** Un test rouge **par compilation** est
  désigné par son fichier (`tests/…/QuantiteTests.cs`, lecteur `buildErrors`), puis par son nom
  JUnit au vert (`….QuantiteTests.AtteintLeSeuil_…`). `concerns` ne connaissait que `chemin > test`.
  La porte GREEN a déclaré « introuvable » un test vert. Corrigé dans `concerns` lui-même, ce qui
  couvre aussi `checkRedGreenSequence` et la suite en attente.
- **Un conflit de conception, non tranché.** Pour le comportement suivant, `skraft-test` a refusé
  d'écrire un test unitaire : le mandat 4 de son plan de test le dit « saturé par l'acceptance »,
  conformément à la skill `test-design-mandates`. La machine DELIVER exige un nouveau test rouge à
  chaque pas et n'a **aucun chemin** « déjà couvert par l'acceptance, passe au code ». Rejet. Au
  réessai l'agent a cédé et écrit un test (`QuantiteTests`). C'est une décision à prendre (ADR),
  pas un défaut à corriger en silence.

**Deuxième reprise (165 requêtes) : DELIVER va au bout de ses scénarios.** Un seul cycle :
`GrilleDePaliersTests.Le_palier_dont_le_seuil_est_atteint_s_applique` rouge sur assertion, puis
`PalierApplicable` et `Montant.Multiplie` implémentés ; les cinq portes de scénario passent (ac-2 et
ac-3 rendus verts, ac-1/4/5 déjà verts), porte de phase franchie. **Premier run à produire du code
qui passe les portes de DELIVER** : 11 tests verts, poussé sur `run/us-2-2026-10-03-deliver`.
Rapport : `docs/runs/2026-10-03-us-2-deliver/`.

**Puis la revue bloque, et elle ne peut pas être satisfaite.** `cold-reader` (major) : un seul test
unitaire pour `PalierApplicable`, alors que le code gère aussi « sous tout seuil », « grille vide »,
« plusieurs paliers ». Or **en mode correction les tests unitaires sont gelés** (`unitTestsHash`) :
`skraft-dev` ne peut toucher que la production. Il a documenté le lien de chaque branche vers son
critère d'acceptance ; rejet à nouveau. Arrêté à la main pendant le troisième essai — le banc
n'aurait pas abandonné seul, la formulation du motif variant d'un rejet à l'autre.

**C'est le revers exact du conflit de la première reprise.** `skraft-test` refusait d'écrire ces
tests (« saturé par l'acceptance », skill `test-design-mandates`) ; `cold-reader` les exige. Deux
agents, deux doctrines, aucun arbitre dans la machine. À trancher par un ADR, avec trois volets :
ce que DELIVER fait d'un comportement déjà couvert par l'acceptance ; ce que la revue a le droit
d'exiger ; et comment une correction de revue peut ajouter un test (aujourd'hui impossible).

**Consommation de la journée : environ 915 requêtes** (run 1 : 242, relance : 404, reprises : 100 et
165). Réserve à ~620 le 03/10.

**Tranché : option A (ADR 0045).** Un comportement couvert par l'acceptance n'exige pas de test
unitaire. Le testeur le déclare dans `coveredBy` (champ facultatif de `report_phase`), le code le
vérifie — rien d'écrit, c'est le test d'acceptance du scénario, rouge pour une bonne raison — et ce
test devient la cible du pas de code, sans entrer dans les tests unitaires du scénario. Les lentilles
ont la consigne de chercher dans l'acceptance avant de réclamer un test.
Reste ouvert, critère `correction-de-revue-peut-ajouter-un-test` : une correction de revue ne peut
toujours pas ajouter de test (gel par empreinte en mode `fix`).

**Puis la revue qui dialogue (ADR 0046), proposée par le responsable.** Chaque défaut de lentille
porte une cible obligatoire (`test`, `code`, `deliverable`), vérifiée par le code d'après le fichier
cité, et un identifiant attribué par le code (`lentille#tour.n`). Il devient un **fil**
(`review-thread.ts`, pur) : routé vers l'agent concerné, auquel l'agent répond (`fixed` ou
`contested` avec raison, champ `responses` de `report_phase`), que la lentille arbitre au tour
suivant (`rulings` : accepted / maintained), et soumis à l'humain s'il est contesté puis maintenu
deux fois (étape `ARBITRATION`). En DELIVER, la correction se fait en deux temps : côté tests
(`fix-test`) puis côté code (`fix`).

**Le piège évité de justesse.** J'allais exiger qu'un test ajouté en correction soit rouge, comme au
pas TDD. Or un test réclamé par la revue sur du code existant passe **d'emblée** : sur US-2,
`PalierApplicable` gérait déjà les quatre branches que `cold-reader` voulait voir testées. La porte
`verifyFixTests` accepte donc un test vert (caractérisation) ou rouge pour une bonne raison ; les
rouges deviennent les cibles du développeur. Ce qu'elle exige : tests unitaires seulement, aucun test
existant disparu ni cassé.

**Un défaut de ma première version, attrapé par le test d'arbitrage.** Quand l'humain donne raison à
l'agent, la lentille gardait « changements demandés » sans plus aucun défaut : le défaut contesté ne
figurait que dans ses arbitrages, pas dans sa liste. `lensesAfterThreads` regarde désormais les fils
de la lentille, pas seulement ses défauts listés.

Passent à `true` : `retour-de-revue-cumulatif` (ouvert depuis le 29/09 : les demandes corrigées sont
rappelées), `correction-de-revue-peut-ajouter-un-test`, et le nouveau `revue-dialogue-avec-l-agent`.

**Le run qui éprouve les ADR 0045 et 0046 (252 requêtes, arrêté au plafond de 250).**
Rapport : `docs/runs/2026-10-03-us-2-deliver-adr45-46/`.
- **ADR 0045, réussi du premier coup.** `skraft-test` déclare `PalierApplicable` couvert par
  l'acceptance (ac-2 rouge), la porte le vérifie, `skraft-dev` implémente, les cinq scénarios
  passent. DELIVER en 2 min 11 et 31 requêtes, sans aucun rejet.
- **ADR 0046, le dialogue fonctionne.** Revue 1 : deux défauts majeurs. Le développeur corrige le
  premier et **conteste** le second avec une raison juste (« je ne peux pas écrire de test »).
  `cold-reader` accepte la correction, `quality-gates` **maintient** avec une raison tout aussi juste
  (couverture de `Montant.cs` à 70 % sous le seuil de 90 %).
- **Le défaut révélé était dans ma conception.** Ce second défaut était déclaré `test` par la lentille
  — à raison — mais citait `CalculDuPanier.cs`, et ma règle « le fichier cité fait foi » l'avait
  reclassé `code`. Corrigé : le fichier ne fait basculer un défaut que **vers** le testeur. ADR amendé.
- **Puis l'agent a triché, et la revue l'a vu.** Au tour suivant, le développeur a « corrigé » le
  défaut de couverture en **supprimant le code non testé** (`ATPayer` ne déduit plus la remise,
  `Montant.Soustrait` retiré). Revue 3 : deux blockers, régression et contrat ratifié non respecté.
  Budget épuisé, escalade, arrêté. → Rien dans les portes n'interdit cette « correction » par
  suppression ; noté ouvert dans l'ADR 0046.

**Consommation du 03/10 : environ 1 170 requêtes.** Réserve à ~330 jusqu'au 01/11.

**Puis l'ADR 0047 (mesures 1 à 3 retenues par le responsable).** Garde du contrat ratifié : la revue
de DELIVER relève les noms du contrat présents dans le code (blocs de `contracts.md`), et la porte
GREEN refuse une correction qui en fait disparaître un. Réponse `outOfScope` : un défaut juste mais
pas du ressort de l'agent part à l'autre agent, une seule fois. Consigne du développeur précisée.
- **Rejouée sur les vrais commits** du run (`git show <ref>:<fichier>` sur la copie) : la correction
  légitime passe, la suppression est refusée (`Soustrait` disparu). Les commits d'un run arrêté
  restent dans la copie même après le rollback d'escalade : `git log --all`.
- **Piège en l'écrivant** : j'ai d'abord réutilisé `PASCAL`, qui n'accepte que les noms composés
  (`AppliqueA`). Il ignorait `Montant` et `Soustrait` — exactement le nom supprimé. Pour un contrat,
  tout identifiant capitalisé.
- **Limite assumée** : un comportement modifié à nom constant passe (retirer la soustraction en
  gardant `Soustrait`). La revue reste le filet.

**Le raccourci qui ne marche pas.** Repartir d'une branche où le code de DELIVER est déjà écrit, pour
sauter directement à la revue : la porte de phase refuse « Aucun livrable produit pendant la phase
DELIVER » en boucle (voulu : une phase qui ne produit rien est suspecte). 8 requêtes, arrêté.

**US-2 LIVRÉE : premier run réel jusqu'à DONE.** Repris juste avant DELIVER
(`run/us-2-2026-10-03-2973`), 4 min 38, **152,5 requêtes**, un seul rejet. Rapport :
`docs/runs/2026-10-03-us-2-836c8392/`. Code poussé sur `run/us-2-2026-10-03-9362`, 11 tests verts
(vérifié par un clone de GitHub).
- DELIVER : couvert par l'acceptance (ADR 0045), 2 tours, 28 requêtes, aucun rejet.
- Revue 1 : `quality-gates` relève le même défaut de couverture d'`ATPayer`, cible `test`, en citant
  `Montant.cs` — et cette fois il **reste au testeur** (routage amendé). La lentille précise même
  que « ce n'est pas un cas de l'ADR 0045 » : aucune acceptance ne couvre `ATPayer`.
- Correction côté tests (`fix-test`, ADR 0046) : le testeur ajoute `FactureTests` (19,00 € à payer
  pour 10 × 2,00 € avec 5 %), vert d'emblée — exactement le cas prévu par `verifyFixTests`.
- Revue 2 : `quality-gates` **accepte** dans ses arbitrages, les quatre lentilles approuvent ; commit,
  DONE. Deux mineurs restent notés (`CompareTo`/`ToString` non couverts ; le test n'exerce `+` qu'avec
  des frais de port nuls).

**Bilan du 03/10.** Partis d'aucun run au-delà de DISTILL. Cinq défauts de notre code révélés par des
runs réels et corrigés (porte cohérence, trois variantes chemin ↔ classe JUnit, routage), trois ADR
de conception (0045, 0046, 0047). Environ 1 330 requêtes. Réserve à ~170 jusqu'au 01/11.

**Prochaine étape.** Rejouer US-2 de bout en bout (RESEARCH → DONE) après la remise à zéro du 01/11,
pour un premier run complet sans reprise ; il coûtera de l'ordre de 450 à 550 requêtes.

**Le choix du modèle fonctionne désormais (ADR 0020, mesuré le 03/10, 2,4 requêtes).** `listModels()`
expose 15 modèles, et le modèle demandé à l'ouverture de session est celui qu'indique l'événement
`usage` : `claude-haiku-4.5` (2,04 requêtes pour un mot), `gpt-5-mini` (0,33). Le 24/09, seul `auto`
existait et la demande était ignorée. Le choix **par rôle** redevient possible : à concevoir (ADR).

**Fait dans la foulée : un modèle par classe de rôle (ADR 0048).** Une extension déclare la classe
d'un agent (`strong`, `standard`, `light`), jamais un modèle — la disponibilité dépend de
l'abonnement, remarque du responsable qui a fixé ce principe. Le projet associe chaque classe à un
modèle (`modelClasses`) ; le cœur résout à chaque tour (classe, puis modèle du projet, puis rien) et
ignore un modèle que `listModels()` ne propose pas. skraft : architectes `strong`, classifieur et
`quality-gates` `light`, le reste `standard`.
- **Constat en route** : le choix par projet de l'ADR 0020 ne s'appliquait qu'à la conversation
  principale, jamais aux agents des tâches. Désormais il sert de repli.
- Banc : `--modeles=strong:claude-sonnet-5.5,light:gpt-5-mini` ; le rapport note les modèles par étape.
- **Interface ajoutée** : panneau « Modèles des agents », en mode avancé seulement, une liste par
  classe avec « Par défaut (modèle du projet) ». Testé par rendu (jsdom), pas encore regardé dans la
  vraie fenêtre Electron.
- Reste : association par défaut d'après le multiplicateur, quand le runtime le renseigne.

**Revue de code de la PR #10 : quatre constats, corrigés.**
- *La correction de revue pouvait rebondir sans fin* entre testeur et développeur si aucun ne
  remplissait `responses` (champ facultatif) : chaque pas validé remettait les essais à zéro. Les
  réponses ne s'appliquent plus qu'au pas validé, et `endTurn` clôt les défauts restés actifs de
  l'agent dont c'était le tour.
- *Une reprise après la porte de fin de scénario repartait sur un état périmé* : elle choisissait le
  testeur d'après les lignes de rappel, et gardait les « corrigé » d'un essai annulé par rollback.
  Les fils sont copiés à l'entrée en correction et restaurés avec le code.
- *La garde du contrat retenait tout mot capitalisé* (`List`, `ArgumentException`) : seuls les noms
  déclarés le sont, 13 au lieu de 27 sur US-2, et la suppression de `Soustrait` reste refusée.
- *`listModels()` était appelé à chaque tour d'agent* : une fois par ouverture de projet.
→ Les deux premiers sont des cas que mes tests ne couvraient pas parce que mes doubles d'agents
répondaient toujours : un champ facultatif doit être testé **absent**.

**La barre de qualité appartient au projet (ADR 0049).** En vérifiant si skraft fait de la mutation
(oui, mais seul `muter-json` est lu : rien sur .NET), trouvé que `Montant.cs`, dans
`Tarification.Domaine`, était jugé au seuil du **reste** (70 %) au lieu du cœur (90 %) : le cœur se
reconnaissait au segment `Domain`. Demande du responsable : que l'utilisateur décide des seuils, de
la mutation et de la définition du cœur, hors de `stack.yaml`.
- `.agent-studio/quality.yaml`, commun aux extensions, cœur par chemins, seuils par couche (domaine,
  application, reste), `mutation.active`, `mutation.moment` ; validation stricte.
- **Désaccord retenu par le responsable** : la commande de mutation reste dans `stack.yaml`
  (vérification des programmes autorisés, format du rapport).
- Mutation **en fin de DELIVER** par défaut. Un échec de la porte de fin de phase relançait toute la
  phase, sans qu'aucun agent puisse tuer les mutants : un mutant survivant devient un défaut adressé
  au testeur (correction de l'ADR 0046), `outOfScope` vers le développeur pour du code superflu.
- **Je m'étais trompé** en annonçant `.skraft/quality.json` modifiable par les agents : il est dans
  `GELÉS` depuis l'ADR 0034. Le nouveau fichier y est ajouté.
- **Faux positif attrapé par les tests de bout en bout** : la note « couche du cœur sans fichier » se
  déclenchait sur les noms par défaut (un projet sans couche `Application`) ; elle ne porte plus que
  sur les couches déclarées.
- Reste : interface ; migration du projet d'essai ; `tdd` à brancher sur la barre.

**Lecteur Stryker, écrit sur un rapport réel.** `dotnet-stryker` 5.0.0 installé en outil global
(`~/.dotnet/tools`, ajouter au `PATH`) et lancé sur le code livré d'US-2 avant d'écrire une ligne :
le rapport réel sert de référence (`test/fixtures/stryker-net-us2.json`, chemins anonymisés).
- Format `mutation-testing-elements` v2, commun à Stryker.NET, StrykerJS et Stryker4s : un seul
  lecteur, `stryker-json`. Score = (tués + délais) / (tués + délais + survivants + non couverts), les
  erreurs de compilation et ignorés ne comptent pas : le lecteur retrouve **exactement** les 72 % de
  Stryker, ce qui valide le calcul sur données réelles.
- Stryker.NET écrit un **dossier** (`--output`) : nouveau jeton `{dossier}`, sur le modèle de
  `{couverture}`.
- Bout en bout réel (profil → adaptateur → Stryker → lecteur) : 72 % en 32 s, projet laissé propre.
- **Tranché** : les mutations de chaînes sont écartées (`stryker-config.json` du projet d'essai,
  `"ignore-mutations": ["string"]` ; Stryker.NET n'a pas d'option en ligne de commande pour cela).
  Plutôt que baisser le seuil du domaine, qui aurait laissé passer un vrai trou.

**Jugement de la porte sur la branche livrée d'US-2, sans crédit** (`run/us-2-2026-10-03-9362`,
configurée avec `quality.yaml`, la commande Stryker et `dotnet-tools.json`) : `GrilleDePaliers.cs`
100 %, `Montant.cs` sous le seuil → **refus**, alors que la revue avait approuvé. Les deux survivants
restants sont de vrais trous : aucun test ne vérifie qu'un facteur négatif est refusé, ni qu'un
facteur nul est accepté. La mutation voit ce que quatre lentilles n'avaient pas vu.

---

## 29/09 — Les fichiers du système, et un banc qui peut travailler chez toi

**Ce que j'avais affirmé à tort.** J'ai annoncé ce matin que les `.DS_Store` apparus dans
`.skraft/<slug>/` étaient enregistrés comme artefacts « produits par » l'agent. Faux sur ce poste :
un `~/.gitignore_global` les couvre, et l'instantané d'un checkpoint passe par `git add -A`, qui
respecte `.gitignore`. Je n'avais pas suivi la chaîne avant de le dire.

**Le risque restait, conditionné à la configuration de l'utilisateur.** Un poste neuf, la CI, un
collègue sous Windows avec `Thumbs.db` et `desktop.ini` : là ils entrent dans l'instantané, donc
dans les artefacts, donc dans le commit de la phase. Le même travail rendrait des empreintes
différentes selon la machine. C'est une garantie du produit qui dépendait d'un réglage personnel.

**Où je l'ai écrit, et pourquoi.** Dans le Workspace, seul service qui touche le disque, et parce
que c'est une connaissance de **plateforme** — pas de langage, donc pas dans un adaptateur de stack.

**Le détail qui a changé l'implémentation.** J'ai d'abord exclu ces fichiers du `git add` par
pathspec. `git add` **échoue** dès qu'un pathspec explicite désigne un fichier ignoré par un
`.gitignore`, même si ce même fichier est exclu par un autre pathspec du même appel. Mesuré dans un
dépôt jetable avant de recoder. La bonne voie est `reset HEAD` après l'ajout, qui a en prime la
sémantique voulue aux deux bouts : absent de HEAD il sort de l'index, déjà suivi il y revient — donc
un `desktop.ini` commité volontairement est préservé.

**Ce que mes tests prouvent vraiment.** Trois tests, un seul discrimine le correctif. Les deux
autres gardent contre une *mauvaise* correction — supprimer le fichier, ou retirer un fichier
volontairement suivi — et passent sans lui. Vérifié par mutation, et dit tel quel dans l'ADR.

**`--en-place` pour le banc.** Il clonait toujours vers un dossier temporaire : le dépôt était
protégé, mais les livrables restaient hors de vue, à chercher dans `/private/var/folders/...`.
L'option renverse le choix, avec deux garde-fous, parce que le pipeline commite, branche et
rembobine : un arbre de travail **sale** fait échouer le lancement en nommant les fichiers, et le
banc annonce en clair que le dépôt sera modifié. Les deux branches essayées à la main ; pas de test
automatisé, `scripts/` n'a pas de suite.

---

## 29/09 — Le test instable, et les deux défauts derrière lui

**Comment je l'ai trouvé.** Pas en lisant : en rejouant la suite **huit fois**. Un échec, un seul,
au quatrième passage — « le texte saisi accompagne la réponse », dans `j6.test.tsx`. Je l'avais
signalé plus tôt sans son nom, faute d'avoir capturé la sortie au moment où il était tombé ; c'est
la seule raison qui m'a coûté ces huit exécutions.

**Deux causes distinctes, un seul symptôme** — le panneau reste vide après l'émission.

**Dans le produit.** `TaskPanel` s'abonne aux événements **et** demande un instantané au montage :

```ts
api.on("interactions:changed", ({ pending }) => setPending(pending));   // synchrone
api.call("interactions:list", {}).then(setPending, () => undefined);    // promesse
```

Un événement reçu pendant le chargement était écrasé, à la résolution, par une liste déjà périmée.
Même schéma pour `tasks:list` / `task:update`, en pire : la liste **remplace** la Map là où
l'événement y **fusionne**. Corrigé par un garde de fraîcheur — l'instantané ne s'applique que si
rien de plus récent n'est arrivé.

**Dans les tests.** `FakeApi.emit` parcourt les auditeurs enregistrés et ne garde rien : un
événement émis avant le montage du panneau est perdu **en silence**. Attendre « (PO / BA) » ou
« Votre message » ne prouve que le montage d'un *autre* composant. Les tests attendent désormais que
le panneau soit abonné — son effet s'abonne puis appelle `interactions:list`, donc voir l'appel
suffit à le prouver.

**Ce qui m'a évité de m'arrêter trop tôt.** Après le premier correctif, j'ai rejoué dix fois : échec
au neuvième. Sans ça j'aurais conclu « réglé » sur une seule exécution verte, alors que je n'avais
traité qu'une des deux causes. Les deux tests de course sont d'ailleurs vérifiés par mutation.

**Stabilité mesurée** : 15 exécutions du fichier et 5 de la suite complète sans échec, contre 2
échecs sur 12 avant.

**Et `scripts/` est entré dans le typecheck**, ce qui a trouvé deux défauts immédiatement : un
doublon d'import que je venais d'introduire dans le banc — le paquet exportait déjà `createGhAuth`
et un `createNodeCommandRunner` que j'avais réécrit à la main — et, plus ancien, un confirmateur de
garde rendant `false` dans `smoke-copilot.ts` là où `ConfirmAnswer` attend une des trois réponses.
L'essai réel contre Copilot tournait avec une garde qui ne disait rien de valide.

---

## 29/09 — Le dépôt revenait en arrière, la mémoire non (ADR 0050, numéroté 0045 à l’origine)

**L'incohérence que j'avais laissée derrière moi.** L'ADR 0040 du matin cesse de rembobiner sur un
réessai, précisément parce que l'agent garde sa session. Je n'ai pas regardé ce que devenait cette
session sur le chemin d'**escalade**, où l'ADR 0029 veut au contraire que le dépôt redevienne
propre. Le rollback partait ; la conversation restait. À la relance, l'architecte revenait avec la
mémoire de fichiers que le rollback venait d'effacer.

Même phrase que le matin, un cran plus loin : **garder le souvenir et retirer la chose**.

**Pourquoi on ne l'avait jamais vu.** Le banc répondait `po` à une escalade qui exige développeur
ou architecte ; le refus était avalé en silence et la relance n'avait jamais lieu (ADR 0044). Deux
runs gelés là-dessus. Le défaut était derrière un autre défaut.

**Ce que j'ai fait.** Une fonction unique du réducteur fabrique la paire `rollback` +
`forgetSessions`, et les trois chemins qui rembobinent l'utilisent. L'oubli porte sur **tous les
rôles de la phase** (`phaseRoles`), pas celui du tour en cours : DESIGN en a deux, DELIVER aussi,
et n'en oublier qu'un reconstituerait exactement le défaut.

**Ce que ça a coûté de traverser la frontière d'extension.** `ctx.agents.forget(taskId, noms)` :
seuls des noms de rôles franchissent, jamais un objet de session (règle de sécurité n°1). Il a
fallu câbler l'API, le port du cœur, l'hôte en processus, le RPC de l'hôte isolé et l'enfant — le
typecheck a listé chacun des points, y compris les doubles de test à compléter.

**Le détail qui rend la correction petite** : la clé de continuité `<taskId>/<extension>/<rôle>`
n'avait pas été conçue pour filtrer, et elle s'y prête sans changement.

**Trois tests affirmaient le rollback seul** à l'escalade. Réécrits pour exiger la paire.

**Reste à vérifier sur un vrai run** : ce chemin n'a jamais été parcouru de bout en bout. Le banc
est corrigé pour y arriver, mais tant qu'aucune escalade n'aura été relancée pour de vrai, le
comportement est une déduction.

---

## 29/09 — On a fait tourner leur pipeline sur la même story (docs/05)

**Le dispositif.** skraft-plugin v1.6.1 chargé par `--plugin-dir`, leur `skraft-orchestrator`, la
même `US-2.md`, une copie du même dépôt. Résultat brut : **2 h 11, 37,81 $, 14 commits, 24 tests
verts** — mais DELIVER n'est pas close, la seconde revue n'a pas rendu son verdict. Détail complet
dans `docs/05-run-compare-skraft-plugin-1.6.1.md`.

**Deux erreurs de méthode, à ne pas refaire.** J'ai pointé `--plugin-dir` sur la racine du dépôt,
qui n'est qu'un *marketplace* : le plugin ne s'est pas chargé, et l'agent a **improvisé** le
pipeline avec des `general-purpose` après avoir lu les prompts sur le disque. Pire, j'avais pris sa
récitation des 31 noms de fichiers pour une preuve de chargement. La vérification qui vaut est la
liste `agents` de l'événement `init`, pas ce que le modèle raconte. Coût du faux départ : ~0,9 $.

**Ce que la comparaison a confirmé.** Les deux pipelines exigent les mêmes documents de conception,
gèlent les tests d'acceptance, et ont recalé DESIGN à l'essai 1 pour le passer à l'essai 2. Nous
sommes plus rapides là où nous passons — 3 min contre 4,7 sur RESEARCH, 12,5 contre 26,8 sur
DESIGN — parce qu'une porte de code constate en millisecondes ce qu'une lentille doit relire.

**Le fait qui compte plus que tout le reste : eux sont allés jusqu'au code, nous jamais.** Aucun de
nos six runs n'a dépassé DISTILL. Aucune considération sur l'élégance de nos portes ne compense ça.

**Un test écrit dans la foulée (A2), et vérifié par mutation.** Cinq assertions confrontent le
contenu partagé d'un agent à ce que le manifeste lui accorde : « lance les tests » exige
`run_tests`, « rédige un ADR » exige `render_adr`, nommer un dossier de livrables exige le droit
d'y écrire, et aucune skill exigée d'un rôle ne peut manquer du paquet — c'est littéralement le cas
`qa-reporting`. Retirer `run_tests` à `skraft-acceptance` ou exiger une skill inexistante fait bien
tomber les bons tests. Piège en les écrivant : déduire la clé de rôle du nom d'agent échoue,
`skraft-lens-test-integrity` contient « test » et tombait sur le rôle du testeur.

**Trois choses à corriger chez nous**, consignées dans `features.json` :

1. **Notre gel des tests est une impasse** dès qu'un refactoring change une signature. Chez eux,
   `Article` et `Reference` naissent d'une remarque de revue, la fabrique privée du test doit
   suivre — assertions et valeurs inchangées. `testFreezeGuard` refuserait ; le test ne compilerait
   plus et ne pourrait pas être réparé. Il faudrait comparer ce que le test **vérifie**, pas ce
   qu'il **contient**.
2. ~~Rien ne vérifie qu'un agent peut faire ce qu'on lui demande.~~ **Fait** (voir ci-dessus).
3. **On a supprimé le faux positif en supprimant la capacité de voir.** Leur revue a recalé DELIVER
   sur deux constats *justes* — Object Calisthenics — que ni notre linter ni nos lentilles ne
   relèveraient. L'ADR 0028 a écarté `quality-gates` de ce mandat, l'ADR 0022 confie la forme au
   linter, et `dotnet format` ne connaît pas ces règles. Piste : un analyseur Roslyn dans le profil
   de stack.

**Et une chose qu'ils font mieux, mesurée** : router les rôles vers des modèles différents
(`cost_role_class`). 25,64 $ de Sonnet pour les sous-agents, 10,47 $ d'Opus pour l'orchestrateur,
1,71 $ de Haiku. Nous utilisons un seul modèle pour tout.

**Ce qu'on ne peut pas comparer, et que je n'ai pas comparé** : les coûts (deux monnaies), les
tokens (deux façons de compter), et un run contre un run (variance du LLM, entrée adaptée, et cinq
de nos six runs occupés par nos propres défauts).

---

## 29/09 — Deux runs gelés en silence, et une réserve que personne ne regardait (ADR 0044)

**Le gel.** Le run relancé à DISTILL s'est arrêté après l'escalade et n'a plus rien fait pendant
trente minutes, processus vivant, journal muet. Cause : `askEscalation` exige
`requiredRoles: ['developpeur','architecte','administrateur']`, le banc répondait toujours `po`,
et le `.catch()` avalait le refus **sans un mot**. Aucun `onChange` ne survenant ensuite, la
demande restait sans réponse pour toujours.

**Ce que ça m'a fait dire de faux.** Deux fois j'ai annoncé « le cycle repart » après une escalade.
Non : le rollback est un effet de la transition d'escalade elle-même, qui **précède** la décision
humaine. La relance, elle, n'a jamais eu lieu — ni hier ni aujourd'hui. J'ai tué le premier run
sans m'apercevoir qu'il était déjà bloqué.

Un `catch` muet sur le seul mécanisme qui débloque une tâche ne cache pas une erreur, il fabrique
un état indiscernable d'un agent qui réfléchit.

**La réserve.** L'utilisateur a supposé être à court de crédit. Vérification :

```
premium_interactions   1471 / 1500   →   28 restantes (1,8 %)
overage_permitted      false         →   à zéro, les appels sont REFUSÉS
quota_reset_date       2026-10-01
```

Il avait raison. Et l'information était à un appel de distance — `/copilot_internal/user` — que
rien n'interrogeait. On lançait des tâches consommant des dizaines de requêtes sans savoir s'il en
restait une. C'est l'ADR 0031 qui se répète : un seuil qu'on ne mesure pas est un seuil qu'on subit.

**Ce que j'ai écrit.** `copilotQuota()` dans `github-auth`, qui rend `null` plutôt que de lever —
le point d'accès n'est pas documenté publiquement, donc tout y est facultatif, et une réserve
inconnue ne doit jamais empêcher de travailler. Le banc l'affiche avant de lancer. Le canal
`auth:quota` l'expose au renderer : des chiffres franchissent l'IPC, jamais un jeton (§10.2). Les
tests portent la charge utile **réellement rendue** par GitHub, pas une charge inventée.

**Ce que je n'ai pas fait, et qui compte plus.** Quand la réserve s'épuise en cours de route, le
pipeline traite l'erreur comme n'importe quelle panne : message brut, mêmes options, « relancer »
en premier alors qu'il ne peut que réechouer. Pour classer les pannes du runtime autrement que par
leur texte — comme le profil de stack classe les erreurs du compilateur par leur **code**, parce
que les messages sont traduits — il faut en avoir **observé** une. Je ne l'ai jamais vue. Si la
réserve tombe à zéro au prochain run, la trace nous la donnera.

---

## 29/09 — L'instruction était là, et elle ne suffisait pas (ADR 0043)

**Ce que l'ADR 0042 n'a pas traité.** Il donne un essai de plus à la revue ; il n'explique pas
pourquoi deux essais avaient été perdus avant elle. La raison : l'agent reformulait.

```
critère   ligne de 9 articles à 2,00 € : remise 0,00 €
écrit     Quand une petite quantité est commandée / Alors aucune remise n'est accordée
```

**Et l'instruction existait.** Dans `skraft-acceptance.agent.md` : « Recopie les valeurs des
critères mot pour mot. » Une phrase, en fin de paragraphe, sans exemple, sans contre-exemple, et
qui ne disait pas ce que la porte compare réellement. Lue et appliquée de travers deux fois.

C'est exactement l'ADR 0033 sur le refus de shell, transposé : un texte correct qui ne dit pas quoi
faire se paie en essais. Une règle énoncée ne vaut pas une règle **montrée**.

**Ce que j'ai écrit à la place :** deux sections. Ce que la comparaison regarde — les caractères,
pas le sens —, un critère réel avec la liste de ses valeurs, puis un scénario ✗ et un ✓ qui disent
la même chose, seul le second étant vérifiable. Puis la norme de nommage : marqueur dans le NOM du
test, deux formes acceptées, une refusée.

**Les exemples sont testés, pas seulement relus.** Chaque forme de nom donnée en exemple passe par
`acOf` et doit rendre ce que l'exemple promet. Sans ça, un exemple faux dans un prompt vit des mois.

**Un déplacement.** La phrase que j'avais ajoutée au brief le matin même (ADR 0041) en sort : c'est
une règle statique, sa place est dans le contenu de l'agent, pas dans un dossier de passation
construit par le code (ADR 0024). Seul l'emplacement des fichiers reste dynamique — lui dépend de
la stack.

**Je n'en attends pas de miracle.** Un prompt mieux écrit rend un comportement plus probable, il ne
l'impose pas ; la porte seule décide, et l'ADR 0042 reste le filet. Si DISTILL reperd des essais
là-dessus au prochain run, c'est la porte qu'il faudra regarder, pas le prompt.

---

## 29/09 — Le budget d'une phase se dépense avant d'arriver au vrai sujet (ADR 0042)

**Le run.** DISTILL relancée depuis une base où RESEARCH et DESIGN étaient déjà produites — c'est
l'option `--depuis=DISTILL` du banc, ajoutée pour ne pas repayer les phases d'avant. La porte RED
corrigée le matin a tenu : elle a reconnu ses tests et accepté le rouge, et n'a plus jamais
protesté. Mais la phase a escaladé quand même, pour une raison entièrement différente.

```
essai 1  porte valeurs  rejet   « 10 articles ou plus : 5 % » absent du scénario @ac-1
essai 2  porte valeurs  rejet   même famille
essai 3  valeurs ✔  RED ✔  →  revue : DEUX DÉFAUTS MAJEURS  →  budget épuisé  →  ESCALADE
```

**Les deux défauts étaient justes et corrigeables** : `Facture.ATPayer` ignore `Remise`, alors que
le contrat de conception **ratifié** exige `SommeDesArticles - Remise + FraisDePort`. Ils
désignaient une ligne. Personne n'a pu y répondre.

**Ce que j'ai compris en regardant pourquoi.** Le budget est commun aux portes de forme et à la
revue, alors que leurs rejets ne sont pas du même ordre : une porte de forme constate une
divergence **mécanique** (une valeur non recopiée), la revue rend un jugement sur le **fond**. Et
la revue siège toujours **en dernier** — elle est donc la seule à pouvoir hériter d'un budget vide.
Recopier « 2,00 € » dans un Gherkin et rebrancher un calcul de facture ne demandent pas le même
nombre de tours ; les faire puiser au même compteur, si.

**Correction au plus petit.** La première revue d'une phase obtient un essai, une seule fois.
J'avais aussi envisagé deux compteurs séparés et un budget rendu au passage d'une porte : les deux
obligeaient à choisir des chiffres, et l'ADR 0031 a montré ce que valent les seuils non mesurés.
Ici aucun chiffre n'est introduit, et `reviews[phase]` portait déjà l'information — pas de champ
d'état, pas de migration.

**Le piège en écrivant les tests.** Mes trois premiers scénarios passaient par RESEARCH… qui n'est
pas dans `REVIEWED_PHASES`. Ils n'atteignaient jamais de revue et affirmaient donc n'importe quoi.
Rejoués sur DISTILL, la phase du run réel.

**Reste ouvert, et ce n'est pas le budget :** il a fallu deux tours à l'agent pour comprendre que
la porte des valeurs veut une **recopie** et non une paraphrase. C'est du côté de ce que la porte
dit qu'il faut regarder.

---

## 29/09 — La porte cherchait ses tests là où le langage les range (ADR 0041)

**Le run.** Premier passage de DISTILL sur un vrai projet. Trois essais, escalade, sur le même
reproche : « Aucun test d'acceptance n'a été exécuté. » Pendant ce temps, la preuve enregistrée par
notre propre code disait : 8 réussis, 2 échecs, et les deux échecs étaient des tests d'acceptance
rouges **sur assertion métier** — le rouge exact que la porte attend. L'agent avait raison les
trois fois. Au troisième essai il a relancé `run_tests`, la seule réponse qu'un tel reproche
appelle, et s'est fait escalader quand même.

**La cause.** `effects.ts` filtrait `run.results` sur `layout.acceptanceTests`, des globs de
**chemins**, alors qu'un rapport JUnit rend `file` comme un **nom de classe** et `id` comme un nom
.NET qualifié :

```
attendu   tests/Tarification.Tests/RemiseParPalierAcceptanceTests.cs
fourni    Tarification.Tests.RemiseParPalierAcceptanceTests
```

Le filtre rendait toujours zéro. Sur tout profil à rapport JUnit. Le profil TypeScript y échappait
parce que Vitest rend de vrais chemins — d'où douze mois de CI verte.

**Le même glob servait à deux tâches**, et n'en faisait qu'une. Lire les fichiers : juste, et le
premier rejet du run le prouve — la porte lisait bien les tests, elle citait leur contenu.
Reconnaître un résultat : impossible.

**La leçon la plus coûteuse : la réponse était deux lignes plus bas.** `checkAcceptanceRed` appelle
déjà `acOf(r.id)` pour relier un résultat à son critère. J'ai proposé deux mécaniques avant de la
voir — un champ `acceptanceTestIds` dans le profil, puis un `acceptanceResultPattern` transporté
comme `testFilePattern`. Les deux auraient marché. Aucune n'était nécessaire. C'est l'utilisateur
qui a débloqué ça en demandant « on ne peut pas utiliser un find ? » : partir de ce qui existe, pas
d'un motif à inventer.

**Une faille refermée au passage.** `checkValues` cherchait le marqueur dans une **ligne** du
fichier, `checkAcceptanceRed` dans le **nom** du test. Un `// ac-2` en commentaire satisfaisait la
première et restait invisible à la seconde. Le brief de DISTILL dit maintenant où le placer.

**Et toujours le même motif de fond.** La porte avait mesuré « aucun identifiant ne ressemble à un
chemin » et rapporté « aucun test n'a été exécuté ». Ce n'est pas une imprécision de rédaction :
c'est ce qui a envoyé l'agent relancer des tests trois fois. Les deux constats sont désormais
distincts, et celui qui compte dit combien de tests ont tourné et en cite trois.

---

## 29/09 — On gardait le souvenir et on retirait la chose (ADR 0040)

**L'incohérence.** L'ADR 0039 garde la session de l'agent d'un essai à l'autre. L'ADR 0029 gardait
le `rollback` sur un rejet de porte, « là un jugement a eu lieu ». Mises ensemble : l'architecte
relancé arrive avec, dans sa conversation, les appels d'outils qui ont créé `contracts.md`,
`event-model.md`, `domain-model.md` — et le disque ne les contient plus. On lui demande de
**corriger** ce qui n'existe pas. Il édite un fichier absent et échoue, ou il retape de mémoire, et
alors il refait tout le trajet sans que le motif du rejet lui serve de guide.

**Ce que 0029 avait raison de dire, et ce qui a changé sous lui.** Sa distinction — une porte a
jugé, un délai n'a rien jugé — était juste. Mais son *implication* (donc on annule) tenait sur une
prémisse silencieuse : chaque essai repartait d'une session neuve, l'agent ne se souvenait de rien,
effacer ne contredisait rien. 0039 a retiré la prémisse sans que je relise ce qui en dépendait.
C'est la même leçon que l'ADR 0037 : **quand on change une capacité, se demander ce qui en
dépendait**.

**Décision.** `failure()` n'émet plus de `rollback` tant que le budget permet un essai, quelle
qu'en soit la cause. L'escalade annule toujours — l'humain reprend un dépôt propre. Le paramètre
`interrompu` disparaît : il ne distinguait plus que ce que la décision vient d'unifier. La
distinction survit là où elle porte encore, le **message** rendu à l'agent (`tourInterrompu()` dit
« interrompu, pas refusé » et « relis, ne recommence pas »).

**La sécurité ne bouge pas**, et ne reposait déjà pas là : la porte de fin de phase juge l'**état
final**, quel qu'ait été le chemin.

**Le piège, trouvé par le test de bout en bout de S3.** `render_adr` prend le premier numéro libre
d'après les fichiers présents dans `docs/adr`. Le rollback rendait le numéro 1 libre entre deux
essais ; sans lui, le deuxième essai ouvrait un **ADR-002 sur la même décision**. Défaut *révélé*
par ce changement, pas créé par lui — il attendait depuis toujours qu'on cesse d'effacer. Corrigé
côté **code** et non côté prompt : l'outil reconnaît le brouillon par son titre, et seulement tant
qu'il est `Proposed`. Un ADR ratifié n'est jamais réécrit en douce.

**Ce que ça change pour le run en cours** : un `research.md` recalé par sa porte reste sur le
disque. C'est ce qu'on voulait pouvoir observer — jusqu'ici, la reprise de session était vraie et
invérifiable, faute de fichiers à reprendre.

---

## 29/09 — On réinitialisait une session que D17 n'obligeait pas à réinitialiser (ADR 0039)

**Le déclencheur.** DESIGN recalée sur `CalculeRemise` cité dans `contracts.md` et absent du
modèle : une incohérence de **nommage**. À l'essai 2, l'architecte repartait d'une session vide —
3 messages, 605 tokens — et devait relire tout le dépôt pour renommer un identifiant qu'il venait
lui-même d'écrire.

**D17 ne demandait pas ça.** « Une session neuve **par phase/rôle** » : trois essais de DESIGN par
le même architecte sont la même phase et le même rôle. On avait implémenté « par essai », plus
strict que la décision, et personne ne l'avait vu. Même raisonnement que l'ADR 0030, qui avait déjà
tranché que la règle vise les **passages de phase**.

**Ce que j'ai dû ajouter pour que ça tienne.** En gardant les sessions, plus rien ne les supprimait
— jamais. L'unité passe donc du tour à la **tâche** : `releaseTask` les libère à la fin. Ce n'était
pas dans la demande, mais sans lui l'état des sessions s'accumulait indéfiniment sur le disque.

**Le test de bout en bout de `tdd` a servi de garde-fou.** Il affirmait « sessions éphémères, toutes
supprimées » et a échoué. En le réécrivant, il vérifie maintenant **davantage** : quatre tours,
**trois** sessions distinctes — le développeur enchaîne « vert » puis « nettoyage » dans la même —,
et toutes supprimées à la fin. Il comparait auparavant deux comptes égaux, ce qui masquait ce qui se
passait vraiment.

**Le garde-fou contre l'ancrage reste le budget d'essais**, puis l'escalade avec les motifs. Il
était déjà là ; on ne lui ajoute pas une amnésie forcée.

---

## 29/09 — RESEARCH produit enfin, et on ne peut pas lire ce qu'elle produit (ADR 0038)

**Le mur est franchi.** Cinquième run : le chercheur écrit son document, en **deux tours** (un par
essai), sans question, sans `mkdir`, sans échec d'écriture. La porte le juge sur son **contenu** :

> `LigneDePanier.cs:5-8` : plage hors du fichier, qui compte 7 lignes.

Reproche juste, précis, actionnable. On est passé d'un blocage d'outillage à un aller-retour de
qualité — ce pour quoi le pipeline existe.

**Et le document était introuvable.** Le rollback exécute `read-tree --reset -u` puis
`git clean -fdq` ; le fichier n'était pas commité. La trace, elle, enregistre **qu'**un outil a été
appelé, jamais **avec quoi**. Donc : impossible d'examiner ce qu'un agent produit **au moment
précis où une porte le refuse**, c'est-à-dire quand on voudrait le lire.

**Archivé dans la trace, pas dans le dépôt** — `git clean -fdq` effacerait tout ce qu'on écrirait à
côté. Le document et son motif se lisent désormais côte à côte.

**La distinction de l'ADR 0032 a servi pour la première fois.** Ouvrir la trace aux extensions
demandait de justifier pourquoi ce n'est pas un trou de sécurité : `evidence` **atteste** et une
porte s'y appuie ; `trace` **raconte** et aucune porte ne doit s'y appuyer. Le test qui verrouille
la liste des capacités exposées m'a obligé à l'écrire — c'est exactement son rôle.

**Et le livrable est gardé ENTIER.** Je l'avais d'abord inliné dans le JSONL, donc borné : 8 000
caractères, puis 200 000 après remarque. Aucun des deux ne venait d'une mesure — exactement le
travers de mon plafond d'un million de tokens, le matin même. La bonne réponse n'était pas un
meilleur nombre, c'était d'écrire le fichier **à côté** et de n'en garder qu'une référence : plus
aucun seuil à choisir. Il en reste un, légitime, sur la narration, qui borne un flux sans fin.

**Contrepartie d'avoir ouvert la trace aux extensions** : `archive` borne elle-même l'étiquette et
les chemins qu'elle reçoit. Sans ça, `ctx.trace.rejected` devenait une écriture arbitraire sur le
disque, hors du dépôt — pire que tout ce que la garde empêche ailleurs. Dès qu'une API accepte un
chemin venu de l'extérieur, elle le borne elle-même.

**Quatrième omission de la même famille en deux jours** : la commande refusée, les compteurs de
cache, le motif d'échec d'un outil, le contenu jugé. À chaque fois l'information existait et
n'était pas conservée. Et il en reste une : **les arguments des outils** ne sont toujours pas
tracés.

---

## 29/09 — Trois runs perdus tenaient dans une ligne qu'on ne gardait pas (ADR 0037)

**La cause des trois échecs sur « Document de recherche absent ».** L'outil `create` du CLI ne crée
pas les dossiers parents — il le documente lui-même. Le chercheur l'a diagnostiqué **seul**, en
testant : chemin imbriqué, un seul niveau, `.keep`, fichier à la racine de `.skraft/` (seul
celui-là passe), `edit` avec un `old_str` vide, et jusqu'au lancement d'un **sous-agent** pour voir
si son outil se comporterait autrement. Sa conclusion, mot pour mot :

> this is likely a harness limitation […] the orchestrator itself needs to create the target
> directory rather than me.

**Notre garde n'y est pour rien, et y est pour tout.** Sur le run tracé : 18 lectures autorisées,
2 écritures autorisées, **zéro refus d'écriture**, 3 refus de shell dont deux `mkdir -p`. Le CLI ne
sait pas créer le dossier ; nous retirons le seul autre moyen. Chaque choix est défendable pris
seul — **c'est l'intersection qui bloque**, et aucun des deux côtés ne pouvait la voir.

**La règle à retenir** : quand on retire une capacité, se demander **ce qui en dépendait**. On a
fermé le shell en pensant aux tests et aux commandes dangereuses ; `mkdir` en dépendait aussi. Le
pendant de l'ADR 0033 : un refus doit dire ce que le rôle peut faire, et ce qu'il peut faire doit
**suffire**.

**Et l'enquête a coûté trois runs pour rien.** Le SDK rend `{ code, message, remediation }` à la fin
d'un appel d'outil ; on n'en gardait que `success: boolean`. Quinze échecs, quinze fois « échoué »,
jamais la raison. Pour répondre à « la CLI produit-elle une erreur ? », j'ai dû lire le
**raisonnement du modèle** — ce que lui avait compris de l'erreur, pas l'erreur.

C'est la deuxième fois que j'écris un mécanisme d'observation en omettant ce qu'il devait capter :
l'ADR 0032 disait « on ne garde pas ce sur quoi on décide », et son implémentation jetait le motif
des échecs d'outil, cinq heures plus tard.

**Relevé, non traité** : un agent peut lancer des **sous-agents**. La garde s'y applique, mais ni la
trace ni les plafonds ne distinguent ce qui s'y passe.

---

## 29/09 — Le contrat parlait d'un périmètre sans le nommer (ADR 0036)

> Tu n'écris que dans ton périmètre : toute autre écriture est refusée.

Sans dire lequel. `composeAgentPrompt` **avait** les globs — ceux du manifeste, ceux que la garde
applique — et les réduisait à un booléen avant de rédiger la phrase. L'information existait et
était jetée à la dernière étape, comme la commande refusée non journalisée ou les compteurs de
cache. C'est le défaut corrigé le matin même pour le shell, resté intact ici.

**Nommer le permis ne dit pas l'interdit.** Le contrat énonce donc les deux, et cite explicitement
la **suppression** : un agent peut lire « voilà où tu écris » sans en conclure « et nulle part
ailleurs, ni modifier, ni supprimer ».

**Ce qu'on a écarté, et pourquoi.** La proposition était de laisser l'agent lancer ses propres
commandes de recherche, puis de vérifier par Git qu'il n'a modifié que l'autorisé. C'est ce que
font Claude Code ou Copilot CLI — **mais dans un conteneur**. Sans confinement, le contrôle a
posteriori ne voit rien de ce qui compte : ce qui se passe hors du dépôt, une exfiltration qui ne
modifie rien par construction, un effet déjà sorti de la machine qu'aucun rollback ne défait.

**Ce qui répondrait vraiment au besoin** : un outil `search` à paramètres structurés, exécuté en
argv sans shell. `ProcessRunner` lance déjà « une commande sans shell », et D47/O12 fournit la
liste de programmes. L'agent composerait sa recherche, le code l'exécuterait — même frontière que
`run_tests`. Le danger n'est pas la commande, c'est l'interpréteur qui lit le `;`.

---

## 29/09 — Un refus se contournait par une majuscule (ADR 0035)

**Déclencheur** : « l'extension est destinée à fonctionner sur Windows, macOS et Linux. » Les deux
premiers ont un système de fichiers **insensible à la casse** par défaut — je l'ai vérifié sur la
machine, APFS l'est.

Or `globToRegExp` compilait sans drapeau. Trois refus, tous adossés à une garantie, se contournaient
par une majuscule :

- le **gel de la barre de qualité**, que je venais d'écrire une heure plus tôt ;
- le **gel des tests d'acceptance** (D21/D22), via `isTestFile` ;
- l'interdiction d'écrire dans **`.git`** — `.GIT/config` passait.

`.skraft/**` accordait l'écriture, `.skraft/quality.json` ne reconnaissait pas
`.skraft/QUALITY.JSON`, et c'est le même fichier.

**La règle est asymétrique, et c'est voulu.** Refuser ignore la casse pour attraper plus ; accorder
la respecte pour accorder moins. Les deux vont vers « refuser par défaut ». Rendre les
autorisations insensibles ouvrirait `.SKRAFT/` sur un Linux où c'est réellement un autre dossier :
on accorderait au nom d'une confusion qui n'existe qu'ailleurs.

**Ce qu'il faut retenir au-delà du correctif.** C'est la **troisième fois en une journée** qu'une
garantie reposait sur une comparaison textuelle trop naïve : le lien symbolique dans l'écriture des
canaris, le chemin recollé de travers par le SDK, et la casse. Le mécanisme était juste chaque fois,
la comparaison approximative. À se demander pour toute garde : *que compare-t-elle au juste, et le
système de fichiers est-il d'accord ?*

**Et la CI ne teste que macOS.** Rien de tout cela n'aurait été vu par un test sur Windows ou
Linux : il n'y en a aucun.

---

## 29/09 — La trace a payé son coût en quatre lignes (ADR 0033)

Premier run avec la trace. Quatre lignes ont suffi à répondre à une question restée ouverte sur
**deux runs entiers** :

```
deny  shell  ls -la .skraft/us-2/research/ 2>/dev/null && find .skraft -type f
```

Le chercheur ne voulait ni écrire son document ni lancer des tests : il voulait **lire**. J'avais
affirmé le contraire une heure plus tôt, avec assurance, en devinant.

**Le refus était juste, la réponse ne l'était pas.** « Les tests sont lancés par l'orchestrateur,
modifie les fichiers avec les outils d'édition » : une justification hors sujet — il n'y a aucun
test en RESEARCH — et une consigne qui oriente vers l'écriture quand l'agent cherchait à lire. Au
run d'avant, dix-huit refus successifs ne lui avaient pas fait trouver la sortie ; il avait fini
par déclarer sa phase sans document.

**Ce que je n'ai pas fait :** autoriser le shell en lecture. Juger une commande inoffensive
demande de l'analyser, et `ls -la .skraft; rm -rf /` passerait n'importe quelle liste blanche.

**La règle qu'on en tire, et qui dépasse ce cas :** un refus s'adresse à quelqu'un qui doit
**continuer à travailler**. Il doit énoncer la sortie, pas la justification interne de la
fermeture. Les autres motifs de la garde nommaient déjà le périmètre autorisé ; celui du shell
était le seul à ne rien proposer d'utile.

---

## 29/09 — On décidait bien, sans jamais garder de quoi comprendre (ADR 0032)

**Quatre runs, quatre diagnostics bloqués au même endroit.** À chaque fois l'information existait
dans le code et n'était pas conservée :

- la commande refusée par la garde — calculée dans `req.command`, puis jetée. Dix-huit refus
  successifs sur un run sans savoir une seule fois ce que l'agent tentait ;
- les fichiers que l'agent déclarait avoir écrits dans `report_phase`, que la porte `citations`
  ignore alors qu'elle dit « document absent » ;
- ce qui existait avant le `rollback`, qui rend indistinguables « il n'a jamais écrit » et « il a
  écrit et on a rembobiné » ;
- l'occupation du contexte, sur laquelle repose l'ADR 0031, que je n'ai pu vérifier qu'en
  instrumentant le banc **après** avoir écrit l'ADR.

C'est le motif du projet, retourné une fois de plus : **une décision correcte, prise sans conserver
ce sur quoi elle porte.** Sauf qu'ici l'aveugle n'est pas une porte, c'est celui qui doit
comprendre ce qui s'est passé.

**Le changement qui compte.** La garde voyait **tous** les appels et ne rapportait que les refus.
Elle rapporte maintenant aussi les autorisations, avec leur cible. C'est la seule fenêtre sur ce
qu'un agent lit : les résultats des outils intégrés du runtime ne nous parviennent jamais,
`tool-end` ne dit que « réussi ». Sans ça, les vingt-six appels d'un architecte restaient une boîte
noire.

**Deux distinctions écrites dans le contrat, pour qu'on ne les perde pas.** La trace *raconte*, la
preuve *atteste* — une porte ne doit jamais s'appuyer sur une trace. Et la cause de fin d'un tour
est nommée par ce qu'elle est (`silence`, `durée`, `contexte`, `coût`, `blocker`…), pas par un type
d'erreur : c'est ce qui rend une trace lisible six mois plus tard.

**Un défaut trouvé en route.** `append` levait une exception **synchrone** sur une méthode déclarée
`Promise<void>` : un appelant qui faisait `.catch()` l'aurait prise en pleine face. Une trace ne
doit sous aucun prétexte faire tomber la tâche qu'elle observe.

---

## 29/09 — Le premier run qui atteint une revue, et ce qu'il montre

**Trois runs réels sur US-2, et seul le troisième dépasse DESIGN.**

| | 28/09 | run 2 | run 3 |
| --- | --- | --- | --- |
| RESEARCH | 4 questions | 1 question | 1 essai, sans rejeu |
| DESIGN atteint la revue | oui | **non** — mon plafond | **oui, deux fois** |
| Cause des rejeux | `quality-gates` hors mandat | plafond de tokens | critiques d'architecture justes |

Les correctifs de la veille tiennent. Ce qui reste bloquant est ailleurs, et c'est nouveau.

**Un piège du banc, à ne pas reproduire.** La configuration du projet d'essai (couverture, barre de
qualité, `coverlet`) vivait sur la branche `skraft/us-2`, pas sur `main`. Or le banc clone puis se
place sur `main`. Les runs 1 et 2 ont donc tourné **sans** elle, et je m'apprêtais à en présenter
les résultats DISTILL/DELIVER comme valides. Vérifier la branche que le banc utilise, pas celle
qu'on a sous les yeux.

### Trois défauts, par gravité croissante

**1. Rien ne borne les questions d'un agent.** Sept questions en DESIGN, huit sessions neuves, et
l'état affiche toujours « essai 1 » : `BLOCKED` → `HUMAN_DECISION` relance le spécialiste sans
toucher à `attempts`. Sur un vrai run, le temps de réponse de l'humain masque la boucle ; au banc,
qui répond en une seconde, elle saute aux yeux.

**2. Les réponses humaines sont incitables — c'est la cause de la boucle.** Cinq de ces sept
questions étaient la même. L'agent est pris entre notre porte `citations`, qui exige une source
pour tout ce qu'il affirme, et le fait que les clarifications qu'on vient de lui donner n'existent
que dans son prompt. Sa dernière question demandait littéralement qu'on les écrive dans un fichier.
Le code les a pourtant dans `state.answers`.

**3. Le retour de revue ne porte que sur le dernier rejet.** Essai 1 recalé par `architecture`,
essai 2 par `cold-reader`. L'agent corrige l'un et attire l'autre : `lastRejection` n'en garde
qu'un, et `specialist(ns, reasons)` ne transmet que celui-là. Avec trois lentilles de fond et trois
essais, **le budget devient une loterie** — on peut satisfaire chaque critique à son tour sans
jamais les satisfaire ensemble. C'est le plus sérieux.

### Deux observations qui n'entrent pas dans les trois

**Le modèle a émis un chemin en caractères gujaratis** : `.શ્કraft/us-2/design/domain-model.md`,
qui *ressemble* à `.skraft/` sans en être. La garde l'a refusé, parce qu'elle compare des chemins
résolus et non des apparences. Ce n'était pas une attaque, juste un modèle qui déraille — mais une
garde qui « normaliserait » l'Unicode par confort laisserait passer la même chose.

**La règle de synthèse fonctionne comme écrite** : deux lentilles APPROVED et une
CHANGES_REQUESTED donnent CHANGES_REQUESTED. La note la plus basse l'emporte, une lentille
satisfaite n'en rattrape pas une inquiète.

---

## 29/09 — Mon plafond de coût mesurait la mauvaise chose (ADR 0031)

**Ce que le run a dit.** Second run réel sur US-2 : DESIGN a épuisé ses trois essais **uniquement**
sur mon plafond de 1 M — 1023 k, 1048 k, 1049 k — sans qu'aucune lentille n'ait jamais siégé. Le
filet était devenu la porte. Un tour normal d'`architect-model` sur un vrai projet *fait* un
million ; j'avais écrit dans l'ADR 0027 que 1 M valait « environ sept fois un tour normal ».

**Et la grandeur elle-même était fausse.** Le cumul des `inputTokens` :
- compte ce qui a **transité**, cache de prompt compris ;
- **ne décroît jamais**, même quand le runtime compacte et vide la fenêtre ;
- n'est pas l'unité de facturation (Copilot facture en requêtes premium).

**La mesure existait depuis le début et je ne l'écoutais pas.** `session.usage_info` donne
`currentTokens` et `tokenLimit`, plus la ventilation système / conversation / définitions d'outils.
Le plafond porte désormais sur `currentTokens / tokenLimit`, seuil 0,9. Plus de nombre magique :
`tokenLimit` vient du modèle employé.

**Le piège que j'ai mis sous test.** C'est la **dernière** mesure qui compte, jamais la plus haute
atteinte. Sinon on réinvente exactement le compteur qui ne redescend pas — le défaut qu'on corrige.

**Deux choses trouvées en chemin, dont une qui me contredit.** J'avais dit qu'on ignorait
`cacheReadTokens` : faux, ces compteurs ne sont **pas** sur l'événement par appel, seulement dans
le résumé de fin de session. Donc l'hypothèse « le cache absorbe l'essentiel de la croissance »
reste **non vérifiée**, ni confirmée ni écartée. En revanche `copilotUsage.totalNanoAiu` existe :
c'est le coût réel de chaque appel, désormais remonté.

**Ce qui reste le plus urgent.** Le pourcentage d'occupation vit dans le cœur et **n'est pas
affiché** — `chat:agent` ne le transporte pas, comme `usage`. Un plafond invisible se redécouvre à
chaque fois par l'enquête, et c'est ce qui a coûté la soirée.

**La leçon, pour la prochaine fois.** J'ai posé deux seuils en deux jours sans mesurer ce qu'ils
bornaient. Le premier (30 min) tient parce qu'il est large. Le second était faux d'un facteur sept
et a bloqué la seule chose qu'il devait protéger. Un seuil ne se règle pas sur une intuition : il
se règle sur une grandeur qu'on a d'abord regardée.

---

## 28/09 — Ce qui n'a pas été jugé ne doit pas être jeté (ADR 0029, 0030)

Deux pertes distinctes, toutes deux déclenchées par la même interruption du 28/09.

**La première : le travail sur disque.** Le réducteur envoyait `TIMEOUT` dans le même `failure()`
qu'un refus de porte — lequel commence par un `rollback`. Les quinze documents de conception écrits
pendant 1 h 55 ont donc été effacés **sans qu'aucune porte les ait examinés**. Une porte qui refuse
a jugé ; un délai n'a rien jugé. Et la sécurité ne reposait pas là-dessus : la porte de fin de phase
juge l'état final, quel qu'ait été le chemin.

Le détail qui compte dans le message rendu au tour suivant : pas seulement « tu as été interrompu »,
mais « ce que tu avais écrit est resté, **possiblement incomplet**, relis-le ». Sans la seconde
phrase, l'agent prend un fichier à moitié écrit pour un fichier fini.

**La seconde : le contexte de la session.** `resumeSession` existait sur le port depuis l'origine.
Elle n'était appelée que par la conversation humaine ; les agents de tâche ouvraient toujours une
session neuve. La relance de 12:13 a donc repayé tout ce que l'architecte avait lu.

**La règle qui sauve cette reprise d'être une mauvaise idée.** On ne reprend que si le contexte
n'est pas en cause : le modèle n'a pas répondu, ou l'agent s'est tu. Si c'est **nous** qui avons
coupé — plafond de durée ou de coût — reprendre renverrait le contexte qui a causé la coupure et
retaperait le plafond dans la seconde. C'est la boucle « retried 5 times » du journal. Là, la
session neuve est le remède, pas la perte.

C'est ce qui justifie après coup d'avoir fait trois erreurs distinctes ce matin plutôt qu'une seule.
Je ne l'avais pas prévu : je les avais séparées pour que l'humain lise le bon motif.

**Ce que j'ai laissé ouvert.** Le SDK reçoit `systemMessage: { mode: "append" }` à la reprise comme
à l'ouverture. Si l'append est cumulatif, le prompt système est ajouté deux fois. `main-session.ts`
fait pareil depuis l'origine sans défaut constaté — mais personne ne l'a éprouvé exprès. Inscrit en
« À vérifier » dans l'ADR 0030.

---

## 28/09 — Une lentille sans rien à mesurer invente un grief (ADR 0028)

**Le symptôme.** La revue de DESIGN sur US-2 a été refusée **deux fois de suite**, par la même
lentille, sur le même motif : les documents de conception « présentent le flux cible comme
l'implémentation actuelle » et citent `CalculDuPanier.cs:15-22` qui ne contient pas ce flux.

**Pourquoi c'était sans issue.** Un document de conception décrit ce qui n'existe pas encore ;
c'est sa fonction. À chaque essai l'architecte réécrit, à chaque essai la lentille retrouve le même
écart. Le budget s'épuise, la tâche escalade.

**La cause.** `quality-gates` confronte les livrables aux faits **mesurés**. En DESIGN il n'y en a
aucun : pas un test n'existe. Mais `reviewFacts` lui servait quand même des lignes « Livrable X :
porte validée à l'essai 1 (sha256 …) » sous l'intitulé *« Faits établis par le code (acquis : ne
les revérifie pas) »*. L'existence d'un fichier n'est pas une mesure. Sommée de juger sans matière,
elle est allée chercher ailleurs.

**C'est notre défaut habituel, retourné.** On répète qu'une porte ne doit jamais attester ce
qu'elle n'a pas mesuré. Il faut lire aussi : elle ne doit pas le **reprocher**.

**Ce qui rend le retrait légitime, et que j'ai mis sous test.** Écarter une lentille pourrait
laisser une des quatre questions de `review.ts` sans réponse — et la synthèse refuse alors
d'approuver, ce qui ferait tourner la revue en rond *autrement*. Le test parcourt les **douze**
couples (niveau, phase) et exige la couverture. Sans ce test, le correctif serait une nouvelle
impasse déguisée.

**Deux tests existants affirmaient l'ancienne règle.** Je les ai corrigés délibérément — intitulé
réécrit, renvoi à l'ADR — et non pour les faire redevenir verts.

**Ce que ça ne corrige pas.** Rien, dans le code, n'empêche une lentille de rendre un défaut hors
de son mandat. Les verdicts sont à schéma, mais le *contenu* d'un défaut n'est pas contraint, et ne
peut probablement pas l'être. À surveiller sur les prochains runs réels.

---

## 28/09 — La durée ne dit rien du coût (ADR 0027)

**Le chiffre.** DESIGN : 4 230 824 tokens d'entrée, 529 k par tour. Les lentilles de revue, sur le
même run : 83 k. Un facteur six.

**La cause est structurelle, pas accidentelle.** Chaque appel au modèle renvoie tout le contexte,
donc le repaie : un tour de N appels d'outil coûte en **O(N²)**, et rien ne bornait N. L'architecte
lisait le dépôt, appelait un outil, relisait — chaque aller-retour emportant tout ce qui précédait.

**Le signal était déjà là.** L'événement `usage` du runtime porte `inputTokens`, et
`task-agent-runner.ts` ne s'en servait que pour *compter après coup*. Le lire en direct dans
`runTurn` suffit à couper. Le piège que j'ai mis sous test : **le cumul ne décroît jamais** — c'est
ce qui a été payé, pas ce qui tient en mémoire. Regarder la taille du dernier appel ne couperait
rien, parce que les appels rétrécissent souvent pendant que la facture monte.

**Ce que ça ne corrige pas, et il faut le dire.** C'est un coupe-circuit. Le contexte croît
exactement pareil ; on cesse seulement de payer au-delà de 1 M. Le vrai correctif n'est pas dans le
cœur : c'est de donner moins à lire à l'agent — un dossier de passation construit par le code
plutôt qu'un dépôt à explorer. Et la dépense reste **invisible pendant** la tâche : elle est écrite
dans `tasks/<id>/usage/<taskId>.json` et ne remonte pas à l'écran. Le responsable a découvert les
4,2 M en lisant un fichier.

---

## 28/09 — Un tour d'agent a duré 1 h 55, et rien ne le bornait (ADR 0026)

**Ce qui s'est passé.** Premier vrai run de `skraft-pipeline` sur US-2 du projet d'essai .NET.
Le responsable a vu une tâche « qui ne finit jamais ». Le journal dit autre chose :

```
10:13:59  session ouverte   skraft-architect-model
                            ← 1 h 55 min 41 s sans aucune transition
12:09:40  effet en échec    TIMEOUT
```

**Pourquoi le chien de garde n'a rien vu.** Il ne surveille que l'**inactivité** (5 min), et il est
réarmé par chaque événement de session **et** chaque battement d'outil. L'agent parlait sans cesse.
Le chronomètre n'a fini par se déclencher que quand l'agent s'est réellement tu, deux heures plus
tard. D30 dit « un agent qui travaille ne doit pas être coupé » — et c'est vrai. Mais
**l'activité n'est pas la progression** : DESIGN a brûlé 4 230 824 tokens d'entrée pour 8 requêtes
(529 k par requête), et tout a été rejoué depuis le checkpoint à l'annulation.

**Ce que j'ai ajouté.** Un plafond de durée totale du tour, défaut 30 min, que **rien ne réarme**.
Un test le défend explicitement — sans lui, un futur « réarmons-le aussi » en referait un second
chronomètre d'inactivité, inutile. Erreur distincte `TurnBudgetError`, parce que « il ne répond
plus » et « il n'en finissait pas » n'appellent pas la même correction chez l'humain qui lit.

**Ce que ça ne corrige pas.** Le coût. Un tour peut tenir sous 30 min et consommer un demi-million
de tokens : 529 k par requête en DESIGN contre 83 k pour les lentilles. Borner le contexte d'une
session est un chantier à part, encore ouvert. Troisième point vu au passage : la lentille
`quality-gates` a rejeté DESIGN deux fois parce que les documents décrivent la cible et non
l'existant — reproche qu'un document de conception ne peut structurellement pas satisfaire, dans
une phase où aucun fait n'est mesuré.

---

## 28/09 — Aucune skill n'était inutilisée ; deux fichiers l'étaient

**Demandé :** supprimer les skills qu'on n'utilise pas. **Mesuré d'abord :** les douze skills
déclarées sont toutes affectées à au moins un rôle — sept obligatoires, cinq à la demande. Aucune
n'était supprimable. Il ne faut pas confondre « à la demande » et « inutilisée » : les trois
critères de revue et les deux catalogues ne sont lus que si un agent appelle `load_skill`, mais les
retirer priverait les lentilles de leur grille.

**Supprimé :** `outside-in-tdd/assets/{CommandHandlerTestTemplate,QueryHandlerTestTemplate}.cs`.
Rien ne les nommait — ni corps de skill, ni `references/`, ni agent — et ils voyageaient **signés**
dans le `.asx`. C'étaient les seuls artefacts .NET du contenu livré.

**Pourquoi cet écart avec l'amont et pas l'autre.** L'ADR 0024 §6 dit « reprises telles quelles »,
et j'ai refusé la veille de retoucher le texte de `craft-discipline` pour cette raison. La
différence tient en une phrase : **supprimer un fichier que personne ne nomme ne change rien à ce
qu'un agent lit** ; modifier un texte injecté, si. Le premier est de l'emballage, le second du
contenu.

**Le garde-fou vaut mieux que la suppression.** Le critère ne vérifiait que `assets/`. Le test le
remplace et couvre tout fichier livré sous `skills/` : un `references/*.md` que plus aucun corps ne
cite tombera aussi. Écrit en RED d'abord — il a nommé les deux fichiers avant que je les efface.

---

## 28/09 — `run_lint` : le linter arrive avant le refus, pas après (ADR 0025)

**Fait.** Un outil `run_lint` fourni par le cœur (`packages/extension-host/src/lint-tool.ts`),
donné à `skraft-test` et `skraft-dev`. Il appelle le **même** `StackAdapter.lint()` que la porte
`deliver` — même mesure, même source de vérité — mais pendant le travail de l'agent.

**Le défaut corrigé.** C4 de `craft-discipline` demande de vérifier que le linter ne signale rien,
sans donner aucun moyen de le savoir, et sans même citer de commande. L'agent découvrait l'avis du
linter quand la porte le recalait : une phase entière consommée pour une violation de forme que
l'outil signale en quelques secondes.

**Ce qui compte plus que l'outil : le résumé sépare trois états.** Pas de linter configuré ;
linter qui a tourné et **n'a examiné aucun fichier** (exclusion ESLint, filtre de sévérité
SwiftLint) ; fichiers examinés sans violation. Seul le troisième vaut conformité. C'est
exactement le défaut réintroduit trois fois en S6, par trois chemins différents — je l'ai écrit
dans le texte que l'agent lit, parce que c'est le seul endroit où il ne se reperdra pas.

**Pas de preuve enregistrée.** La porte relance le linter elle-même. Si cette exécution-ci valait
preuve, l'agent choisirait le moment de la mesure — il pourrait linter avant d'écrire le code
fautif. Même raison que pour `run_tests`, retournée : là c'est la preuve qui compte, ici c'est
l'information.

**Pas de `run_build`, et c'est délibéré.** `runTests` compile déjà dans les trois piles, et
`buildErrors` du profil sait nommer les erreurs de compilation. Un second outil d'attestation,
indépendant des tests, laisserait l'agent conclure « ça compile » sans qu'un test ait tourné.
Si le besoin revient, ce sera une décision à part : il faudra dire ce qu'on a le droit d'en
conclure.

---

## 28/09 — Le contrat retire la commande, il ne se contente pas d'en proposer une autre

**Fait.** Le contrat du cœur interdit désormais à l'agent d'exécuter lui-même toute commande de
compilation ou de test (`packages/extension-host/src/agent-prompts.ts`, `contractBlock`).

**Le piège.** Les douze skills sont reprises **telles quelles** (ADR 0024 §6) — je l'ai vérifié,
elles sont octet pour octet identiques à `v1.6.1`. Elles viennent d'un cadre .NET et font lancer
`dotnet test`, `dotnet build`, `[Theory]`. Je croyais le problème réglé parce que le contrat disait
déjà « lance les tests uniquement avec `run_tests` ». **Il ne l'était pas** : cette phrase couvre
les tests et laisse la compilation à l'agent — qui lit `dotnet build` dans `craft-discipline` C3 et
l'exécute, sur un projet Swift ou TypeScript où la commande n'existe pas. Une consigne qui
*propose une alternative* ne *retire* pas l'instruction concurrente ; il faut la retirer
explicitement. C'est le même motif que les portes : **ce qu'on n'a pas interdit, on l'a permis.**

**Pourquoi dans le contrat et pas dans la skill.** Modifier `craft-discipline` aurait été plus
direct, mais c'était rediscuter l'ADR 0024 §6, qui est `décidé`, et ouvrir un écart à maintenir
avec l'amont GPL. Le §3 prévoit exactement ce cas : le contrat vient en dernier et prime. Une ligne
dans `contractBlock` couvre en plus toutes les skills reprises ensuite, sans y toucher.

**Ce qui reste ouvert.** C4 — l'analyse statique — n'a toujours aucun outil : `StackAdapter.lint()`
existe et la porte `deliver` s'en sert (`deliver-effects.ts:204`), mais **après coup**. L'agent dev
n'a que `run_tests` et `report_blocker` : il découvre le refus du linter quand la porte le recale.
Un outil `run_lint` sur le même `adapter.lint()` corrigerait ça — même mesure, disponible plus tôt.
Pas de `run_build` en revanche : `runTests` compile déjà, et un second outil d'attestation
indépendant des tests est exactement le défaut qu'on traque.

---

## 28/09 — Agents et skills en Markdown : un contenu, deux usages (ADR 0024)

**Fait.** Branche `feat/skraft-agents-skills-md`, partie de `main`, **rien poussé sur main**
(consigne du responsable).
- Une extension déclare désormais ses agents par fichier (`agents/<nom>.agent.md`) et ses skills
  (`skills/<nom>/SKILL.md`).
- Le cœur compose le prompt dans cet ordre : contenu du rôle, skills obligatoires (ou une seule
  section, `nom#Titre`), consignes du manifeste, puis le **contrat d'exécution** en dernier. Le
  contrat couvre l'outil de fin, `run_tests`, `report_blocker`, `load_skill` et l'interdiction de
  Git, et il prime explicitement sur le reste.
- `load_skill` trace chaque chargement jusque dans l'état de la tâche (D26).
- skraft livre ainsi ses onze rôles et douze skills reprises du tag `v1.6.1`, que le responsable a
  déclaré autorisé le 28/09.

**Pourquoi séparer contenu et contrat.** Le responsable voulait que les mêmes fichiers servent à
agent-studio et à Copilot CLI / Claude Code. Or une même phrase ne peut pas être vraie dans les
deux modes : « lance les tests et commite » est juste ailleurs, faux chez nous. D'où la règle : les
`.md` ne nomment **aucun** outil d'agent-studio, et un test le vérifie. Tout ce qui n'a de sens que
sous l'orchestrateur va dans `roles.ts` ou dans le contrat du cœur.

**Piège attrapé par le test du frontmatter.** Mon premier lecteur de frontmatter ne gérait que les
valeurs sur une ligne. `adr-eligibility-gate` écrit sa description en bloc replié YAML
(`description: >` puis des lignes indentées) : description vide, donc liste `load_skill` des
lentilles sans explication. Corrigé (`>` et `|`) et testé. Leçon : sur du contenu repris d'un
tiers, écrire le test sur **tous** les fichiers réels, pas sur un exemple fabriqué.

**Conflit repéré entre skills reprises et nos décisions.** La skill `craft-discipline` impose ses
seuils d'Object Calisthenics, alors que l'ADR 0022 fait du linter du projet la seule autorité. Et
`outside-in-tdd` fait commiter l'agent. Je n'ai **pas** modifié les skills : elles restent
identiques à la source, ce qui garde la reprise traçable. La consigne d'orchestration des rôles
concernés tranche (« le linter fait foi », « ne fais pas les commits ni les portes »), et un test
vérifie qu'elle vient après les skills.

**Reste à faire.**
- Éprouver le dossier comme plugin dans Copilot CLI et Claude Code (critère
  `skraft-plugin-autonome`, manuel). Le format Copilot est repris de skraft-plugin sans avoir été
  essayé.
- Verser la pièce d'origine de l'autorisation, qui porte maintenant aussi sur `v1.6.1`
  (critère `reprise-skraft`).

---

## 28/09 — La couverture est enfin mesurée, et non plus supposée

**Le défaut corrigé.** Le prompt de la lentille `quality-gates` affirmait que la couverture faisait
partie des faits établis par le code — alors qu'aucun fait de couverture n'était jamais produit. La
lentille recevait l'assurance qu'une catégorie de faits existait, avec consigne de ne pas la
revérifier, et cette catégorie était toujours vide.

**Cobertura comme format pivot.** `dotnet test --collect`, `vitest --coverage.reporter=cobertura`,
`pytest --cov-report=xml` et les convertisseurs JaCoCo le produisent tous. **Un lecteur pour quatre
écosystèmes**, au lieu d'un lecteur par outil. C'est le même raisonnement que pour `junit-xml`.

**Le jeton `{couverture}` est un DOSSIER, pas un fichier.** Je l'avais d'abord écrit comme un
fichier, et le vrai `dotnet test` m'a détrompé : son collecteur range le rapport sous un
sous-dossier nommé par un **GUID qu'il choisit lui-même**. Imposer un nom de fichier aurait exclu
.NET. L'adaptateur cherche donc le rapport dans l'arborescence.

**La séparation que j'ai tenue malgré la demande.** Il m'était proposé de mettre l'objectif de
couverture dans l'adaptateur. Je l'ai mis dans `.skraft/quality.json`, où vivent déjà les seuils de
mutation : **le profil dit COMMENT lancer, la barre dit CE QUI est exigé.** Deux endroits qui
décideraient la politique finiraient par se contredire, et personne ne saurait lequel fait foi.

**Aucun seuil par défaut.** Sans déclaration du projet, la couverture est rapportée comme un fait,
jamais exigée. Un seuil imposé d'en haut ferait échouer des projets qui n'ont rien demandé, et
pousserait à écrire des tests qui couvrent sans juger — exactement ce que la mutation existe pour
attraper.

**Le piège du projet .NET.** `--collect "XPlat Code Coverage"` a d'abord répondu « datacollector
introuvable » : il vient du paquet `coverlet.collector`, absent de mon `.csproj` écrit à la main.
Et la suite **passait quand même** — les tests étaient verts, la mesure silencieusement absente.
→ Un outil de mesure manquant ne fait pas rougir la suite ; seule la porte peut le dire.

**Vérifié en réel** : 5 fichiers mesurés dans la même exécution que les 5 tests, de 66,7 % à 100 %.

---

## 28/09 — Ce qui est mécanisable dans les skills devient du code

**Contexte.** La branche apporte douze skills reprises telles quelles. Une skill est une consigne :
elle améliore les chances qu'un agent fasse bien, elle ne garantit rien. La question posée était
donc : **qu'est-ce qui, là-dedans, peut devenir une porte ?**

**Inventaire.** Sur les douze, deux seulement portent des règles reconnaissables sans
interprétation : `bdd-methodology` (motifs d'étape interdits, granularité, tags) et, pour deux
règles, `architecture-review-criteria` et `adr-eligibility-gate`. Les autres sont du jugement — et
c'est bien qu'elles restent des skills.

**Porte `gherkin`, placée avant le gel.** C'est tout l'argument : les tests d'acceptance sont gelés
à la sortie de DISTILL. Un scénario qui dit « Quand j'appelle POST /api/panier » ne devient pas
seulement médiocre, il devient **la spécification** que toute la livraison doit satisfaire, et plus
personne ne peut le réécrire. Ailleurs une faiblesse de méthode coûte un réessai ; ici elle se
fige. La porte refuse donc AVANT la porte `valeurs` et avant le gel.

**Le bug que le français a révélé.** `\b` de JavaScript ne connaît que `[A-Za-z0-9_]`. Après
« donné » ou avant « ça », il ne voit aucune transition : **la porte ne reconnaissait rien** sur du
Gherkin français. Quatre tests sont tombés là-dessus. → Toute frontière de mot dans ce dépôt doit
s'écrire `(?<![A-Za-zÀ-ÿ0-9])`, jamais `\b`.

**Deux règles d'ADR pour DESIGN**, notre phase la plus faible — la seule où nous n'avons ni méthode
ni porte : le verdict dans le nom de fichier (leur G14) et l'ADR de « bonne pratique » (leur Q2).
Peu de code, et ça atterrit là où il n'y avait rien.

**Une porte que je n'ai PAS écrite, et pourquoi.** J'avais proposé une porte « matrice » exigeant
que `impl-plan.md` couvre tous les scénarios — leur G6. Vérification faite avant d'écrire :
`planScenarios` tire les scénarios des **tests réellement trouvés**, et n'utilise le plan que pour
l'ordre. Un plan incomplet ne fait donc perdre aucun scénario. Leur porte garde contre un risque
que notre structure a déjà éliminé. → Vérifier la prémisse d'une porte avant de l'écrire : celle-ci
aurait été du zèle.

---

## 26/09 — La vraie application Electron tourne en CI, sans jamais appeler Copilot

**Fait.** Playwright pilote l'application réelle : vrai processus principal, vrai préchargement,
vrai IPC. Deux essais — démarrage jusqu'à l'écran projet, puis ouverture d'un projet jusqu'à la
conversation — plus la vérification qu'**aucune erreur n'est écrite en console**. Job de CI séparé,
parce qu'il exige le binaire Electron (~250 Mo) que le job principal ne télécharge pas.

**Aucune requête à Copilot, c'était la consigne.** `mode-essai.ts` substitue un runtime scripté,
une session GitHub feinte et un sélecteur de dossier sans boîte native. Le port `AgentRuntime`
rend cela possible sans rien simuler d'autre : **seul l'adaptateur change**, tout le câblage est
celui de production.

**La garde, et c'est le point sensible.** Ce mode désactive l'authentification. Une variable
d'environnement ne protège rien — c'est la chose la plus facile à poser. La vraie condition est
`!app.isPackaged` : un binaire distribué ne peut pas être basculé dans ce mode, quoi qu'on mette
dans son environnement. Sept tests verrouillent la garde, dont un qui vérifie qu'une application
empaquetée refuse même avec la variable posée.

**Deux pièges, et le second m'a eu.**

*Le profil utilisateur.* Sans `--user-data-dir` vers un dossier jetable, l'essai lirait les
réglages **réels** du développeur — dont `lastWorkspace`, qui lui ferait ouvrir un projet au
hasard — et les écraserait. Vu avant de le subir, pour une fois.

*L'assertion creuse.* Ma première version affirmait `getByRole("textbox").first()` après le clic.
Ça passait en 1,2 s… en matchant un champ de l'écran **projet**, sans avoir jamais ouvert le
projet. En resserrant, l'essai a échoué — et c'est là qu'il a commencé à valoir quelque chose.
→ Deuxième fois aujourd'hui que l'assertion faible d'un essai coûteux me piège : elle passe, elle
rassure, et elle ne dit rien. Sur ce genre d'essai, **écrire d'abord l'assertion qui échoue**.

**Ce que la capture Playwright a révélé en passant.** Le titre « Que voulez-vous faire… » ne
s'affiche que sur une conversation **vide**, et elle ne l'était pas : le dépôt jetable n'étant
reconnu par aucun adaptateur, l'application avait posté son avertissement. Autrement dit le
mécanisme de mise en attente des messages du 24/09 — postés avant qu'une conversation existe —
**fonctionne dans la vraie application**, et c'est la première fois qu'on le voit. L'essai
l'affirme désormais explicitement.

**Reste à faire avant de distribuer** : `mode-essai.ts` est compilé dans le paquet, inerte mais
présent. La garde protège l'exécution, pas la taille ni la surface de lecture. C'est écrit en tête
du module.

---

## 26/09 — Le vrai ESLint a trouvé un défaut en une seule exécution

**Fait.** `test/fixtures/projet-eslint`, un vrai projet ESLint, et le lint de
`profiles/typescript.yaml` qui y tourne pour de vrai. ESLint a été ajouté au dépôt pour cela
(`pnpm add -w -D eslint`), avec l'accord du responsable — il n'y était pas.

**Et dès le premier lancement, trois tests sur cinq ont échoué — pour une bonne raison.** Les
outils rapportent des chemins **réels**, et sous macOS `tmpdir()` passe par `/var`, lien vers
`/private/var`. Sans résoudre la racine, `relative()` rendait
`../../../../private/var/…/src/a.js` au lieu de `src/a.js`. Or les portes rapprochent `analyzed`
des fichiers qu'elles ont demandés : plus rien ne correspondait, et **la porte concluait « rien
n'a été jugé » alors que le linter avait parfaitement travaillé.**

**Trois lecteurs sur quatre avaient le défaut.** Seul `parseVitestReport` résolvait la racine —
et je l'y avais mis exprès, avec un commentaire expliquant pourquoi. Les trois autres répétaient
le même calcul sans la résolution. `relatifDepuis` est désormais partagé par les quatre.

→ C'est la **troisième fois cette semaine** que le lien symbolique de `/var` mord : les tests de
J1 le 24, l'écriture des canaris le 26 au matin, la lecture des rapports le 26 au soir. Chaque
fois un endroit différent, chaque fois la même cause. Le bon réflexe n'est pas « attention aux
liens » mais « **tout chemin qui traverse une frontière de processus passe par un helper
commun** ».

**Ce que ce témoin prouve exactement.** Un fichier propre, un fichier fautif, et un fichier
**ignoré par la configuration** : ce dernier doit être absent d'`analyzed`, ce qui éprouve contre
le vrai outil le défaut du 24/09. Plus un fichier inexistant, pour vérifier qu'une sortie vide ne
se conclut pas en « aucune erreur ».

**Deux limites assumées.** Les fichiers du témoin sont en JavaScript : l'analyseur par défaut
d'ESLint ne lit pas les annotations de type, et ajouter `typescript-eslint` pour un témoin serait
disproportionné. Et **SwiftLint reste non couvert** — il exigerait un runner macOS en CI.

---

## 26/09 — Les canaris affrontent enfin un vrai lanceur, et en CI

**Ce que ça change.** Tous les tests des canaris jusqu'ici employaient des lanceurs doublés : ils
éprouvaient l'oracle, jamais les gabarits. Rien ne prouvait que `vitest` découvre
`src/canari_<marque>.test.ts`, ni qu'un `fonctionAbsente()` produise un message que nos motifs
reconnaissent, ni — le point crucial — qu'une syntaxe cassée ressorte en `other_error` plutôt qu'en
`assertion`.

**Fait.** `test/fixtures/projet-vitest`, un vrai projet Vitest minimal, et les canaris de
`profiles/typescript.yaml` — **le profil livré, pas une copie** — exécutés dedans pour de vrai.
Résultat : **les quatre genres ressortent `ok`**, y compris celui qui protège la porte RED. Cinq
exécutions de Vitest en ~5 secondes, aucun LLM, aucun réseau : la CI le lance à chaque poussée sans
qu'il ait fallu toucher au workflow.

**Deux pièges, et ils ne s'inventent pas.** Le témoin est copié hors du dépôt, donc `vitest` n'y est
pas installé : il faut exposer `node_modules/.bin` dans le `PATH`, comme le ferait un script pnpm.
Et nous sommes nous-mêmes dans Vitest, qui pose des `VITEST_*` dans l'environnement : héritées, le
Vitest fils se croit dans un worker du père. Il faut les **vider** — `ProcessOptions.env` ne sait que
surcharger, pas supprimer.

**L'assertion a été resserrée en cours de route.** Je m'étais d'abord contenté de « aucun problème ».
Ça aurait laissé passer quatre avertissements, c'est-à-dire un classement inexact partout. Le test
exige maintenant `ok` pour chaque genre. → Sur un test d'intégration coûteux, l'assertion faible est
la tentation : elle passe, elle rassure, et elle ne dit rien.

**Le témoin est hors des globs de `pnpm-workspace.yaml`** (`packages/*`), donc jamais installé comme
paquet du dépôt — vérifié, pas supposé.

**Prochaine étape, décidée avec le responsable.** Même traitement pour `lint-execute-en-vrai`, qui
demande d'ajouter un vrai ESLint au dépôt (absent aujourd'hui). Puis un job Electron avec Playwright,
**runtime d'agent moqué** : aucune requête Copilot réelle en CI, c'est une consigne explicite.

---

## 26/09 — Un profil sait enfin lire une erreur de compilation

**Ce que ça débloque.** Sur un langage compilé, le rouge le plus courant du cycle TDD — « la
fonction que je viens d'appeler n'existe pas encore » — **arrête la compilation**. Le lanceur ne
produit alors aucun rapport de tests, et l'adaptateur générique n'avait qu'une exception à offrir :
le rouge légitime n'atteignait jamais la porte. Autrement dit les profils étaient inutilisables sur
Swift, C#, Java, Rust — la moitié de l'intérêt du jalon.

**Fait.** Section `buildErrors` : un motif appliqué **ligne à ligne**, groupes nommés `file` et
`message` obligatoires, plus une liste de **sous-chaînes** désignant un symbole absent. Branché sur
l'adaptateur (rapport absent → erreurs lues et classées) et sur les canaris, ce qui rend le canari
`missing_symbol` éprouvable : `profiles/swift.yaml` déclare maintenant ses quatre genres.

**Le choix qui compte.** En cas de doute, le classement est `other_error`. Refuser un rouge correct
fait perdre un tour ; l'accepter à tort laisse passer du code qui ne compile pas. Les deux erreurs
ne coûtent pas la même chose, donc le doute ne penche pas des deux côtés.

**Des sous-chaînes, pas des expressions régulières, pour `missingSymbol`.** Deux raisons : un auteur
de profil écrit `cannot find` sans se tromper, là où une expression régulière est un piège ; et une
expression de plus serait une surface d'attaque de plus. Le motif de `pattern`, lui, est
indispensable — mais borné.

**La leçon de ce matin appliquée tout de suite.** Le motif vient du dépôt du projet, donc d'une
source non fiable, et j'avais été pris ce matin même par l'explosion des globs. Donc : les
quantificateurs imbriqués (`(…+)+`) sont refusés à la lecture, le motif est plafonné à 300
caractères, et l'application est bornée — 20 000 lignes, 1 000 caractères par ligne, 200 fichiers
rapportés. Un moteur d'expressions régulières ne s'interrompt pas : la seule protection est de ne
jamais lui donner de quoi s'emballer. L'heuristique des quantificateurs imbriqués est **imparfaite
et le commentaire le dit** — ce sont les bornes qui rattrapent ce qu'elle laisse passer.

---

## 26/09 — La revue a trouvé treize défauts, dont deux exploitables

Revue de `packages/stack-adapters` sur la PR #5. Treize constats, tous corrigés. Les quatre qui
méritent d'être retenus.

**Un lien symbolique du dépôt détournait l'écriture d'un canari.** Le contrôle de confinement
était **purement textuel** — `resolve` puis `relative` —, et `resolve` ne suit pas les liens. Un
dépôt portant `tests` → un dossier de l'utilisateur, reproduit fidèlement par `git worktree`, plus
un profil déclarant `file: tests/x.py` : le chemin n'a aucun `..`, donc il passait, et l'écriture
atterrissait dehors avec un contenu choisi par le profil, avant d'être supprimée. Écraser puis
détruire un fichier de l'utilisateur. → `chemin-sur.ts` résout les liens. Et le plus rageant :
`packages/core/src/guards/real-path.ts` existe **pour cette attaque exacte**, je l'ai écrit
avant-hier, et `progress.md` porte déjà la phrase « tout chemin comparé doit passer par
`realPath` ». Je ne l'ai pas appliquée à un chemin que j'**écris**.

**Quatorze globstars figeaient l'application pendant 170 secondes.** `**/` devient `(?:.*/)?`, et
deux `.*` qui se suivent font revenir le moteur sur ses pas de façon exponentielle. Mesuré :
`170,4 s` pour **un seul** `test()`, dans le processus principal, sur un motif venu du `layout` du
dépôt. Les suites de globstars sont maintenant repliées en une — même sens, plus d'explosion.

**Un `testFilePattern` vide faisait de chaque fichier un fichier de test.** `[].join("|")` rend la
chaîne vide, et `new RegExp("")` reconnaît tout. Dans l'extension, `isTestFile` renvoyait alors
vrai partout : la garde qui interdit d'écrire du code de production en phase rouge n'interdisait
plus rien, et l'adaptateur se contredisait lui-même. Le schéma exige désormais un emplacement de
test, et le motif de repli est `(?!)`.

**Je m'étais trompé sur ma propre porte.** J'avais écrit que la porte RED n'accepte que
`assertion` et `missing_symbol`. Elle ne **rejette** que `other_error` : un échec **non classé la
franchit**. Mon oracle notait ce cas en avertissement en affirmant l'inverse du vrai. La règle est
maintenant écrite dans le sens du rejet, pas de l'acceptation — énumérer ce qui est accepté invite
à oublier ce qui passe par défaut. Et l'oracle jugeait **le premier échec seulement**, alors que la
porte s'arrête sur la première entrée qui l'arrange : il juge désormais tous les échecs, le pire
l'emportant.

**Trois autres du même genre**, tous « une porte atteste ce qu'elle n'a pas mesuré » : un rapport
lisible mais **vide** compté comme favorable ; un canari `syntax` silencieusement ignoré par le
lanceur ramené à un avertissement, alors que c'est le pire cas — une suite « verte » sur du code
qui ne compile pas ; et le modèle Python qui routait `ruff` vers le lecteur `eslint-json`, dont le
schéma ne peut rien lire : une porte de lint qui n'aurait **jamais** rien mesuré, sans jamais le
dire. Section `lint` retirée du modèle.

→ La leçon n'est pas neuve, elle est seulement plus précise : **je corrige ce défaut, puis je le
réintroduis ailleurs dans la même semaine.** Trois fois le 24/09, quatre fois ici. Il ne suffit pas
de le chercher là où on vient de le corriger.

---

## 25/09 — `/stack doctor` exécute enfin ce qu'il diagnostique

**Fait.** `Repository.worktree()` dans le paquet workspace, et les canaris branchés dessus. Le
paragraphe où doctor avouait n'avoir rien exécuté disparaît dès que les canaris tournent.

**Trois choix, et chacun protège de quelque chose.**

- *La copie est ouverte hors du projet*, dans `tmpdir()`. Posée dedans, elle se retrouverait dans
  les listages de fichiers, dans les motifs de `layout`, et dans le prochain `git add -A`.
- *Elle part du dernier commit, pas du travail en cours.* Diagnostiquer des fichiers en cours
  d'édition donnerait des résultats qui changent à chaque frappe. La copie éprouve ce qui est
  validé — c'est écrit dans un test, parce que c'est le genre de choix qu'on oublie et qu'on
  prend ensuite pour un bogue.
- *`--detach`*, donc aucune branche créée : rien à nettoyer côté références.

**Le point qui m'importe le plus.** Un échec des canaris — worktree impossible, lanceur absent —
devient un **problème** dans le rapport, pas un silence. Sans ça, doctor conclurait « aucun
problème » sur la foi d'une vérification qui n'a jamais eu lieu. C'est la même erreur que
l'analyseur de forme du 24/09, qui attestait « conforme » pour les langages qu'il ne connaissait
pas. Elle revient sous une forme nouvelle à chaque fois qu'on branche une mesure.

**Détail qui aurait mordu.** `doctor` lance la suite de tests **une fois par canari** : plusieurs
minutes pendant lesquelles l'application semblerait figée. Un message est posté avant de
commencer, qui dit que ça tourne dans une copie isolée et que le travail en cours n'est pas
touché.

**Six doubles de test** ont dû fournir `worktree`. Je les fais **échouer** plutôt que rendre une
racine vide : un double qui ment silencieusement ferait passer des tests qui ne prouvent rien.

**Reste de §8.6** : la proposition par un agent via `submit_stack_profile`, le réessai ciblé à
budget, la relance sur changement du verrou de dépendances.

---

## 25/09 — Le dépôt a enfin une licence

**Décidé (ADR 0023).** Propriétaire — tous droits réservés — sauf `extensions/skraft/`, en
GPL-3.0-or-later. Le dépôt ne déclarait rien du tout : ni `LICENSE`, ni champ `license` dans
aucun des quatorze `package.json`.

**Pourquoi propriétaire.** Deux raisons, et la seconde est la vraie. D'abord c'est ce qui était
**déjà vrai** : sans fichier `LICENSE`, le droit d'auteur s'applique par défaut, tous droits
réservés — ce n'était pas un vide juridique mais l'état le plus fermé qui soit. Ensuite, le choix
n'est réversible que dans un sens : on peut ouvrir plus tard, on ne reprend pas une licence ouverte
une fois publiée. Rien n'obligeait à trancher dans l'urgence le sens le plus coûteux.

**Ce qui fait coexister les deux licences.** L'extension n'est pas livrée avec l'application :
`apps/desktop` ne dépend que de `ext-tdd`, et skraft s'installe à part en `.asx`, dans son propre
processus derrière `ctx`. C'est l'isolation de l'option B de l'ADR 0012 — déjà en place, mais pour
des raisons de sécurité, pas de licence.

**Le point qui compte.** Cet argument tient sur **un fait technique, pas sur une intention**. Un
`pnpm add` distrait suffirait à faire de skraft une dépendance de l'application : la frontière
tomberait en silence, la GPL s'appliquerait à l'ensemble distribué, et **aucune erreur ne se
manifesterait** puisque le code marcherait parfaitement. D'où `licence.test.ts`, qui échoue si
`ext-skraft` apparaît dans les dépendances de l'application — dépendances de développement
comprises, car c'est l'arbre installé qui est distribué, pas l'intention de qui l'a déclaré.
→ Une frontière juridique qui repose sur un fait technique doit être défendue par un test, sinon
elle n'est qu'un souvenir.

**Ce que je n'ai pas prétendu faire.** L'ADR dit en toutes lettres qu'il ne constitue pas un avis
juridique, et il note ce qui manquerait pour une diffusion large : la GPL veut une notice de
licence **par fichier source**, et seuls `roles.ts` et `review.ts` portent aujourd'hui leur
provenance.

**Reste pour `reprise-skraft`** : une seule chose, non technique — verser la pièce d'origine de
l'autorisation. Le dossier porte la déclaration du responsable la rapportant, ce qui l'engage lui
mais ne serait opposable à personne d'autre.

---

## 25/09 — `/stack` existe enfin

**Fait.** Trois formes : `/stack` dit quelle stack le projet emploie et d'où elle vient,
`/stack doctor` diagnostique le profil déclaré, `/stack init` en propose un, le fait approuver,
puis l'écrit. Tout ce qui avait été construit depuis deux jours devient atteignable depuis la
conversation — jusqu'ici c'étaient des fonctions que personne ne pouvait appeler.

**Commande du cœur, pas d'une extension.** Elle décrit le projet lui-même, et doit rester
disponible quand aucune extension n'est installée. Enregistrée dans le registre sous
`extensionId: "agent-studio"`, le même identifiant que les messages système.

**La règle qui gouverne tout le fichier.** Un profil est une liste de commandes exécutées sur la
machine : l'écrire équivaut à élargir des permissions (§8.5). Donc le YAML **complet** est posté
avant la demande — on approuve ce qu'on a lu, pas un résumé — et la confirmation **nomme les
programmes** que le profil lancera, seule information qu'on ne devine pas d'un identifiant de
stack. Sans confirmateur, la commande n'est pas enregistrée du tout : mieux vaut pas de commande
qu'une commande qui écrirait sans accord.

**Ce que doctor dit de lui-même.** Il conclut par ce qu'il n'a **pas** vérifié : rien n'a été
exécuté, les canaris n'ont pas tourné, un profil déclaré sain ici peut encore classer un échec de
travers. Sans ce paragraphe, un rapport tout vert laisserait croire que le profil a été éprouvé
alors qu'il n'a été que relu. C'est la même règle que pour les portes : ne rien attester qu'on
n'ait mesuré.

**Deux détails qui auraient mordu.** `programmeTrouvable` cherche dans le `PATH` sans rien
exécuter — lancer un programme pour savoir s'il existe serait exactement ce que la liste blanche
cherche à éviter. Et `indices()` ne retient que les fichiers de la **racine** : un `pyproject.toml`
enfoui dans un dossier d'exemples ne dit rien de la stack du projet.

**Prochaine étape.** Brancher les canaris sur `doctor`, ce qui demande un `git worktree` —
`runCanaries` reçoit un `sandboxRoot`, il ne le crée pas. Le paragraphe « ce que je n'ai pas
vérifié » disparaîtra alors, remplacé par de vraies mesures.

---

## 25/09 — Les documents d'audit disaient faux

**Fait.** Documents 02, 03 et 04 mis à jour. Le 02 reçoit une section « Suivi au 25 septembre » qui
fait foi ; les deux analyses antérieures sont gardées telles quelles, comme trace de ce qui a été
observé à leur date — on ne réécrit pas un constat daté, on le date mieux.

**Ce que j'ai trouvé.** La branche avait avancé de deux jours (`c82cbbb` → `6b2e7af`) et le plan de
refonte y avait été appliqué. **Aucun des constats C1 à C7, N1 et N2 ne subsiste.** C1 est corrigé
par un pointeur de pipeline actif que la CLI d'état écrit et que les hooks lisent — c'est
exactement la recommandation 3 que notre propre document faisait. C2 par une projection
(`projectDispatchState`) au-dessus d'un état unifié validé par schéma Draft 2020-12. C3 par un
ordre de phases lu de la configuration, qui initialise en RESEARCH. `entryPoint` a purement disparu
du dépôt, ce qui dissout N1.

**Le vrai enjeu, et il touche nos propres textes.** Les documents 03 et 04 justifiaient notre
conception par « leurs garde-fous ne se déclenchent pas ». Cet argument est mort. Je l'ai corrigé
aux trois endroits : la comparaison n'oppose plus un mécanisme qui marche à un mécanisme en panne,
elle oppose **deux endroits où mettre la décision**. → Ne jamais adosser une justification de
conception au défaut passager d'un autre dépôt : le défaut se corrige, et la justification tombe
avec lui. Notre réducteur déterministe a ses raisons propres, qui n'ont jamais eu besoin de ça.

**Piège que j'ai failli commettre.** `pipeline-policy.mjs` lit `dispatchState.specialistDone` et
`.reviewerVerdict`, deux champs absents du schéma d'état — qui, lui, interdit les propriétés
supplémentaires. J'ai cru tenir un défaut sérieux. C'est une projection qui les calcule, une ligne
plus haut dans le service. → Avant d'annoncer une incohérence entre deux fichiers, chercher la
couche qui les relie.

**Réserve assumée.** Tout ce suivi est établi **par lecture seule** : aucune CLI rejouée, aucune
suite de tests lancée. Les constats d'origine distinguaient « vérifié » de « lu dans le code » ;
j'ai respecté cette distinction et l'ai écrite en tête de section plutôt que de laisser croire à
une reproduction.

---

## 25/09 — Reprise skraft : faite, pour l'essentiel

**Le dépôt est arrivé** : `github.com/SebastienDegodez/skraft-plugin`, branche
`refactor/v1.6.0-tracking-substrate`. Donc la **1.6.0 en cours**, pas la 1.5.2 qu'auditait
`docs/02-analyse-technique-skraft-plugin.md` — l'audit ne décrit pas ce que j'ai repris, c'est la
branche qui fait foi. Conditions 1 et 3 remplies ; la 2, la licence de redistribution, ne l'est
toujours pas.

**Repris.** La **synthèse pondérée** (`review.ts`) : quatre questions — complétude, adéquation
métier, qualité, risque — avec leurs poids 0,30 / 0,30 / 0,15 / 0,25, la note au **minimum** des
lentilles qui répondent à une même question, et l'arrêt sur question non couverte. La
correspondance lentille → question vient telle quelle de `software-engineer-reviewer.md`. Puis la
**quatrième lentille** `quality-gates`, et la substance des prompts `researcher`, `acceptance`,
`test`, `dev`.

**L'adaptation qui compte.** Chez eux la synthèse est faite par l'agent réviseur ; ici **le code la
calcule**. C'est plus fort que l'original : la revue se rejoue à l'identique depuis son seul JSON,
et un agent ne peut pas arrondir un verdict. Même logique pour les lentilles : leurs portes sont
nommées dans le prompt là-bas (G4, G7, G11…), exécutées par le code ici.

**Deux familles de règles, et leur ordre est tout.** Les contributions pondérées **éclairent** le
verdict ; les règles de gravité le **décident**. Un calcul ne rattrape jamais une porte. Je l'ai
écrit explicitement dans le code, parce que c'est exactement le genre de nuance qu'une relecture
distraite inverse.

**La règle qui a tout fait bouger.** « Une question non posée ne revient jamais propre » : si
aucune lentille ne traite une question, l'approbation est refusée. Une dizaine de tests en
dépendaient — ils n'employaient qu'une lentille `cold-reader`, qui ne couvre que deux questions
sur quatre. Le banc d'essai devait aussi scripter la quatrième lentille, sans quoi le pipeline
attendait une réponse qui ne venait jamais.

**Écarté sciemment, et c'est le plus instructif.** Les lentilles `contract-fidelity` et
`mock-fidelity` sont conditionnelles et écrites pour .NET — les reprendre aurait relié l'extension
à une pile. Les Object Calisthenics : chez nous le linter du projet en juge (ADR 0022), deux
autorités se contrediraient. Et surtout « un test qui ne tue aucun mutant, supprime-le », qui
**contredit notre règle du test intouchable** : c'est la porte de mutation qui doit le dire, pas
l'agent qui écrit le code et à qui ce test déplaît. → Une reprise n'est pas une transcription :
chaque règle importée doit être confrontée aux règles déjà en place.

**Piège de méthode, entièrement de mon fait.** J'ai lancé la suite complète pendant qu'une autre
exécution de Vitest tournait encore en arrière-plan. Deux tests de reprise ont expiré et la suite
a mis **31 minutes au lieu de 93 secondes**. J'ai d'abord cherché la cause dans mon code. →
Vérifier `pgrep -f vitest` avant de conclure qu'une lenteur ou une expiration vient du code.

**Toujours instable** : `app.test.tsx` « carte de tâche mise à jour en place » expire parfois à
5 s sous charge, et passe 3 fois sur 3 isolément. Connu depuis le 24/09, toujours pas corrigé.

---

## 25/09 — Reprise skraft : le dossier, avant que le dépôt n'arrive

**Demandé.** Faire la reprise du contenu de skraft-plugin, O9/D42 étant tranché (ADR 0012,
option C : l'auteur autorise).

**Pas faisable, et la raison est matérielle avant d'être juridique.** skraft-plugin n'est nulle
part sur le poste, et le paquet n'existe pas sur le registre npm public. On ne reprend pas des
prompts qu'on n'a pas. Reconstituer à partir de `docs/02-analyse-technique-skraft-plugin.md`
serait reprendre l'œuvre par un détour — écarté explicitement dans le dossier, pour que personne
n'y revienne en croyant avoir trouvé une astuce.

**Trouvé en ouvrant le dossier, et c'est plus gênant que la reprise elle-même :** le dépôt
**ne déclare aucune licence**. Pas de fichier `LICENSE`, pas de champ `license` dans les
`package.json`. Or la condition 2 de l'ADR 0012 demande de dire si l'extension `skraft` « reste
sous la licence de l'application » — la formule ne désigne rien. Ça dépasse skraft : ça concerne
la distribution des paquets `.asx` et celle de l'application. Inscrit comme `licence-du-depot`.

**Un critère qui mentait.** `reprise-skraft` se vérifiait par `test -f
docs/licences/autorisation-skraft.md`. Autrement dit, **créer un fichier vide le faisait passer au
vert** — et c'est précisément ce que j'allais faire en ouvrant le dossier. Le `verify` exige
maintenant les trois conditions réunies *et* la disparition des prompts de substitution de
`roles.ts`. → Un critère dont la vérification porte sur l'existence d'un fichier, et non sur son
contenu, se satisfait tout seul.

**Fait quand même, pour que la reprise soit un remplacement et non une enquête.**
`docs/licences/autorisation-skraft.md` recense les trois artefacts concernés, et eux seuls :
les 8 prompts de `ROLES`, les 3 lentilles de `LENS_FOCUS`, et la synthèse sans pondération de
`review.ts`. Tout le reste de l'extension est notre conception et ne bouge pas. Deux garde-fous y
sont posés : un prompt repris ne doit jamais déplacer une décision du code vers le LLM, et chaque
artefact repris doit porter sa provenance dans le code.

**Ce qu'il faut pour débloquer** — trois choses que seul le responsable du projet a : les sources
de skraft-plugin 1.5.2, la pièce écrite de l'autorisation (qui, quoi, quand), et la licence sous
laquelle redistribuer.

---

## 25/09 — J5 : les canaris de `/stack doctor`

**Ce qui a déclenché ça.** J'ai relu §8.6 après coup et j'ai trouvé un écart sérieux : j'avais
nommé une fonction `diagnoseProfile` comme si elle faisait le travail de `/stack doctor`, alors
qu'elle n'en fait que la vérification statique. La spec décrit huit contrôles, **chacun avec son
oracle**, dont des tests canaris. Et le canari `syntax` — « classé `syntax`, jamais `assertion` »
— est exactement le garde-fou qui aurait attrapé le trou du lecteur `junit-xml` trouvé deux
heures plus tôt. La spec avait prévu la parade ; je ne l'avais pas lue.

**Fait.** `canaries.ts` : une section `canaries` dans le profil, un oracle pur (`jugerCanari`) et
l'exécution (`runCanaries`), 24 tests. Le code écrit un canari, lance la commande déclarée, et
vérifie le classement obtenu. Aucun LLM n'est consulté : la bonne réponse est connue d'avance.

**Le raisonnement qui fixe les gravités.** Une seule question : *la porte peut-elle encore
juger ?* Les portes RED acceptent `assertion` et `missing_symbol` comme des rouges légitimes, et
rejettent `other_error`. Donc :

- une erreur de syntaxe classée `assertion` **ou** `missing_symbol` est un **problème** — du code
  qui ne compile pas franchirait la porte ;
- un symbole manquant classé `other_error` est un **problème** aussi, en sens inverse : un cycle
  TDD correct serait refusé ;
- mais confondre `assertion` et `missing_symbol` n'est qu'un **avertissement** : les deux sont
  acceptées, aucune porte n'est trompée, seuls les messages deviennent inexacts.

**Un canari par exécution.** Sinon celui qui ne compile pas empêche les autres de s'exécuter.
C'est cher — cinq lancements de la suite pour un `doctor` complet — et c'est le prix de l'oracle.
Chaque canari porte une marque unique (`{marque}`), sans quoi ses résultats seraient confondus
avec ceux du projet ; le schéma l'exige, sauf pour `syntax` qui n'en produit souvent aucun.

**Le trou que les canaris ont révélé avant même de tourner.** En écrivant le gabarit Swift
`missing_symbol`, j'ai buté : dans un langage compilé, un symbole absent arrête la compilation,
`swift test` ne produit aucun rapport, et **`createProfileAdapter.runTests` lève une exception**
dans ce cas. L'adaptateur Swift écrit à la main, lui, lit les erreurs de compilation et les
classe. Donc un profil ne peut pas produire le rouge légitime du cycle TDD sur un langage
compilé. Inscrit comme `j5-profil-echec-de-compilation`, et `profiles/swift.yaml` ne déclare pas
ce canari en le disant franchement. → Même leçon qu'avant-hier : quand un chemin générique
remplace un chemin spécifique, lister ce que le spécifique faisait **en plus**.

**Ce qui n'est toujours pas fait**, et features.json le dit maintenant : la proposition par un
agent (`submit_stack_profile`), l'approbation des commandes avant exécution, le `git worktree` —
`runCanaries` reçoit un `sandboxRoot`, il ne le crée pas —, le réessai à budget, la relance sur
changement du verrou de dépendances. Et les gabarits livrés n'ont jamais affronté un vrai
lanceur : `canaris-contre-un-vrai-lanceur`.

---

## 25/09 — J5 : l'outillage des profils (init et doctor)

**Fait.** `proposeProfile` et `diagnoseProfile`, dans `stack-adapters`. Toutes deux **pures** :
elles reçoivent ce qu'on a lu du disque — fichiers présents, dépendances déclarées — et rendent un
texte ou des constats. Rien n'est exécuté depuis elles, conformément à la règle sur les politiques.

**Choix.** *init ne devine pas* : sans marque reconnue, il ne propose rien plutôt qu'un modèle au
hasard. *doctor distingue deux gravités* : un programme introuvable est un **problème** — la
commande échouera —, un emplacement vide n'est qu'un **avertissement**, un projet pouvant n'avoir
pas encore de tests d'acceptance. Les constats favorables sont inclus, sinon le rapport n'est
qu'une liste de reproches.

**Pas encore branché.** Aucune commande `/stack` n'existe : la logique est là, le câblage non.
Il faudra l'enregistrer dans le registre de commandes, lister le disque, et écrire le fichier.
Inscrit comme `j5-commande-stack`, pour ne pas croire le jalon plus avancé qu'il n'est.

---

## 25/09 — J5, profils d'exemple : ce qui résiste

**Fait.** `profiles/typescript.yaml` et `profiles/swift.yaml`, valides et testés. Un test les
relit à chaque exécution, pour qu'un exemple faux ne se propage pas.

**Le trou trouvé en chemin, et il était grave.** Mon lecteur `junit-xml` générique ne produisait
pas de `failureKind`. Or `verifyUnitRed` teste `=== "other_error"` : avec `undefined`, la
condition est fausse et **une erreur de syntaxe passait pour un rouge valide**. Un projet piloté
par profil aurait eu une porte RED aveugle. `parseXunit` capture désormais le message de
`<failure>`, et le lecteur classe l'échec. Les motifs d'assertion, écrits pour Vitest, ont dû être
élargis : `XCTAssert…` n'était pas reconnu, tout échec Swift aurait été classé « mauvaise raison ».
→ Même leçon qu'hier, sous une autre forme : quand un chemin générique remplace un chemin
spécifique, lister ce que le spécifique faisait **en plus**, et le refaire ou le dire.

**Deux limites assumées, inscrites dans features.json.** La détection ne regarde que l'existence
de fichiers, jamais leur contenu — l'adaptateur TypeScript vérifie `vitest` dans le package.json,
un profil ne sait pas. Et l'analyse des imports n'a pas de section : avec un profil,
`ctx.stack.architecture()` renvoie null et la porte dit qu'elle n'a rien vérifié.

**Donc les profils ne remplacent pas encore les deux adaptateurs**, et `profiles/README.md` le dit
franchement. Ils montrent ce qu'un projet tiers peut déclarer aujourd'hui, ce qui est déjà l'essentiel.

---

## 25/09 — J5, brique 4 : le profil est enfin lu par l'application

**Fait.** `.agent-studio/stack.yaml` est lu à l'ouverture d'un projet et l'emporte sur la
détection. La chaîne est complète : admin.json → `allowedPrograms` → `parseStackProfile` →
`createProfileAdapter` → `ctx.stack`. Un projet peut donc décrire sa stack sans qu'une ligne de
TypeScript soit écrite pour lui — ce qui était tout l'objet du jalon.

**Choix.** *Un profil refusé n'interrompt pas l'ouverture.* Il est expliqué dans la conversation,
champ et valeur fautive nommés, et la détection reprend la main. Empêcher d'ouvrir le projet pour
un YAML mal écrit serait disproportionné, et l'utilisateur ne saurait pas quoi corriger.

**Piège évité de justesse.** J'ai failli conclure la brique sans brancher `allowedPrograms` dans
`index.ts` : les tests passaient, puisqu'ils le passent eux-mêmes. En vrai, la liste serait restée
vide et **tout profil aurait été refusé** — un jalon livré qui ne marche pas. → Quand une option
traverse plusieurs couches, vérifier le câblage de production, pas seulement les tests.

**Prochaine étape.** Réécrire les adaptateurs Swift et TypeScript en profils d'exemple
(`j5-profils-exemple`) : c'est ce qui prouvera que l'adaptateur générique suffit. Puis le lecteur
TAP, puis `/stack init` et `/stack doctor`.

---

## 25/09 — J5, brique 5 : la liste des programmes autorisés

**Fait.** `admin.json` porte `allowedPrograms` (D47, O12). Liste par défaut : lanceurs de tests,
linters, outils de mutation. Ni interpréteur (`bash`, `node`), ni client réseau (`curl`), ni outil
capable d'écrire hors du projet.

**Trois choix qui méritent d'être connus.**

- *Le fichier de l'administrateur remplace la liste, il ne s'y ajoute pas.* Un poste administré
  doit pouvoir **restreindre**, pas seulement élargir ce que nous avons jugé raisonnable. Une
  liste vide est donc un choix valide : elle interdit tout profil de stack.
- *Un nom avec chemin est refusé.* `/usr/local/bin/pytest` ou `./script` échapperaient à la liste
  par le chemin ; seul un nom de commande est accepté.
- *Une configuration refusée n'autorise rien.* Retomber sur la liste par défaut appliquerait des
  permissions que l'administrateur n'a jamais relues.

**Prochaine étape.** Le préalable est levé : on peut brancher la lecture de
`.agent-studio/stack.yaml`, en lui passant la liste de l'admin, et poster le refus éventuel dans
la conversation — le canal existe depuis hier.

---

## 25/09 — J5, briques 1 et 2 : les profils de stack

**Où j'en suis.** Branche `feat/j5-profils-de-stack`, quatre commits non poussés. Un projet peut
désormais décrire sa chaîne en YAML (`parseStackProfile`), et un `StackAdapter` complet se
construit à partir de cette déclaration (`createProfileAdapter`). Rien n'est branché sur
l'application : aucun profil n'est encore lu depuis un dépôt.

**La prochaine étape, dans cet ordre.** D'abord la liste des programmes autorisés (`admin.json`),
*ensuite* le chargement du profil. Pas l'inverse : le profil vient du dépôt du projet, donc d'un
fichier que l'agent peut modifier. Le schéma réclame déjà `allowedPrograms`, mais personne ne le
remplit — brancher la lecture avant d'avoir la liste blanche ouvrirait l'exécution de n'importe
quel programme.

**Décisions prises, et pourquoi.**

- *Deux jetons, pas un langage de substitution.* Seuls `{rapport}` et `{fichiers}` sont remplacés
  dans les arguments. Tout le reste passe tel quel, sans shell. Un profil ne doit pas pouvoir
  fabriquer une commande par interpolation.
- *Les lecteurs de rapport sont nommés, et seulement ceux qui existent.* J'avais d'abord annoncé
  `tap` avant de l'écrire ; je l'ai retiré. Annoncer un format qu'on ne sait pas lire, c'est le
  mensonge qu'on passe son temps à corriger ailleurs.
- *Une capacité non déclarée est `undefined`*, pas une méthode qui échoue. La porte voit
  l'absence et le dit, comme avec les adaptateurs écrits à la main.
- *`globToRegExp` est descendu* de `extension-api` vers `stack-adapters` : c'est le paquet le plus
  bas qui en a besoin, et l'importer en sens inverse créait un cycle. `extension-api` le réexporte,
  donc le contrat des extensions ne bouge pas.

---

## 24/09 — La journée où l'application a tourné pour la première fois

Elle n'avait jamais été lancée à l'écran. Quatre bugs sont apparus aussitôt, qu'aucun test ne
pouvait attraper. Deux revues ont ensuite trouvé dix-neuf défauts. Voilà ce que j'en retiens.

### Les pièges, par ordre d'utilité

**Les doubles en mémoire masquent les bugs de persistance.** J'ai ajouté deux clés à
`AppSettings` sans toucher au schéma zod de la store JSON : zod les écartait à la lecture, et
comme le contrôleur enregistre par `{ ...(await load()), x }`, **chaque sauvegarde effaçait les
autres clés**. Mes tests utilisaient une fausse store en mémoire, donc ne voyaient rien. → Quand
on ajoute un champ persisté, écrire un test sur la *vraie* store, aller-retour disque compris.

**React `<StrictMode>` lance tout deux fois, en parallèle.** Trois courses en sont nées :
`workspace:current`, `chat:start`, `ensureRuntime`. Le remède est chaque fois le même — partager
une promesse en cours — mais je l'ai appliqué trois fois de suite après avoir cru chaque fois en
avoir fini. → Chercher les autres appelants du même motif *avant* de conclure.

**macOS : `/var` et `/tmp` sont des liens symboliques.** Sous `--permission`, Node compare les
chemins **tels que fournis**, sans les résoudre : `--allow-fs-read=/var/…` n'autorise rien.
17 tests échouaient pour cette seule raison, et ce n'était pas un défaut de test — une extension
installée sous un chemin traversant un lien refusait de s'activer. Le même oubli traînait dans les
gardes de périmètre : un lien posé *dans* le projet permettait d'écrire dehors. → Tout chemin
comparé doit passer par `realPath`.

**Une porte qui ne mesure rien ne doit rien attester.** L'analyseur de forme ne connaissait que
Swift et TypeScript ; ailleurs il rendait zéro motif, et la porte en concluait « conforme », ce
qu'elle versait aux lentilles de revue — qui ont consigne de ne pas revérifier les faits. En le
remplaçant par le linter du projet, **j'ai réintroduit le même défaut par trois chemins**
(repli `|| "[]"`, filtre de sévérité SwiftLint, fichier ignoré par ESLint). → À chaque capacité
branchée sur un outil externe, se demander : que se passe-t-il quand l'outil échoue, est muet, ou
n'examine pas ce qu'on lui donne ?

**`process.execPath` est le binaire Electron dans l'application**, pas Node. Lancer les tests
aurait ouvert une seconde fenêtre. Invisible en test, puisque Vitest fait tourner l'adaptateur
sous Node. → `env: { ELECTRON_RUN_AS_NODE: "1" }` sur tout `spawn(process.execPath, …)`.

**Les tests instables se stabilisent, ils ne se tolèrent pas.** Deux échouaient au hasard sous
charge parallèle. Depuis que la CI tourne à chaque poussée, ils auraient rougi sans raison.

### Décisions tranchées ce jour-là

O9/D42 (licence skraft, option C), O6 (SQLite aligné sur VS Code, ADR 0019), D38 (choix du modèle,
ADR 0020), skraft distribuée en `.asx` (ADR 0021), qualité de forme au linter du projet (ADR 0022).

### Choses vraies qu'il ne faut pas réapprendre

- Le **jeton Copilot** est OAuth et fonctionne ; Electron tourne sur macOS ; `utilityProcess.fork
  --permission` fonctionne. Les trois blocages historiques de J1 sont levés.
- Le **Copilot CLI n'honore pas le modèle demandé** : ni à la création de session, ni par
  `setModel()`, accepté puis ignoré. L'API, elle, le respecte — c'est l'intégration CLI qui
  restreint. Mesures dans l'ADR 0020.
- **`node:sqlite` fonctionne dans Electron 44** (Node 24.21), sans module natif à recompiler.
- La doc suit les décisions mais **pas les renoncements** : ce sont les specs d'origine qui
  mentaient, jamais les ADR ni les bilans.
