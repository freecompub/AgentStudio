# Journal de progression

Pour le prochain moi. Texte libre : ce qui a été fait, pourquoi, et surtout ce qui m'a piégé.
À mettre à jour après chaque tâche, en même temps que `features.json`.

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
