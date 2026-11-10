# ADR 0077 — Effort et contexte long déclarés par rôle

## Statut

**Accepté** le 2026-11-10 par le responsable du projet, qui a demandé un effort élevé et un contexte
de 1M pour le DESIGN, sur une nouvelle branche. **Révisé** le même jour après la revue de la branche
(« ok corrige ça ») : les points 3 et 4 refusaient la session, ils abandonnent désormais l'option
avec un avertissement (voir « Révision du 2026-11-10 »). Ce comportement est un choix provisoire, que
le responsable peut inverser.

## Contexte

Le choix du modèle par classe (ADR 0048) ne permet pas de demander un effort de raisonnement ou un
palier de contexte différents selon le rôle. La saturation du contexte a interrompu un run DESIGN,
alors que le SDK Copilot et Claude Code exposent des réglages propres à leur runtime.

## Décision

1. Les rôles peuvent déclarer `reasoningEffort` (`low`, `medium`, `high`) et `contextTier`
   (`default`, `long_context`). Ces options sont absentes par défaut et traversent le port
   `AgentRuntime`, sans exposer de détails du SDK au workflow ou à l'extension.
2. Les deux rôles architectes de DESIGN dans skraft demandent `high` et `long_context`, dans
   l'extension et dans le workflow indépendant.
3. Le runtime Copilot vérifie, avant d'ouvrir la session, que le modèle choisi déclare l'effort
   demandé et un palier long-context d'au moins 1M tokens (`supportedReasoningEfforts`,
   `capabilities.limits.max_context_window_tokens`, `billing.tokenPrices.longContext`). Il transmet
   ce qu'il a vérifié (`reasoningEffort`, `contextTier`) au SDK. Une option qu'il ne peut pas
   vérifier est abandonnée, avec l'avertissement `options de modèle ignorées` :
   - sans modèle explicite (la configuration par défaut), les deux options ;
   - pour un modèle absent du catalogue, ou un catalogue illisible, les deux ;
   - un effort non déclaré, seul ;
   - une fenêtre de moins de 1M tokens ou sans prix long contexte : le contexte long, seul.
4. Le runtime Claude transmet `--effort`. Pour `long_context`, il ne demande la variante `[1m]` que
   pour `sonnet` et `opus` (ou leurs formes `[1m]`) : on ne prétend jamais à un contexte étendu non
   connu. Un autre modèle (`haiku`, un identifiant complet, aucun) part tel quel, avec
   l'avertissement `contexte long ignoré`.

## Conséquences

- Les autres rôles et les sessions ordinaires gardent leur configuration inchangée.
- La taille effective d'une session Copilot reste celle rapportée par le runtime ; la validation de
  capacité et la demande de tier ne remplacent pas cette mesure.
- Un modèle Claude ou Copilot qui ne peut pas honorer une option travaille sans elle ; le journal
  dit laquelle et pourquoi.
- **Coût** : un effort élevé et un contexte long coûtent plus cher par tour. Ce sont des unités
  Copilot (le prix long contexte du modèle) et des dollars avec Claude. Seuls les deux architectes
  le demandent.
- Avec Copilot, il faut un modèle explicite pour la classe `strong` (`modeles.strong` du serveur MCP,
  ou le réglage de classe de l'application), qui déclare les options. Sinon, rien ne change par
  rapport à avant cette décision.
- **À vérifier sur un run réel** (aucun n'a été lancé) :
  - le palier de contexte effectivement accordé par Copilot ;
  - l'acceptation de `opus[1m]` par le CLI `claude`. `--effort` est confirmé par son aide.

## Alternatives

- Régler globalement l'effort et le contexte : rejeté, car cela modifierait aussi les rôles de revue,
  de test et de livraison.
- Laisser chaque agent choisir ses propres options : rejeté, car l'agent ne décide pas de sa
  configuration d'exécution.

## Révision du 2026-11-10

La première version refusait la session quand le modèle ne déclarait pas une option. La revue l'a
montré par un test :
- sans modèle choisi pour la classe `strong`, chaque run Copilot s'arrêtait au premier
  architecte. C'est la configuration par défaut du serveur MCP (`modeles: {}`) et de l'application,
  et un échec d'ouverture de session vaut escalade immédiate ;
- avec un modèle `strong` sans contexte long, DESIGN échouait à chaque essai ;
- côté Claude, tout modèle autre que `sonnet` ou `opus` faisait échouer chaque tour des architectes.

D'où les points 3 et 4 révisés : l'option qu'on ne peut pas honorer est abandonnée, avec un
avertissement, et le travail continue.
