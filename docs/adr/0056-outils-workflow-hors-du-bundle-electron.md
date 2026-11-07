# ADR 0056 — Charger les outils de workflow hors du bundle Electron

## Statut

Accepté le 2026-10-10.

## Contexte

Le moteur de workflows importe Acorn pour lire les métadonnées et esbuild pour compiler les
scripts. Les paquets internes sont intégrés au bundle Electron car ils exportent du TypeScript
(ADR 0001). Leurs dépendances tierces ne sont pas automatiquement externalisées si elles ne
figurent pas dans les dépendances d'exécution de l'application.

Avec Acorn intégré, le détecteur textuel d'imports d'electron-vite 5 confond une chaîne du
parseur avec un import et insère son shim CommonJS dans cette chaîne. Le build et le démarrage
en développement échouent avec `Unterminated string literal`. esbuild doit également rester
hors du bundle : il charge un exécutable relatif à son paquet.

## Décision

Déclarer Acorn et esbuild dans les dépendances d'exécution de `apps/desktop`, avec les mêmes
plages de versions que le moteur de workflows. L'externalisation existante d'electron-vite
s'applique à ces paquets, sans modifier les dépendances installées ni désactiver son shim.
Les paquets internes restent intégrés au bundle.

## Conséquences

Les outils de workflow sont résolus par Node depuis leurs paquets installés et doivent être
livrés avec l'application, y compris l'exécutable d'esbuild. Le build Electron et les essais
de bout en bout existants vérifient le bundle et le démarrage sans requête Copilot.
