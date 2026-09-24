# ADR 0001 — Monorepo pnpm et modules organisés par protocoles

- Statut : accepté
- Date : 2026-09-23
- Jalon : J1

## Contexte

La spec (§4.4, §16) impose un monorepo pnpm, TypeScript `strict`, ESM et Vitest. Il faut fixer
l'outillage concret et la façon de découper le code. Le demandeur exige un code modulaire,
organisé par **protocoles** : on dépend d'interfaces, jamais d'implémentations.

## Décision

1. **Outillage** : pnpm 10, TypeScript 5.9 (la 7.x native est trop récente pour l'écosystème Electron/Vite),
   Vitest 4 en mode `projects` (un projet par paquet), Zod 4 pour les schémas d'exécution.
2. **Paquets internes sans étape de build** : chaque paquet exporte `./src/index.ts`. Vitest et le bundler
   d'Electron consomment directement les sources ; `pnpm typecheck` vérifie tout le dépôt d'un seul
   `tsc --noEmit`. Le paquet `extension-api`, destiné aux tiers, aura son propre build quand il existera.
3. **Protocoles d'abord** : chaque paquet expose un fichier `src/protocols.ts` qui décrit ses capacités
   par des interfaces. Chaque implémentation vit dans son propre module (`git/`, `files/`,
   `checkpoints/`…) et se construit par une fabrique `createX(deps)` qui reçoit ses dépendances sous
   forme de protocoles. Une fonction de composition (`openWorkspace`, …) assemble les implémentations
   par défaut ; les tests et les autres runtimes peuvent substituer n'importe quelle pièce.
4. Options du compilateur renforcées : `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `verbatimModuleSyntax`.

## Conséquences

- On remplace une pièce (git CLI → libgit2, disque → FS virtuel, Copilot → Claude Agent SDK)
  sans toucher aux appelants, ce qui prolonge le port `AgentRuntime` (§4.3) à tous les services.
- Les tests unitaires utilisent des doubles de protocoles ; les tests d'intégration du Workspace
  utilisent de vrais dépôts Git temporaires.
- Pas de `dist/` à maintenir pour les paquets internes. En contrepartie, un paquet interne ne peut pas
  être consommé hors du monorepo sans étape de build supplémentaire.
