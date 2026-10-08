# ADR 0054 — skraft et skraft-workflow coexistent, indépendants, le temps de les comparer

- Statut : **décidé**, 2026-10-08 (décision du responsable du projet)
- S'appuie sur : ADR 0052 (orchestration par script rejouable), ADR 0053 (cycle de vie des sessions)
- Détail : `docs/09-workflows-rejouables.md` §14, `extensions/skraft-workflow/README.md`

## Contexte

Le pipeline skraft a été réécrit en workflow rejouable, phase par phase, dans une extension à
part : `extensions/skraft-workflow` (`/skraft-workflow`). Le responsable a demandé qu'elle soit
**totalement indépendante** de `extensions/skraft` : elle n'en importe rien, et ses fonctions
pures, ses agents et ses skills sont des copies qui portent leur provenance.

Les deux extensions font la même chose. Les tests jumeaux le montrent sur des agents simulés
(dont la vraie chaîne Swift), mais aucun run réel avec Copilot n'a encore comparé les deux.
Mesure de taille : 1 015 lignes de code pour le workflow, 1 624 pour le réducteur ; gain faible
sur DELIVER seul (595 contre 639).

## Décision

1. **Les deux extensions restent**, distribuées chacune en paquet `.asx` (`pnpm ext:build`, puis
   `pnpm ext:pack`), non signées, donc en mode développeur (ADR 0021).
2. **Elles restent indépendantes** : aucune importation de l'une par l'autre (vérifié par
   `extensions/skraft-workflow/test/independance.test.ts`), identifiants distincts
   (`agent-studio.skraft`, `agent-studio.skraft-workflow`), donc agents et sessions distincts.
3. **On les compare sur de vraies stories avec Copilot** avant de choisir : réussite, nombre de
   requêtes et de tokens par phase, interventions humaines, facilité à corriger un comportement.
4. Tant que la comparaison n'a pas eu lieu, **aucune n'est retirée**, et les écarts du §13 de
   `docs/09` ne sont tranchés dans aucune des deux.

## Conséquences

- Environ 450 lignes de fonctions pures (story, difficulté, portes, revue) existent en deux
  exemplaires. **Une correction faite dans l'une ne se reporte pas seule dans l'autre** : il faut
  la reporter à la main, ou assumer l'écart et le noter dans `progress.md`.
- Les tests copiés protègent chaque copie, pas leur accord. Les tests jumeaux (`e2e-s*-workflow`)
  sont le seul endroit où les deux comportements se comparent.
- Le choix final donnera un ADR qui remplace celui-ci : retrait de l'une, ou fusion.
