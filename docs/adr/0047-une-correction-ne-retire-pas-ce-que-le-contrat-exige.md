# ADR 0047 — Une correction ne retire pas ce que le contrat exige, et un défaut mal routé se renvoie

- Statut : **décidé**, 2026-10-03 (mesures 1 à 3 retenues par le responsable du projet)
- Contexte amont : ADR 0046 (la revue dialogue avec l'agent qui corrige), ADR 0043 (une règle sans
  contre-exemple ne tient pas), D16 (le LLM propose, le code décide)

## Contexte

Le 03/10, premier run réel de l'ADR 0046 sur US-2 (`docs/runs/2026-10-03-us-2-deliver-adr45-46/`) :

1. `quality-gates` signale, cible `test`, qu'aucun test ne couvre `Facture.ATPayer` ; il cite
   `CalculDuPanier.cs`. La première version du routage fait foi au fichier : le défaut part au
   développeur, tests gelés (corrigé depuis : le fichier ne fait basculer un défaut que vers le
   testeur).
2. Le développeur conteste — il ne peut pas écrire de test. La lentille maintient — le test manque.
3. Le développeur « corrige » en **supprimant le code non couvert** : `ATPayer` ne déduit plus la
   remise, `Montant.Soustrait` disparaît. La revue suivante le bloque (contrat ratifié non respecté),
   mais le budget est épuisé.

Deux manques : rien n'interdisait de retirer ce que le contrat de DESIGN exige, et un agent qui
reçoit un défaut qui n'est pas le sien n'avait que deux sorties — contester (alors que le défaut est
juste) ou céder.

## Décision

1. **Garde du contrat ratifié.** À la revue de DELIVER, le code relève les noms que le contrat
   **déclare** (`design/contracts.md`, blocs de code : types, méthodes `Type Nom(`, propriétés
   `Nom { get` ou `Nom =>`) présents dans les sources.
   En correction, la porte GREEN refuse un tour qui en fait disparaître un, avec la marche à
   suivre : corriger sans retirer, ou contester, ou déclarer hors périmètre. La référence est
   relevée au moment de la revue faute de pouvoir relire le code d'un état passé : l'API de
   l'espace de travail n'est pas étendue.
2. **« Hors de mon périmètre ».** Troisième réponse possible à un défaut (`outOfScope`, avec raison) :
   il est juste, mais revient à l'autre agent. En DELIVER, il change de cible et part à l'autre
   agent — y compris après la correction du code, vers le testeur. **Une seule fois** : renvoyé de
   nouveau, il devient une contestation que la lentille arbitre, au lieu de rebondir. Hors DELIVER,
   faute de second agent, c'est une contestation.
3. **Consigne du développeur** : ne jamais supprimer un comportement exigé par le contrat pour faire
   taire une revue ; contester ou déclarer hors périmètre. Seule, elle ne suffirait pas (ADR 0043) :
   la garde du point 1 la rend vérifiable.

## Conséquences

- **Rejouée sur les commits réels du run** : la correction légitime (`Multiplie` repassant par
  `De`) passe ; la suppression est refusée (`Soustrait` disparu).
- **Limite** : la garde voit les noms qui disparaissent, pas un comportement modifié à nom constant.
  Retirer la soustraction dans `ATPayer` en gardant `Soustrait` passerait ; la revue reste le filet.
- ~~La référence inclut aussi des noms du cadre~~ — corrigé après la revue de code du 03/10 : seuls
  les noms **déclarés** sont retenus (13 sur US-2, contre 27 en prenant tout mot capitalisé) ;
  `IEnumerable`, `Aggregate`, `Montant` en type de paramètre ne le sont plus. Rejouée sur les commits
  réels : la suppression de `Soustrait` reste refusée.
- Un défaut mal routé coûte désormais un tour au lieu de trois.
