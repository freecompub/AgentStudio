# ADR 0061 — Retrait de Swift

## Statut

Accepté le 2026-10-11, à la demande de l'utilisateur. Remplace l'ADR 0010 pour sa partie
« adaptateur de stack Swift » ; l'usage par état qu'il décidait reste en place.

## Contexte

Le commit `036016a` (ADR 0060) lance les tests du projet avant tout appel d'agent. Les
quatre tests de bout en bout Swift (`e2e-s5`, `e2e-s6`, extension et workflow) ont cessé de
passer : le projet de démonstration déclarait la cible `AcceptanceTests` dans `Package.swift`
avant que DISTILL n'en crée le dossier, et SwiftPM refusait de lancer les tests. Ces tests sont
sautés quand la chaîne Swift est absente, ce qui est le cas sous macOS et dans la CI : la
régression n'était visible que sur la machine qui possède `~/.cache/agent-studio/swift`.

Aucun projet réel ne tourne en Swift : la campagne de comparaison porte sur un projet .NET, et
les profils de stack (J5) permettent d'ajouter un langage sans code. Plutôt que de réparer le
projet de démonstration ou de le porter vers un autre langage, l'utilisateur décide de retirer
Swift.

## Décision

Swift est retiré entièrement :

- `packages/stack-adapters/src/swift/` : adaptateur, chaîne locale, analyse des imports,
  lecteurs de sortie XCTest, SwiftLint et Muter ;
- lecteurs de profil `swiftlint-json` et `muter-json` ; modèle Swift de `/stack init` ;
  `profiles/swift.yaml` ;
- branchement de l'adaptateur dans l'application ; `swift`, `swiftlint` et `muter` dans la liste
  des programmes autorisés par défaut ; `swift test` dans les commandes de test autorisées sans
  question par la politique « souple » ;
- tests de bout en bout sur la vraie chaîne Swift (`e2e-j5-swift` de `tdd`, `e2e-s5` et `e2e-s6`
  de skraft, extension et workflow) et leur projet de démonstration.

Le lecteur JUnit XML, générique, quitte le dossier Swift pour `src/reports/junit-xml.ts`.

La pile simulée des tests skraft (`fakeStack`, ex-`fakeSwiftStack`) imite désormais un projet
TypeScript avec Vitest (`src/`, `tests/acceptance/`, `tests/unit/`, identifiants
`<fichier> > <test>`). Les chemins Swift qui restent dans les tests unitaires de skraft sont des
données de texte (citations, chemins de fichiers) : le code testé ne connaît aucun langage
(SPEC §0, règle 10), ils n'ont pas été réécrits.

## Conséquences

- Les critères de sortie de S5 (« US-12 livrée sur le projet Swift de démonstration ») et de S6
  (« bout en bout 13.3 vert ») ne sont plus couverts par une vraie chaîne de tests : il reste la
  pile simulée. Un bout en bout sur une vraie chaîne, TypeScript ou .NET, est à écrire.
- `profiles/typescript.yaml` déclarait `report: muter-json` pour Stryker : il lit désormais
  `stryker-json`, le seul lecteur de mutation qui reste.
- La règle de dépendance (analyse des imports) n'est plus vérifiée par aucun adaptateur :
  l'adaptateur Swift était le seul à la fournir, et les profils n'ont pas de section pour elle.
  La porte d'architecture est donc « non disponible » partout (D45).
- Un projet Swift n'est plus reconnu : `/stack init` ne propose rien sur `Package.swift`, et un
  profil Swift écrit à la main est refusé tant que l'administrateur n'autorise pas `swift`.
- Les documents datés (ADR 0010, bilans de J5, S5, S6, `progress.md`) restent tels quels : ils
  décrivent l'état de leur époque.
