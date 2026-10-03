# Runs réels sur US-2 : problèmes rencontrés et solutions retenues

Journée du 2026-10-03, branche `feat/suivi-run`. Projet d'essai : `freecompub/exemple-dotnet-tdd`
(.NET 10, xUnit, rapport JUnit), story `stories/US-2.md` (remise par palier de quantité).
Runtime : Copilot CLI, modèle `claude-sonnet-5`, banc `scripts/mesure-skraft.ts`.

Ce document est écrit pour qui reprendra le travail. Pour chaque problème : ce qu'on a **observé**,
la **cause** établie, la **solution retenue** et pourquoi, ce qu'on a **écarté**, comment c'est
**vérifié**, et où le trouver. Les décisions de conception ont chacune leur ADR ; ce document les
relie entre elles et au run qui les a provoquées.

> Point de départ : avant le 03/10, **aucun run réel n'avait dépassé DISTILL**. En fin de journée,
> US-2 est allée jusqu'à `DONE` (reprise à DELIVER), code poussé, 11 tests verts.

---

## Sommaire

| # | Problème | Nature | Solution | Référence |
|---|---|---|---|---|
| 1 | Jeton GitHub refusé par Copilot, relance en boucle | environnement + banc | connexion OAuth ; le banc refuse de démarrer et abandonne une escalade répétée | `0340a01` |
| 2 | SDK .NET absent | environnement | SDK 10 dans `~/.dotnet` | — |
| 3 | Rejeux et causes illisibles : la trace n'écrivait ni transitions ni rejets | instrumentation | le moteur écrit `transition` et `rejet` ; bilan par étape | `0340a01` |
| 4 | Estimation des crédits fausse d'un facteur 18 | instrumentation | mesure par `nanoAiu` | `0340a01` |
| 5 | Porte cohérence : rejet à tort d'un nom défini (`AppliqueA`) | défaut de porte | un nom est défini n'importe où dans le code du modèle | `1b10b55` |
| 6 | DELIVER refuse de démarrer : tests d'acceptance rouges pris pour une régression | défaut de porte | reconnaître l'acceptance à sa marque `ac-<n>` | `1749111` |
| 7 | Test rouge par compilation déclaré « introuvable » au vert | défaut de porte | relier un fichier à la classe JUnit du même nom | `3dc89af` |
| 8 | Le testeur refuse un test redondant, la machine le rejette | conception | ADR 0045 : couvert par l'acceptance | `a49a179` |
| 9 | La revue réclame un test qu'aucune correction ne peut écrire | conception | ADR 0046 : la revue dialogue, défauts routés | `b37d252` |
| 10 | Défaut « test manquant » envoyé au développeur | défaut de notre ADR 0046 | le fichier cité ne fait basculer que vers le testeur | `3a2b423` |
| 11 | L'agent supprime le code non testé pour satisfaire la revue | conception | ADR 0047 : garde du contrat, renvoi hors périmètre | `bb39ce2` |
| 12 | Reprise sur code déjà écrit refusée (« aucun livrable ») | méthode de reprise | repartir juste avant DELIVER | — |
| 13 | Le banc relance après une escalade | banc | **non corrigé**, arrêt manuel | — |

Chronologie et coûts en fin de document.

---

## 1. Jeton GitHub refusé par Copilot, relance en boucle

**Observé.** Premier lancement : chaque tour du classifieur rend `Execution failed: 400 Bad Request`.
La tâche part en escalade ; le banc répond « relancer » ; nouvel échec ; et ainsi de suite, une
escalade par seconde. Arrêté au bout d'une vingtaine de secondes, 0 requête consommée.

**Cause.** Sur cette machine Linux, `gh` était connecté par **PAT classique** (`ghp_…`), que Copilot
refuse (`auth.status()` : `tokenKind: classic-pat`, `copilotCompatible: false`). Le blocage 1 de J1
avait été levé sur le Mac, par une connexion OAuth : il ne voyage pas avec le dépôt.

**Solution retenue.**
- Connexion OAuth : `gh auth login --hostname github.com --git-protocol https --web` (jeton `gho_…`).
- Le banc vérifie `auth.status()` **avant** de lancer et refuse de démarrer si le jeton n'est pas
  accepté, en donnant la commande ci-dessus.
- Le banc abandonne la tâche au **troisième motif d'escalade identique** au lieu de relancer sans fin.

**Vérifié.** `pnpm smoke:copilot` : `tokenKind: oauth`, `copilotCompatible: true`, essai réel abouti.
L'abandon sur escalade répétée a servi en réel (problème 6) : trois escalades, abandon, 0 requête.

---

## 2. SDK .NET absent

**Observé.** `dotnet: command not found`. Le profil de stack lance `dotnet test` : sans SDK, la porte
RED de DISTILL et tout DELIVER auraient échoué pour une raison d'environnement.

**Solution retenue.** SDK 10 installé par le script officiel `dotnet-install.sh` dans `~/.dotnet`,
sans sudo ni modification du système. Le banc se lance avec
`PATH=$HOME/.dotnet:$PATH DOTNET_ROOT=$HOME/.dotnet`.

**Vérifié.** Les 5 tests du projet d'essai passent avant tout run.

---

## 3. Rejeux et causes illisibles : la trace n'écrivait ni transitions ni rejets

**Observé.** La demande était de suivre chaque étape : durée, nombre de rejeux, cause de chaque
rejeu, crédits. En branchant le suivi, on découvre que les entrées `transition` et `rejet` de la
trace (ADR 0032) sont **déclarées dans le type mais jamais écrites** : le nombre de rejeux d'une
phase et leurs motifs n'étaient lisibles nulle part.

**Solution retenue.**
- Le moteur de tâches écrit une entrée `transition` par transition (événement, phase, stade,
  essais, effets) et une entrée `rejet` par rejet (porte, motifs entiers).
- Un rejet se repère à un **compteur croissant** `rejections` dans l'état, lu par convention comme
  `phase`. skraft l'incrémente dans `bumpRetries`, par où passent tous ses rejets.
- `resumerTrace` (pur, `packages/core/src/trace/run-summary.ts`) résume un run par étape.
- Le banc annonce en direct chaque étape, rejet et fin de tour anormale (lignes `§`), et verse un
  rapport dans `docs/runs/<date>-<story>-<id>/`.
- `--pousser` pousse le travail sur une branche `run/<story>-<date>-<id>` du projet d'essai après
  chaque phase commitée, jamais sur `main`, jamais par l'agent.

**Écarté.**
- Ajouter des `console.log` dans le code : deux sources de vérité qui divergeraient.
- Repérer un rejet à `lastRejection` : les motifs restent posés pendant tout le réessai, et deux
  rejets identiques de suite sont deux rejets.
- Comparer des références d'objets : l'état d'une extension isolée revient sérialisé.

**Vérifié.** Tests du moteur et de `resumerTrace`. En réel : tous les rapports du 03/10 sont produits
par ce mécanisme.

**Reste.** Les escalades pour panne d'environnement ne sont pas des rejets de porte : le suivi en
direct les montre, le rapport final ne les liste pas.

---

## 4. Estimation des crédits fausse d'un facteur 18

**Observé.** Estimation initiale : une requête premium par tour d'agent. RESEARCH a fait 2 tours et
consommé **36 requêtes**.

**Cause.** Copilot facture chaque **appel** au modèle (un par aller-retour avec les outils), et un
tour en contient des dizaines. Le coût d'un appel croît avec la taille du contexte renvoyé.

**Solution retenue.** Le SDK joint à chaque appel son coût en `nanoAiu` : **10⁹ nanoAiu = une
requête premium**. Le banc affiche ce cumul par étape. La réserve (`/copilot_internal/user`) reste
relevée, mais elle se met à jour avec retard.

**Vérifié.** CLASSIFY + RESEARCH : 35,99 × 10⁹ nanoAiu pour un écart de réserve de 36. Sur le run
complet suivant : 404,2 calculées pour 405 constatées.

---

## 5. Porte cohérence : rejet à tort d'un nom défini

**Observé.** Run 1 : DESIGN rejetée **trois fois** pour « `AppliqueA` cité dans contracts.md
n'existe pas dans event-model.md ni dans domain-model.md ». Escalade, **environ 200 requêtes**.

**Cause.** Rejouée sur les trois instantanés de checkpoint :

| Essai | `AppliqueA` dans le modèle | Rejet |
|---|---|---|
| 1 | absent | **justifié** |
| 2 | défini : signature dans un bloc de code, appel `palier.Taux.AppliqueA(SousTotal)` | **à tort** |
| 3 | idem | **à tort** |

La porte ne tenait un nom pour défini que s'il était écrit **seul entre backticks**. L'agent avait
corrigé dès l'essai 2.

**Solution retenue.** Asymétrie voulue : un document **cite** un nom en l'écrivant seul entre
backticks ; le modèle le **définit** n'importe où dans son code (bloc délimité, appel, signature).
Un nom écrit seulement en prose reste inconnu : la convention est qu'un nom du modèle s'écrit en
code.

**Vérifié.** Rejeu sur les trois instantanés : seul l'essai 1 est encore rejeté. Run suivant : le
seul rejet de DESIGN (`PalierApplicable`, réellement absent du modèle) est justifié.

**Leçon.** Les instantanés de checkpoint (`refs/agent-studio/checkpoints/`) sont la meilleure source
pour rejouer une porte : le rollback efface l'arbre de travail, pas eux.

---

## 6. DELIVER refuse de démarrer : tests d'acceptance rouges pris pour une régression

**Observé.** Relance : RESEARCH, DESIGN et DISTILL validées — premier run à atteindre DELIVER. Puis
« La suite est rouge avant DELIVER : `…Ac2…`, `…Ac3…` », trois fois, abandon. 0 requête.

**Cause.** Ces tests sont ceux que DISTILL **doit** laisser rouges. Le contrôle préalable de DELIVER
les reconnaissait comme tests d'acceptance en appliquant les globs de `layout.acceptanceTests`
(des **chemins**) au champ `file` du résultat. Or un rapport JUnit rend `file` comme un **nom de
classe** (`Tarification.Tests.RemiseParPalierAcceptanceTests`). C'est le défaut de l'ADR 0041, qui
n'avait été corrigé que dans DISTILL ; quatre usages identiques restaient dans DELIVER.

**Solution retenue.** Un résultat est d'acceptance s'il porte la marque `ac-<n>` que DISTILL impose
dans le nom du test (`acOf`), ou, à défaut, si son chemin correspond aux globs. Appliqué aux quatre
usages.

**Vérifié.** Test reproduisant le rapport JUnit .NET réel. Recherche de l'idiome `r.file` dans tout
le dépôt : plus aucune occurrence.

**Pourquoi les tests ne l'avaient pas vu.** Les tests de bout en bout utilisent un faux lanceur
Swift, qui rend de vrais chemins.

---

## 7. Test rouge par compilation déclaré « introuvable » au vert

**Observé.** Première reprise à DELIVER : la boucle TDD tourne (test rouge sur assertion, puis code
vert, confirmés par nos portes). Au deuxième pas : « Le test du pas est introuvable :
`tests/Tarification.Tests/QuantiteTests.cs` » sur un test pourtant vert. Arrêté, 100 requêtes.

**Cause.** Troisième variante de la même confusion chemin ↔ classe. Le test rouge appelait une
méthode encore absente : en C#, c'est une **erreur de compilation**, et le lecteur d'erreurs de
compilation désigne le test par son **fichier**. Au vert, le rapport JUnit le nomme par sa **classe
qualifiée**. `concerns`, qui décide si un résultat désigne un test, ne connaissait que les
identifiants `chemin > test` (Vitest, Swift).

**Solution retenue.** Dans `concerns` lui-même : le fichier `…/QuantiteTests.cs` désigne les tests de
la classe `….QuantiteTests` (segment de classe de l'identifiant, méthode exclue). Corriger à cet
endroit couvre aussi la séquence rouge puis vert de la porte de fin de scénario.

**Vérifié.** Tests sur les deux sens, contre-exemples (`MontantTests`, `QuantiteTestsBis`), et
séquence rouge (compilateur) puis vert (JUnit).

**Leçon.** Après un correctif de ce genre, chercher l'idiome dans tout le dépôt, pas seulement là
où il a mordu. Ce défaut est revenu trois fois en une journée.

---

## 8. Le testeur refuse un test redondant, la machine le rejette — ADR 0045

**Observé.** Pour `PalierApplicable`, `skraft-test` refuse d'écrire un test unitaire : ses quatre
branches sont vérifiées par les tests d'acceptance ac-1, ac-2, ac-3 et ac-5 (mandat 4 de la skill
reprise `test-design-mandates`, noté « saturated by AC » dans le plan de test). La machine DELIVER
exige un nouveau test rouge à chaque pas et n'offre aucune autre sortie : rejet. Au réessai, l'agent
cède et écrit un test redondant.

**Cause.** Un défaut de la machine, pas de l'agent : rien ne disait ce qu'est un test suffisant.

**Solution retenue (option A).** Un comportement vérifié par le test d'acceptance du scénario
n'exige pas de test unitaire. Le testeur le déclare dans `report_phase.coveredBy`. **Le code
décide** : rien d'écrit, c'est bien le test d'acceptance **du scénario**, et il échoue pour une
bonne raison. Ce test devient la cible du pas de code, sans entrer dans la liste des tests
unitaires du scénario. Les lentilles ont pour consigne de chercher dans l'acceptance avant de
réclamer un test.

**Écarté.**
- B : un test unitaire par branche, quitte à contredire la skill et dupliquer l'acceptance.
- C : mixte, la revue décidant au cas par cas, d'un coût imprévisible.

**Vérifié.** 7 tests. En réel, deux fois : DELIVER passe sans aucun rejet (31 puis 28 requêtes).

**Prix accepté.** Moins de tests unitaires, donc un diagnostic moins fin quand un test d'acceptance
casse. La mutation et la couverture, mesurées en fin de scénario, restent le filet.

---

## 9. La revue réclame un test qu'aucune correction ne peut écrire — ADR 0046

**Observé.** Deuxième reprise : DELIVER va au bout de ses scénarios, premier code qui passe nos
portes. La revue (`cold-reader`, major) réclame des tests unitaires pour les autres branches de
`PalierApplicable`. La correction est confiée au développeur, **tests gelés par empreinte** : il ne
peut qu'enrichir un commentaire. Deux rejets, arrêté. 165 requêtes.

**Cause.** Trois manques :
1. pas de **routage** : tout défaut allait au développeur ;
2. pas de **droit de réponse** : céder ou être rejeté ;
3. pas de **mémoire** : le retour ne gardait que le dernier rejet (critère
   `retour-de-revue-cumulatif`, observé dès le 29/09).

**Solution retenue** (proposée par le responsable du projet, précisée ensemble).
- **Sortie de lentille normalisée** : cible obligatoire par défaut (`test`, `code`, `deliverable`),
  un seul sujet par défaut ; **identifiant attribué par le code** (`lentille#tour.n`), jamais par le
  modèle.
- **Un fil par défaut** (`review-thread.ts`, pur), conservé jusqu'au commit de la phase.
- **Routage en DELIVER, les tests d'abord** : correction côté tests (`fix-test`) puis côté code
  (`fix`). La porte côté tests **n'exige pas de rouge** : un test réclamé sur du code existant passe
  souvent d'emblée. Elle exige des tests unitaires seulement, aucun test existant disparu ni cassé,
  et un rouge éventuel pour une bonne raison ; les rouges deviennent les cibles du développeur.
- **Droit de réponse** : `fixed`, ou `contested` avec raison. Chaque lentille revoit **ses** défauts
  et la réponse de l'agent, et arbitre (`accepted` : le défaut tombe ; `maintained` : à corriger).
- **L'humain en dernier recours** : contesté puis maintenu deux fois, étape `ARBITRATION`.
- **Mémoire** : les demandes déjà corrigées sont rappelées à chaque retour.

**Écarté.** Exiger un rouge pour tout test ajouté en correction : sur US-2, tous les tests demandés
auraient été verts d'emblée et la correction aurait été impossible.

**Vérifié.** 17 tests du module, tests d'intégration du réducteur. En réel : contestation
argumentée, arbitrages motivés dans les deux sens, rappel des demandes corrigées.

---

## 10. Défaut « test manquant » envoyé au développeur — défaut de notre ADR 0046

**Observé.** Run de l'ADR 0046 : `quality-gates` signale, cible `test` (à raison), qu'aucun test ne
couvre `Facture.ATPayer`, en citant `CalculDuPanier.cs`. Le défaut part au **développeur**. Il le
conteste (« je ne peux pas écrire de test ») ; la lentille le maintient (« le test manque ») ; les
deux ont raison.

**Cause.** Notre règle « le fichier cité fait foi sur la cible déclarée ». Or un défaut « test
manquant » cite **naturellement** le code qu'aucun test ne couvre.

**Solution retenue.** Le fichier cité ne fait basculer un défaut que **vers le testeur** (un défaut
qui cite un fichier de test ne peut pas être corrigé par le développeur). Un défaut déclaré `test`
reste au testeur, quel que soit le fichier cité.

**Vérifié.** Test du cas réel. Run suivant : le même défaut, citant `Montant.cs`, reste au testeur,
qui ajoute `FactureTests` ; la revue accepte ; US-2 va jusqu'à `DONE`.

---

## 11. L'agent supprime le code non testé pour satisfaire la revue — ADR 0047

**Observé.** Suite du problème 10 : au tour suivant, le développeur « corrige » le défaut de
couverture en **supprimant le code non couvert** (`ATPayer` ne déduit plus la remise,
`Montant.Soustrait` disparaît). La revue suivante bloque : régression, contrat ratifié de DESIGN
non respecté. Budget épuisé, escalade. Arrêté à 252 requêtes.

**Cause.** Rien n'interdisait de retirer ce que le contrat exige. Et un agent qui reçoit un défaut
juste mais hors de son ressort n'avait que deux sorties : contester (alors que le défaut est juste)
ou céder. Il avait une troisième option — contester encore et faire arbitrer l'humain — mais on lui
disait « maintenu, à corriger ».

**Solution retenue** (mesures 1 à 3 retenues par le responsable).
1. **Garde du contrat ratifié** : à la revue de DELIVER, le code relève les noms du contrat
   (`design/contracts.md`, identifiants capitalisés des blocs de code) présents dans le code ; en
   correction, la porte refuse un tour qui en fait disparaître un, avec la marche à suivre.
   La référence est relevée à la revue, faute de pouvoir relire le code d'un état passé.
2. **Réponse `outOfScope`** : le défaut est juste mais revient à l'autre agent ; il change de cible.
   **Une seule fois** : renvoyé de nouveau, il devient une contestation que la lentille arbitre.
3. **Consigne du développeur** : ne jamais supprimer un comportement exigé par le contrat pour faire
   taire une revue ; contester ou déclarer hors périmètre.

**Écarté.** Une consigne seule (ADR 0043 : une règle énoncée ne vaut pas une règle vérifiée).
Étendre l'API de l'espace de travail pour relire un état passé : quatre couches à modifier pour un
résultat équivalent.

**Vérifié.** Rejouée sur les commits réels du run : la correction légitime (`Multiplie` repassant
par `De`) passe, la suppression est refusée (`Soustrait` disparu).

**Limites.** La garde voit les **noms** qui disparaissent, pas un comportement modifié à nom
constant. Elle inclut des noms du cadre cités par le contrat (`IEnumerable`, `Aggregate`).
`outOfScope` n'a pas encore été sollicité en réel.

**Piège en l'écrivant.** Le motif d'abord réutilisé n'acceptait que les noms composés (`AppliqueA`)
et ignorait `Montant` et `Soustrait` — exactement le nom supprimé.

---

## 12. Reprise sur code déjà écrit refusée (« aucun livrable »)

**Observé.** Pour éprouver la revue sans refaire DELIVER, reprise depuis une branche où le code était
déjà écrit. La porte de phase refuse « Aucun livrable produit pendant la phase DELIVER », en boucle.
Arrêté, 8 requêtes.

**Cause.** Pas un défaut : une phase qui ne produit rien est suspecte, et la porte le dit.

**Solution retenue.** Reprendre **juste avant** DELIVER (`--depuis=DELIVER --base=<branche run/…>`).
DELIVER réécrit le code, ce qui coûte peu (environ 30 requêtes grâce à l'ADR 0045).

---

## 13. Le banc relance après une escalade — non corrigé

**Observé.** Le banc répond à toute interaction par la première option, donc « relancer » en
escalade. Le 03/10, cela a coûté une dizaine de requêtes après une escalade (plafond dépassé de 2).

**Décision.** La mesure proposée (plafond intégré au banc, arrêt sur escalade) n'a pas été retenue.
Le plafond est tenu par une surveillance externe, et les escalades sont arrêtées à la main.

---

## Chronologie et coûts

| Run | Départ | Où il s'est arrêté | Cause | Requêtes |
|---|---|---|---|---|
| 0 | `main` | CLASSIFY | jeton refusé (1) | 0 |
| 1 | `main` | DESIGN, escalade | porte cohérence (5) | 242 |
| 2 | `main` | entrée de DELIVER | acceptance prise pour régression (6) | 404 |
| 3 | reprise DELIVER | 2ᵉ pas | rouge de compilation (7) | 100 |
| 4 | reprise DELIVER | revue | test réclamé, tests gelés (8, 9) | 165 |
| 5 | reprise DELIVER, ADR 0045-0046 | revue, escalade | routage (10), suppression (11) | 252 |
| 6 | code déjà écrit | DELIVER | aucun livrable (12) | 8 |
| 7 | reprise DELIVER, ADR 0045-0047 | **DONE** | — | 152 |

Total : environ **1 330 requêtes premium**. Rapports dans `docs/runs/`. Le code livré est sur la
branche `run/us-2-2026-10-03-9362` du projet d'essai (11 tests verts) ; RESEARCH, DESIGN et DISTILL
viennent du run 2 (`run/us-2-2026-10-03-2973`).

## Ce qui se dégage

- **Les quatre défauts de notre code étaient mécaniques** (problèmes 5, 6, 7, 10) : le prix de « le
  code décide ». Chacun est un coût payé une fois, corrigé et couvert par un test. Trois d'entre eux
  avaient la même racine — un chemin comparé à un nom de classe — invisible tant que les tests de
  bout en bout tournaient sur un faux lanceur qui rend de vrais chemins.
- **Les blocages de fond** (problèmes 8, 9, 11) existent aussi dans skraft-plugin, dont les skills
  sont les nôtres. Chez nous, ils ont arrêté le run, laissé une trace et donné lieu à une décision
  écrite ; chez eux, l'orchestrateur LLM les aurait tranchés en silence.
- **Un run réel trouve en minutes ce que des mois de tests scriptés n'avaient pas vu.** Les doubles
  de test reproduisent ce qu'on croit savoir du monde, pas ce qu'il est.

## Points ouverts

- Un run complet sans reprise (RESEARCH → DONE), après la remise à zéro du 01/11 : 450 à
  550 requêtes estimées.
- `outOfScope` (ADR 0047) jamais sollicité en réel.
- Un comportement modifié à nom constant échappe à la garde du contrat.
- Les escalades pour panne d'environnement absentes du rapport final.
- Un modèle par rôle, comme skraft-plugin : la piste d'économie la plus sérieuse.
- `gel-distingue-adaptation-et-alteration` (docs/05, A1) toujours ouvert.
