# skraft-workflow

Le pipeline skraft écrit en **workflow rejouable** (ADR 0052, `docs/09-workflows-rejouables.md`).
Extension **totalement indépendante** de `extensions/skraft` : elle n'en importe rien (un test le
vérifie, `test/independance.test.ts`), et `/skraft` n'est pas modifiée.

Commande : `/skraft-workflow [--auto] <story>`. Pour l'instant : préparation, difficulté, RESEARCH,
questions ouvertes, DESIGN (revue et ratification comprises) et DISTILL (portes, RED d'acceptance,
gel des tests), puis publication du dossier de passation de DELIVER.

## Provenance et licence

GPL-3.0-or-later, comme skraft. Copié de `extensions/skraft` le 2026-10-08, avec un commentaire de
provenance en tête de chaque fichier :

- `src/story.ts`, `difficulty.ts`, `research.ts`, `text-analysis.ts`, `preselect.ts` et leurs tests ;
- `src/design.ts`, `adr.ts`, `render-adr-tool.ts`, `review.ts`, `review-thread.ts`, `distill.ts`,
  `gherkin.ts` et leurs tests ;
  `src/review-brief.ts` (sans l'état du réducteur) ;
- `src/support.ts` (extraits de `effects.ts` et `config.ts`), `src/brief.ts` (réduit), `src/roles.ts` ;
- `agents/` : classifieur, chercheur, les deux architectes, l'agent d'acceptance et les quatre
  lentilles ;
- `skills/` : les dix skills de ces rôles (reprises de skraft-plugin v1.6.1,
  voir `docs/licences/autorisation-skraft.md`) ;
- `test/support/harness.ts` (réduit).

Les copies divergent librement : une correction faite dans skraft ne se reporte pas seule ici.
