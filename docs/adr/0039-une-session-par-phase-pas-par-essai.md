# ADR 0039 — Une session par phase et par rôle, pas par essai

- Statut : **décidé**, 2026-09-29
- Précise : **D17** (« une session neuve par phase/rôle »)
- Contexte amont : ADR 0030 (reprise après interruption), ADR 0031 (plafond sur le contexte),
  ADR 0037 (l'orchestrateur prépare l'arborescence)

## Contexte

Sixième run sur US-2. DESIGN est recalée par sa porte de cohérence :

> `CalculeRemise` cité dans `contracts.md` n'existe pas dans `event-model.md` ni dans
> `domain-model.md`.

Une incohérence de **nommage**. L'architecte sait exactement ce qu'il a écrit et où. Pourtant, à
l'essai 2, il repartait d'une session vide : sa conversation comptait 3 messages et 605 tokens. Pour
renommer un identifiant, il devait relire tout le dépôt, reconstruire son modèle et réécrire quinze
documents.

**D17 ne demandait pas cela.** Il dit « une session neuve **par phase/rôle** ». Trois essais de
DESIGN par `skraft-architect-model` sont la même phase et le même rôle. L'implémentation était plus
stricte que la décision — une session neuve par **essai** — et personne ne l'avait remarqué.

C'est le même raisonnement qui avait validé l'ADR 0030 : la règle vise les **passages de phase**,
pas les tours à l'intérieur d'une phase.

## Décision

1. **Un tour clos normalement garde sa session.** Le tour suivant du même rôle dans la même tâche la
   reprend, avec les motifs du rejet.
2. **Les plafonds restent une exception** (ADR 0030) : un tour coupé pour cause de durée, de coût ou
   d'occupation du contexte n'est **jamais** repris. Là, le contexte *est* le problème ; le renvoyer
   retaperait le plafond. Un test le défend, pour qu'on ne relâche pas les deux règles d'un coup.
3. **Les sessions sont libérées quand la tâche se termine** (`releaseTask`). Sans ce point, elles ne
   seraient plus jamais supprimées et leur état s'accumulerait sur le disque. Elles restent
   éphémères — à l'échelle de la **tâche** et non du tour.
4. **Un seul exécuteur d'agents** pour toutes les extensions : la clé de continuité porte déjà
   l'identifiant de l'extension, et la libération doit atteindre les sessions d'une tâche où
   qu'elles aient été ouvertes.

## Conséquences

- Le garde-fou contre l'ancrage — un agent qui défendrait son travail au lieu de le revoir — reste
  le **budget d'essais**, puis l'escalade vers l'humain avec les motifs. Il était déjà là ; on ne
  lui ajoute pas une amnésie forcée.
- Le coût en contexte s'accumule sur les essais d'une phase. C'était dangereux avant l'ADR 0031 ;
  ça ne l'est plus : on coupe à 90 % de la fenêtre réelle, et le runtime compacte avant.
- **Trois tests affirmaient l'ancienne règle** et ont été réécrits en le disant. Celui de bout en
  bout de l'extension `tdd` vérifie désormais davantage : quatre tours, **trois** sessions
  distinctes — le développeur enchaîne « vert » puis « nettoyage » dans la même —, et toutes
  supprimées à la fin. Il comparait auparavant deux comptes égaux, ce qui masquait ce qui se
  passait.
- Le banc de test de `tdd` relaie la libération comme l'application le fait. Sans ce relais, il ne
  vérifierait plus rien de ce cycle.
