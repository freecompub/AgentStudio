---
name: skraft-attendre
description: "Suit un run skraft en cours et dit ce qui a changé : phase, étape, rejets, questions, fin. Usage : /skraft-attendre [identifiant de la tâche]."
---

Appelle l'outil MCP `skraft_attendre` du serveur `skraft`, avec `tache` si l'utilisateur en
donne une (sinon, prends la tâche en cours dans `skraft_etat`).

L'outil attend un changement au plus 50 secondes. À chaque retour :
- dis ce qui a changé, et recopie la ligne de progression telle quelle ;
- une question est en attente : montre-la avec ses options, attends l'utilisateur, puis réponds par
  `skraft_repondre` ;
- rappelle `skraft_attendre` tant que `termine` est faux.

Le run fini, propose `/skraft-rapport`.

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
