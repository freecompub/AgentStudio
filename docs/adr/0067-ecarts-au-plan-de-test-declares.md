# ADR 0067 — Écarts au plan de test, déclarés par l'agent et vérifiés par le code

## Statut

Accepté le 2026-10-15 par l'utilisateur (`docs/15-agents-face-a-skraft-plugin.md` §5, reprise de
`PLAN_DEVIATION` de skraft-plugin v1.15.1). Même comportement dans l'extension `skraft` et dans le
workflow `workflows/skraft/`.

## Contexte

Depuis le 15/10 (docs/15 §4.7), la porte « plan de test » de DISTILL exige une matrice de
couverture : pour chaque critère, la couche et la doublure de ses tests. Le testeur et le
développeur de DELIVER doivent la respecter. Il arrive qu'une skill chargée interdise le choix
prévu : par exemple, `clean-architecture-testing` veut qu'un invariant se teste dans le domaine,
alors que la matrice prévoyait l'application.

Le plugin (v1.15.1, `software-engineer`) l'autorise à une condition : écrire
`PLAN_DEVIATION: {ligne} — {prévu} → {réel} — {règle}` dans un journal tenu par l'agent, que les
lentilles lisent ensuite. Rien ne vérifie la déclaration.

Le code ne peut pas voir lui-même qu'un test est écrit à une autre couche : cela dépend des
conventions de chaque projet.

## Décision

1. **Déclaration structurée.** L'outil terminal du cœur `report_phase` gagne un champ facultatif
   `planDeviations` : une entrée par écart, avec le critère (`ac-N`), le prévu, le réel et la règle
   (chacun non vide). Les autres rôles l'ignorent.
2. **Vérification par le code.** La matrice est gardée à la fin de DISTILL (`planDeTest`). Un écart
   dont le critère n'est pas dans la matrice, ou dont le prévu ne reprend pas sa ligne (couche et
   doublure), **refuse le pas** avec un motif précis (`verifierEcarts`).
3. **Conservation avec le pas.** Un écart n'est gardé que si la porte du pas valide le pas. Il est
   effacé avec ses tests quand le scénario repart de son début, ou quand DELIVER est rembobinée.
4. **Traçabilité.** Les écarts sont donnés comme faits à la revue de DELIVER, écrits dans
   `.skraft/<slug>/deliver/ecarts-au-plan.md` (commité avec la livraison) et cités dans le rapport
   final.
5. **Jugement par les lentilles.** `test-integrity` : un écart non déclaré est un défaut, un écart
   déclaré se juge sur sa règle. `quality-gates` : chaque critère a au moins un test fidèle à sa
   ligne, sauf écart déclaré.
6. **Prompts.** Le contenu partagé du testeur et du développeur dit la règle, sans nommer d'outil
   (ADR 0024) ; la consigne d'orchestration nomme `planDeviations` et le chemin du plan.

## Conséquences

- Un écart est toujours explicite, vérifié dans sa forme et visible dans l'historique du projet.
- La justesse de l'écart (la règle l'impose-t-elle vraiment ?) reste un jugement, confié à la revue.
- Le contrat de `report_phase` change pour tous les agents ; le champ est facultatif, aucun
  compte rendu existant n'est invalidé.
- Pas d'entrée de trace dédiée : un écart refusé est tracé comme le rejet de son pas, un écart
  accepté vit dans `ecarts-au-plan.md` et le rapport final.
