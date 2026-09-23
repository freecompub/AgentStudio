# J2 — Bilan

- Date : 2026-09-23
- Branche : `feat/j2-moteur-taches` (partie de `feat/j1-socle`)
- État : **critères de sortie vérifiés en tests automatisés, sans LLM** ; validation avec le vrai
  Copilot et dans l'interface bloquée par les points de J1 (`docs/jalons/J1-blocages.md`).

## Critères de sortie (SPEC §14)

| Critère | État | Preuve |
| --- | --- | --- |
| `/tdd` déroule un cycle complet sur un projet TypeScript | ✅ agents scriptés / ⏳ vrai LLM | `extensions/tdd/test/e2e-cycle.test.ts` (scénario 1) : vrai Git, vrai Vitest, commits `test:` puis `feat:` |
| Tous les tests du réducteur passent sans LLM | ✅ | `extensions/tdd/test/reducer.test.ts` (35 tests purs) |
| Une modification de test par l'agent dev est détectée et annulée | ✅ | scénario 2 : empreinte des tests gelés, rollback au point rouge, relance avec le motif |
| Un redémarrage en plein GREEN reprend proprement | ✅ | scénario 3 : nouveau moteur sur le même stockage, rollback du travail partiel, `RESUMED`, cycle terminé |

## Livré

| Paquet | Contenu |
| --- | --- |
| `packages/task-engine` | Moteur générique : persistance après chaque transition, checkpoint et marqueur avant chaque effet, reprise, `TIMEOUT` / `ENV_FAILURE`, annulation, stockage JSON (ADR 0006) |
| `extensions/tdd` | Réducteur pur, dossier de passation, portes RED et GREEN exécutées par le code, manifeste, `/tdd` |
| `packages/stack-adapters` | Adaptateur TypeScript (Vitest JSON), classement des échecs, lanceur qui tue l'arbre de processus, empreinte des fichiers |
| `packages/core` | Registre, routeur, garde des agents de tâche, outils terminaux, exécuteur d'agent, demandes d'interaction, runtime paresseux |
| `packages/extension-api`, `packages/extension-host` | API `ctx` 0.1, hôte en processus, permissions déclarées (ADR 0007) |
| `apps/desktop` | Routage des commandes, cartes de tâche, « En attente de vous », aide à la saisie `/` |

## Limites connues, prévues aux jalons suivants

- **J3** : les demandes d'interaction sont **en mémoire**. Après un redémarrage, une tâche en attente
  de décision reste `waiting`, mais sa demande a disparu (vérifié par
  `workspace-services.test.ts`). Restent aussi à faire : l'outil `run_tests` et les preuves, la
  granularité par défaut (un tour par comportement), les jalons et alertes avec notifications.
- **Granularité** : seul le mode strict (une session par pas RED / GREEN / REFACTOR) est implémenté.
- **J4** : l'extension `tdd` tourne dans le processus principal ; composition des hooks et manifeste
  validé par schéma à faire.
- La politique « suite déjà rouge au début d'une étape » donne une escalade immédiate
  (`ENV_FAILURE`) : il faut réparer la suite avant de lancer `/tdd`.
- Un projet sans Vitest (Jest, Swift…) échoue à la première exécution des tests : seul l'adaptateur
  TypeScript/Vitest existe (Swift au J5).

## Blocages hérités de J1

Toujours ouverts : jeton `gh` refusé par Copilot, et Electron non lançable sur la machine de
développement. Voir `docs/jalons/J1-blocages.md`.
