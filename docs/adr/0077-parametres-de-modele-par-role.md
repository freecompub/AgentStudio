# ADR 0077 — Effort et contexte long déclarés par rôle

## Statut

**Accepté** le 2026-11-10 par le responsable du projet, qui a demandé un effort élevé et un contexte
de 1M pour le DESIGN, sur une nouvelle branche.

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
3. Le runtime Copilot vérifie avant l'ouverture de session que le modèle sélectionné déclare l'effort
   demandé et un palier long-context d'au moins 1M tokens ; sinon, il refuse explicitement la session.
   Il transmet ensuite `reasoningEffort` et `contextTier` au SDK.
4. Le runtime Claude transmet `--effort` et, pour `long_context`, n'accepte que les alias `sonnet` et
   `opus` (ou leurs formes `[1m]`) ; il transmet le modèle avec le suffixe `[1m]`. Un autre alias est
   refusé au lieu de prétendre utiliser un contexte étendu.

## Conséquences

- Les autres rôles et les sessions ordinaires gardent leur configuration inchangée.
- La taille effective d'une session Copilot reste celle rapportée par le runtime ; la validation de
  capacité et la demande de tier ne remplacent pas cette mesure.
- Un modèle Claude ou Copilot indisponible pour les options demandées échoue avant le travail de
  l'agent, avec un motif explicite.

## Alternatives

- Régler globalement l'effort et le contexte : rejeté, car cela modifierait aussi les rôles de revue,
  de test et de livraison.
- Laisser chaque agent choisir ses propres options : rejeté, car l'agent ne décide pas de sa
  configuration d'exécution.
