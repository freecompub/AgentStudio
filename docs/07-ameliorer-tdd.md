# Améliorer l'extension `tdd` à partir des runs réels de skraft

Analyse du 2026-10-03, après les runs réels de skraft sur US-2 (`docs/06-run-us-2-problemes-et-solutions.md`).
Question posée : parmi les manques découverts sur skraft, lesquels s'appliquent à l'extension `tdd` ?

`tdd` est bien plus simple que skraft : un planificateur, puis pour chaque comportement un cycle
rouge → vert → nettoyage (un tour unique `tdd-pair`, ou des sessions séparées `tdd-test` puis
`tdd-dev`). Elle n'a ni tests d'acceptance, ni revue à lentilles, ni contrat de conception : la
plupart des problèmes de skraft ne la concernent pas. **Trois s'appliquent**, dont un vrai défaut.

> État : **rien n'est corrigé à ce jour**. Ce document décrit le travail à faire.

---

## 1. Un test rouge par compilation est déclaré « introuvable » au vert — défaut

**Où.** `extensions/tdd/src/effects.ts`, porte du vert (`verifyGreen`) :

```ts
const own = run.results.filter((r) => r.id === id || r.file === id);
if (own.length === 0) return fail(`Le test de l'étape est introuvable : ${id}.`);
```

**Ce qui se passerait.** Sur un projet .NET ou Java (rapport JUnit), au premier test qui appelle une
méthode encore inexistante — le rouge le plus courant en TDD :

1. le test ne compile pas ; le lecteur d'erreurs de compilation le désigne par **son fichier**
   (`tests/…/QuantiteTests.cs`), qui devient l'identifiant du test de l'étape (`newTestIds`) ;
2. au vert, le rapport JUnit le nomme par **sa classe qualifiée**
   (`Projet.Tests.QuantiteTests.Methode`), avec `file` = `Projet.Tests.QuantiteTests` ;
3. aucune des deux comparaisons ne correspond : « Le test de l'étape est introuvable », sur un test
   pourtant vert. Rejet, réessai, escalade.

**Pourquoi les tests ne le voient pas.** Le test de bout en bout Swift (`e2e-j5-swift.test.ts`) rend
des identifiants `chemin > test`, où le chemin est un préfixe de l'identifiant. C'est exactement
l'angle mort qui a caché le même défaut dans skraft (problème 7 de `docs/06`), corrigé le 03/10.

**Correction proposée.** Ne pas recopier le correctif de skraft : sortir la fonction qui relie un
résultat à un test (`concerns`, `extensions/skraft/src/deliver.ts`) vers un paquet partagé
(`@agent-studio/extension-api`), et l'utiliser dans les deux extensions. Elle sait déjà relier
`chemin > test`, et un fichier à la classe JUnit du même nom.

**Vérification.** Un test de `verifyGreen` avec un rapport JUnit réel : rouge par compilation désigné
par son fichier, vert sous la classe qualifiée. Il doit échouer avant la correction.

---

## 2. Le suivi des rejeux et de leurs causes ne fonctionne pas pour `tdd`

**Où.** Le moteur de tâches trace un rejet quand l'état porte un compteur croissant `rejections` et un
motif `lastRejection` (`packages/task-engine/src/task-engine.ts`, ADR 0032). `tdd` compte ses
réessais (`retries`) mais n'a ni l'un ni l'autre.

**Conséquence.** Le bilan d'un run `/tdd` (`resumerTrace`) montrerait les étapes et leurs durées, mais
**aucun rejet ni aucune cause** — précisément ce que le suivi a été construit pour donner.

**Correction proposée.** Dans `extensions/tdd/src/reducer.ts`, incrémenter `rejections` et poser
`lastRejection: { gate, reasons }` aux deux endroits par où passent tous les rejets :
`retryOrEscalate` et `fallbackToStrict`. Champs facultatifs dans le schéma de l'état : un état
persisté avant reste lisible.

**Vérification.** Un test du réducteur : un `VERIFY_FAIL` incrémente `rejections` et pose le motif ;
un test du moteur avec la définition de `tdd` : l'entrée `rejet` est écrite.

---

## 3. Le modèle par classe de rôle (ADR 0048)

**Où.** `extensions/tdd/src/manifest.ts` : les quatre agents ne déclarent pas de `modelClass`. Ils
prennent le modèle du projet, ou celui que choisit le runtime.

**Correction proposée.**

| Agent | Classe | Pourquoi |
|---|---|---|
| `tdd-planner` | `strong` | découper un besoin en comportements testables demande le plus de jugement |
| `tdd-pair` | `standard` | produit test et code en un tour |
| `tdd-test` | `standard` | écrit un test |
| `tdd-dev` | `standard` | écrit le code |

**Vérification.** Un test du manifeste, sur le modèle de celui de skraft
(`extensions/skraft/test/manifest.test.ts`, « classes de modèle des rôles »).

---

## Ce qui ne s'applique pas

| Problème rencontré sur skraft | Pourquoi `tdd` n'est pas concerné |
|---|---|
| Porte cohérence (`AppliqueA`, problème 5) | pas de documents de conception |
| Tests d'acceptance pris pour une régression (problème 6) | pas de tests d'acceptance ; une suite rouge avant une étape est une vraie anomalie |
| Testeur contre revue (ADR 0045) | pas de revue, pas d'acceptance qui couvre déjà un comportement |
| Revue qui dialogue, routage des défauts (ADR 0046) | pas de revue à lentilles |
| Suppression de code pour satisfaire la revue (ADR 0047) | pas de revue ; au vert, toute la suite doit passer : retirer un comportement testé casse un test |
| Correction de revue sans fin (revue de code du 03/10) | pas de correction de revue |
| Reprise sur code déjà écrit refusée (problème 12) | pas de reprise de phase |
| Jeton GitHub, SDK .NET (problèmes 1 et 2) | environnement, commun aux deux extensions : déjà réglé |

## Un cas voisin, sans action pour l'instant

Si le planificateur découpe deux comportements qui se recouvrent, le testeur ne peut pas écrire de
test rouge pour le second : il passerait déjà. La porte le refuse (« passe déjà »), la tâche escalade,
et l'humain peut choisir « Sauter ce comportement ». C'est l'équivalent de l'ADR 0045 (comportement
déjà couvert), mais l'humain le règle déjà. À revoir si un run réel montre que le cas est fréquent.

## Après les corrections : un premier run réel

Le critère `tdd-avec-vrai-copilot` reste ouvert : **`/tdd` n'a jamais tourné avec le vrai Copilot**.
Les runs de skraft du 03/10 ont montré qu'un premier run réel trouve des défauts que des mois de
tests scriptés n'avaient pas vus ; le point 1 en est un exemple, trouvé par analogie.

À prévoir après la remise à zéro des crédits du 01/11, sur le projet d'essai .NET :

- un banc de mesure pour `tdd`, sur le modèle de `scripts/mesure-skraft.ts` (suivi par étape,
  requêtes premium par `nanoAiu`, poussée sur une branche `run/…`), ou ce banc généralisé à toute
  tâche ;
- une story courte (US-1 ou US-3 du projet d'essai) ;
- un plafond de crédits fixé avant le lancement.

## Ordre proposé

1. Point 1 (défaut réel sur .NET et Java), en TDD.
2. Point 2 (suivi), en TDD.
3. Point 3 (modèle par classe), en TDD.
4. Premier run réel de `/tdd`, après le 01/11.

Les points 1 à 3 ne consomment aucun crédit.
