# Run skraft — US-2.md — 2026-11-05 — serveur MCP (ADR 0068)

- Mode : workflow skraft, piloté par le **serveur MCP** construit (`apps/mcp-skraft/dist/main.mjs`,
  transport stdio), l'hôte étant `scripts/essai-mcp-skraft.ts` ; agents Copilot réels.
- Projet : clone de `~/Projets/exemple-dotnet-tdd` (pile `dotnet`, source : profil du projet) ;
  branche `skraft/us-2`, non poussée.
- Réponses humaines : `docs/runs/reponses-us-2.json`, par le répondeur commun du banc ; profil
  `architecte` (`admin.json` de l'essai).
- État final : **fini / DONE** ; phases RESEARCH, DESIGN, DISTILL, DELIVER, aucune sautée.
- Durée : 19 min 24 s ; **≈ 374 requêtes premium** : 373,8 unités dans la trace (128 appels au
  modèle, tous `claude-sonnet-5`, 5,0 M tokens d'entrée), et réserve Copilot passée de 0 à 373
  utilisées. 20 **tours** d'agent : c'est ce que compte `requests` dans l'usage du serveur (un par
  tour), pas les requêtes facturées.
- Livrable vérifié à part : `dotnet test` dans le clone, **10/10 verts**. Scénarios ac-1 à ac-5
  `done` (ac-2 et ac-3 moteurs, les autres de régression). ADR : aucun. Arbitrages : aucun.
- Dernier rejet : porte de cohérence en DESIGN (`ArgumentOutOfRangeException` cité dans
  `contracts.md`, absent des modèles), corrigé par l'agent au tour suivant.

## Déroulé vu par l'hôte MCP

1. `skraft_etat` : pilote, workflow `skraft-workflow` sans accord, pile `dotnet` (projet).
2. `skraft_demarrer` sans accord : « Accord requis » et le résumé ; rappel avec
   `accord: "une-fois"` : tâche lancée.
3. Questions reçues par `skraft_etat`, réponses par `skraft_repondre` : difficulté (« Assez
   difficile », confirmée) ; deux questions ouvertes.
4. `skraft_rapport` en fin de run : `rapport.json` de ce dossier.

## Constats

- **Premier essai échoué** avant tout agent : le processus enfant des workflows, construit avec
  `esbuild` en import externe, ne pouvait pas lire `node_modules` sous `--permission`. Corrigé
  (`d9b66bd`) et couvert par un test sur l'enfant construit ; aucune requête consommée.
- **Question ouverte posée deux fois** (« Les paliers sont-ils les mêmes pour toutes les
  références… », avec et sans guillemets) : doublon de l'extraction des questions par skraft, pas
  du serveur. La même réponse a été donnée aux deux. À regarder dans le workflow.
- Par rapport au run workflow du 10/10 sur la même story (264,3 requêtes, 55 min, modèles gpt-6 et
  claude) : **plus rapide (19 min), plus cher (≈ 374)**, avec `claude-sonnet-5` partout. Un seul run :
  pas une mesure, un constat.
- Piège de lecture : le `usage.requests` de la carte de tâche (et de `skraft_etat`) compte les tours,
  pas les requêtes premium ; l'hôte d'essai l'affichait en « req. ». Le coût se lit dans la trace
  (`nanoAiu`) ou dans la réserve.
