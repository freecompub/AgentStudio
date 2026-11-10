---
name: skraft-etat
description: "Montre l'état de skraft sur le projet : runs en cours, progression, questions en attente, pile retenue. Usage : /skraft-etat."
---

Appelle l'outil MCP `skraft_etat` du serveur `skraft`, sans argument.

Résume la réponse pour l'utilisateur : le mode du serveur (pilote ou consultation), la pile, chaque
run avec sa ligne `progression` recopiée telle quelle, et les questions en attente avec leurs
options. Pour répondre à une question : `/skraft-repondre`.

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
