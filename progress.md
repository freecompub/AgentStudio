# Journal de progression

Pour le prochain moi. Texte libre : ce qui a été fait, pourquoi, et surtout ce qui m'a piégé.
À mettre à jour après chaque tâche, en même temps que `features.json`.

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
