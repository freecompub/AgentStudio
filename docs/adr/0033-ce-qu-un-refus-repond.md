# ADR 0033 — Un refus dit ce que le rôle **peut** faire, pas pourquoi on a fermé la porte

- Statut : **décidé**, 2026-09-29
- Contexte amont : D28 (garde de permissions), D20 (les preuves viennent du code), ADR 0032 (trace)

## Contexte

La trace introduite par l'ADR 0032 a livré, en quatre lignes et dès le premier run, la réponse à
une question restée ouverte sur deux runs entiers :

```
deny  shell  ls -la .skraft/us-2/research/ 2>/dev/null && find .skraft -type f
```

Le chercheur ne cherchait pas à écrire son document, ni à lancer des tests : il voulait **lire**,
savoir ce que contenait `.skraft/`. J'avais affirmé le contraire avec assurance, faute de trace.

La garde refusait — à raison. Mais elle répondait :

> Le shell est désactivé pour ce rôle : **les tests sont lancés et vérifiés par l'orchestrateur**.
> Modifie les fichiers avec **les outils d'édition**, puis termine ta phase.

Deux défauts dans une seule phrase : une justification qui ne concerne pas ce que l'agent faisait —
il n'y a aucun test en RESEARCH —, et une consigne qui l'oriente vers l'**écriture** quand il
cherchait à **lire**. Au run précédent, dix-huit refus successifs n'avaient pas suffi à lui faire
trouver la sortie ; il avait fini par déclarer sa phase sans document, et la porte l'avait recalé.

## Décision

1. **Le refus de shell reste total, sans exception.** Décider qu'une commande est inoffensive
   demanderait de l'analyser, et `ls -la .skraft; rm -rf /` ou `find . -exec …` passeraient
   n'importe quelle liste blanche. Ce n'est pas le refus qui était fautif, c'est sa réponse.
2. **Le motif nomme les sorties qui existent pour ce rôle**, et elles seules. La garde reçoit donc
   les outils du rôle. Un chercheur ne s'entend plus parler de tests ; un rôle en lecture seule ne
   s'entend pas proposer d'écrire.
3. **La lecture est nommée en premier**, parce que c'est ce que la trace montre que les agents
   tentent — et c'est ce que l'ancien message passait entièrement sous silence.
4. **La raison donnée est la vraie** : aucune commande n'est autorisée, même en lecture. Invoquer
   l'exécution des tests était un raccourci correct pour un rôle sur sept.

## Conséquences

- Un test existant exigeait `reason: /orchestrateur/` : il encodait le message fautif. Réécrit pour
  n'exiger que le refus, le motif étant vérifié à part.
- La règle générale qu'on en tire : **un refus s'adresse à quelqu'un qui doit continuer à
  travailler.** Il doit donc énoncer la sortie, pas la justification interne de la fermeture.
  Les autres motifs de la garde — écriture hors périmètre, lecture hors projet — nomment déjà le
  périmètre autorisé ; celui du shell était le seul à ne rien proposer d'utile.
- Ceci ne dit pas si le chercheur trouvera la sortie. C'est mesurable au prochain run, et c'est la
  seule façon de le savoir : deux runs ont déjà échoué au même endroit.
