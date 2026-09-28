# ADR 0024 — Agents et skills en Markdown : un contenu partagé, un contrat ajouté par le cœur

- Statut : **décidé**, 2026-09-28
- Date : 2026-09-28
- Contexte amont : D12 (capacités nommées), D26 (skills obligatoires injectées, `load_skill` tracé),
  ADR 0012 et 0023 (licence de skraft), ADR 0021 (skraft distribuée en `.asx`), ADR 0022 (linter du projet)

## Contexte

Les rôles des agents de skraft étaient des chaînes TypeScript (`roles.ts`), et aucune skill n'était
livrée : le mécanisme de D26 n'existait pas dans le cœur. skraft-plugin, dont la reprise est
autorisée (tag `v1.6.1`), livre au contraire ses agents et ses skills en fichiers Markdown à
frontmatter, lus tels quels par Copilot CLI et Claude Code.

On veut que **les deux approches coexistent sur les mêmes fichiers** : le contenu reste utilisable
dans un harnais généraliste, et agent-studio l'orchestre avec ses garanties (portes exécutées par
le code, preuves, tests gelés).

Le contenu et le contrat ne sont pas les mêmes d'un mode à l'autre. Dans un harnais généraliste,
l'agent lance les tests, commite et enchaîne. Dans agent-studio, il termine par un outil terminal,
passe par `run_tests`, n'utilise jamais Git et ne choisit pas la suite. Une même phrase ne peut donc
pas être vraie dans les deux modes.

## Décision

1. **Le contenu est dans des fichiers Markdown de l'extension** :
   - `agents/<nom>.agent.md` : le rôle, avec `name` et `description` dans le frontmatter ;
   - `skills/<nom>/SKILL.md` : la méthode.

   Ces fichiers ne nomment **aucun** outil ni mécanisme d'agent-studio. Un test de skraft le vérifie.
2. **Le manifeste porte l'orchestration.** Pour chaque agent : `prompt` (le fichier de rôle),
   `role` (consignes propres à agent-studio, désormais facultatif), `output`, `write`, `tools` et
   `skills: { mandatory, onDemand }`. Les skills sont déclarées dans `contributes.skills`
   (`name`, `path`). Une référence `nom#Titre` désigne une seule section : du titre au prochain
   titre de même niveau, numéro ignoré. La validation refuse :
   - un chemin absolu ou contenant `..` ;
   - un rôle qui n'est pas un `.md` ;
   - une skill référencée mais non déclarée ;
   - un agent sans fichier ni consignes.
3. **Le cœur compose le prompt système**, une fois à l'activation, dans cet ordre :
   1. contenu du rôle, sans son frontmatter ;
   2. skills obligatoires, ou leurs sections ;
   3. consignes du manifeste ;
   4. **contrat d'exécution**.

   Le contrat vient en dernier et prime explicitement sur le reste. Il contient l'outil de fin,
   `run_tests`, `report_blocker`, la liste des skills à la demande, l'interdiction de Git et le
   périmètre d'écriture. La composition est une fonction pure de l'hôte d'extension
   (`agent-prompts.ts`).
4. **`load_skill`** est fourni aux agents qui ont des skills à la demande. Il ne rend que les skills
   du rôle. Chaque chargement est rendu à l'extension (`AgentRunResult.skillsLoaded`), et skraft le
   trace dans l'état de sa tâche (`skillsLoaded`), comme l'exige D26.
5. **Les fichiers sont lus par l'hôte**, dans le processus principal, depuis le dossier de
   l'extension. Les liens symboliques sont résolus et rien n'est lu au-dessus de ce dossier. Ils
   voyagent dans le `.asx` signé : `ext:build` copie les fichiers déclarés et la licence, et la
   signature couvre tout le paquet. Une extension ne peut donc pas changer ses prompts après
   installation.
6. **Les skills sont reprises telles quelles.** Là où elles contredisent une décision du projet,
   c'est la consigne d'orchestration du rôle qui tranche. Deux cas se présentent aujourd'hui :
   - la forme du code relève du linter du projet (ADR 0022), et non des seuils d'Object
     Calisthenics de `craft-discipline` ;
   - les commits, les portes et la mutation sont exécutés par le code.
7. **Le dossier de l'extension est aussi un plugin** pour Claude Code (`.claude-plugin/plugin.json`)
   et pour Copilot CLI (`plugin.json`), qui désignent `agents/` et `skills/`. Dans ce mode, **aucune
   garantie** ne s'applique : ni porte, ni preuve produite par le code, ni test gelé.

## Conséquences

- skraft reprend douze skills de skraft-plugin `v1.6.1`, dans les catégories « méthode » et
  « critères de revue » de SPEC-skraft §4.2, réparties par rôle selon §6.4. Les skills devenues du
  code ne sont pas reprises : `quality-gates-*`, `quality-gates-evidence-contract`,
  `skraft-quality-bar` et `resolving-stack-commands`.
- Les skills reprises viennent d'un cadre .NET et citent des commandes de pile (`dotnet test`,
  `dotnet build`) ainsi que des attributs xUnit (`[Theory]`). Dire à l'agent de passer par
  `run_tests` ne suffisait pas : ça couvre les tests et lui laisse la compilation, avec une commande
  qui n'existe pas sur un projet Swift ou TypeScript. Le contrat lui **interdit donc d'exécuter
  lui-même toute commande de compilation ou de test**. Les fichiers repris restent identiques à
  l'amont, conformément au point 6 : la correction est dans le contrat, qui prime (point 3).
- Les prompts s'allongent (skills injectées). Injecter une section plutôt qu'une skill entière
  reste le levier d'économie (`outside-in-tdd#RED` pour l'agent test, `#SYNTHESIZE-GREEN` pour
  l'agent dev).
- Un agent déclaré uniquement par `role`, comme ceux de l'extension tdd, reçoit désormais lui aussi
  le contrat d'exécution du cœur.
- **À vérifier** (§15) : le format de plugin que Copilot CLI attend réellement (`plugin.json` à la
  racine, découverte des fichiers `*.agent.md` et des `SKILL.md`). Il est repris de la structure de
  skraft-plugin, mais n'a pas été éprouvé sur la version installée.
