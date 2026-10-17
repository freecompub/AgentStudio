# skraft en serveur MCP local

- Date : 2026-10-13, branche `feat/workflow-rejouable`.
- Statut : **étude**, suivie de l'ADR 0068 (accepté le 2026-10-17, branche `feat/mcp-skraft`) : option A, workflow, transport stdio, verrou par projet, projet borné, runtime Copilot.
- Question : peut-on utiliser skraft depuis Claude Code ou Copilot CLI, sous la forme d'un serveur
  MCP exécuté en local ?

---

## 1. Réponse courte

Oui, à une condition : **le serveur MCP reste l'orchestrateur et lance lui-même ses agents.**
L'hôte (Claude Code, Copilot CLI) ne sert qu'à démarrer un run, le suivre et répondre aux
questions. Si l'on demande au contraire au LLM de l'hôte de jouer les agents, le principe « le LLM
propose, le code décide et vérifie » ne tient plus.

---

## 2. Ce que dit le code

| Constat | Où |
|---|---|
| Le moteur ne dépend pas d'Electron : aucun import d'`electron` dans `workflow`, `core`, `task-engine`, `runtime-copilot`, `extension-host` | `packages/*/src` |
| Le workflow skraft est autonome : il n'importe rien de l'extension | `workflows/skraft/` |
| L'assemblage des services d'un projet ne dépend pas d'Electron : moteur de tâches, stockage JSON des tâches, etc. | `apps/desktop/src/main/workspace-services.ts` (`workspaceServicesFactory`) |
| Les tâches sont persistées en JSON, ce qui permet la reprise | `packages/task-engine` (`createJsonTaskStore`) |
| Un lanceur de processus Node existe pour isoler un script, à côté du lanceur `utilityProcess` d'Electron | `packages/extension-host/src/launchers/node-launcher.ts` |
| Un workflow s'active hors de l'interface | `packages/workflow/src/hote/activer.ts` (`activerWorkflow`) |
| Les dépendances à fournir sont celles de `HostDeps` : registre, moteur, agents, Workspace, adaptateur de pile, interactions, preuves, hooks, chat, horloge, identifiants | `packages/extension-host/src/in-process-host.ts` |
| Un seul runtime d'agent est implémenté : Copilot | `packages/runtime-copilot` |

Ce qui reste couplé à l'application : la fenêtre, l'IPC, les confirmations et consentements
(`ipc-confirmer`, `ipc-consent`) et la conversation affichée (le chat). Le serveur MCP doit
remplacer ces éléments par des outils et des notifications MCP.

---

## 3. Deux architectures

### A. Le serveur MCP orchestre (recommandée)

```
Claude Code / Copilot CLI ──MCP (stdio)──▶ serveur skraft local
                                            ├─ workflow skraft (script rejouable)
                                            ├─ portes, gels, preuves : le code
                                            ├─ sessions d'agents neuves par rôle (Copilot SDK)
                                            └─ Workspace : seul accès au disque et à Git
```

- Les portes, les rejets, le gel des tests et les preuves restent dans le code.
- Chaque rôle garde sa session neuve, son dossier de passation et ses gardes d'écriture
  (`onPreToolUse`).
- L'hôte ne voit que des résultats sérialisés.

### B. Le serveur MCP n'expose que les portes (déconseillée)

Le LLM de l'hôte écrit le code et les tests, puis appelle des outils comme `verifier_red` ou
`verifier_gel`.

- Rien n'oblige l'hôte à appeler les portes, ni à respecter leur verdict.
- Il n'y a plus de session neuve par rôle : le même contexte écrit les tests puis le code.
- Le serveur ne voit pas les écritures de l'hôte et ne peut donc pas en limiter le périmètre.
- C'est exactement ce que la reprise de skraft évite : déplacer vers le LLM une décision que le
  code prend (règle GPL et reprise, `CLAUDE.md`).

### Comparaison

| | A. Le MCP orchestre | B. Le MCP expose les portes |
|---|---|---|
| Qui lance les agents | Le serveur, avec ses sessions | Le LLM de l'hôte |
| « Le code décide » | Conservé | Perdu |
| Session neuve par rôle | Conservée | Perdue |
| Gardes d'écriture | Conservées | Impossibles |
| LLM de l'hôte utilisé | Non : l'hôte est une télécommande | Oui |

---

## 4. Outils MCP pour l'option A

Un run dure longtemps : un appel bloquant dépasserait les délais des clients MCP. Les outils sont
donc courts et l'hôte interroge le serveur.

| Outil | Rôle |
|---|---|
| `skraft_demarrer(story, auto?)` | Crée la tâche, renvoie son identifiant |
| `skraft_etat(id)` | Phase, étape, dernier rejet, questions en attente |
| `skraft_repondre(id, question, choix, texte?)` | Ratification d'ADR, escalade, arbitrage, réponse à une question ouverte |
| `skraft_reprendre(id)` | Reprise après un arrêt du serveur (rejeu du journal) |
| `skraft_arreter(id)` | Abandon |
| `skraft_rapport(id)` | Rapport final, traces, dérogations |

Les questions à l'humain sont déjà des demandes d'interaction enregistrées, jamais des attentes
bloquantes : elles se traduisent directement en `skraft_etat` puis `skraft_repondre`. Les messages
du chat deviennent des notifications MCP (journal ou progression).

---

## 5. Travaux nécessaires

1. **Point d'entrée Node** : un nouveau paquet, par exemple `apps/mcp-skraft`, qui assemble
   `HostDeps` à partir de `workspaceServicesFactory`, avec le lanceur Node et sans fenêtre.
2. **Remplacement de l'IPC** : interactions, confirmations, consentements et chat traduits en
   outils et notifications MCP.
3. **Authentification Copilot** : jeton GitHub lu comme dans l'application (`github-auth`).
4. **Reprise** : vérifier que la persistance des tâches et du journal de rejeu fonctionne hors
   Electron. Ce point n'est **pas encore vérifié**.
5. **Tests** : de bout en bout avec le `ScriptedRuntime` (`@agent-studio/core/testing`), sans LLM
   réel, en pilotant le serveur par un client MCP de test.

---

## 6. Limites

- **Le modèle des agents.** Avec Claude Code comme hôte, les agents de skraft tournent quand même
  sur Copilot. Pour qu'ils tournent sur Claude, il faut un adaptateur Claude Agent SDK, qui n'est
  aujourd'hui qu'une interface documentée (port `AgentRuntime`, SPEC §4.3), non implémentée.
- **Deux LLM, deux coûts.** L'hôte consomme pour piloter, les agents de skraft consomment pour
  travailler.
- **Conflits d'écriture.** Pendant un run, l'hôte ne doit pas modifier le dépôt : skraft travaille
  sur sa branche `skraft/<slug>` et ses checkpoints Git supposent d'être seuls.
- **Workflow ou extension.** Le workflow est le candidat naturel, car il est autonome et rejouable.
  L'extension est liée au réducteur et à l'hôte d'extensions ; la porter en plus doublerait le
  travail tant que les deux coexistent (ADR 0054).

---

## 7. Prochaines étapes proposées

1. Écrire un ADR (option A, workflow seulement).
2. Faire un essai avec le `ScriptedRuntime` : démarrer, répondre à une ratification, aller jusqu'au
   rapport final, sans Copilot réel.
3. Lever le point 4 du §5 (reprise hors Electron).
