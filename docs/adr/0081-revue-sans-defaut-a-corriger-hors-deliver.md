# ADR 0081 — Une revue sans défaut à corriger ne fait plus rejouer la phase, hors DELIVER

## Statut

**Accepté** le 2026-11-11 par le responsable du projet. Il a validé la proposition « une revue sans
défaut bloquant ni majeur doit passer : c'est la gravité des défauts qui décide, pas le verdict de
la lentille ».

Précise SPEC-skraft §9.3 pour RESEARCH, DESIGN et DISTILL. DELIVER garde la règle de l'ADR 0062.
Concerne l'extension (`extensions/skraft`) et le workflow (`workflows/skraft`), donc le serveur MCP.

## Contexte

La synthèse du code (`synthesize`, SPEC-skraft §9.3) n'approuve une revue que si toutes les
lentilles rendent `APPROVED`. Une lentille qui répond « changements demandés » sans défaut bloquant
ni majeur donne donc `CHANGES_REQUESTED`. Cela arrive dans deux cas : elle n'a relevé que des
mineurs, ou le réfutateur (ADR 0069) a écarté ses défauts majeurs.

En DELIVER, l'ADR 0062 règle ce cas : les mineurs sont corrigés de façon ciblée, et une revue sans
aucun défaut est escaladée sans consommer d'essai. Dans les autres phases, rien ne le réglait : la
phase était rejouée avec le motif « Revue « changements demandés » sans défaut bloquant ni majeur à
corriger ». Le producteur n'avait rien à corriger, et chaque tour consommait un essai.

Au run 4 de LEC-1 (freecompub/AgentStudio#32), deux revues de DISTILL de ce genre ont épuisé le
budget de la phase et provoqué la seconde escalade. Le run a été arrêté après 1 h 23 et 30,12 $.

## Décision

Hors DELIVER, une revue `CHANGES_REQUESTED` dont aucun défaut bloquant ni majeur ne reste actif
(`revueSansDefautCorrigible`) :

1. **est approuvée** si aucune lentille n'a rendu `REJECTED` et si chaque question de revue a sa
   lentille. Les défauts mineurs restent consignés dans le rapport de revue
   (`reviews/<phase>-review-<n>.md`) ;
2. **est escaladée sans consommer d'essai** sinon : une lentille `REJECTED` sans défaut à corriger,
   ou une question de revue restée sans lentille. Le producteur ne peut pas y répondre, l'humain
   décide.

La fonction `synthesize` ne change pas : son verdict reste celui de SPEC-skraft §9.3, et DELIVER
s'en sert pour sa propre règle (ADR 0062). La décision porte sur ce qui suit un verdict
`CHANGES_REQUESTED` qui ne laisse rien à corriger.

## Conséquences

- Une revue de RESEARCH, DESIGN ou DISTILL ne consomme plus d'essai sans motif à corriger.
- Un défaut mineur n'est plus corrigé hors DELIVER. Il ne l'était pas non plus avant, puisque seuls
  les défauts bloquants et majeurs sont transmis au producteur (SPEC-skraft §9.3).
- Une lentille `REJECTED` seule, sans défaut, va à l'humain au lieu de faire rejouer la phase.

## Alternatives

- **Changer `synthesize`** pour approuver toute revue sans défaut majeur. Écarté : cela aurait
  changé DELIVER, que l'ADR 0062 règle autrement (ses mineurs y sont corrigés).
- **Faire corriger les mineurs dans toutes les phases**, comme DELIVER. Écarté : un mineur ne
  justifie pas un essai de plus dans une phase de conception, et les mineurs n'y étaient jamais
  transmis au producteur.
- **Relancer la lentille** au lieu d'escalader, quand elle rend `REJECTED` sans défaut. Écarté pour
  l'instant : une lentille qui rejette sans dire pourquoi a besoin d'un humain, pas d'un nouveau tour.
