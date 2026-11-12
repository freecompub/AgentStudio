---
name: skraft-lecons
description: "Liste les leçons que skraft a tirées des erreurs répétées du projet, par statut, avec leurs sources et leur catalogue ; propose de ratifier ou de retirer une leçon. Usage : /skraft-lecons [candidate|validee|retiree] [ratifier|retirer L-03]."
---

Appelle l'outil MCP `skraft_lecons` du serveur `skraft`. Sans argument, il liste toutes les leçons ;
avec un statut, seulement celles-là, dans `statut`. Si l'utilisateur veut ratifier ou retirer une
leçon, passe `action` (`ratifier` ou `retirer`) et `lecon` (son identifiant).

Le client affiche une question avant toute ratification ou tout retrait : laisse l'utilisateur y
répondre. Montre ensuite la liste, ou le motif si rien n'a changé (profil qui n'est ni architecte ni
administrateur, client qui ne sait pas poser la question, accord refusé).

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
