# Audit : passage entre portes, lentilles et contrôles dans skraft

- Date : 2026-10-10, branche `feat/workflow-rejouable`.
- Portée : l'**extension** skraft (`extensions/skraft/src/`, réducteur et sous-machine DELIVER) et
  le **workflow** skraft (`workflows/skraft/`). Les deux sont indépendants (ADR 0054) : un défaut
  commun se corrige **deux fois**.
- Méthode : lecture du code comparée à `docs/specs/SPEC-skraft.md`. Chaque constat marqué
  « test » a été reproduit par un test jetable : appels directs à `transition` pour l'extension,
  vrai moteur de rejeu sur un disque en mémoire pour le workflow. Ces tests sont supprimés et le
  dépôt n'est pas modifié. Aucun appel à Copilot.
- Statut : **constats et propositions**. Corrigés : D1 (ADR 0059), D2, D3 (ADR 0064), D6, D4 (ADR 0063), D5 (ADR 0062), D7, D8, D9, D10, D11, D12, D14, D15, D22 (ADR 0065), D23.

Légende : **E** = extension, **W** = workflow, **E+W** = les deux.

---

## 1. Synthèse

Deux causes reviennent dans presque tous les constats :

1. **Un état qui survit au rembobinage.**
   - Dans l'extension, ce sont des champs de l'état que le rollback ne remet pas à zéro :
     `acceptanceHash`, `adrs`, `reviewThreads`, `lastRejection`, `artifacts`.
   - Dans le workflow, ce sont des variables JavaScript modifiées pendant un essai rembobiné :
     `d.acceptanceHash`, `d.adrs`, `suivi.livrables`, `suivi.revues`, `L.baseline`,
     `L.unitTestsHash`, `L.dernierVert`. Le disque revient en arrière, la mémoire non.
2. **Un échec imputé au mauvais rôle, ou un motif qui n'atteint personne.**
   - Une lentille en échec fait payer le producteur.
   - Un rejet de DELIVER ne touche aucun agent quand tout est déjà vert.
   - Le motif d'une phase sautée est envoyé à la phase suivante.

Priorités proposées :

- **D1** : le gel des tests d'acceptance bloque DELIVER sans issue.
- **D11** : le découpage en étapes du workflow fausse la comparaison de `docs/10`.
- Ces deux points passent avant la campagne US-2.
- Ensuite viennent D2 à D6, communs aux deux, puis les défauts propres à chaque implémentation.

---

## 2. Défauts graves communs (E+W)

### D1 — Le gel des tests d'acceptance n'est jamais mis à jour

- **Où** :
  - W : `workflows/skraft/distillation.mjs:72-75` ;
  - E : `extensions/skraft/src/reducer.ts:159`.
- **Ce qui se passe** : l'empreinte des tests d'acceptance est prise **une seule fois**, quand la
  porte de DISTILL passe, **avant la revue**. Elle n'est jamais recalculée, ni effacée au
  rembobinage. La liste `regressions` est figée de la même façon.
- **Scénarios** (test, E et W) :
  - **Revue de DISTILL** : la lentille *test-integrity* demande de corriger un test d'acceptance.
    L'agent reçoit à la fois « tests gelés, ne les modifie jamais » et « corrige ce test ». S'il
    corrige, l'empreinte reste l'ancienne.
  - **Escalade, puis « relancer »** : DISTILL est rembobinée et les tests sont réécrits, mais
    l'empreinte garde celle de l'essai effacé.
  - **Escalade, puis « sauter »** : l'empreinte d'un état rembobiné est gardée.
- **Conséquence** : au démarrage de DELIVER, la vérification du gel lève une panne
  d'environnement : « Les tests d'acceptance ont changé depuis DISTILL ».
  - W : `livraison.mjs:118` ; E : vérification de gel.
  - « Relancer » reproduit la panne : seuls « sauter » et « abandonner » en sortent.
- **Proposition** :
  - Poser le gel **au commit de DISTILL**, une fois la revue approuvée, et plus à la porte.
  - Pendant DISTILL, recalculer l'empreinte à chaque passage de porte, en écrasant la précédente :
    elle sert alors aux faits de revue, pas au gel.
  - Ne présenter la consigne « tests gelés » qu'à partir de DELIVER.
  - Au rembobinage ou au saut de DISTILL, remettre l'empreinte et `regressions` à zéro :
    - E : dans la fonction unique qui fabrique `rollback` + `forgetSessions` ;
    - W : la phase rend l'empreinte comme valeur de `w.phase`, qui est journalisée, au lieu de
      modifier `d` depuis l'intérieur d'un essai.
  - Une phase DISTILL sautée ne gèle rien. DELIVER doit alors le dire, au lieu de comparer à une
    empreinte d'un état effacé.

### D2 — ADR fantômes après un rembobinage ou un saut de DESIGN

- **Où** :
  - W : `conception.mjs:78-83`. `porteCoherence` ajoute l'ADR à `d.adrs`, et `connus.has(id)`
    empêche ensuite d'enregistrer un nouveau chemin.
  - E : `reducer.ts:151`, `:213`, `:337` (`GATE_OK`, `known`).
- **Scénarios** (test) :
  - **W** :
    1. L'architecte écrit `adr-001-plafond-domaine.md`.
    2. La revue rend REJECTED, d'où une escalade et « relancer ».
    3. L'architecte écrit `adr-001-plafond-interface.md`.
    4. La ratification présente l'ancien chemin et `statuerAdrs` lit un fichier effacé. Le script
       finit en échec : « absent : docs/adr/adr-001-plafond-domaine.md ».
  - **E** :
    1. Deux REJECTED, puis une escalade, puis « sauter ».
    2. L'ADR effacé reste « proposé » et la tâche passe en RATIFICATION.
    3. Si l'humain accepte, DESIGN est commitée et figure à la fois dans les phases terminées et
       dans les phases sautées.
- **Proposition** :
  - Ne garder les ADR proposés d'une phase que dans l'essai qui les a produits.
  - Au rembobinage ou au saut, revenir à la liste du début de la phase.
  - Dans W, relire la liste depuis le disque (`docs/adr/` + ligne `Story : <slug>`, ADR 0055),
    plutôt que la tenir en mémoire. Le disque est rembobiné, lui.
  - Une phase sautée ne passe jamais en RATIFICATION.

- **Corrigé le 2026-10-11**, dans l'extension et dans le workflow :
  - W : la liste des ADR est relue sur le disque (`adrsDuDisque`), à la porte cohérence et après
    chaque rembobinage de DESIGN (escalade, saut) ;
  - E : la liste est prise à l'entrée de la phase (`adrsAvantPhase`) et restaurée à chaque
    rembobinage ou saut ; au `GATE_OK`, les propositions sont celles que la porte vient de lire.

### D3 — Un ADR accepté peut être réécrit et rester « Accepted » sans nouvelle ratification

- **Où** :
  - W : `conception.mjs:137-158`. Le statut n'est écrit qu'à la fin, par `statuerAdrs`.
    Entre-temps le fichier dit `Proposed`, et `controlerAdrs` (l.115) le juge donc modifiable.
  - E : même mécanisme.
- **Scénario** (test W) :
  1. La ratification accepte ADR-001 et demande d'amender ADR-002.
  2. La revue de l'amendement demande des changements.
  3. À l'essai suivant, l'architecte réécrit la Décision d'ADR-001.
  4. Seul ADR-002 est re-ratifié, et le fichier final porte « Statut : Accepted » sur une décision
     que personne n'a acceptée.
- **Proposition** :
  - Écrire `Accepted` dans le fichier **dès la ratification de cet ADR**, avant les amendements des
    autres.
  - La règle existante, « modifiable seulement s'il est Proposed et du même slug », protège alors
    l'ADR accepté.
  - À défaut, enregistrer l'empreinte de chaque ADR accepté et refuser à la porte toute
    modification.

- **Corrigé le 2026-10-11 (ADR 0064)**, dans l'extension et dans le workflow : statut écrit dès
  la décision, ADR décidé en lecture seule pour les agents, exclu des vérifications « nouvel ADR »
  de la porte. Reste lié : D2 (la mémoire n'est pas remise au point d'un rembobinage).

### D4 — Une lentille en échec fait payer le producteur

- **Où** :
  - W : `revue.mjs:45-46` (`throw new TourInterrompu`), puis `aides.ts:41-44` ;
  - E : `reducer.ts:191`, `REVIEW` / `TIMEOUT` → `failure` ; une lentille bloquée ou muette
    devient TIMEOUT (`task-engine.ts:153`) ;
  - même message après un dépassement de délai pendant la porte de phase (E `:169`).
- **Ce qui se passe** : une lentille dépasse son délai, pose une question bloquante ou ne rend
  rien. Un essai de la phase est consommé, le spécialiste refait toute la phase (pour DESIGN, à
  partir de la modélisation), et il reçoit « Le tour précédent a été interrompu, reprends-le ».
  Or ce n'est pas son tour qui a été interrompu.
- **Exemple** (W, DESIGN, US-2, « medium-hard », 3 essais) :
  1. L'architecte livre, les portes passent.
  2. `cold-reader` et `test-integrity` approuvent. `architecture` pose une question : « Le palier
     s'applique-t-il par ligne ou par commande ? ».
  3. `TourInterrompu` est levé, l'essai 1 est consommé, et l'architecte refait la phase avec
     « reprends ton tour interrompu ».
  4. Même scénario aux essais 2 et 3, puis escalade.
  5. Bilan : budget entier consommé, trois modélisations payées, et une escalade sur une phase
     qui était bonne. La question portait sur la story, pas sur le travail de l'architecte.

- **Décision (2026-10-10, avec l'utilisateur)** :
  - **Une question de lentille va à l'utilisateur.** Elle suit le même chemin que les
    questions bloquantes des producteurs. La réponse rejoint les réponses de la story, donc les
    dossiers de passation des phases suivantes.
  - **Toute la phase est rejouée**, car la réponse peut changer la conception.
    - Le producteur repart avec le motif « Question de la revue (<lentille>) : … — Réponse de
      l'utilisateur : … ».
    - Il **amende** son travail. Comme pour un rejet de porte, le dépôt n'est pas rembobiné
      (ADR 0040).
    - Puis les portes repassent, et la revue complète avec **toutes** les lentilles.
  - **Ce rejeu ne consomme pas d'essai.** Ce n'est pas un échec du producteur mais une
    information nouvelle, comme une question ouverte.
  - **Bornes**, puisque le budget ne borne plus :
    - une question déjà répondue (questions ouvertes, blocages, revues précédentes) est refusée
      par le code ;
    - au-delà de **2 questions de revue par phase**, on escalade.
  - **Délai dépassé ou sortie absente** (lentille en panne, sans question) : on relance **la
    seule lentille**, une fois. Sans le budget du producteur. Si elle échoue encore, on escalade
    avec « revue impossible : <lentille>, <raison> ».
  - Le motif « reprends ton tour interrompu » n'est jamais envoyé à un producteur dont le tour
    s'est terminé normalement.

- **Mise en œuvre** :
  - **W** :
    - `reviser` (`revue.mjs:43-47`) lève une erreur dédiée qui porte la question ;
    - `essayer` (`aides.ts`) pose la question par `w.humain` (journalisé : le rejeu la rejoue),
      puis relance l'essai **sans l'incrémenter** ;
    - une lentille en panne est relancée seule dans `reviser`.
  - **E** :
    - nouveau chemin `REVIEW → BLOCKED → SPECIALIST`, avec la question et la réponse dans le
      motif, sans toucher à `attempts` ;
    - aujourd'hui, le blocage d'une lentille devient un `TIMEOUT` (`task-engine.ts:153`).
  - **Trace** : `w.rejet("question de revue", [question, réponse])` d'un côté, `lastRejection`
    de porte `question de revue` de l'autre. Ainsi le banc (`docs/10`) attribue ce rejeu à sa
    vraie cause.
  - **Tests** : chaque implémentation doit couvrir trois cas : la question, le rejeu non compté,
    et l'escalade à la 3ᵉ question.

- **Corrigé le 2026-10-11 (ADR 0063)**, dans l'extension et dans le workflow, avec une
  rectification : les lentilles n'avaient pas `report_blocker`, l'exemple ci-dessus ne pouvait pas
  se produire. Seul le silence d'une lentille faisait payer le producteur. Les lentilles reçoivent
  l'outil, et la décision ci-dessus est appliquée ; en DELIVER, seule la revue est relancée.

### D5 — En DELIVER, un rejet n'atteint aucun agent quand tout est déjà vert

- **Où** :
  - E : `reducer.ts:288-293`, `:318` ;
  - W : `livraison.mjs:58-62` et `:201-205`.
- **Ce qui se passe** : l'échec relance tout le plan de livraison. Si les tests d'acceptance sont
  déjà verts, chaque scénario passe directement à sa porte de fin, puis vient une nouvelle revue
  sur le même code. Les motifs ne servent qu'aux scénarios encore rouges.
- **Cas concernés** :
  - une revue avec seulement des défauts mineurs ;
  - un délai dépassé pendant la revue ;
  - une porte de phase en échec ;
  - deux échecs de mutation.
- **Conséquence** : un essai, même l'essai garanti de l'ADR 0042, est consommé sans que personne
  ne travaille (test E : `attempts` passe de 2 à 3 sans aucun tour d'agent).
- **Proposition** :
  - Si aucun scénario n'est rouge, envoyer les motifs à une **correction ciblée**, au testeur ou
    au développeur selon la cible : défauts de revue, mutation, porte de phase.
  - S'il n'y a pas de cible, escalader sans consommer d'essai.
  - Ne jamais compter un essai qui n'a fait travailler aucun agent.
- **Nouveau déclencheur (commit `036016a`, ADR 0060)** : la porte « couverture du diff » mesure
  tout ce que la tâche a modifié, y compris les squelettes écrits en DISTILL, que seule la porte de
  fin de phase voit.
- **Corrigé le 2026-10-11 (ADR 0062)**, dans l'extension et dans le workflow :
  - mutation, couverture du diff → testeur ; suite finale → développeur (correction ciblée) ;
  - revue à défauts mineurs seulement → mineurs corrigés comme des majeurs ;
  - revue sans aucun défaut, aucun livrable → escalade sans consommer d'essai.
  Reste : le délai dépassé pendant la revue rejoue la phase (pour relancer la revue).

### D6 — Les lentilles reçoivent des faits périmés et les anciens rapports de revue

- **Où** :
  - W : `revue.mjs:77`, `:95-96`, `:105` ; `review-brief.mjs:117` ; `distillation.mjs:70` ;
  - E : `artifacts[phase]`, `effects.ts:444`.
- **Ce qui se passe** (test W) :
  - Après une escalade puis « relancer », le suivi des livrables garde ceux du run effacé, et la
    numérotation des essais repart à 1. `latestArtifacts` choisit le numéro le plus haut, celui
    du run effacé.
  - La lentille reçoit alors « porte validée à l'essai 2 (sha256 48cb…) » pour un contenu
    effacé, présenté comme « acquis : ne le revérifie pas ».
  - Les rapports `*-review-<n>.json|md` sont enregistrés comme livrables et soumis aux lentilles.
    Le commentaire dit pourtant « rapports de revue exclus ».
- **Proposition** :
  - Remettre à zéro le suivi des livrables et des revues au rembobinage de la phase.
  - Exclure `/reviews/` dès l'enregistrement des livrables, pas seulement des changements.
  - Numéroter les essais sans jamais revenir en arrière, au moins dans les noms de rapport (voir
    D8).
- **Corrigé le 2026-10-11**, dans l'extension et dans le workflow :
  - les rapports de revue (`/reviews/`) ne sont plus enregistrés comme livrables ;
  - au rembobinage, les livrables du run effacé ne nourrissent plus les faits. W : le suivi des
    livrables est vidé dans `apresRembobinage`. E : la liste reste en ajout seul (invariant 4,
    §5.3) ; `debutDuRun` marque où commence le run en cours, et `artifactsDuRun` ne lit que lui.
  - Le suivi des revues n'est pas remis à zéro : la numérotation des défauts entrerait en collision
    avec les fils conservés. La numérotation des rapports reste à traiter avec D8.

---

## 3. Défauts communs moins graves (E+W)

### D7 — En correction ciblée, un développeur qui conteste tout est refusé

- **Où** : W `livraison.mjs:401`, même règle dans E.
- **Ce qui se passe** (test W) : la règle « aucun fichier de production modifié » s'applique aussi
  au pas `fix`. Pourtant la consigne invite à contester ou à déclarer `outOfScope`. Une
  contestation motivée est refusée 3 × 3 fois, puis escalade, et la lentille n'arbitre jamais.
- **Proposition** : au pas `fix`, accepter de ne rien modifier si **chaque** défaut reçu a une
  réponse `contested` ou `outOfScope`. Le fil part alors en arbitrage.
- **Corrigé le 2026-10-11**, dans l'extension et dans le workflow, comme proposé : `allDisputed`
  (`review-thread`) vrai si chaque défaut actif du développeur a une réponse `contested` ou
  `outOfScope` motivée (un défaut maintenu par l'humain ne compte pas). Il faut en plus qu'aucun
  test rouge de la correction côté tests ne reste à faire passer. Extension : le réducteur pose
  `nothingToChange` sur `verifyUnitGreen` ; workflow : `porteVerte` le calcule.

### D8 — Rapports de revue écrasés ou ressuscités

- **Où** : W `revue.mjs:50-53`, `conception.mjs:22-23`.
- **Ce qui se passe** :
  - Dans la boucle d'amendement, deux revues portent le même numéro d'essai : `design-review-<n>`
    est écrasé.
  - Après une relance, les rapports du run effacé sont réécrits avant le commit.
- **Proposition** : un compteur de revues propre à la phase, qui ne revient jamais en arrière, et
  une remise à zéro de `suivi.revues` au rembobinage.
- **Corrigé le 2026-10-11**, dans le workflow **et dans l'extension**, qui avait les deux défauts
  (vérifié par test). Un rapport est nommé par son **rang** dans la phase (`suivi.revues`,
  `state.reviews[phase]`), qui ne recule jamais, et non plus par le numéro d'essai. `suivi.revues`
  n'est pas vidé, parce que son rang numérote aussi les fils de défauts. Un marqueur de début de
  run (`suivi.debutDuRun` posé par `oublierLeRun`, `debutDesRevues` posé par `oublierLaPhase`)
  limite la réécriture avant le commit aux revues du run en cours.

### D9 — Après une question bloquante, la relance perd le motif du rejet

- **Où** : E `reducer.ts:137-138` ; W `workflow.mjs:299`, `revue.mjs:31`.
- **Ce qui se passe** (test E) : le spécialiste est relancé avec un retour vide. C'est atténué
  quand la session de l'agent est conservée. Dans les deux implémentations, les réponses
  humaines d'une phase effacée restent aussi dans les dossiers de passation suivants.
- **Proposition** :
  - Garder le dernier motif jusqu'à la fin de l'essai, question comprise.
  - Rattacher chaque réponse humaine à sa phase, et l'oublier si la phase est rembobinée.
- **Corrigé le 2026-10-11** (premier point), dans l'extension et dans le workflow :
  - L'agent repart avec la réponse **et** le motif qu'il corrigeait (rejet de porte, amendement,
    question de revue, pas refusé).
  - Extension : `lancer` garde le retour dans `state.retour` ; en DELIVER, `deliver.feedback` est
    tenu par `agent`.
  - Workflow : les boucles de `specialiste`, `agentDuPas` et RESEARCH ne vident plus leur retour.
- **Second point écarté** sur décision du responsable du projet. Les réponses aux questions sont
  gardées et réutilisées dans tout le processus, même après un rembobinage. Une réponse métier
  reste vraie ; l'oublier ferait reposer la question à l'humain.

### D10 — Contrôles faibles des tests unitaires

- **Où** : W `porteRouge`, `porteCorrectionTests`, `livraison.mjs:478` ; même logique dans E.
- **Ce qui se passe** (lecture) :
  - Un test unitaire existant peut être affaibli sans être détecté : seul le passage de réussi à
    échoué est refusé.
  - `checkRedGreenSequence` compte aussi les preuves des essais rembobinés.
- **Proposition** :
  - Vérifier l'empreinte des tests unitaires existants aussi aux pas de test, en n'autorisant que
    des ajouts.
  - Ne compter que les preuves postérieures au point de reprise.
- **Corrigé le 2026-10-11** (premier point), dans l'extension et dans le workflow, en tenant
  compte d'un cas légitime : une lentille peut demander de **renforcer** un test faible.
  - Le cœur donne, par fichier modifié, le nombre de lignes retirées ou remplacées (`removed`,
    lu dans les hunks de `git diff`). Zéro veut dire que le fichier n'a reçu que des ajouts.
  - Au pas `test`, un test unitaire existant ne reçoit que des ajouts.
  - Au pas `fix-test`, il peut être modifié s'il est cité par un défaut actif adressé au testeur.
    La revue suivante voit la modification, puis la mutation de fin de DELIVER la mesure. La
    consigne du pas l'autorise désormais.
- **Second point vérifié sans effet.** La porte de fin de scénario lance les tests **avant** de
  lire les preuves. Le vert vient donc toujours de sa propre exécution, et un test rouge à ce
  moment est déjà refusé (« suite rouge »). Le rouge de l'essai en cours est exigé par la porte du
  pas rouge. Une preuve d'un essai effacé ne peut pas faire accepter ce que l'essai en cours
  refuserait. Aucun test ne peut échouer sans le filtrage, donc rien n'est modifié.

---

## 4. Propres au workflow (W)

### D11 — Trace et découpage en étapes : la comparaison est faussée

- **Où** :
  - `workflow.mjs:190` : `w.etape("ROUTE")` ;
  - `revue.mjs:68-69` : REJECTED → `Escalade` sans `w.rejet` ;
  - `distillation.mjs:60` : plan de test absent.
- **Ce qui se passe** :
  - `ROUTE` est annoncé **même sans question ouverte**. L'extension, elle, n'y entre que s'il
    reste des questions. Dans le banc, le workflow a donc une étape QUESTIONS de plus (`docs/10`
    §3).
  - Un verdict REJECTED ne laisse aucune entrée `rejet` : la cause n'existe que dans le texte de
    l'escalade.
  - « Plan de test absent » est tracé sous la porte `valeurs`. C'est aussi le cas dans E.
- **Proposition** :
  - `if (vue.questions.length) await w.etape("ROUTE")`.
  - `await w.rejet("revue", […défauts])` avant `throw new Escalade`.
  - Une porte nommée `plan de test`, dans les deux implémentations.
- **Corrigé le 2026-10-11**, avec une rectification : `w.etape` n'écrit rien dans la trace, et
  ROUTE n'y apparaît que si une question est posée pendant l'étape. Le banc ne voyait donc pas
  d'étape QUESTIONS en trop ; seul le journal (et la phase affichée) l'annonçait. Corrigé quand même,
  avec un test sur le journal. REJECTED est tracé sous la porte « revue » avec les lentilles qui
  rejettent (workflow : `w.rejet` ; extension : `rejections` et `lastRejection`, ce qui règle aussi
  la partie REJECTED de D21). « Plan de test absent » a sa porte `plan de test` dans les deux.

### D12 — Échec d'une correction ciblée : état non restauré, correction impossible

- **Où** :
  - `livraison.mjs:631-656` (`corriger`) : seul `s.fils` est restauré ;
  - `L.baseline`, `L.unitTestsHash` et `L.dernierVert` sont fixés par `porteCorrectionTests`
    (l.718-720) et par `porteVerte` (l.435-436).
- **Scénarios** (test) :
  - **Cas a** :
    1. Le défaut est renvoyé au testeur, qui ajoute u2, et l'empreinte est prise avec u2.
    2. Le développeur échoue et la correction est rembobinée.
    3. À la reprise, chaque pas `fix` est refusé : « Les tests unitaires ont été modifiés ».
    4. 3 × 3 refus, puis escalade.
    - L'empreinte périmée existe aussi dans E (`deliver-machine.ts:275`).
  - **Cas b** :
    1. Le testeur ajoute u2, le développeur échoue, la correction est rembobinée.
    2. À la reprise, la porte refuse trois fois : « Des tests existants ont disparu : u2 ».
    - E remet `baseline: d.scenarioBaseline`.
- **Proposition** :
  - Prendre un **instantané** de `L` au point de reprise de la correction et le restaurer au
    rembobinage.
  - Plus généralement, offrir dans la bibliothèque une aide qui associe un objet à un point de
    reprise, pour que tout rembobinage restaure aussi la mémoire.
- **Corrigé le 2026-10-11** par le correctif ciblé.
  - Workflow : `corriger` photographie `L.unitTestsHash`, `L.baseline` et `L.dernierVert` à son
    entrée, et les restaure à chaque rembobinage, comme `s.fils`.
  - Extension : elle avait l'empreinte périmée, que le test confirme. `startReviewFix` prend
    `scenarioBaseline` et `scenarioUnitTestsHash` au point d'entrée de la correction, et chaque
    reprise les rend. Cela corrige aussi D23.
  - L'aide générale de la bibliothèque n'est pas faite ; elle reste à décider.

### D13 — Après un réessai de toute la phase DELIVER, plus aucune correction ciblée

- **Où** : `livraison.mjs:62` (`planifier` rend `dernierVert: null`), `:201-205`, `:568`, `:591`.
- **Ce qui se passe** (test) : un scénario déjà vert ne pose pas `dernierVert`, donc la condition
  `L.dernierVert && …` est toujours fausse. Le développeur n'est jamais appelé en correction, et
  la revue suivante escalade. E pose `stepCheckpoint` même pour un scénario déjà vert
  (`deliver-machine.ts:64`).
- **Proposition** : poser `dernierVert` au début de chaque scénario, comme E.

### D14 — Une panne pendant une correction rembobine toute la phase DELIVER

- **Où** : `livraison.mjs:643-645`. `corriger` n'attrape que `ScenarioEchoue` ; la
  `PanneEnvironnement` remonte jusqu'à `w.phase`.
- **Ce qui se passe** (test) : sur une panne au vert de la correction, « relancer » refait tous
  les scénarios. Cela contredit l'écart assumé : « relancer reprend la correction ».
- **Proposition** :
  - Attraper la panne dans `corriger`.
  - Escalader avec une question propre à la correction.
  - Sur « relancer », revenir au point de reprise de la correction et pas à celui de la phase,
    comme `escalateDeliver` dans E.
- **Corrigé le 2026-10-11, dans les deux.** Contrairement à ce que disait ce constat, l'extension
  ne reprenait pas la correction non plus. Elle rembobinait bien à l'entrée de la correction, mais
  « relancer » replanifiait DELIVER (les scénarios étaient tous terminés), d'où une nouvelle revue
  et une correction perdue. Le copier dans le workflow aurait rouvert D13.
  - Workflow : `corriger` attrape la panne, rembobine à son entrée, restaure la mémoire et escalade.
    « Relancer » reprend la correction, sans essai consommé.
  - Extension : au « relancer » pendant une correction, `retryFix` la reprend depuis son entrée,
    avec ses défauts d'entrée.

### D15 — Motifs perdus à la reprise d'une correction et au « relancer » de phase

- **Où** : `livraison.mjs:663` (`pas(..., [], ...)`) et `:58` (`motifs = []`).
- **Ce qui se passe** (test) :
  - Le testeur repris ne reçoit pas la cause de l'échec (« Tests en échec : u2 »).
  - Après « relancer », le premier pas ne porte aucun « Rejet précédent ».
  - E transmet les motifs dans les deux cas (`scenarioFailure`, `DELIVER_PLANNED`).
- **Proposition** :
  - Faire passer les motifs dans `deroulerCorrection`.
  - Faire rendre à `w.phase` les motifs de l'escalade au « relancer ».
  - Garder l'écart assumé : les sessions sont oubliées, mais pas les motifs.
- **Corrigé le 2026-10-11.**
  - `corriger` passe la cause de l'échec au premier pas de la reprise.
  - Dans la bibliothèque, `w.phase` appelle `fn(cp, relance)` : `relance` vaut les motifs de
    l'escalade après « relancer », et rien au premier passage. `essayer` accepte des `motifs`
    initiaux. Les quatre phases de skraft les transmettent.

### D16 — Le vert du nettoyage est ignoré

- **Où** : `livraison.mjs:218-233`.
- **Ce qui se passe** (lecture) : le résultat du pas `refactor` n'est pas pris en compte, et la
  porte du nettoyage tolère que l'acceptance redevienne rouge. W rembobine alors tout le
  scénario, là où E continue le cycle.
- **Proposition** : prendre le vert après le nettoyage, et refuser un nettoyage qui fait passer
  l'acceptance du scénario de vert à rouge.

---

## 5. Propres à l'extension (E)

| # | Défaut | Où | Vérifié | Proposition |
|---|---|---|---|---|
| D17 | Une panne en ROUTE bloque la tâche : `phase` vaut `null`, et « relancer » ou « sauter » ne font rien. Seul « abandonner » fonctionne | `reducer.ts:426`, `:444`, `:450` | test | En ROUTE, « relancer » reprend les questions et « sauter » passe à DESIGN ; refuser une escalade dont aucune option n'agit |
| D18 | Une phase sautée transmet ses défauts de revue et son motif à la phase suivante | `reducer.ts:450-453`, `:448`, `deliver-machine.ts:52` | test | « Sauter » vide `reviewThreads` et `lastRejection`, comme le commit (`:231`) |
| D19 | Une panne au commit rembobine une phase déjà approuvée, et « relancer » la refait entière, revue comprise | `reducer.ts:422-428` | test | Une panne au commit ne rembobine pas : on réessaie le commit seul |
| D20 | Deux escalades de DELIVER rembobinent sans faire oublier les sessions (ADR 0050) | `deliver-machine.ts:306-311`, `:318-325` | test | Utiliser la fonction unique `rollback` + `forgetSessions` |
| D21 | Rejets ni comptés ni tracés : REJECTED (« relancer » repart alors avec un retour vide), plafond de 20 cycles, nettoyage refusé, relance du classifieur | `reducer.ts:284`, `:362` ; `deliver-machine.ts:165`, `:236` | test | Tout rejet passe par une seule fonction qui incrémente `rejections` et pose `lastRejection` ; corriger le commentaire de `deliver-machine.ts:16` |
| D22 | Un défaut de mutation contesté n'a pas d'arbitre et la revue rend APPROVED. **Revu le 2026-10-11** : depuis D5, la porte relancée échoue de nouveau et le budget s'épuise ; touche aussi le workflow. **Corrigé (ADR 0065)** : arbitre de mutation, humain au-delà, dérogations tracées | `reducer.ts:257-268`, `review-thread.ts:111`, `:140` | test | Faire arbitrer les défauts `mutation` par l'humain, ou par la lentille *quality-gates* |
| D23 | Une correction en échec revient à une référence de tests trop ancienne (le début du dernier scénario). **Corrigé le 2026-10-11 avec D12** | `deliver-machine.ts:284` | test | Prendre la référence au point d'entrée de la correction |

---

## 6. Écarts entre le code et la spécification

À trancher : on corrige le code, ou on amende `SPEC-skraft.md` par un ADR.

| # | Écart | Où | Piste |
|---|---|---|---|
| S1 | Le compteur d'essais dépasse le budget avec l'essai garanti, ce que la spec interdit (invariant 3) | ADR 0042 | Amender la spec : l'essai garanti est hors budget, et compté à part |
| S2 | RESEARCH est sautée pour les niveaux `simple` et `medium`, alors que la spec dit que les quatre phases s'exécutent toujours | `difficulty.ts:577-579`, `reducer.ts:328` ; spec §5.1, §8.1, §8.4 ; ADR 0014 | Écrire un ADR qui acte le saut, ou rétablir RESEARCH |
| S3 | L'état `VERDICT_GATE` est déclaré mais jamais atteint | `model.ts:308` | Le retirer du modèle, ou l'implémenter |
| S4 | La spec prévoit un rollback après un rejet de porte ; les ADR 0029 et 0040 l'ont retiré | spec §5.2 | Mettre à jour la table §5.2 |
| S5 | La spec prévoit trois lentilles en DELIVER ; le code en lance quatre, avec *quality-gates* | spec §7.4 | Mettre la spec à jour |

---

## 7. Écarté ou vérifié sans défaut

- **Budgets** : un seul décompte par essai dans `essayer`. Les budgets par pas, par scénario, de
  cycles (20) et de phase sont remis à zéro aux bons moments. L'essai garanti est conforme à
  l'ADR 0042.
- **Ordre des portes de DISTILL** : gherkin → valeurs → plan → RED, conforme.
- **Preuves** : elles viennent toujours de `w.lancerTests` / `run_tests`, jamais de l'agent.
- **Routage testeur / développeur** : conforme, comme le renvoi unique d'un défaut et `endTurn`.
- **Sessions séparées** : on y passe après le premier échec d'un scénario.
- **Pannes et budget** : une panne d'environnement ne consomme pas de budget.
- **« Abandonner »** : il intervient après un rembobinage, donc l'état reste propre.
- **Non étayés, donc non retenus** :
  - un ancien événement de fin de tour arrivant pendant la porte de scénario (E) ;
  - l'absence de limite au nombre d'amendements en ratification, qui dépend de l'humain.

---

## 8. Ordre de correction proposé

1. **D1** (gel) et **D11** (trace, ROUTE), avant la campagne US-2.
2. **D2, D3, D6** (ADR et faits de revue) : des décisions fausses risquent d'être ratifiées.
3. **D4** (décision prise : question de lentille à l'utilisateur, rejeu de phase non compté), **D5** : les essais consommés pour rien faussent le coût mesuré.
4. W : **D12 à D15**, puis une aide de la bibliothèque qui restaure la mémoire avec le
   rembobinage. C'est la cause commune de D1, D2, D6, D8 et D12 côté workflow.
5. E : **D17 à D23**.
6. **S1 à S5** : décisions à prendre, ADR à écrire.

Chaque correction se fait en TDD. Le test jetable de l'audit devient le test de non-régression,
écrit une fois pour l'extension et une fois pour le workflow.
