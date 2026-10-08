# ADR 0052 — L'orchestration s'écrit comme un script rejouable

- Statut : **décidé**, 2026-10-05 — moteur implémenté le 2026-10-08 (`packages/workflow`), encore
  utilisé par aucune extension (plan : `docs/09-workflows-rejouables.md` §14)
- Précise : **D16** (orchestrateur déterministe : réducteur pur + runner d'effets)
- S'appuie sur : D9, D10, D11, D13, D23, D24, D25, D29
- Remplace : la proposition YAML de `docs/08` (abandonnée)
- Détail : `docs/09-workflows-rejouables.md`

## Contexte

Écrire skraft a coûté cher, à cause de la **forme** imposée et non du langage : une machine à
états écrite à la main (`reducer.ts`, `deliver-machine.ts`, ≈ 820 lignes) et un état d'une
quarantaine de champs dont la plupart ne disent que « où l'on en est » (`stage`, `designStep`,
`deliver.step`, `fixing`, `pendingResponses`, `threadsAtFixStart`…). Lire une tâche en cours
demande de décoder ces champs ensemble ; ajouter un comportement demande d'inventer des états.

Le 2026-10-04, une description de skraft entièrement en YAML (`docs/08`) a été essayée. Elle a été
abandonnée le lendemain : le YAML devenait un langage sans les outils d'un langage, ne savait pas
exprimer deux comportements réels de skraft (ADR 0042, arbitrage humain hors budget), cachait les
fautes de séquence, et obligeait à recopier en Python des portes déjà testées en TypeScript.

Les workflows de Claude Code montrent une autre voie : un script ordinaire orchestre les agents,
et la plateforme le rend reprenable en journalisant chaque appel extérieur et en rejouant le
script contre ce journal.

## Décision

1. **Une orchestration est un script** (JavaScript, D15 inchangé), écrit de haut en bas avec des
   appels `w.*` vers la plateforme : agent, humain, fichiers, tests, Git, oubli de sessions,
   phases. Tout le reste du script est du code pur ; les portes existantes s'appellent directement.
2. **Chaque appel `w.*` est journalisé** dans l'état persisté de la tâche. À chaque transition, le
   script est relancé depuis le début : un appel journalisé rend son résultat enregistré sans
   s'exécuter ; le premier appel absent du journal devient l'effet suivant.
3. **C'est la lecture retenue de D16.** Le script étant déterministe, l'étape suivante est une
   fonction pure du script et du journal : un réducteur dont l'état est le journal. Le LLM ne
   choisit toujours jamais la transition. Le moteur de tâches n'est pas remplacé : une définition
   générique, `createWorkflowTask(script)`, implémente le contrat `TaskDefinition` existant, et
   garde la persistance après chaque transition, le checkpoint avant chaque effet et la reprise
   d'un effet interrompu (D23).
4. **Le déterminisme est imposé et vérifié.** Le script tourne dans le processus isolé de
   l'extension (D9), sans `Date`, hasard, minuteries, disque, réseau ni `process`. Un appel rejoué
   qui ne correspond pas au journal arrête la tâche (non-déterminisme), au lieu de la laisser
   diverger. Le journal porte l'empreinte du script : un script modifié refuse de reprendre une
   tâche commencée.
5. **Le déclaratif reste dans le manifeste** : agents (avec skills, outils, écriture, sortie,
   classe de modèle et mémoire), et pour chaque workflow, son fichier, sa commande, ses entrées,
   ses phases et ses questions humaines avec les profils autorisés. Tout est vérifié à
   l'installation (D11) ; un workflow qui appelle un agent ou une question non déclarés est refusé.
6. **Le script n'a aucun pouvoir de plus qu'une extension.** Il ne voit que des résultats
   sérialisés (D10) et ne peut que restreindre un agent pour un tour, jamais lui donner un outil,
   une skill ou un droit d'écriture.
7. **On abandonne le format YAML** et ses scripts Python (`fonctionnalites/`, retirés).

## Conséquences

- skraft se réécrit phase par phase, en commençant par RESEARCH ; critère : ses tests de bout en
  bout passent sans modification. Si le script n'est pas nettement plus simple que la partie du
  réducteur qu'il remplace, on s'arrête là.
- `reducer.ts`, `deliver-machine.ts` et le schéma d'état de skraft disparaîtront à la fin de la
  migration ; les portes, la story, la difficulté et la revue restent, avec leurs tests.
- Un seul schéma de journal, commun à toutes les extensions, remplace les schémas d'état propres.
- Chaque transition rejoue tout le script (O(n²) sur la tâche) : négligeable pour quelques
  centaines d'appels, à mesurer.
- Les gros résultats (fichiers lus, consignes, rapports) vont dans un magasin de contenus indexé
  par empreinte, pour garder le journal petit et lisible.
- `@agent-studio/workflow` entre dans l'API versionnée (D13) et ne se fige qu'après deux
  extensions migrées (D14).
- Les écarts de comportement repérés entre la description YAML et le code (`docs/09` §13) sont
  tranchés phase par phase ; tant qu'ils ne le sont pas, le workflow reproduit le code actuel.
