# ADR 0010 — Adaptateur de stack Swift et usage par état

- Statut : accepté (lecture de Muter : **à vérifier**)
- Date : 2026-09-23
- Jalon : J5 (D37, §9.7, §13, §15)

## Contexte

J5 exige `/tdd` sur un projet Swift et l'affichage de l'usage par état de la machine. La machine de
développement est une Ubuntu 26.04 sans chaîne Swift ni outils de compilation système.

## Décision

1. **Adaptateur Swift** (SwiftPM + XCTest) :
   - `swift test --parallel --xunit-output <fichier hors projet>` ; identifiant d'un test :
     `<module>.<classe>/<méthode>`. Résultats triés, car `--parallel` rend l'ordre non déterministe.
   - La nature d'un échec est lue dans la sortie XCTest (`<fichier>:<ligne>: error: <Classe>.<méthode> : …`) :
     `XCTAssert*`, `XCTFail` et `XCTUnwrap` sont des assertions ; tout le reste est une autre erreur.
   - En Swift, un symbole absent **empêche la compilation**. Sans rapport, les erreurs du compilateur
     donnent une entrée par fichier : `cannot find … in scope`, `no such module`, `has no member`… dans
     un fichier de test = symbole manquant (bonne raison d'être rouge), sinon autre erreur.
   - Fichiers de test : sous `Tests/`.
   - **Architecture** : analyse des `import` de chaque module de `Sources/` (commentaires et chaînes
     ignorés) et règles de dépendance « le module X n'importe pas Y ».
   - **Mutation** : Muter, rapport JSON. La forme du rapport et les options de la ligne de commande sont
     reprises de la documentation et **à vérifier** sur la version installée (Muter n'a pas pu être
     exécuté ici). Utilisée à partir de S5.
2. **Sélection de la stack** par détection (`Package.swift`, puis dépendance `vitest`), par projet.
3. **Chaîne Swift hors système** : `findLocalSwiftToolchain()` retient `~/.cache/agent-studio/swift`
   (ou `$AGENT_STUDIO_SWIFT_HOME`) avec un dossier `compat/` (lien `libxml2.so.2`, objets GCC extraits
   des paquets, `ld.lld` via `CCC_OVERRIDE_OPTIONS`) pour les distributions plus récentes que la chaîne.
4. **Usage par état** (D37) :
   - le runtime traduit `assistant.usage` en événement `usage` (modèle, tokens, multiplicateur
     `cost`, expérimental dans le SDK) ;
   - l'exécuteur d'agent compte **une requête par prompt envoyé, multipliée par le coût du modèle**,
     et cumule les tokens (§13 ; décompte à confirmer selon l'offre Copilot) ;
   - le moteur attribue la durée et le nombre d'effets à l'état courant (`phaseOf`, défaut `state.phase`) ;
   - l'hôte attribue l'usage d'un agent à la tâche de son étiquette et à l'état courant de cette tâche ;
   - les réessais sont tenus par le réducteur (`state.retries`) ;
   - un enregistreur persistant (JSON par tâche) alimente la carte, affichée dans l'unité du
     fournisseur (requêtes pour Copilot), avec un tableau par état.

## Conséquences

- `/tdd` fonctionne sur Swift sans changement de l'extension : seul l'adaptateur diffère.
- Les tests qui exigent Swift sont sautés sans chaîne disponible (CI) ; ils ont été exécutés ici avec
  Swift 6.1.2.
- L'usage de la session principale n'est pas encore enregistré (seules les tâches le sont).
