# ADR 0057 — Associer le jeton Copilot à son hôte GitHub

## Statut

Accepté le 2026-10-10.

## Contexte

`byb.ghe.com` est un hôte GitHub Enterprise Cloud avec résidence des données, pas un serveur
GHES utilisant un fournisseur de modèle en mode offline. Le jeton OAuth lu par `gh` est valide :
la réserve Copilot répond, mais le SDK ne s'authentifie pas si l'hôte n'est pas transmis.
L'application mémorisait l'hôte pour `gh` sans le donner à sa fabrique de runtime.

Le premier correctif du banc utilisait à tort les variables `COPILOT_PROVIDER_GHES_*` et
`COPILOT_OFFLINE` ; la liste des modèles restait inaccessible.

## Décision

Le client reçoit `gitHubToken` et `hostname` ensemble. Le SDK transmet le jeton par sa variable
d'authentification dédiée ; `env.GH_HOST` indique au runtime l'hôte du jeton. Le défaut explicite
est `github.com`, indépendamment de l'environnement ambiant. `useLoggedInUser: false` évite
de reprendre une autre connexion.

Le contrôleur de l'application transmet l'hôte courant de son service d'authentification à la
fabrique du runtime, y compris après une connexion ou une restauration des réglages. Le banc
et l'essai Copilot emploient le même client. Aucun mode offline n'est activé.

## Conséquences

Vérifié avec `@github/copilot-sdk@1.0.14` et le jeton `gh` existant : 23 modèles accessibles et
création de session réussie sur `byb.ghe.com`, puis fermeture et suppression de cette session.
Aucun prompt d'inférence n'a été envoyé ; la campagne comparative reste à lancer.

Ce correctif ne prétend pas prendre en charge GHES offline. Aucun jeton n'est écrit dans les
fichiers, les arguments du processus ou les journaux.

Référence : [configuration Enterprise Cloud avec résidence des données](https://github.github.com/gh-aw/troubleshooting/debug-ghe/).
