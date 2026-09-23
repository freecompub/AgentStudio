# ADR 0018 — Revue : faits établis, contexte par lentille, correction ciblée, verdict reproductible

- Statut : accepté
- Date : 2026-09-23
- Jalon : S6 (SPEC-skraft §9, §12, §13.3)

## Contexte

Les lentilles ne doivent pas revérifier ce que le code a déjà établi, et `cold-reader` doit lire
les livrables sans le contexte du producteur. Le verdict doit être rejouable depuis les JSON des
lentilles. Une revue de DELIVER qui demande des changements ne doit pas refaire toute la phase.

## Décision

1. **Faits établis** (`reviewFacts`, pur) : livrables et empreintes validés par les portes,
   empreinte des tests d'acceptance, non-régressions justifiées, dernière exécution des tests par
   le code, et pour DELIVER, par scénario : tests unitaires rouges puis verts, mutation, règle de
   dépendance, Object Calisthenics, plus les constats « non mesuré ».
2. **Contexte par lentille** (`lensBrief`, pur) : `cold-reader` ne reçoit que la liste des
   livrables, du code et des tests (ni story, ni réponses, ni faits, ni ADR). `test-integrity` reçoit
   les critères, les tests, les livrables et les faits. `architecture` reçoit les ADR ratifiés
   (`Accepted`), le code, les livrables et les faits. Chaque lentille tourne dans une session
   neuve, en parallèle.
3. **Rapports reproductibles** : le rapport Markdown est une fonction pure des JSON
   (`reviewReport`) ; `replayReview` redonne le même verdict et le même rapport. Au commit de la
   phase, le code réécrit tous les rapports depuis l'état, car un rollback de réessai peut avoir
   effacé ceux des revues précédentes.
4. **Correction ciblée en DELIVER** : si la revue demande des changements, retour au dernier point
   sûr (dernier vert), puis nouveau pas `fix` de `skraft-dev`. Il reçoit les seuls défauts
   `blocker` et `major` avec fichier et ligne. Viennent ensuite la porte de pas (tests gelés,
   production modifiée, suite verte, commit `fix:`), la porte de fin de scénario (mutation,
   dépendances et calisthenics du code corrigé), puis une nouvelle revue. Le budget de la phase
   s'applique. Les autres phases gardent le réessai complet depuis leur checkpoint.
5. **Mesures** : réessais comptés par phase dans l'état (`retries`) et affichés dans le bilan ;
   requêtes, tokens et durées par état restent mesurés par le cœur (D37).

## Conséquences

- La synthèse garde les règles minimales de §9.3 ; la table de pondération de
  `adversarial-review-lenses` attend la décision de licence (ADR 0012).
- Les mesures sur trois stories sont faites avec des agents simulés. La comparaison chiffrée
  sur de vraies stories attend un run réel avec Copilot, bloqué par le jeton (J1-blocages).
