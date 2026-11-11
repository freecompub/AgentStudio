# ADR 0055 — Un workflow est un dossier, pas une extension

- Statut : **décidé**, 2026-10-08 (point par point avec le responsable du projet) — non implémenté
- Remplace : ADR 0052 points 4 (« le script tourne dans le processus isolé de l'extension ») et 5
  (« le déclaratif reste dans le manifeste ») ; `docs/09` §3 et §8 ; `contributes.workflows`
- Garde : ADR 0052 points 1 à 3, 6 et 7 (script rejouable, journal, déterminisme, aucun pouvoir de
  plus qu'avant) ; ADR 0053 ; ADR 0054 (comparaison avec l'extension skraft)
- Détail : `docs/11-workflows-dynamiques.md`
- Révisé : point 3 par l'ADR 0082 (2026-11-11) — un workflow peut apporter ses propres outils à ses agents

## Contexte

`docs/09` gardait l'orchestration dans une extension : manifeste signé, processus isolé de
l'extension, API `ctx`. skraft-workflow a été écrit ainsi. Le responsable veut l'approche des
**workflows dynamiques** de Claude Code et de Copilot : un workflow est un script avec sa
description, posé dans le projet ou sur la machine, sans passer par le système d'extensions.

## Décision

1. Les workflows sont **écrits par les développeurs** ; l'agent principal les utilise, il ne les
   écrit pas.
2. On les lance **par une commande**, ou **l'agent principal propose** et l'utilisateur confirme.
3. Un workflow est **un dossier** : `workflow.mjs` (JavaScript, modules ES), ses agents, ses skills
   et le code de ses contrôles et de sa revue. Ni hooks, ni outils propres, ni `ctx` : seulement
   `w.*`. *Révisé par l'ADR 0082 : un workflow peut apporter ses outils (`meta.outils`).*
4. Deux emplacements : **machine** (`~/.agent-studio/workflows/`) et **projet**
   (`.agent-studio/workflows/`). Une copie à la main est prise en compte ; le projet l'emporte à
   nom égal ; `/workflow ajouter` copie un modèle.
5. La description est un **`meta` littéral** en tête du script : commande, entrées, phases,
   questions humaines et profils, **agents et leurs droits**, permissions du script. Validé par
   schéma au chargement, sans exécuter le script. Les fichiers d'agents ne contiennent que le
   contenu (ADR 0024).
6. **Accord** de l'utilisateur à la première exécution et à chaque modification (empreinte du
   dossier), permissions et agents montrés ; **dossier gelé** pendant une tâche.
7. Le script tourne dans un **processus isolé dédié**, `globalThis` réduit (ni heure, ni hasard, ni
   minuteries, ni réseau, ni modules Node).
8. Plus d'outil `render_adr` : l'architecte crée les ADR et modifie ceux de **son US** encore
   « Proposé » ; l'appartenance est une ligne `Story : <slug>` **écrite par le code** ; la porte
   refuse toute autre modification.
9. `extensions/skraft-workflow` est converti au nouveau format ; l'extension `skraft` reste
   (ADR 0054) ; le système d'extensions reste pour ce qui n'est pas une orchestration.

## Conséquences

- Un workflow de projet est **du code du dépôt qui s'exécute** : l'accord par empreinte et le gel
  pendant la tâche sont la protection ; un agent ne peut pas modifier le workflow qui le contrôle.
- Sans manifeste signé, la vérification d'installation (D11) devient une **vérification au
  chargement** du `meta`. La signature des paquets ne s'applique plus aux workflows.
- Les droits de chaque agent se lisent en un seul endroit, le `meta` ; un même fichier d'agent sert
  à plusieurs workflows avec des droits différents.
- Les contrôles d'un workflow sont son code : un autre workflow ne les partage qu'en les copiant.
- À trancher plus tard (`docs/11` §12) : pouvoir d'un administrateur sur les workflows de projet,
  mise à jour d'un workflow copié quand le modèle change.
