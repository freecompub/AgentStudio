# Journal de progression

Pour le prochain moi. Texte libre : ce qui a été fait, pourquoi, et surtout ce qui m'a piégé.
À mettre à jour après chaque tâche, en même temps que `features.json`.

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
