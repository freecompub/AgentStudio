# ADR 0090 — La porte des valeurs avertit sans bloquer

## Statut

**Accepté** le 2026-11-13 par le responsable du projet : « c'est 3 et 4 qui doivent être des warnings »,
« on informe l'utilisateur de ce warning », puis « je veux également ne plus demander à l'utilisateur
de confirmer les nombres dans la première phase ». Remplace l'ADR 0080.

Précise SPEC-skraft §6.1 et §7.3. Concerne l'extension (`extensions/skraft`) et le workflow
(`workflows/skraft`), donc le serveur MCP.

## Contexte

La porte des valeurs de DISTILL faisait quatre contrôles par critère : un scénario tagué `@ac-<n>`, un
test d'acceptance marqué `ac-<n>`, chaque valeur du critère dans le scénario, chaque valeur dans le
test. Les deux derniers refusaient souvent pour de mauvaises raisons : une valeur testée sous une autre
forme (`0.05` pour « 5 % », un montant en centimes, une valeur lue du Gherkin par les étapes). L'ADR 0080
y avait répondu en demandant à l'humain, avant RESEARCH, s'il fallait tester chaque nombre seul d'un
critère : une question de plus par nombre, au début de chaque run.

## Décision

1. **Bloquant** : un scénario tagué et un test marqué par critère.
2. **Avertissement non bloquant** : une valeur du critère absente de son scénario ou de son test.
   L'avertissement est :
   - montré à l'utilisateur, dans un message « Porte des valeurs — avertissement non bloquant » ;
   - rendu à l'agent d'acceptance par `verifier_scenarios`, après ses motifs, comme non bloquant ;
   - donné à la revue de DISTILL comme fait établi par le code, à juger : la valeur est-elle testée
     sous une autre forme ? Une lentille qui juge que non le dit, et la revue renvoie la phase.
3. **Plus de question sur les nombres** des critères avant RESEARCH : les valeurs douteuses de
   l'ADR 0080, leur question, leur retrait et la ligne du bilan sont supprimés.

## Conséquences

- Un run ne pose plus une question par nombre seul d'un critère.
- Une valeur réellement absente n'est plus arrêtée par le code : c'est la revue qui la juge. La garde
  mécanique qui restait est que chaque critère a un scénario et un test.
- Un écart de forme ne coûte plus un essai de DISTILL.

## Alternatives

- **Garder le refus quand le test ne porte aucune des valeurs de son critère**, et avertir sinon.
  Proposé, écarté par le responsable : les deux contrôles avertissent.
- **Garder la question de l'ADR 0080.** Écarté : elle n'a plus d'objet quand la porte n'exige plus les
  valeurs.
