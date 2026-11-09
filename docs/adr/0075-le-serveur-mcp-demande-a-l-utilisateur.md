# ADR 0075 — Le serveur MCP demande à l'utilisateur, par son client

## Statut

**Accepté** le 2026-11-09 par le responsable du projet (« ok on fait ca »).
Concerne `apps/mcp-skraft`. Revient sur une partie de l'ADR 0068 (point 9 : l'*elicitation* y était
écartée, faute de savoir si Copilot CLI la gère).

## Contexte

Sur un autre poste (Copilot CLI, projet Python géré par uv), skraft n'a pas pu démarrer :

- le dépôt était hors des dossiers permis : Copilot CLI ne semble déclarer aucun root, et le dossier
  n'était pas dans `autorises` ;
- `uv` et `make` étaient refusés comme programmes de pile ;
- le projet n'avait pas de profil de pile.

Le serveur tourne derrière le client, sans fenêtre : stdout appartient au protocole. Toute confirmation
y était refusée d'office (`SANS_FENETRE`), et un refus ne laissait qu'un fichier de configuration à
corriger à la main.

Deux voies existent vers l'utilisateur :

- **un argument d'outil** (comme `accord` de `skraft_demarrer`) : il est rempli par le LLM de l'hôte.
  Il suffit pour l'accord sur un workflow, dont le résumé est montré. Pour un dossier ou un programme,
  il annulerait la borne : le même LLM proposerait le dépôt ou la pile, et l'accepterait ;
- **l'*elicitation* MCP** : le serveur demande au client de poser une question à l'utilisateur, qui
  répond directement. Le SDK MCP installé (1.32.2) la gère (`elicitInput`).

L'objection de l'ADR 0068 ne tient pas : on n'a pas à savoir d'avance si le client la gère. Il annonce
ses capacités à l'initialisation, comme il annonce les roots (`getClientCapabilities()`).

## Décision

1. **Demander si le client l'annonce, refuser sinon.** `confirmerParLeClient` (`src/confirmation.ts`)
   pose la question si le client annonce l'elicitation par formulaire. Une capacité vide vaut
   formulaire ; l'adresse web seule ne suffit pas. Sinon, ou si la question est refusée, annulée,
   en erreur ou sans réponse reconnue, la réponse est « non ». Le refus explique alors quoi corriger.
2. **Trois réponses** : « Oui, cette fois », « Oui, toujours », « Non ». Elles correspondent à
   `allow-once`, `allow-always` et `deny` du `UserConfirmer` du cœur.
3. **Le délai de la question est de 10 minutes.** Le délai par défaut d'une requête (60 s) couperait
   un utilisateur qui lit.
4. **Premier usage : un dépôt hors des dossiers permis.**
   - `resoudreProjet` distingue ce refus (`horsBornes`) des autres. Un dossier absent ou qui n'est
     pas un dépôt Git reste refusé sans question.
   - La question dit ce que skraft fera du dépôt : branche, checkpoints, écritures des agents,
     tests lancés.
   - « Oui, cette fois » vaut pour ce serveur, donc cette session du client.
   - « Oui, toujours » est retenu dans `~/.agent-studio/mcp-skraft/depots-acceptes.json`, **hors des
     dépôts** : un agent qui écrit dans un projet ne peut pas s'en ouvrir un autre. Un fichier
     illisible n'accepte rien.
   - Deux appels simultanés sur le même dépôt ne posent qu'une question.
5. **Deuxième usage : un programme hors de la liste de l'administrateur** (`project-services`, donc
   aussi l'application de bureau, qui pose la question dans sa fenêtre).
   - À l'ouverture du projet, les programmes que nomme la pile sont lus (`programmesDuProfil`), que la
     pile vienne du projet, d'un composant ou du client. Ceux qui manquent à la liste sont demandés,
     un par programme, même s'il sert à plusieurs sections.
   - La question nomme le programme, les commandes qui le lancent, l'origine de la liste, et ce que
     l'accord permet : exécution sans shell, dans le projet, aux portes de test, de lint, de format
     ou de mutation, avec les droits de l'utilisateur, réseau compris.
   - Le profil est ensuite jugé, comme avant, contre la liste élargie de ces seuls programmes.
   - Un nom avec un chemin n'est jamais demandé : il échapperait à la liste.
   - « Oui, toujours » est retenu par projet dans `programmes-acceptes.json`, dans le dossier des
     tâches, hors du dépôt.
   - L'administrateur peut l'interdire : `"programConsent": false` dans `admin.json`. Il n'y a alors
     ni question ni accord retenu. Un `admin.json` refusé l'interdit aussi.
   - Chaque réponse est journalisée (`programme hors liste`, avec la réponse).
6. **Usages suivants**, chacun dans sa propre brique :
   - l'écriture du profil de pile proposé (`skraft_pile`) ;
   - peut-être l'accord sur le workflow, qui passe aujourd'hui par l'argument `accord`.

## Écarté

- **Prendre le dossier de lancement du serveur pour borne quand le client ne déclare aucun root.**
  C'était déjà refusé (`projet.test.ts` : « le dossier courant n'est pas accepté d'office ») : on ne
  sait pas où le client lance le serveur, peut-être dans le dossier personnel.
- **Accepter `uv run X`, `poetry run X`, `npx X`… si X est autorisé.** Chaque lanceur a ses options
  (`uv run --with` installe un paquet), et `npx` télécharge. À la place, le profil déclarera où vivent
  les outils du projet (`.venv/bin`), et le programme restera jugé par son nom.
- **Un accord par argument d'outil pour un dossier ou un programme** : c'est le LLM qui le donnerait.

## Conséquences

- Avec un client qui gère l'elicitation, l'utilisateur répond à une question au lieu d'éditer un
  fichier. Avec un client qui ne la gère pas, rien ne change : le refus, et son explication.
- **Vérifié avec Copilot CLI 1.0.107, le 2026-11-09** :
  - il annonce `elicitation: { form, url }` et `sampling`, pas `roots` : `listRoots` rend une liste
    vide. Il lance le serveur dans le dossier où l'utilisateur l'a démarré ;
  - en mode non interactif (`-p`), il refuse toute question de lui-même (`decline`) : le refus du
    dépôt ne prétend donc pas que l'utilisateur a répondu ;
  - en mode interactif, il affiche la question, son détail et les trois réponses. Essai réel dans
    un dépôt jetable dont la pile lance `uv run pytest`, hors des dossiers permis : deux questions
    (le dépôt, puis `uv`), deux « Oui, cette fois », et `skraft_etat` rend la pile du projet ;
  - il n'abandonne pas l'appel pendant que la question attend : une réponse donnée au bout de 75 s
    a abouti (appel de 1 min 17 s).
