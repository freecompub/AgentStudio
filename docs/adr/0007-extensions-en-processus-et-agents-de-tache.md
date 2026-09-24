# ADR 0007 — Extensions en processus, API ctx 0.1 et agents de tâche

- Statut : accepté
- Date : 2026-09-23
- Jalon : J2 (§5, §6.5, §8, D10, D11, D12, D17, D18, D31)

## Contexte

J2 demande un registre, un routeur, une API `ctx` minimale et l'extension `tdd` **chargée en
processus**. L'isolation en `utilityProcess` viendra au J4. Il faut que le passage de l'un à l'autre
ne change ni l'API vue par l'extension ni les services du cœur.

## Décision

1. **`packages/extension-api`** porte les types publics (manifeste, `ExtensionContext`), version 0.1
   non figée (D14). Le contexte n'expose que des résultats sérialisés : `agents.run` renvoie la sortie
   de l'outil terminal, jamais une session (D10).
2. **`packages/extension-host`** : `activateInProcess(ext, deps)` construit le `ctx` au-dessus des
   services du cœur, qui sont tous des protocoles (registre, moteur, exécuteur d'agents, Workspace,
   adaptateur de stack, interactions, sortie de chat). Au J4, ce même contexte vivra côté principal,
   derrière un RPC.
3. **Permissions appliquées dès J2** (D11) : chaque méthode de `ctx` exige la permission déclarée
   (`fs:read`, `git:commit`, `git:revert` pour un rollback, `shell:test`, `copilot:sessions`). Les
   commandes, agents et tâches doivent figurer au manifeste. Le périmètre d'écriture d'un agent doit
   être couvert par une permission `fs:write:<glob>`.
4. **Registre unique** (D12) : nom complet `<extension>/<nom>`, alias court seulement s'il est sans
   collision. **Routeur** : `/commande` va à l'extension (le message est consigné avant exécution),
   le texte libre va à la session principale, et une commande inconnue produit un avis, jamais un
   envoi à l'agent.
5. **Exécuteur d'agent de tâche** : une session neuve par appel (D17), une garde propre au rôle
   (lecture dans le projet, écriture dans le seul périmètre, ni shell, ni réseau, ni MCP), un outil
   terminal validé par schéma (D18), une seule relance si la sortie manque (sinon `WorkDefectError`,
   donc un réessai), puis fermeture **et suppression** de la session.
6. **Demandes d'interaction** (D31) : service `request` / `respond` / `pending`. La réponse est
   validée (option proposée, demande encore ouverte) puis livrée comme `HUMAN_DECISION`. Stockage
   derrière `InteractionStore` : en mémoire au J2, persistant au J3.
7. **Runtime paresseux** : les services d'un projet s'assemblent avant toute connexion ; le runtime
   Copilot n'est obtenu (authentification comprise) qu'au premier agent lancé.
8. `engine.dispatch` rend la main dès que la transition est persistée, sans attendre les effets. Une
   réponse de l'interface ne reste jamais bloquée pendant un tour d'agent.

## Conséquences

- Les tests de bout en bout de `tdd` assemblent la vraie pile (Git, Vitest, moteur, hôte, exécuteur)
  avec un runtime scripté : aucun appel au LLM en CI (§16).
- L'extension n'a pas de `writeFile` dans `ctx` : seuls ses agents écrivent, sous garde. À revoir
  quand une extension en aura besoin.
