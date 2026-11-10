---
name: skraft-repondre
description: "Répond à une question en attente d'un run skraft. Usage : /skraft-repondre <réponse ou option> [commentaire]."
---

Appelle l'outil MCP `skraft_repondre` du serveur `skraft`.

1. Appelle d'abord `skraft_etat` pour lire les questions en attente, leurs identifiants et leurs
   options.
2. Retrouve la question et l'option que désigne le texte de l'utilisateur. S'il y a un doute (deux
   questions, une option qui ne correspond à aucune), demande-lui de préciser.
3. Appelle `skraft_repondre` avec `question`, `option` et, s'il a ajouté un commentaire ou une
   réponse libre, `texte`.

Ne choisis jamais une option que l'utilisateur n'a pas donnée.

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
