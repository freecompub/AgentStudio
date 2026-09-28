# ADR 0030 — Reprendre la session d'un tour interrompu, mais jamais celle qu'on a coupée

- Statut : **décidé**, 2026-09-28
- Contexte amont : ADR 0026 et 0027 (plafonds), ADR 0029 (interruption ≠ verdict), D17 (une session
  neuve par phase/rôle), D10 (aucun objet du SDK exposé à une extension)

## Contexte

`resumeSession` existait sur le port `AgentRuntime` depuis l'origine, implémentée par l'adaptateur
Copilot — et **utilisée par la seule conversation humaine** (`main-session.ts`). Les agents de
tâche n'appelaient jamais que `openSession`.

Conséquence observée le 2026-09-28 : à 12:09 le modèle a cessé de répondre après 1 h 55 de travail.
Le réducteur a relancé, la relance a ouvert une session neuve, et tout le contexte accumulé — dépôt
parcouru, fichiers lus, raisonnement — était à repayer. Le run de mesure du soir a montré ce que
cela coûte : un tour d'`architect-decide` atteint **1 008 k tokens d'entrée en 4 min 18**, et un
tour qui recommence les repaie.

## Décision

1. **L'exécuteur d'agents mémorise la session d'un tour interrompu**, par clé de continuité
   (`<taskId>/<extension>/<rôle>`), et le tour suivant de la même clé la reprend.
2. **Seules deux causes rendent une session reprenable** :
   - `EnvFailureError` — le modèle n'a pas répondu ; le contexte va bien, c'est le service qui a
     hoqueté ;
   - `TurnTimeoutError` — l'agent s'est tu ; le contexte n'est pas en cause.
3. **`TurnBudgetError` et `TurnCostError` ne le rendent jamais.** C'est le point qui justifie
   d'avoir trois erreurs distinctes plutôt qu'une : quand c'est **nous** qui avons coupé, le
   contexte **est** le problème. Reprendre renverrait le même contexte énorme et retaperait le
   plafond dans la seconde — la boucle exacte qu'on a observée (« retried 5 times »). Une session
   neuve est alors le remède, pas la perte.
4. **Une session disparue côté runtime ne fait pas échouer le tour** : on repart sur une neuve, en
   le disant au journal.
5. **Sans clé de continuité, rien n'est mémorisé.** Les agents lancés hors tâche gardent le
   comportement d'avant, et deux tâches qui emploient le même rôle ne se mélangent pas.
6. **Rien de nouveau ne franchit la frontière d'extension.** La mémoire vit entièrement dans le
   cœur ; une extension ne voit ni session, ni identifiant de session. D10 est intact, et l'API
   `ctx.agents.run` est inchangée.

## Conséquences

- D17 (« une session neuve par phase/rôle, les transcriptions ne sont jamais réinjectées ») vise
  les **passages de phase** : ne pas verser la transcription de RESEARCH dans DESIGN. Reprendre un
  tour interrompu **à l'intérieur** de la même phase et du même rôle ne l'enfreint pas. Il fallait
  l'écrire, sinon la contradiction se lit.
- Une session reprise reçoit la configuration du nouveau tour — outils et garde compris. Le double
  de test ne le faisait pas ; il a été corrigé pour rester fidèle.
- **À vérifier (§16)** : le SDK Copilot reçoit `systemMessage: { mode: "append" }` à la reprise
  comme à l'ouverture. Si l'append est cumulatif, le prompt système serait ajouté deux fois sur une
  session reprise. `main-session.ts` fait la même chose depuis l'origine sans que le défaut ait été
  constaté, mais cela n'a pas été éprouvé délibérément.
- La reprise garde le contexte, donc elle garde aussi son coût : un tour repris repart d'un contexte
  déjà gros et atteindra le plafond de coût plus vite. C'est voulu — le plafond compte ce qui est
  envoyé au tour courant, pas ce qui a été accumulé avant.
