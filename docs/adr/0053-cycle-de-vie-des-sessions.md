# ADR 0053 — La mémoire d'un agent se déclare, et un redémarrage l'efface toujours

- Statut : **décidé**, 2026-10-05 — non implémenté (plan : `docs/09-workflows-rejouables.md` §14)
- Précise : **D17** (une session neuve par phase ou par rôle)
- Complète : ADR 0030 (reprise après interruption), ADR 0039 (une session par phase et par rôle,
  pas par essai), ADR 0050 (le dépôt et la mémoire reviennent au même point)
- Détail : `docs/09-workflows-rejouables.md` §9

## Contexte

Aujourd'hui, la rétention des sessions suit l'ADR 0039 : un tour clos normalement garde sa session
pour le tour suivant du même rôle dans la même tâche ; les plafonds l'excluent (ADR 0030) ;
`releaseTask` supprime tout en fin de tâche ; l'escalade fait oublier les rôles de la phase
(ADR 0050). Trois défauts :

1. **Rien ne se déclare.** La règle est codée en dur dans le cœur, la même pour tous les agents.
   Une extension ne peut pas dire qu'un agent (une lentille de revue, par exemple) doit repartir
   neuf à chaque appel.
2. **Un crash laisse des sessions orphelines.** Le lien entre un rôle et sa session ne vit que dans
   une `Map` en mémoire (`reprenables`, `packages/core/src/agents/task-agent-runner.ts`). Après un
   crash, les agents repartent neufs — le bon comportement, obtenu par accident — mais personne ne
   connaît plus les identifiants, et les sessions restent sur le disque côté Copilot CLI.
3. **L'extension doit lister elle-même les rôles à oublier** (`phaseRoles`). L'ADR 0050 est né
   d'un oubli dans une liste de ce genre.

## Décision

1. **Chaque agent déclare sa mémoire dans le manifeste** : `memoire: "tache"` (défaut : gardée
   d'un tour à l'autre dans la tâche, ADR 0039) ou `"tour"` (neuve à chaque appel). Le script ne
   peut pas la changer.
2. **Le script peut seulement faire oublier** (`w.oublier(agents)`), jamais forcer la reprise
   d'une session.
3. **Rembobiner fait oublier automatiquement** tous les agents qui ont travaillé depuis le
   checkpoint visé. La plateforme le sait par le journal ; l'extension n'a plus de liste à tenir.
4. **Crash, redémarrage ou fermeture normale de l'application : toutes les sessions des tâches
   en cours sont supprimées**, et chaque agent repart neuf avec son dossier de passation. Les
   identifiants de session sont **persistés avec la tâche** pour rendre cette suppression
   possible.
5. **Fin de tâche, quelle que soit l'issue** (réussite, abandon, échec, annulation) : toutes les
   sessions sont supprimées, comme `releaseTask` aujourd'hui.
6. **Un plafond de durée, de coût ou de contexte** exclut toujours la reprise (ADR 0030, inchangé).

## Pourquoi ne pas reprendre une session après un crash

Le tour en cours au moment du crash est rembobiné (D23), mais la session Copilot contient déjà ses
appels d'outils, et le SDK ne sait pas tronquer une conversation. La reprendre donnerait un agent
qui se souvient de fichiers effacés : exactement l'incohérence corrigée par l'ADR 0050.

La fermeture normale suit la même règle : une seule règle à retenir, et pas de sessions qui
traînent pendant une attente humaine de plusieurs jours. Le prix : l'agent relit le dépôt après
la pause.

## Conséquences

- **La mémoire est un confort, jamais une condition de correction.** Toute consigne et tout
  dossier de passation (SPEC §6.6) doivent suffire à un agent qui repart de zéro.
- Le défaut 2 existe indépendamment des workflows : il se corrige en premier, sur une branche
  `fix/` (identifiants persistés, suppression au redémarrage et à la fermeture, avec un test qui
  simule le crash).
- La question des « sessions conservées » au-delà de l'orchestration ne se pose plus : une session
  vit au plus le temps de sa tâche, et au plus le temps du processus qui l'a ouverte.
