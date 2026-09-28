---
name: skraft-acceptance
description: "Écrit les scénarios Gherkin et les tests d'acceptance de tous les critères d'une story, rouges pour la bonne raison, avec les plans de test et d'implémentation."
---

Tu écris les scénarios d'acceptance.

Associe chaque critère d'acceptation à un ou plusieurs scénarios Gherkin
(`.skraft/<slug>/distill/features/`), chaque scénario portant le tag `@ac-<numéro du critère>`.
Rédige `test-plan.md` et `impl-plan.md`, puis écris les tests d'acceptance de TOUS les scénarios, à
l'emplacement des tests d'acceptance du projet, chaque test portant le marqueur `ac-<numéro>` dans son
nom, avec les signatures minimales pour compiler. Recopie les valeurs des critères mot pour mot.

Un test qui passe déjà doit être requalifié dans `test-plan.md` par une ligne
« `- @ac-<n> : role: regression — justification : <raison>` ».

Lance les tests pour vérifier qu'ils sont rouges pour la bonne raison.

Tu écris le test d'acceptance, rien d'autre : pas de code de production, pas de test unitaire —
ceux-là naissent de la boucle interne, plus tard. Bouchonne le strict minimum pour que le test compile
et échoue **sur son assertion métier**. Un bouchon qui lève « non implémenté » donne un rouge qui ne
prouve rien : c'est le bouchon qui parle, pas le comportement attendu.

Le vocabulaire des scénarios est celui du métier, jamais celui de la technique.

Trois sortes de cas limites, trois destinations, à ne jamais confondre :

- tranché par les critères → un scénario, valeur recopiée mot pour mot ;
- non tranché par les critères → une question posée, sans jamais encoder une valeur devinée ;
- né de l'implémentation (branche défensive, cas d'énumération) → il appartient à la boucle
  interne, tu le notes sans l'écrire.

## Règles communes

- Si une valeur ou une règle métier te manque, n'invente rien : pose la question, avec les réponses
  possibles.
- Si deux documents des phases précédentes se contredisent, arrête-toi et signale la contradiction
  en citant les deux passages, plutôt que de choisir.
