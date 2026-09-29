# ADR 0043 — Une règle sans contre-exemple ne tient pas

- Statut : **décidé**, 2026-09-29
- Contexte amont : ADR 0024 (agents et skills en Markdown : le contenu ne nomme aucun outil
  d'agent-studio, l'orchestration est dans le manifeste), ADR 0033 (ce qu'un refus répond),
  ADR 0042 (la revue a droit à un essai)

## Contexte

Run du 29/09 : DISTILL a dépensé deux de ses trois essais sur la porte des valeurs, qui exige que
chaque valeur d'un critère soit recopiée **caractère par caractère** dans le scénario et dans le
test. L'agent écrivait des scénarios justes de sens mais reformulés :

```
critère    ligne de 9 articles à 2,00 € : remise 0,00 €
écrit      Quand une petite quantité est commandée / Alors aucune remise n'est accordée
```

L'instruction existait déjà, dans `skraft-acceptance.agent.md` :

> Recopie les valeurs des critères mot pour mot.

Une phrase, en fin de paragraphe, sans exemple, sans contre-exemple, et qui ne dit pas ce que la
porte compare réellement. Elle a été lue et appliquée de travers deux fois de suite — ce qui a
ensuite privé la revue de tout budget (ADR 0042).

C'est le même constat que l'ADR 0033 pour le refus de shell : un message correct mais qui ne dit
pas ce qu'il faut faire ne produit pas le comportement attendu, et l'agent paie la différence en
essais.

## Décision

1. **La norme de recopie devient une section illustrée** : ce que la comparaison regarde (les
   caractères, pas le sens), un critère réel, la liste de ses valeurs, puis un scénario ✗ et un
   scénario ✓ qui disent la même chose — seul le second étant vérifiable.
2. **La norme de nommage devient explicite** : le marqueur `ac-<n>` va dans le **nom du test**,
   avec deux formes acceptées et une refusée en exemple. Elle remplace la phrase ajoutée au
   dossier de passation par l'ADR 0041 : c'est une règle **statique**, sa place est dans le
   contenu de l'agent, pas dans un brief construit par le code (ADR 0024). Seul l'emplacement des
   fichiers reste dynamique, car lui dépend de la stack.
3. **Les exemples sont vérifiés par des tests**, pas seulement relus : chaque forme de nom donnée
   en exemple est passée à la fonction qui relie un résultat à son critère, et doit rendre ce que
   l'exemple promet.

## Conséquences

- Le contenu reste **partageable** (ADR 0024) : la norme parle de Gherkin, de noms de tests et de
  valeurs, jamais d'un outil d'agent-studio. Un test le vérifie, comme pour les autres agents.
- La norme reste **indépendante des langages** (D10) : les deux formes de nom données en exemple
  couvrent les conventions courantes, et le texte invite explicitement à suivre celles du projet
  pourvu que le numéro reste lisible dans le nom.
- **Ceci ne garantit rien.** Un prompt mieux écrit rend un comportement plus probable, il ne
  l'impose pas ; c'est la porte, et elle seule, qui décide. L'ADR 0042 reste le filet.
- Deux redites ont été retirées du fichier plutôt que laissées s'accumuler : la phrase sur le
  vocabulaire métier, et « valeur recopiée mot pour mot » dans la liste des cas limites, qui
  renvoie désormais à la section qui la définit.
- À VÉRIFIER au prochain run : c'est une hypothèse sur un comportement, pas un théorème. Si DISTILL
  perd encore des essais sur cette porte, c'est la porte qu'il faudra regarder, pas le prompt.
