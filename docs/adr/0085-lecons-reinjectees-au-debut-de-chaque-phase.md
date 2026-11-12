# ADR 0085 — Les leçons réinjectées au début de chaque phase

## Statut

**Accepté** le 2026-11-12 par le responsable du projet, qui a demandé de continuer après LEC-2 (LEC-3,
freecompub/AgentStudio#34). Deux choix sont **provisoires**, faute de décision : le classement par
dernière occurrence, et la forme de la trace des leçons injectées (points 2 et 5).

Concerne le workflow (`workflows/skraft`), donc le serveur MCP. L'extension `extensions/skraft` n'est
pas concernée (ADR 0054).

## Contexte

LEC-2 (ADR 0084) tire des leçons des erreurs répétées et les valide par le code. Elles ne servent à
rien tant qu'aucun agent ne les reçoit : les mêmes défauts reviennent, et coûtent des revues et des
réessais.

## Décision

1. **Au début de chaque phase**, le dossier de passation d'un agent contient la section « Erreurs déjà
   commises en <PHASE> sur ce projet (à éviter) », avec les leçons validées de sa phase et de son rôle.
   Chaque leçon donne sa règle, son identifiant, sa référence de catalogue, quand elle s'applique, quoi
   faire, et un exemple réel tiré d'une story précédente. Une phase sans leçon pour le rôle n'a pas de
   section. La section précède le « Rejet précédent ».
2. **Au plus six leçons et deux mille caractères**, classées par nombre de stories touchées, puis par
   dernière occurrence. *Provisoire* : le registre ne date pas les erreurs, la dernière occurrence est
   le rang de la dernière story touchée dans l'ordre des runs (`stories.jsonl`).
3. **Les lentilles** reçoivent les leçons validées de la phase, tous rôles, sous « Points de vigilance
   connus », suivies de la consigne que cette liste ne remplace pas leur examen général.
4. **Les leçons sont chargées une fois, au début du run** (`chargerLaMemoire`) : un run ne voit pas les
   leçons qu'il produit lui-même à sa fin.
5. **Chaque injection est notée** : la phase, le rôle (ou `lentilles`) et les identifiants. *Provisoire* :
   la liste est rendue dans la valeur finale du run (`leconsInjectees`, lisible par `skraft_rapport`),
   en plus du dossier de passation, journalisé avec l'appel de l'agent.
6. **Une récidive malgré une leçon** : une erreur de la story qui a la signature d'une leçon injectée
   dans un dossier de la même phase incrémente `recidivesMalgreLecon` de cette leçon, une fois par run.
   À deux récidives, le bilan la signale comme candidate à devenir une porte de code. Sa
   transformation en porte est hors périmètre.

## Conséquences

- `buildBrief` reste pur : l'appelant lui passe la section (`leconsPour`), et note l'injection.
- Un dossier de passation grossit d'au plus deux mille caractères par phase.
- Une leçon fausse serait répétée à chaque run : la vérification de LEC-2 et la ratification humaine
  des nouvelles entrées de catalogue en sont la garde.

## Alternatives

- **Injecter toutes les leçons du projet à chaque agent.** Écarté par la story : au plus six, celles de
  la phase et du rôle, pour rester un rappel.
- **Recharger les leçons à chaque phase.** Écarté : elles ne changent qu'à la fin d'un run.
