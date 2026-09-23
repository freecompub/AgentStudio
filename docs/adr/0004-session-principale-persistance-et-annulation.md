# ADR 0004 — Session principale : reprise, persistance et annulation par tour

- Statut : accepté (persistance : **provisoire**, O6 ouvert)
- Date : 2026-09-23
- Jalon : J1

## Contexte

Critères de sortie de J1 : mener une conversation complète sur un dépôt cloné, avec checkpoint et
annulation en un geste, puis reprendre cette conversation après un redémarrage. Le port `AgentRuntime`
de la spec (§4.3) ne prévoit ni la reprise d'une session ni l'arrêt du runtime.

## Décision

1. **Extension du port** `AgentRuntime` : ajout de `resumeSession(id, cfg)`, `stop()` et de la capacité
   `resumableSessions`. `AgentSessionConfig` reçoit un `guard: ToolCallGuard`, l'arbitre unique de la
   session que l'adaptateur consulte avant chaque outil. L'adaptateur transforme toute exception ou tout
   délai dépassé en refus (D28).
2. **Événements normalisés** `AgentEvent` (`message`, `message-delta`, `tool-start`, `tool-end`,
   `tool-denied`, `idle`, `error`, `activity`…) : le cœur ne voit jamais les événements du SDK.
3. **Tour d'agent** : `runTurn` fait `send()` non bloquant, avec un chronomètre d'inactivité réarmé
   par chaque événement (D30). Aucun `sendAndWait`.
4. **Checkpoint avant chaque tour** de la session principale, rattaché au message utilisateur.
   *Annuler* un tour restaure ce checkpoint et marque ce tour et les suivants comme annulés. Au tour
   suivant, l'agent reçoit une note explicite lui signalant l'annulation, car sa mémoire de
   conversation n'est pas réécrite.
5. **Persistance provisoire (O6)** : la conversation affichée est stockée en JSON, un fichier par
   espace de travail dans le profil utilisateur, avec écriture atomique et validation Zod à la lecture.
   Un fichier corrompu est mis de côté, pas supprimé. Le tout est derrière le protocole
   `ConversationStore` : passer à SQLite ne touchera que l'implémentation.
6. Si la reprise côté runtime échoue, une nouvelle session est ouverte, l'historique affiché est
   conservé et un avis prévient l'utilisateur que l'agent ne s'en souvient plus.

## Conséquences

- La même mécanique de checkpoint servira au moteur de tâches (J2).
- Le message utilisateur est persisté **avant** le tour : un plantage en plein tour ne le perd pas.
- O6 reste ouvert pour l'état des tâches ; la décision définitive sera prise en J2.
