# ADR 0032 — Une trace d'exécution : ce que la tâche a échangé, et pourquoi elle s'est arrêtée

- Statut : **décidé**, 2026-09-29
- Contexte amont : D20 (les preuves sont produites par le code), D28 (garde de permissions),
  ADR 0026–0031 (plafonds et reprises)

## Contexte

Quatre runs réels en vingt-quatre heures, et à chaque fois le diagnostic a buté sur une information
qui **existait dans le code et n'était pas conservée**.

- Un refus de garde était journalisé sans la commande refusée. `toToolCallRequest` la calculait
  dans `req.command`, et on la jetait. Dix-huit refus successifs sur un run, sans savoir une seule
  fois ce que l'agent avait tenté.
- La porte `citations` disait « Document de recherche absent » sans dire ce que l'agent
  **prétendait** avoir écrit — alors que `report_phase` rend une liste `files`.
- Le `rollback` d'un rejet effaçait ce qu'on voulait examiner, rendant impossible de distinguer
  « il n'a jamais écrit » de « il a écrit et on a rembobiné ».
- L'occupation de la fenêtre de contexte, sur laquelle repose l'ADR 0031, n'a pu être vérifiée
  qu'en ajoutant une ligne de journal au banc de mesure — après avoir écrit l'ADR.

Le point commun est celui que le projet traque depuis le début, retourné une fois de plus : **une
décision correcte, prise sans conserver ce sur quoi elle porte.** Sauf qu'ici, la personne aveuglée
n'est pas une porte : c'est celui qui doit comprendre ce qui s'est passé.

## Décision

1. **Une trace par tâche**, en JSON Lines, à côté des preuves (`tasks/<projet>/traces/<id>.jsonl`).
2. **Ce qu'elle enregistre**, par tour d'agent : le prompt envoyé, si la session a été **reprise**,
   les messages et raisonnements du modèle, les appels d'outils, les décisions de la garde, l'usage
   (tokens et `nanoAiu`), l'occupation du contexte, et **la cause de fin du tour** nommée par ce
   qu'elle est — `output`, `blocker`, `silence`, `durée`, `contexte`, `coût`, `panne`,
   `sans-sortie`, `annulé` — et non par un type d'erreur.
3. **La garde rapporte TOUTES ses décisions, pas seulement ses refus**, avec leur cible (commande,
   chemin, URL). C'est le point central : les résultats des outils intégrés du runtime ne nous
   parviennent jamais — `tool-end` ne dit que « réussi ». **La garde est la seule fenêtre sur ce
   qu'un agent lit, écrit ou exécute.**
4. **La trace n'atteste rien.** Elle raconte. Une porte ne doit jamais s'appuyer dessus : les
   preuves (`Evidence`, D20) restent seules à faire foi dans une revue. Deux journaux, deux rôles.
5. **Elle ne fait jamais tomber la tâche qu'elle observe.** Écriture silencieuse, échec journalisé
   en avertissement. `append` ne lève jamais d'exception synchrone — elle est déclarée
   `Promise<void>`, et un appelant qui fait `.catch()` doit pouvoir s'y fier.
6. **La troncature dit ce qu'elle coupe** (`[... N caractères coupés]`), au-delà de 8 000
   caractères par champ. Une troncature muette ferait lire un texte amputé comme s'il était
   entier — la même faute que de taire ce qu'on n'a pas mesuré.

## Conséquences

- Un run devient rejouable par la lecture : on sait quel prompt a été envoyé, quels fichiers ont
  été lus, quelles commandes ont été refusées et pourquoi, combien la fenêtre était remplie, et ce
  qui a mis fin à chaque tour.
- **Volume.** Un tour d'architecte compte des dizaines d'appels ; la troncature borne chaque champ,
  pas le nombre d'entrées. Aucune rotation n'est prévue : à instruire si les fichiers gênent.
- **Ce qui reste hors de portée** : le contenu rendu par les outils intégrés du runtime. On saura
  que l'agent a lu `Panier.cs`, jamais ce que la lecture lui a rendu. Le SDK ne l'expose pas.
- La trace ne franchit pas l'IPC : `chat:agent` ne transporte ni `permission`, ni `usage`, ni
  `context`. L'afficher est un chantier d'interface distinct.
- **Confidentialité** : la trace contient des extraits du dépôt de l'utilisateur et reste locale,
  comme les preuves. La consigne du projet — aucune donnée de santé ou personnelle dans les
  journaux — vaut pour elle : un projet qui en contiendrait la verrait apparaître ici.
