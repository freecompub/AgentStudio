# ADR 0073 — Disjoncteur des réessais : deux refus identiques de suite, on escalade

## Statut

**Accepté** le 2026-11-07 par le responsable du projet, branche `feat/disjoncteur`. Le responsable a
demandé de reprendre le disjoncteur de skraft-plugin v2 (comparatif du 06/11, `progress.md`, lot [1]),
puis a validé sa portée ci-dessous. Concerne l'extension `skraft` et le workflow `workflows/skraft/`.

## Contexte

Un travail refusé par une porte est relancé avec le motif du refus, dans la limite d'un budget
(3 essais par défaut). Quand l'agent échoue deux fois **exactement de la même façon**, le troisième
essai refait presque toujours la même erreur : il coûte un tour, et l'escalade arrive quand même.
skraft-plugin v2 arrête dès deux échecs identiques (« circuit breaker »).

## Décision

1. **Même refus** : même porte, et même ensemble de motifs (espaces de début et de fin ignorés,
   ordre indifférent). Un motif différent, même proche, n'est pas le même refus.
2. Au deuxième refus identique **de suite**, l'escalade est immédiate, comme un budget épuisé ; son
   motif commence par « Même refus deux fois de suite : ». Les options de l'escalade ne changent pas
   (celles de l'ADR 0066 comprises).
3. Il s'applique là où un budget de réessais se consomme : portes de phase, pas de DELIVER,
   reprises d'un scénario.
4. Ne comptent pas : un tour **interrompu** (délai, panne : un délai se réessaie, SPEC §6) ; la
   première ronde d'une revue garantie ; un refus non compté.

## Conséquences

- Au plus un essai épargné par niveau avec le budget par défaut, et une escalade plus tôt quand
  l'agent tourne en rond.
- Le cas rare d'un troisième essai qui aurait réussi après deux refus identiques passe par l'humain,
  qui peut relancer.
