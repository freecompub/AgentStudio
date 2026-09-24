# ADR 0006 — Moteur de tâches : persistance, checkpoints et reprise

- Statut : accepté (stockage : **provisoire**, O6 ouvert)
- Date : 2026-09-23
- Jalon : J2 (§6, D16, D23, D24, D25)

## Contexte

Le moteur exécute des tâches décrites par un réducteur pur et un runner d'effets. Il doit survivre à un
plantage ou à une fermeture : un effet interrompu est rejoué depuis son checkpoint, jamais récupéré.

## Décision

1. **Contrat** `TaskDefinition<S, E, F, D>` : `initialState`, `initialEffects`, `transition` (pur),
   `runEffect(effect, deps, { taskId, signal })`, `checkpointBefore(effect)` (oui par défaut) et
   `isTerminal`.
2. **Enregistrement persisté** `TaskRecord` : état, effets en attente (`pending`), effet en cours
   (`inflight` : effet, checkpoint, date de début) et statut (`running`, `waiting`, `finished`). Il est
   écrit **après chaque transition** et **avant chaque effet** : checkpoint créé, puis marqueur écrit,
   puis exécution.
3. **Reprise** (`resumeAll` au démarrage) : un `inflight` présent déclenche le rollback au checkpoint,
   la transition `RESUMED`, puis la relance de l'effet ; les effets en attente suivent. Une tâche
   `waiting` attend son événement externe, et une tâche `finished` n'est jamais relancée.
4. **Événements système** : `TurnTimeoutError` devient `TIMEOUT` (réessai décidé par le réducteur).
   `EnvFailureError` **et toute erreur imprévue** deviennent `ENV_FAILURE` (escalade), ce qui évite de
   consommer le budget de réessais sur un bogue (D25).
5. **Attente sans blocage** : un effet qui ne renvoie aucun événement laisse la tâche `waiting`. La
   suite arrive par `dispatch` (par exemple `HUMAN_DECISION`, D31).
6. **Annulation** : un `AbortSignal` est transmis à l'effet en cours. Aucun nouvel effet ne démarre,
   les effets en attente sont vidés et `ABORT` est appliqué.
7. Une file par tâche sérialise transitions et effets. Les tâches sont indépendantes entre elles.
8. **Stockage provisoire** : JSON, un fichier par tâche, écriture atomique, validé à la lecture
   (`createJsonTaskStore`). Il est derrière `TaskStore` : le passage à SQLite (hypothèse d'O6) ne
   touchera que l'implémentation.

## Conséquences

- Un checkpoint par effet a un coût : chaque tâche désigne ses effets sans écriture (vérifications en
  lecture seule, notifications) via `checkpointBefore`.
- Le budget de réessais reste dans le réducteur (D24) : le moteur ne réessaie jamais de lui-même.
