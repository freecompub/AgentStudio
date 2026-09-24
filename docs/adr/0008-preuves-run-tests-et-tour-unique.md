# ADR 0008 — Preuves produites par le code, outil run_tests et tour unique par comportement

- Statut : accepté
- Date : 2026-09-23
- Jalon : J3 (D20, D21, D22, D31, D33, §6.4, §6.5, §7.2)

## Contexte

J3 exige des preuves de rouge puis de vert pour chaque comportement, un tour d'agent par comportement
par défaut, des demandes d'interaction persistées, ainsi que des cartes, jalons et alertes.

## Décision

1. **Journal de preuves** (`Evidence`, stockage JSONL par tâche). Une preuve est écrite par le cœur à
   chaque exécution de tests, qu'elle vienne de l'outil `run_tests` appelé par un agent (source
   `run_tests`) ou d'une porte (`ctx.stack.runTests` avec étiquette, source `gate`). Elle contient les
   compteurs, les échecs classés, les identifiants des tests, l'empreinte des fichiers de test et HEAD.
   L'extension ne peut que la lire (`ctx.evidence.list`).
2. **Outil `run_tests`** fourni par le cœur aux agents qui le déclarent dans le manifeste (`tools`),
   ce qui exige `shell:test`. L'agent ne voit qu'un résumé mesuré. Chaque ligne de sortie réarme le
   watchdog via un battement (`Heartbeat`) transmis à `runTurn`.
3. **Gel dans le tour** : avec `freezeTestsAfterRed`, une garde composée refuse toute écriture de
   fichier de test après la première exécution rouge (prévention). La porte revérifie par empreinte
   (détection, D36).
4. **Composition des gardes** (`composeGuards`) : exécution en série, premier refus l'emporte, délai
   par garde, refus si une garde plante ou expire (D28). La garde du rôle passe avant les gardes
   supplémentaires.
5. **Tour unique par défaut** (D22) : l'agent `tdd-pair` écrit le test, le voit rouge via `run_tests`,
   écrit le code et le voit vert. La porte du cycle exige, dans les preuves **de ce tour** (étiquette
   `CYCLE:<runId>`, pour qu'un tour interrompu ne serve jamais de preuve au suivant), un rouge du
   nouveau test pour une bonne raison, puis un vert. Elle exige aussi des tests inchangés depuis le
   rouge et une exécution finale verte avec un seul nouveau test. Les commits sont séparés : `test:`
   (fichiers de test seuls) puis `feat:`. Un échec du tour donne un rollback au début d'étape et le
   **mode strict pour cette étape**, sans consommer de budget ; l'étape suivante revient au tour unique.
   `/tdd --strict` impose le mode strict.
6. **Demandes d'interaction persistées** (JSON, un fichier par demande) : une escalade survit au
   redémarrage ; la réponse relance la tâche.
7. **Progression** (`createProgressReporter`) : la carte est rafraîchie au plus deux fois par seconde
   (dernier état toujours publié). Les jalons sont émis à l'entrée des états déclarés et regroupés au
   delà d'un toutes les dix secondes ; les alertes sont immédiates. Jalons et alertes sont consignés
   dans la conversation (origine affichée, jamais envoyés au LLM) et notifiés par le système si la
   fenêtre n'a pas le focus.

## Conséquences

- Le critère « preuves de rouge puis vert pour chaque comportement » est vérifiable mécaniquement
  sur le journal, dans les deux modes (`e2e-j3.test.ts`).
- `run_tests` exécute toujours toute la suite : un sous-ensemble (§6.5) viendra si la durée l'exige.
