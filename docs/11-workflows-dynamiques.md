# Workflows dynamiques : un dossier, pas une extension

- Statut : **direction retenue le 2026-10-08**, point par point avec le responsable du projet ;
  rien d'implémenté. Décision : ADR 0055.
- Remplace : la règle « une fonctionnalité reste une extension » (`docs/09` §3, §8 ; ADR 0052
  points 4 et 5). Le moteur rejouable de `docs/09` (§5 à §7, §9, §10) **ne change pas**.
- Inspiration : les workflows dynamiques de Claude Code et de Copilot (§13).

---

## 1. En une phrase

Un workflow est **un dossier** — un script JavaScript qui commence par une description littérale
(`meta`), ses agents et ses skills, le code de ses contrôles — que la plateforme trouve sur la
machine ou dans le projet, et qu'on lance par une commande ou que l'agent principal propose.

## 2. Les décisions, point par point

| # | Décision |
|---|---|
| 1 | Les workflows sont **écrits par nous** (développeurs), jamais par l'agent. L'agent principal les **utilise**. |
| 2 | Deux façons de lancer : **une commande** (`/skraft stories/US-2.md`), ou **l'agent principal propose** et l'utilisateur confirme avant le démarrage. |
| 3 | Un workflow **n'est pas une extension** : pas de hooks, pas d'outils propres, pas d'API `ctx`. Le script n'a que les appels `w.*`. |
| 4, 10 | Deux emplacements : **machine** (`~/.agent-studio/workflows/<nom>/`) et **projet** (`.agent-studio/workflows/<nom>/`, versionné avec le code). La commande `/workflow ajouter <nom>` copie un modèle ; **une copie à la main est prise en compte** de la même façon. Même nom aux deux endroits : **le projet l'emporte**. |
| 5 | Les **agents** (`agents/*.agent.md`) et les **skills** (`skills/<nom>/SKILL.md`) sont dans le dossier. |
| 6 | Le **code des contrôles** (portes) et de la **revue** (lentilles, fils de défauts) est dans le dossier ; le script l'importe. |
| 7 | Plus d'outil `render_adr`. L'architecte **crée** les ADR et **modifie ceux de son US** encore « Proposé » ; l'appartenance se lit à une ligne `Story : <slug>` **écrite par le code**. |
| 8, 13 | La description est un **`meta` littéral** en tête du script : nom, commande, entrées, phases, questions humaines, **agents et leurs droits**, permissions du script. Les fichiers d'agents ne gardent que le **contenu** (ADR 0024). |
| 9 | **JavaScript**, modules ES (`.mjs`), comme Claude Code et Copilot. |
| 11 | `extensions/skraft-workflow` est **converti** au nouveau format et devient le modèle fourni avec l'application ; l'extension `skraft` (réducteur) **reste** pour la comparaison (ADR 0054, `docs/10`) ; le **système d'extensions reste** pour ce qui n'est pas une orchestration (`tdd` pour l'instant). |
| 12 | Les **permissions du script** (écrire, tester, commiter, brancher, rembobiner) sont dans le `meta`, **montrées à l'accord** ; toute action non déclarée est refusée. |

## 3. Le dossier

```
.agent-studio/workflows/skraft/        (ou ~/.agent-studio/workflows/skraft/)
  workflow.mjs        meta + script
  portes/             citations.mjs, coherence.mjs, valeurs.mjs, rouge.mjs, livraison.mjs…
  revue/              revue.mjs, fils.mjs, dossiers-lentilles.mjs
  story.mjs, difficulte.mjs, dossier-de-passation.mjs
  agents/             skraft-researcher.agent.md, skraft-test.agent.md, skraft-lens-*.agent.md…
  skills/             outside-in-tdd/SKILL.md, architecture-decisions/SKILL.md…
  LICENSE             GPL-3.0-or-later (provenance skraft-plugin, ADR 0012)
```

Le script n'importe que des fichiers **de son dossier** et `@agent-studio/workflow` (fourni par
la plateforme : aides, erreurs et calculs purs, §8). Aucun autre module, aucun accès Node ;
l'heure passe par `w.maintenant()`.

## 4. Le fichier `workflow.mjs`

```js
export const meta = {
  name: "skraft",
  description: "Livre une user story : recherche, conception, scénarios d'acceptance, TDD, revues.",
  commande: "skraft",
  entrees: {
    story: { type: "fichier", obligatoire: true, aide: "La user story (« # US-2 — Titre », critères numérotés)." },
    auto: { type: "booleen", defaut: false, aide: "Difficulté retenue sans confirmation." },
  },
  phases: { RESEARCH: "Enquête sur le code existant", DESIGN: "Conception", DISTILL: "Scénarios d'acceptance", DELIVER: "Implémentation en TDD" },
  humains: {
    "confirmer-difficulte": [],
    "question-ouverte": ["po", "developpeur", "architecte", "administrateur"],
    "ratifier-adr": ["architecte"],
    arbitrer: ["developpeur", "architecte", "administrateur"],
    escalade: ["developpeur", "architecte", "administrateur"],
    blocage: ["po", "developpeur", "architecte", "administrateur"],
  },
  permissions: {
    // tout ce que le script ET ses agents peuvent écrire : un agent ne déclare rien qui n'y soit pas
    ecriture: [".skraft/**", "docs/adr/**", "@stack:acceptanceTests", "@stack:unitTests", "@stack:sources"],
    tests: true,
    git: ["branche", "commit", "revert"],
  },
  agents: {
    "skraft-researcher": { prompt: "agents/skraft-researcher.agent.md", classe: "standard", ecriture: [".skraft/**"], outils: ["list_files", "report_blocker"], sortie: "report_phase" },
    "skraft-architect-decide": {
      prompt: "agents/skraft-architect-decide.agent.md",
      classe: "strong",
      ecriture: [".skraft/**", "docs/adr/**"],
      outils: ["list_files", "report_blocker"],
      skills: { obligatoires: ["architecture-decisions", "adr-eligibility-gate"], aLaDemande: ["architecture-patterns"] },
      sortie: "report_phase",
    },
    "skraft-test": {
      prompt: "agents/skraft-test.agent.md",
      classe: "standard",
      ecriture: ["@stack:unitTests"],
      outils: ["list_files", "run_tests", "run_lint", "report_blocker"],
      skills: { obligatoires: ["test-design-mandates", "outside-in-tdd#RED"], aLaDemande: ["test-refactoring-catalog"] },
      sortie: "report_phase",
      memoire: "tache",
    },
    // … architecte (modélisation), acceptance, dev, quatre lentilles
  },
};

export default async function skraft(w, entree) {
  // le script de skraft-workflow, en JavaScript
}
```

**Le `meta` est une valeur littérale** : objets, tableaux, chaînes, nombres, booléens ; aucune
variable, aucun appel, aucun gabarit. C'est la condition pour que la plateforme le lise **sans
exécuter le script** (même contrainte que Claude Code). Il est validé par schéma au chargement
(`packages/workflow/src/chargeur/`) : champ inconnu, fichier d'agent ou skill absents du dossier,
chemin qui sort du dossier, outil qui n'est pas de la plateforme, `run_tests` sans
`permissions.tests`, droit d'écriture d'un agent absent de `permissions.ecriture` : refusés, avec
leur motif. Un agent ou une question humaine **appelés par le script** sans être déclarés ne se
voient qu'à l'exécution : l'appel est alors refusé et la tâche échoue avec ce motif.

Les outils d'un agent sont **ceux de la plateforme** (`list_files`, `run_tests`, `run_lint`,
`report_blocker`, `load_skill`) et sa **sortie** (`report_phase`, `submit_plan`,
`submit_difficulty`, `submit_lens_verdict`). Un workflow n'apporte pas d'outil (point 3).

## 5. Trouver les workflows

Au démarrage et à l'ouverture d'un projet, la plateforme lit les deux emplacements :

1. `~/.agent-studio/workflows/*/workflow.mjs` (machine) ;
2. `<projet>/.agent-studio/workflows/*/workflow.mjs` (projet) ;
3. même nom : le projet l'emporte, et c'est dit dans la conversation.

Un dossier copié à la main est trouvé comme un autre. Un `meta` invalide n'empêche pas l'ouverture
du projet : le workflow est écarté, et la raison est dite (champ et valeur fautive).

`/workflow ajouter skraft [--machine]` copie le modèle fourni avec l'application dans le projet
(par défaut) ou sur la machine. `/workflow liste` dit ce qui est trouvé, d'où, et sa version.

## 6. Lancer

- **Par commande** : `meta.commande` devient une commande (`/skraft <story> [--auto]`) ; ses
  arguments sont lus d'après `meta.entrees`.
- **Par l'agent principal** : il a un outil `proposer_workflow(nom, entrees)` ; la plateforme
  affiche la proposition (workflow, entrées, phases) et **rien ne démarre sans confirmation**.
  L'agent ne peut pas lancer seul.

## 7. La confiance

Un workflow du projet est du code du dépôt qui s'exécute sur la machine ; un workflow de la machine
aussi, venu d'ailleurs. Même règle pour les deux :

1. **Accord à la première exécution**, puis **à chaque modification** : la plateforme calcule
   l'**empreinte du dossier** et montre, avant l'accord, les permissions du script, les agents et
   leurs droits, les questions humaines et leurs profils. L'accord est retenu par empreinte.
2. **Dossier gelé pendant une tâche** : aucun agent ne peut écrire sous `.agent-studio/workflows/**`
   (garde du cœur), et l'empreinte enregistrée avec la tâche est revérifiée à chaque reprise : un
   dossier modifié refuse de reprendre la tâche (`docs/09` §6.5).
3. Les invariants du cœur restent garantis quoi que fasse le script : preuves produites par
   `run_tests` (D20), tests gelés (D21), périmètres d'écriture, gardes en refus par défaut (D28),
   aucun Git ni shell pour les agents.

## 8. Exécuter

- Le script tourne dans un **processus isolé dédié aux workflows** (`utilityProcess`, comme un hôte
  d'extension). S'il plante ou boucle, l'application continue ; il ne lui parle que par messages,
  pour demander une action `w.*`.
- **Interdit** dans ce processus : tout ce qui rend un résultat différent d'une exécution à l'autre
  ou touche l'extérieur — `Date` et `Math.random` directs, minuteries, `fetch` et réseau, `fs` et
  disque, `process`, `child_process`, `require` et modules Node (prévu par `docs/09` §6.4, jamais
  fait jusqu'ici). Deux raisons : le rejeu (un script qui lit l'heure prendrait un autre chemin
  après une reprise) et la sécurité (rien ne sort sans passer par `w.*`, donc par le `meta`).
- **Permis** : les **calculs purs** dont les contrôles ont besoin, fournis par
  `@agent-studio/workflow` (relevé fait sur skraft le 2026-10-09 : aucune heure, aucun hasard,
  aucun réseau dans ses contrôles, mais des calculs venus de modules) :
  - `empreinte(texte)` (sha256 ; skraft l'utilisait par `node:crypto`) ;
  - `correspond(motifs, chemin)` et la résolution de motifs de fichiers ;
  - `lireBarreDeQualite(...)`, `couchesManquantes(...)`, `coucheDe(...)` (barre de qualité,
    ADR 0049) et `lireYaml(texte)` ;
  - `essayer`, `agir`, les erreurs.
- **L'heure** est permise par un appel **journalisé**, `w.maintenant()` : à la première exécution,
  la plateforme note l'heure dans le journal ; au rejeu, le script reçoit la même. C'est la façon
  dont les moteurs de workflow durables rendent l'heure compatible avec le rejeu. `Date` reste
  interdit. (Le hasard pourrait suivre le même chemin, `w.aleatoire()`, si un workflow en a besoin.)
- Le script ne voit que `w` et `@agent-studio/workflow`. Les appels `w.*` sont exécutés par le
  processus principal, bornés par `meta.permissions` et `meta.agents`.
- Moteur, journal, rejeu, reprise après crash, sessions : **inchangés** (`docs/09`, ADR 0052, 0053).
  `createWorkflowTask` reçoit le script et le `meta` au lieu d'une déclaration en TypeScript.

## 9. Les ADR sans `render_adr` (point 7)

- L'architecte (décisions) écrit sous `docs/adr/**` (droit déclaré dans le `meta`).
- **Le code marque chaque nouvel ADR** : après le tour, le script ajoute la ligne
  `- Story : <slug>` aux ADR créés pendant le tour (le slug est celui créé à la première étape,
  avec les dossiers `.skraft/<slug>/`).
- **Règle** : un ADR est modifiable s'il porte le slug de l'US en cours **et** s'il est encore
  « Proposé ». Elle vaut pendant un réessai, un amendement, et après un arrêt ou une reprise,
  puisqu'elle se lit dans le fichier.
- **Contrôle** : avant le tour, le script lit les ADR existants ; après, la porte compare. Un ADR
  d'un autre slug modifié, un ADR décidé modifié, une ligne `Story` changée : rejet, et le tour est
  rembobiné. Le gabarit est vérifié par la porte cohérence (sections, statut).

## 10. Ce que ça change dans le code

| Part | Devenir |
|---|---|
| `packages/workflow` (moteur, rejeu, `essayer`, `agir`) | **gardé** ; `createWorkflowTask` prend `{ meta, script }` |
| Chargeur de workflows (deux emplacements, priorité, validation du `meta`) | **nouveau** |
| Hôte d'exécution isolé des workflows, `globalThis` réduit | **nouveau** (réutilise le mécanisme des hôtes d'extension) |
| Accord par empreinte, gel du dossier pendant une tâche | **nouveau** |
| Commandes `/<commande>`, `/workflow ajouter`, `/workflow liste` ; outil `proposer_workflow` de l'agent principal | **nouveau** |
| Composition des prompts d'agents (contenu + skills + contrat d'exécution) | **réutilisée** depuis `extension-host` (`agent-prompts.ts`) |
| `extensions/skraft-workflow` | **converti** en `workflows/skraft/` (JavaScript), puis retiré |
| `extensions/skraft` | **inchangé** (comparaison, ADR 0054) |
| `contributes.workflows` (prévu par `docs/09` §3) | **abandonné** |

## 11. Plan

Chaque étape a son critère de sortie.

1. **Documentation** : ce document, ADR 0055.
2. **Chargeur et `meta`** : lecture des deux emplacements, priorité, validation par schéma.
   *Sortie* : tests du chargeur (dossier copié à la main trouvé ; projet prioritaire ; `meta` non
   littéral, agent non déclaré, droit plus large que les permissions : refusés avec leur motif).
3. **Exécution isolée** : processus dédié, `globalThis` réduit, `w.*` bornés par le `meta`.
   *Sortie* : un script qui lit l'heure ou importe `node:fs` est refusé ; les tests du moteur
   passent par cet hôte.
4. **Accord et gel** : empreinte du dossier, accord retenu, dossier gelé pendant une tâche.
5. **Lancement** : commande, `proposer_workflow` avec confirmation.
6. **skraft en JavaScript** : conversion de `extensions/skraft-workflow`, ADR par slug (§9).
   *Sortie* : les jumeaux `e2e-s2` à `e2e-s6` et le test de reprise passent sur le workflow
   chargé depuis un dossier de projet.
7. **Comparaison** (`docs/10`) : l'extension `skraft` contre le workflow `skraft`.

## 12. Questions ouvertes

- **Tests des workflows** : les tests de skraft sont en TypeScript (Vitest) ; ils peuvent importer
  le `.mjs` du modèle. À confirmer à l'étape 6.
- **Mise à jour d'un workflow copié dans un projet** quand le modèle fourni change : rien d'automatique
  pour l'instant ; `/workflow liste` signale l'écart de version.
- **Profils et administrateur** (`admin.json`, O5) : un administrateur peut-il interdire les
  workflows de projet, ou n'autoriser que ceux qu'il a validés ? À trancher avant une diffusion
  au-delà des développeurs.

## 13. Comparaison avec Claude Code et Copilot

| | Claude Code | Copilot | agent-studio |
|---|---|---|---|
| Langage | JavaScript | JavaScript (`.mjs`) | JavaScript (`.mjs`) |
| Description | `meta` littéral en tête | dans l'extension | `meta` littéral en tête |
| Emplacement | `.claude/workflows/` | `.github/extensions/` ou `~/.copilot/extensions/` | `.agent-studio/workflows/` ou `~/.agent-studio/workflows/` |
| Qui écrit | l'agent ou l'utilisateur | l'utilisateur ou Copilot | **les développeurs** ; l'agent propose de lancer |
| Le script fait des E/S | non | oui (commandes, outils) | uniquement par `w.*`, bornés par le `meta` |
| Reprise | même session seulement | à un checkpoint | **après crash et fermeture** (journal persisté) |
| Accord | permissions de la session | `--allow-tool`, `--allow-url` | accord par empreinte, permissions et agents montrés |

Sources : [Claude Code — workflows](https://code.claude.com/docs/en/workflows),
[GitHub Changelog — dynamic workflows](https://github.blog/changelog/2026-10-01-dynamic-workflows-in-copilot-cli-and-the-copilot-app/),
[GitHub Docs — using dynamic workflows](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-dynamic-workflows).
