---
name: skraft-pile
description: "Fait découvrir la pile du projet par un agent (comment lancer ses tests, BDD compris), la fait vérifier en l'exécutant, puis l'écrit après accord ; ou la diagnostique. Usage : /skraft-pile [diagnostiquer] [sans bdd] [réponse à la question de l'agent]."
---

Appelle l'outil MCP `skraft_pile` du serveur `skraft`. Lis le texte qui suit la commande :

- « diagnostiquer » (ou « doctor ») : `action: "diagnostiquer"` ; sinon, ne donne pas d'action ;
- « sans bdd » : `sansBdd: true` ;
- un lanceur ou des dossiers BDD nommés : `lanceur`, `features`, `etapes` ;
- une réponse à la question que l'agent de découverte a posée : `reponse`, en une phrase complète
  (« les tests se lancent avec … »). L'agent ne revoit pas sa question.

L'appel peut durer une minute ou deux : l'agent lit le projet, puis le code lance les tests témoins.
Montre la réponse telle quelle. Si l'agent pose une question, montre-la avec ses réponses possibles
et attends l'utilisateur ; il répondra par `/skraft-pile <sa réponse>`.

Les questions de skraft, et celles que le client affiche (ouvrir un dépôt, autoriser un programme, écrire un profil), reviennent à l'utilisateur : tu ne réponds jamais à la place de l'utilisateur.
