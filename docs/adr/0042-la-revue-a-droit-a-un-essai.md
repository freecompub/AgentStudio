# ADR 0042 — La revue a droit à un essai, même quand les portes de forme ont tout dépensé

- Statut : **décidé**, 2026-09-29
- Contexte amont : D24 (défaut de travail = réessai, budget par phase), ADR 0016 (portes valeurs et
  RED de DISTILL), ADR 0018 (revue par lentilles), ADR 0040 (un réessai n'annule rien)

## Contexte

Run du 29/09, DISTILL relancée depuis une base où RESEARCH et DESIGN étaient déjà produites :

```
essai 1   porte valeurs   rejet — « 10 articles ou plus : 5 % » absent du scénario @ac-1
essai 2   porte valeurs   rejet — même famille
essai 3   portes valeurs et RED franchies → la revue siège
          cold-reader   CHANGES_REQUESTED  [major] Facture.ATPayer ignore Remise
          architecture  CHANGES_REQUESTED  [major] le contrat ratifié exige
                                           SommeDesArticles - Remise + FraisDePort
```

Deux défauts **majeurs, précis et corrigeables**, qui désignent une ligne de code et un contrat de
conception ratifié. Ils sont partis en **escalade** : `attempts` valait 3, le budget de la phase
était épuisé. Aucun tour n'a pu y répondre, et l'escalade a rembobiné les quatre livrables.

Le budget est **commun** aux portes de forme et à la revue. Or les rejets qu'elles produisent ne
sont pas du même ordre :

- une porte de forme constate une **divergence mécanique** — une valeur qui n'est pas recopiée ;
- la revue rend un **jugement sur le fond** — un calcul qui ignore une remise.

Recopier « 2,00 € » dans un Gherkin et rebrancher `Facture.ATPayer` ne demandent ni le même travail
ni le même nombre de tours. Les faire puiser dans le même compteur fait qu'un agent peut épuiser sa
réserve sur de la mise en forme, et n'avoir plus rien quand arrive le vrai sujet. La revue est de
surcroît **toujours dernière** : elle ne siège qu'une fois les portes franchies, donc elle est la
seule à pouvoir hériter d'un budget vide.

## Décision

1. **La première revue d'une phase obtient un essai**, quel que soit le budget restant. `failure()`
   prend un `essaiGaranti` ; un seul appelant le passe, le site de la revue, et seulement quand
   `reviews[phase].length === 1`.
2. **Une seule fois.** Une deuxième revue défavorable escalade normalement. Sans cela, revue et
   correction pourraient s'enchaîner sans fin.
3. **Rien d'autre ne change.** Une porte de forme à budget épuisé escalade comme avant ; un verdict
   `REJECTED` escalade toujours — ce n'est pas une demande de changement, c'est un refus.

## Conséquences

- Le budget effectif d'une phase revue passe de `maxAttemptsPerPhase` à `maxAttemptsPerPhase + 1`
  dans le seul cas où la revue rend des changements demandés après un budget consommé. C'est un
  ajustement, pas un nouveau seuil : aucun chiffre n'est introduit, et l'ADR 0031 nous a appris ce
  que valent les seuils qu'on n'a pas mesurés.
- L'état porte déjà ce qu'il faut pour décider : `reviews[phase]` compte les revues tenues. Aucun
  champ n'est ajouté, donc aucune migration de `schemaVersion`.
- **Ne corrige pas la cause profonde.** Les deux rejets de la porte des valeurs étaient justes —
  l'agent paraphrasait au lieu de recopier. Qu'il lui faille deux tours pour comprendre ce qu'exige
  cette porte reste un problème ouvert, du côté de ce que la porte *dit*, pas du budget.
- Le run qui a motivé cet ADR reste à rejouer : il s'est arrêté sur cette escalade.
