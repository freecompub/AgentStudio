---
name: skraft-rapport
description: "Donne le bilan d'un run skraft : statut, phases, ADR, rejets et le tableau des étapes. Usage : /skraft-rapport [identifiant de la tâche]."
---

Appelle l'outil MCP `skraft_rapport` du serveur `skraft`, avec `tache` (sinon, prends le dernier
run dans `skraft_etat`).

Montre le statut et le bilan, puis les étapes en tableau : phase, essai, durée, rejets (porte et
motif), coût ou unités. Ne réinterprète pas les motifs de rejet : recopie-les.

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
