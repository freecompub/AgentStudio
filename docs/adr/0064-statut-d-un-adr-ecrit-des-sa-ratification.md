# ADR 0064 — Le statut d'un ADR est écrit dès sa ratification

## Statut

Accepté le 2026-10-11 par l'utilisateur (défaut D3 de `docs/12-audit-portes-lentilles-skraft.md`).

## Contexte

La ratification ne changeait le statut d'un ADR qu'en mémoire ; le fichier n'était basculé qu'une
fois **tous** les ADR décidés. Si l'un était accepté et un autre renvoyé en amendement, le fichier
de l'ADR accepté disait encore `Proposed` pendant l'amendement : l'architecte pouvait réécrire sa
décision, et le fichier final portait « Accepted » sur un texte que personne n'avait accepté.

## Décision

1. Chaque acceptation ou rejet écrit aussitôt le statut dans le fichier de cet ADR (extension :
   effet `applyAdrStatuses` à chaque décision ; workflow : `ratifier`).
2. Un ADR décidé est en **lecture seule** pour tous les agents (`readOnly` / `lectureSeule`, avec
   les fichiers gelés). Pour revenir dessus, l'architecte propose un nouvel ADR qui le remplace,
   ratifié à son tour.
3. Un ADR décidé n'est plus « nouveau » pour la porte cohérence : sa vérification « statut
   Proposed attendu » ne s'applique plus à lui.

Filets existants qui s'appuient désormais sur le fichier : `render_adr` refuse d'amender un ADR
« déjà Accepted » (extension) ; `controlerAdrs` annule toute réécriture d'un ADR qui n'est plus
`Proposed` et rejette le tour (workflow).

## Conséquences

- Le fichier dit toujours la vérité sur la décision, y compris en cours de ratification.
- Divergence assumée (ADR 0054) : une écriture qui contourne la garde (commande shell) est annulée
  par le workflow (`controlerAdrs`), pas par l'extension, qui n'a pas d'équivalent.
- Un rembobinage de DESIGN efface le statut écrit avec le reste ; la mémoire (`adrs`) doit être
  remise au même point : c'est le défaut D2, à corriger avec celui-ci en tête.
