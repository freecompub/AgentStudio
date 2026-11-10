---
name: skraft-arreter
description: "Abandonne un run skraft ; ses questions en attente sont annulées. Usage : /skraft-arreter [identifiant de la tâche]."
---

Appelle l'outil MCP `skraft_arreter` du serveur `skraft`, avec `tache`.

Sans identifiant donné, lis les runs en cours dans `skraft_etat`. S'il y en a plusieurs, demande
lequel. Avant d'arrêter, rappelle à l'utilisateur ce que fait l'arrêt (le run est abandonné, ses
questions annulées) et demande-lui de confirmer.

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
