# ADR 0070 — Runtime Claude par le CLI (`claude -p`), au choix avec Copilot

## Statut

**Accepté** le 2026-11-06 par le responsable du projet, branche `feat/mcp-skraft`.
Essais du 2026-11-06 (Claude Code 2.1.319) : `progress.md`, entrée du 06/11.

## Contexte

Tous les runs réels passent par Copilot (`packages/runtime-copilot`). Le cœur ne dépend que du port
`AgentRuntime` (SPEC §4.3), qui prévoit déjà l'identifiant `claude-agent-sdk`. Le responsable veut
pouvoir choisir Claude. Deux voies : le Claude Agent SDK, ou le CLI de Claude Code en mode non
interactif (`claude -p`).

Le CLI a l'avantage de ne demander **aucune authentification nouvelle** (la connexion `claude`
existante, par abonnement ou clé API), aucun SDK à intégrer, et d'offrir un plafond de coût par tour
(`--max-budget-usd`). Les essais ont vérifié qu'il couvre ce que le port exige.

## Décision

1. **Un adaptateur `packages/runtime-claude`**, derrière le port `AgentRuntime`, qui lance un
   processus `claude -p` par tour. Copilot reste le runtime **par défaut** ; le choix se fait par
   configuration (`runtime: copilot | claude`) dans l'application et dans le serveur MCP
   (ADR 0068). Le cœur, l'extension et le workflow ne savent pas quel runtime tourne.
2. **Isolement**, chaque tour : `--setting-sources ""` (ni réglages, ni hooks, ni `CLAUDE.md` du
   projet ou de l'utilisateur — `--system-prompt` seul ne les écarte **pas**, essai témoin),
   `--disable-slash-commands` (ni skills ni commandes), `--strict-mcp-config` (seulement nos
   serveurs MCP), `--tools` (outils intégrés du rôle, **sans Bash** : les tests passent par
   `run_tests`, qui produit les preuves).
3. **Agents et skills : notre composition, inchangée.** Le prompt système composé par le cœur
   (`composeAgentPrompt` : contenu de l'agent, skills obligatoires, consignes, contrat) passe par
   `--system-prompt` ; les skills à la demande par notre outil `load_skill`. Les agents et skills
   natifs de Claude Code (`--agents`, `--plugin-dir`) ne sont pas utilisés : même contenu sur les deux
   runtimes, chargements tracés, ADR 0024.
4. **Nos outils par MCP.** `report_phase` et les autres outils de fin, `run_tests`, `run_lint`,
   `list_files`, `report_blocker`, `load_skill` (et `render_adr` pour l'extension) sont servis par un
   serveur MCP que le CLI lance (`--mcp-config`) et qui **relaie chaque appel à notre processus** par
   un socket local. Le modèle les voit sous `mcp__<serveur>__<outil>` : le contrat ajouté par le
   cœur donne ces noms quand `capabilities.customTools` vaut `"mcp"`.
5. **Gardes d'écriture, avant l'écriture.**
   - Le périmètre du rôle et les fichiers gelés, connus au début du tour, deviennent des règles de
     permission par chemin (`--allowedTools "Write(<motif>)" "Edit(<motif>)"`).
   - Tout le reste est soumis à **notre outil de permission** (`--permission-prompt-tool`, caché au
     modèle par `--disallowedTools`) : la même garde qu'avec Copilot (`ToolCallGuard`) décide, y
     compris les règles qui changent pendant le tour (`gelApresRouge`). Refus par défaut si le relais
     échoue ou expire, comme pour toute garde (SPEC, hooks).
6. **Événements** lus dans `--output-format stream-json --verbose` : outils et session à
   l'initialisation, appels d'outil et résultats, usage par étape, et au résultat final le coût en
   dollars, l'usage par modèle et les permissions refusées. Ils alimentent le chien de garde, la
   trace et l'usage (`usageUnit: "tokens"`, coût en dollars à côté des unités Copilot).
7. **Modèles** : les classes `strong`, `standard`, `light` (ADR 0048) reçoivent une correspondance
   Claude par projet (`--model`, `--fallback-model`).

## Conséquences

- Rien ne change pour Copilot : adaptateur intact, défaut inchangé, et les tests du dépôt passent par
  le runtime simulé, qui ne dépend d'aucun des deux.
- Le format `stream-json` suit les versions du CLI : tests de contrat sur des sorties enregistrées,
  et version minimale vérifiée au démarrage.
- Un processus par tour : quelques secondes de démarrage ; la reprise d'une session passe par
  `--session-id` puis `--resume` (à vérifier, ainsi que l'interruption et `--json-schema`).
- Coût et réserve : la réserve premium et `nanoAiu` restent propres à Copilot ; pour Claude, les
  rapports donnent tokens et dollars (`total_cost_usd`). `--max-budget-usd` borne un tour.
- Effort estimé : 1,5 à 2 semaines, dont le relais MCP (la pièce la plus lourde), les gardes, le choix
  du runtime, l'usage, et un run réel sur US-2 avec l'accord du responsable.
