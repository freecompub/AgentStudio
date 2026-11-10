---
name: skraft-demarrer
description: "Démarre skraft sur une user story : recherche, conception, scénarios d'acceptance, TDD, revues. Usage : /skraft-demarrer <chemin de la story> [auto] [archi <skill>]."
---

Appelle l'outil MCP `skraft_demarrer` du serveur `skraft`. Lis le texte qui suit la commande :

- le chemin de la story, relatif au projet : `story` ;
- « auto » : `auto: true` (la difficulté proposée est retenue sans confirmation) ;
- « archi <nom> » : `archi`, le skill d'architecture.

Au premier lancement, la réponse est un résumé à faire accepter : montre-le, et demande à
l'utilisateur s'il accepte une fois ou toujours. S'il accepte, rappelle `skraft_demarrer` avec les
mêmes arguments et `accord: "une-fois"` ou `accord: "toujours"`. Ne choisis pas pour lui.

Le run lancé, suis-le comme le fait `/skraft-attendre` : appelle `skraft_attendre` avec la tâche,
dis à chaque retour ce qui a changé et la ligne de progression, et recommence tant que `termine` est
faux. Une question apparaît : montre-la avec ses options, et réponds par `skraft_repondre` avec le
choix de l'utilisateur. Le run fini, appelle `skraft_rapport` et montre le bilan.

Sans pile, le serveur refuse de démarrer : propose `/skraft-pile`.

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
