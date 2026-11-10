---
name: skraft-pr
description: "Publie le travail d'un run skraft fini : pousse sa branche et ouvre une PR liée à l'issue de la story (Closes #n), après l'accord de l'utilisateur. Usage : /skraft-pr [identifiant de la tâche] [issue]."
---

Appelle l'outil MCP `skraft_pr` du serveur `skraft`, avec `tache` (sinon, prends le dernier run
fini dans `skraft_etat`). Si la story du run n'était pas une issue GitHub et que l'utilisateur en
donne une, passe-la dans `issue`.

Le client affiche une question avant toute publication : laisse l'utilisateur y répondre. Montre
ensuite le lien de la PR, ou le motif si rien n'a été publié (remote qui n'est pas le dépôt de
l'issue, push refusé…).

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
