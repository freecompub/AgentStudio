# ADR 0016 — DISTILL : disposition des tests par pile, portes valeurs et RED, gel des tests d'acceptance

- Statut : accepté
- Date : 2026-09-23
- Jalon : S4 (SPEC-skraft §7.3, §13.2)

## Contexte

DISTILL doit écrire les tests d'acceptance « aux emplacements fournis par l'adaptateur de stack ».
Les valeurs des critères doivent être recopiées mot pour mot, les tests doivent être rouges pour
une bonne raison, et leur empreinte doit être gelée pour la suite du pipeline. Il faut aussi
relier chaque scénario et chaque test au critère d'acceptance qu'il couvre.

## Décision

1. **`StackLayout`** sur chaque adaptateur (`acceptanceTests`, `unitTests`, `sources`) :
   TypeScript `tests/acceptance/**`, `tests/**` et `src/**/*.test.ts`, `src/**` ;
   Swift `Tests/AcceptanceTests/**`, `Tests/**`, `Sources/**`. Le manifeste d'une extension peut
   citer `@stack:acceptanceTests`, `@stack:unitTests` et `@stack:sources` dans ses permissions
   d'écriture et dans les périmètres de ses agents ; l'hôte résout ces alias avec la pile détectée.
   Le ctx expose `stack.layout` et `workspace.fingerprint(globs)`.
2. **Convention de liaison** (propre à agent-studio, ADR 0012) : un scénario porte l'étiquette
   `@ac-<n>` ; un test d'acceptance porte `ac-<n>` dans son nom (ou `Ac<n>` en camelCase, par exemple
   `testAc2…` en XCTest).
3. **Porte valeurs** (fonction pure) : chaque littéral du critère n doit apparaître dans le
   scénario `@ac-n` **et** dans un fichier de test d'acceptance. La comparaison est textuelle
   (séparateur décimal et espaces insécables normalisés) ; dans le code du test, un nombre est aussi
   reconnu par sa valeur (`12.5` pour « 12,5 U »).
4. **Porte RED** : la porte lance `run_tests` sur les tests d'acceptance (preuve `DISTILL_RED`).
   Un échec sur assertion ou sur symbole manquant est accepté, tout autre échec est rejeté. Un test
   déjà vert n'est accepté que s'il est requalifié dans `test-plan.md` par une ligne
   `- @ac-<n> : role: regression — justification : <texte non vide>`. Sinon, rejet avec le nom du test.
5. **Gel** : à la sortie de la porte, `acceptanceHash = fingerprint(@stack:acceptanceTests)` et la
   liste des tests requalifiés (`regressions`) sont enregistrés une seule fois dans l'état. Le
   contrôle de l'empreinte pendant DELIVER relève de S5.

## Conséquences

- Les prompts de substitution du rôle `skraft-acceptance` rappellent les conventions 2 et 4.
- La reconnaissance d'un nombre par sa valeur peut accepter une valeur écrite autrement dans le
  code (`12.50`) ; c'est voulu, puisque seul le scénario doit reprendre le texte exact.
