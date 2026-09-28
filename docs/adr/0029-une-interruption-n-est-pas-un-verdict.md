# ADR 0029 — Un tour interrompu n'est pas un travail jugé mauvais

- Statut : **décidé**, 2026-09-28
- Contexte amont : ADR 0026 et 0027 (plafonds de durée et de coût), D24 (défaut de travail =
  réessai), SPEC §6 (checkpoint avant chaque effet, rollback au rejeu)

## Contexte

Le réducteur de skraft traitait `TIMEOUT` par le **même chemin** qu'un refus de porte :

```ts
if (e.type === "TIMEOUT") return failure(s, "délai", [e.reason]);
```

et `failure` commence par `rollback` au checkpoint de phase.

Le 2026-09-28, le tour de `skraft-architect-model` a été coupé après 1 h 55. Tout ce que
l'architecte avait écrit — quinze documents de conception, un ADR — a donc été **effacé du dépôt**,
alors qu'aucune porte ne l'avait examiné.

Les deux situations ne se valent pas :

- une porte qui refuse a **jugé** le travail et l'a trouvé mauvais → l'annuler est juste ;
- un délai dépassé n'a **rien jugé** → on jette un travail dont personne n'a dit qu'il est mauvais.

C'est le motif que le projet traque, une fois de plus : traiter comme un verdict ce qui n'en est
pas un.

## Décision

1. **Un `TIMEOUT` relance sans `rollback`.** Le travail du tour interrompu reste sur le disque.
2. **Le tour suivant est prévenu**, en deux phrases dont la seconde compte autant que la première :
   que le tour précédent a été *interrompu* et non refusé ; et que ce qui a été écrit est resté,
   **possiblement incomplet**, donc à relire et terminer plutôt qu'à reprendre de zéro. Sans cette
   seconde phrase, l'agent relit des fichiers à moitié écrits en les croyant finis.
3. **L'escalade annule toujours**, quelle que soit la cause : quand la main repasse à l'humain, il
   doit retrouver un dépôt propre.
4. **Le budget d'essais est consommé comme avant.** Une interruption ne se rejoue pas sans fin.
5. Un refus de porte (`GATE_FAIL`) et une revue défavorable gardent leur `rollback` : là, un
   jugement a eu lieu.

## Conséquences

- La sécurité ne repose pas sur ce `rollback`, et n'en dépendait pas : **la porte de fin de phase
  juge l'état final**, quel qu'ait été le chemin pour l'atteindre. Un tour interrompu qui laisse du
  travail bancal sera recalé par elle, exactement comme avant.
- Le test qui s'appelait « TIMEOUT d'un agent = GATE_FAIL » portait dans son intitulé l'équivalence
  qu'on casse. Il a été **réécrit**, pas supprimé : l'équivalence tenait sur la relance et le
  budget, elle ne tient pas sur le rollback.
- Ceci vaut pour les trois causes d'interruption — silence, plafond de durée, plafond de coût — qui
  arrivent toutes au réducteur comme `TIMEOUT`. Le réducteur ne les distingue pas ; l'exécuteur
  d'agents, lui, les distingue (ADR 0030).
