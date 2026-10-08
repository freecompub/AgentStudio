# Plan de test : skraft (réducteur) contre skraft-workflow, sur US-2

- Statut : **plan**, 2026-10-08. Rien n'est lancé ; les prérequis (§5) sont à développer d'abord.
- Contexte : ADR 0054 (les deux extensions coexistent le temps de les comparer), `docs/09`.
- Projet d'essai : `/home/diabeo/Projets/exemple-dotnet-tdd` (.NET 10, xUnit, rapport JUnit,
  `.agent-studio/stack.yaml`), story `stories/US-2.md` (remise par palier de quantité, cinq
  critères, une question ouverte). Historique : `docs/06-run-us-2-problemes-et-solutions.md`,
  `docs/runs/2026-10-03-us-2-*`.

---

## 1. Ce qu'on veut savoir

| # | Question | Mesure |
|---|---|---|
| Q1 | Les deux livrent-ils US-2 ? | état final ; tests verts sur la branche livrée ; revue finale |
| Q2 | Combien de temps prend **chaque étape**, et où passe ce temps ? | durée murale par étape, découpée en temps agent, temps code (tests, mutation, lint), attente humaine |
| Q3 | Combien coûte **chaque étape** ? | requêtes premium (SDK, `nanoAiu`), tokens d'entrée et de sortie, écart de réserve Copilot |
| Q4 | Combien de rejeux, et **pourquoi chacun** ? | liste exhaustive : étape, essai, nature, porte, motifs exacts, coût et durée de l'essai perdu |
| Q5 | Combien d'interventions humaines ? | questions posées, par nature, et temps d'attente |
| Q6 | Lequel est plus facile à **corriger** quand un run révèle un défaut ? | §8, qualitatif, sur le premier défaut rencontré |

Aucune question ne porte sur la vitesse de calcul du moteur lui-même : le rejeu du script coûte
quelques millisecondes par transition (`docs/09` §6.6) ; on le mesure quand même (§4.2) pour le
vérifier.

## 2. Ce qui est comparé, et ce qui doit rester identique

| Élément | Valeur, identique pour les deux |
|---|---|
| Projet | `exemple-dotnet-tdd` au commit noté au début de la campagne (aujourd'hui `a7cf6db`), copié pour chaque run (le banc ne touche jamais l'original) |
| Story | `stories/US-2.md`, inchangée |
| Barre de qualité | `.skraft/quality.json` du projet (ancien emplacement, relu par les deux, ADR 0049), inchangée |
| Modèles | même association classe → modèle (`--modeles=strong:…,standard:…,light:…`), notée dans le rapport |
| Plafonds | même plafond de durée de tour, de coût de tour et de contexte (ADR 0026, 0027, 0031) |
| Réponses humaines | même répondeur scripté (§5, P4) : mêmes réponses, aux mêmes questions |
| Compte Copilot | le même ; réserve relevée avant et après chaque run |
| Chaîne .NET | la même (`dotnet --version` noté) |

Différences **assumées** entre les deux (ADR 0054, `progress.md`), à garder en tête en lisant
les résultats :

- skraft-workflow fait oublier aux agents leur session après un rembobinage (ADR 0053) ; skraft
  ne le faisait pas en DELIVER. Effet attendu : quelques tokens de plus après un rejet de pas ;
- plusieurs amendements d'ADR sont traités ensemble dans le workflow ;
- « relancer » après une escalade pendant une correction de revue reprend la correction.

## 3. Le découpage en étapes, commun aux deux

Pour comparer, les deux runs sont découpés **de la même façon**, quel que soit le vocabulaire
interne (états du réducteur, phases du script) :

| Étape | Sous-étapes |
|---|---|
| PRÉPARATION | lecture de la story, branche, arborescence, indicateurs |
| DIFFICULTÉ | classifieur ; confirmation humaine |
| RESEARCH | chercheur ; porte citations |
| QUESTIONS | questions ouvertes posées et répondues |
| DESIGN | modélisation ; décisions ; porte cohérence ; revue (par lentille) ; arbitrages ; ratification ; amendements |
| DISTILL | acceptance ; portes gherkin, valeurs, plan ; RED d'acceptance ; revue |
| DELIVER | suite de référence ; par scénario : pas test (rouge), pas code ou vert, nettoyage, porte de fin de scénario ; mutation de fin ; revue ; corrections (côté tests, côté code) |
| BILAN | commit final, rapport |

La correspondance avec chaque implémentation est écrite dans le banc (P3), une fois pour toutes :
états `CLASSIFY`, `CONFIRM_DIFFICULTY`, `REVIEW`… pour skraft ; marqueurs d'étape pour le
workflow (P1).

## 4. Les mesures

### 4.1 Temps

| Mesure | Source |
|---|---|
| Durée murale d'une étape | horodatages de la trace (ADR 0032) : début de l'étape, début de la suivante |
| Temps agent | `tour-début` → `tour-fin` de la trace, par tour, par rôle |
| Temps code (tests, mutation, lint, Git) | durée de chaque effet (P2) : `lancerTests`, `mutation`… pour le workflow ; effets `verifyUnitRed`, `scenarioGate`… pour skraft |
| Attente humaine | `createdAt` → réponse de chaque demande d'interaction (magasin des interactions) |
| Coût du moteur | durée de chaque transition (P2) ; pour le workflow, durée du rejeu |

Le temps humain est **retiré** de la durée murale pour comparer les automates : le répondeur
scripté répond en moins d'une seconde, mais on le mesure quand même.

### 4.2 Coût

| Mesure | Source |
|---|---|
| Requêtes premium par appel | `nanoAiu` de chaque événement `usage` (10⁹ nanoAiu = 1 requête, vérifié le 03/10) |
| Tokens d'entrée et de sortie | événements `usage` |
| Contrôle global | réserve Copilot avant et après (mise à jour avec retard : relevée aussi 10 min après la fin) |
| Coût en euros | requêtes premium × prix unitaire. **Prix à confirmer** par le responsable selon le forfait (le dépassement est facturé à la requête) ; le rapport donne les requêtes, l'euro n'est qu'une colonne calculée |

Chaque coût est rattaché à **l'étape, la sous-étape, le rôle et l'essai** qui l'ont produit.

### 4.3 Rejeux et leurs raisons

Un **rejeu** est tout travail refait. Pour chacun, le rapport donne : étape, sous-étape, essai,
**nature**, porte ou cause, **motifs exacts** (texte complet, pas un résumé), durée et coût de
l'essai perdu, et ce qui a été refait.

| Nature | Exemple | Trace attendue |
|---|---|---|
| Rejet de porte | citations, cohérence, valeurs, RED, porte d'un pas, fin de scénario | nom de la porte + motifs |
| Revue « changements demandés » | défauts `lentille#tour.n`, cible, gravité | identifiants et textes des défauts |
| Tour interrompu | silence, plafond de durée, de coût, de contexte | fin anormale + raison |
| Panne d'environnement | quota, modèle injoignable, suite rouge avant DELIVER | raison ; escalade |
| Pas refusé (DELIVER) | « Aucun nouveau test unitaire détecté » | porte du pas + motif |
| Scénario repris | budget d'un pas épuisé, porte de fin de scénario, cycles | motifs ; passage en sessions séparées |
| Correction de revue | défauts routés au testeur ou au développeur | fils, réponses (`fixed`, `contested`, `outOfScope`) |
| Escalade | budget épuisé, verdict `REJECTED` | motif ; décision humaine |
| Reprise après crash | — | non provoquée dans cette campagne |

**Règle : un rejeu sans raison tracée est un défaut du banc, pas un résultat.** Le run est alors
noté invalide pour Q4 et le banc corrigé avant le run suivant.

## 5. Prérequis à développer avant tout run

| # | Travail | Pourquoi | Critère de sortie |
|---|---|---|---|
| P1 | **Tracer les rejets et les étapes du workflow.** Appels marqueurs journalisés `w.etape(nom)` et `w.rejet(porte, motifs)`, émis par `essayer`, la revue, les pas et les scénarios de DELIVER ; l'état du workflow expose `stage`, `rejections`, `lastRejection`, que le moteur trace déjà (`TracedState`) | aujourd'hui le workflow ne trace **aucun** rejet : Q4 serait vide | un test : chaque essai refait produit une entrée `rejet` avec porte et motifs ; les jumeaux restent verts |
| P2 | **Durée de chaque effet et de chaque transition dans la trace** (moteur de tâches, commun aux deux) | séparer temps agent, temps code et coût du moteur (Q2) | une entrée `effet` (nom, durée) par effet, et la durée de transition, pour les deux extensions |
| P3 | **Banc commun** : `scripts/mesure-skraft.ts` accepte `--extension=skraft|skraft-workflow`, lit le résultat sans dépendre de `SkraftState`, découpe en étapes selon §3, produit le même rapport | le banc actuel ne sait lancer que skraft | un run à blanc sur agents simulés produit deux rapports au même format |
| P4 | **Répondeur scripté commun**, piloté par un fichier (`docs/runs/reponses-us-2.json`) : difficulté (confirmer la proposition), question ouverte (« par référence »), ratification (accepter), arbitrage (donner raison à la lentille), escalade (relancer deux fois, puis abandonner) ; reconnaissance par **libellé**, pas par identifiant (les identifiants diffèrent : `abort` contre `<n>:abandonner`) | sans réponses identiques, les runs ne sont pas comparables ; aujourd'hui les questions ouvertes reçoivent une réponse vide | même fichier, même décision prise pour la même question dans les deux runs à blanc |
| P5 | **Plafond par run** : 250 requêtes premium et 45 min ; au-delà, arrêt propre et rapport | borne le coût d'un run qui dérape (le 03/10, un run a consommé 404 requêtes) | arrêt testé sur agents simulés |
| P6 | **Rapport de comparaison** : un script lit les `resume.json` des runs et produit le tableau du §7 | évite les recopies à la main | tableau produit sur les deux runs à blanc |

P1 et P2 sont des changements de code : branche `feat/mesure-comparee`, TDD, `features.json`.

## 6. Protocole

1. **Run à blanc** de chaque extension sur agents simulés (pile Swift simulée) : vérifie P1 à P6
   sans rien consommer.
2. **Campagne** : quatre runs réels, **en alternance** pour ne pas mêler l'effet de l'heure ou de
   la charge du service à celui de l'approche : skraft, workflow, skraft, workflow. Un troisième
   couple seulement si les deux premiers divergent sur Q1 ou de plus de 30 % sur le coût.
3. Pour chaque run :
   - relever la réserve Copilot, `dotnet --version`, le commit du projet, les modèles ;
   - lancer `pnpm tsx scripts/mesure-skraft.ts <projet> stories/US-2.md 45 --extension=… --modeles=… --pousser` ;
   - ne pas intervenir à la main : seul le répondeur répond. Toute intervention manuelle est notée
     et invalide le run pour Q2 et Q3 ;
   - relever la réserve 10 min après la fin ;
   - archiver dans `docs/runs/<date>-us-2-<extension>-<id>/` : `rapport.md`, `resume.json`, trace
     JSONL, interactions, preuves ; la branche du projet est poussée sous `run/…`.
4. **Vérification du livrable** (Q1) : sur la branche livrée, `dotnet test` vert ; les cinq
   critères couverts par un test d'acceptance marqué `ac-<n>` ; aucun test d'acceptance modifié
   depuis DISTILL (empreinte) ; revue finale `APPROVED`.

### Budget estimé

D'après les runs du 03/10 sur US-2 : 150 à 400 requêtes premium et 5 à 15 min par run complet.

| Campagne | Requêtes premium (estimation) |
|---|---|
| 4 runs | 600 à 1 600 |
| 6 runs (si troisième couple) | 900 à 2 400 |

**À valider par le responsable** avant de lancer : la réserve disponible et le prix unitaire.
Le plafond P5 borne chaque run à 250 requêtes : la campagne de quatre runs coûte au plus 1 000
requêtes, au prix d'un run éventuellement arrêté avant la fin (noté « non livré au plafond »).

## 7. Le rapport de comparaison

Un fichier `docs/runs/<date>-comparaison-us-2.md`, produit par P6 :

1. **Synthèse** : pour chaque approche, livré ou non, durée totale hors attente humaine, requêtes
   premium, tokens, nombre de rejeux, interventions humaines (médiane des runs, et les valeurs
   brutes).
2. **Par étape** (§3), une ligne par étape et par run : durée murale, temps agent, temps code,
   attente humaine, tours, appels, requêtes premium, tokens d'entrée et de sortie, rejeux.
3. **Liste des rejeux**, run par run, dans l'ordre : étape, essai, nature, porte, motifs complets,
   durée et coût perdus.
4. **Rejeux mis en regard** : pour chaque porte, le nombre de rejets dans chaque approche. Un rejet
   présent d'un côté seulement est **expliqué** (différence de comportement connue, ou hasard du
   modèle) ; aucun écart sans explication.
5. **Écarts de comportement observés** entre les deux, à comparer aux différences assumées (§2).

## 8. Critère « facilité à corriger » (Q6)

Le premier défaut d'orchestration que la campagne révèle (s'il y en a un) est corrigé **dans les
deux** extensions, et l'on note pour chacune : fichiers touchés, lignes modifiées, tests ajoutés,
temps passé. C'est la mesure de lisibilité que les tailles de fichiers ne donnent pas. Sans
défaut révélé, Q6 reste sans réponse ; on ne fabrique pas de défaut pour la remplir.

## 9. Décision attendue

Avec le rapport, le responsable tranche l'ADR qui remplacera l'ADR 0054 :

| Constat | Suite proposée |
|---|---|
| Même réussite, coût et durée comparables (écart < 15 %) | le workflow remplace skraft (moins de code, reprise après crash démontrée) |
| Le workflow coûte nettement plus (> 15 %) | chercher la cause (oubli des sessions, ADR 0053 ?) avant de décider |
| L'un livre, l'autre non | analyser le rejeu fatal ; corriger ; nouveau couple de runs |
| Écart inexpliqué sur les rejeux | le banc ou l'une des implémentations a un défaut : on corrige avant de conclure |

## 10. Risques

- **Variance du modèle** : deux runs de la même approche peuvent différer autant que les deux
  approches. Les quatre runs servent à le voir ; on ne conclut pas sur un seul couple.
- **Quota** : la réserve peut ne pas suffire pour la campagne ; vérifier avant (ADR 0044).
- **Service** : une panne Copilot pendant un run invalide ce run (noté, refait).
- **Défauts déjà connus sur US-2** (`docs/06`) : correction de revue qui supprime du code non
  testé (garde ADR 0047), tests unitaires exigés par la revue (ADR 0045, 0046). Ils sont corrigés
  dans les deux ; s'ils réapparaissent, c'est un résultat, pas un défaut du banc.
