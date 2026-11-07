# ADR 0058 — Afficher le code gh et ouvrir la bonne page Enterprise

## Statut

Accepté le 2026-10-10.

## Contexte

Sans terminal interactif, gh 2.101 affiche `One-time code (…) copied to clipboard` et
`Open this URL to continue in your web browser`. Notre lecteur ne reconnaissait que
`one-time code: …` : aucun événement ne parvenait à l'interface, puis le délai expirait.
Le bouton de réouverture visait en outre toujours GitHub.com, même pour Enterprise.

## Décision

Reconnaître les deux formats, y compris une sortie reçue en plusieurs morceaux. Ne valider
l'invite par Entrée que si gh la demande. À réception du code, l'interface demande l'ouverture
du navigateur par le canal IPC existant. Le processus principal conserve l'adresse construite
par le service d'authentification pour l'hôte de la connexion en cours : l'hôte courant ne
change, lui, qu'après réussite. Le renderer ne peut pas fournir une adresse arbitraire à ce canal.

## Conséquences

Le code et l'adresse restent visibles si le navigateur échoue à s'ouvrir, avec une erreur
explicite et un bouton pour réessayer. Les tests couvrent les formats observés de gh, la page
Enterprise avant la fin de la connexion, l'ouverture automatique et son échec.
La validation réelle du code OAuth dans le navigateur reste une action de l'utilisateur.
