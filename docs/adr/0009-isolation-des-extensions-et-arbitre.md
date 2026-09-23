# ADR 0009 — Isolation des extensions, RPC, hooks et arbitre de permissions

- Statut : accepté
- Date : 2026-09-23
- Jalon : J4 (D9, D10, D11, D13, D27, D28, §4.1, §5, §10)

## Contexte

Les extensions sont du code tiers non fiable. J4 exige qu'elles tournent hors du processus principal
sans perte de fonction, qu'une permission non déclarée soit refusée et qu'un hook qui plante
n'autorise rien.

## Décision

1. **Le `ctx` réel reste dans le principal.** L'hôte isolé réutilise l'hôte en processus de J2 :
   un module « pont » reçoit le `ctx` contrôlé (permissions, registre, moteur, preuves) et le rend
   accessible à l'enfant par RPC, via une **liste blanche** d'appels. L'enfant ne reçoit qu'un `ctx`
   mandataire : aucune session, aucun objet du SDK, aucun service (D10).
2. **Contributions par mandataires** : réducteurs de tâche, commandes et hooks vivent dans
   l'extension. Le principal enregistre des mandataires qui appellent l'enfant (délais : 5 s pour une
   transition, 2 s pour un hook, aucun pour un effet, qui a son propre watchdog). Le moteur accepte donc
   des définitions asynchrones ; le réducteur reste pur.
3. **RPC** : requête/réponse avec identifiant, annulation propagée (`AbortSignal`), délai par appel,
   arguments non sérialisables refusés. Les erreurs sont revivifiées selon leur nature
   (`WorkDefectError` = réessai, `EnvFailureError` = escalade). Une fermeture fait échouer les appels
   en cours comme panne d'environnement.
4. **Processus** : un par extension. `utilityProcess.fork` dans Electron, `child_process.fork` hors
   Electron (tests), toujours sous le **modèle de permissions Node** (`--permission` : lecture limitée
   au dossier de l'extension et du runtime, ni écriture ni sous-processus), avec un budget mémoire.
   Les extensions sont livrées **compilées** (bundle ESM autonome, `manifest.main`).
5. **Supervision** : à un plantage, les appels en cours échouent (les tâches escaladent), les
   contributions et hooks sont retirés, puis l'hôte redémarre. Au-delà de trois plantages par heure,
   l'extension est désactivée pour la session, avec un message qui la nomme (§4.1).
6. **Hooks** (`ctx.hooks.onPreToolUse`) : ils ne peuvent que refuser. Ils sont composés **après** les
   gardes du cœur, dans les sessions de tâche comme dans la session principale. Tout plantage ou délai
   dépassé vaut refus (D28).
7. **Arbitre de permissions unique** (D27) : politique du cœur, puis hooks d'extension, puis règles
   mémorisées de l'utilisateur, puis question à l'écran (« une fois », « toujours », « refuser »).
   Une règle ne contourne jamais un refus du cœur ni d'une extension.
8. **Manifeste validé** (`packages/extension-manifest`) à l'installation et au démarrage : schéma,
   compatibilité semver de `engines.appApi`, grammaire fermée des permissions, cohérence des
   contributions avec les permissions (D11, D13). Une extension invalide est écartée.

## Conséquences

- Le même contexte sert aux deux modes d'hébergement : les tests de bout en bout tournent dans les
  deux modes, ce qui prouve l'absence de perte de fonction.
- La politique de profil (§10.3) viendra au J6 comme couche supplémentaire de l'arbitre.
- Non vérifié ici faute d'environnement graphique : l'exécution réelle sous `utilityProcess` avec
  `--permission` dans Electron (voir `docs/jalons/J1-blocages.md`).
