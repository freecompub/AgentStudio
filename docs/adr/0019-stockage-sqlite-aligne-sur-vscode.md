# ADR 0019 — Stockage SQLite dans le profil, aligné sur VS Code

- Statut : **décidé** (tranche O6)
- Date : 2026-09-24
- Jalon : hors jalon (dette reprise après S6)

## Contexte

O6 demandait : « Stockage de l'état des tâches : JSON dans le projet ou SQLite dans le profil
utilisateur ? ». La piste de la spec était SQLite, mais J1 et J2 ont livré du JSON, choisi comme
provisoire et documenté ainsi (ADR 0004 pour les conversations, ADR 0006 pour les tâches).

Le responsable du projet tranche : **s'aligner sur ce que fait VS Code.**

VS Code sépare deux natures de données :

- **l'état interne**, volumineux et écrit souvent, dans une base SQLite du profil utilisateur
  (`state.vscdb`) ;
- **la configuration éditable à la main**, en JSON commenté (`settings.json`, `keybindings.json`).

## Décision

Même partage.

| Donnée | Support | Emplacement |
| --- | --- | --- |
| Conversations, tâches, preuves, demandes d'interaction, usage | **SQLite** | profil utilisateur (`app.getPath("userData")`) |
| Réglages de l'utilisateur, `admin.json`, barre de qualité `.skraft/quality.json` | **JSON** | profil utilisateur / dépôt, inchangé |

L'accès se fait par **`node:sqlite`**, module intégré : vérifié dans Electron 44.4.5 (Node 24.21.0),
il fonctionne sans module natif à recompiler, donc sans `better-sqlite3` ni étape de rebuild par
plateforme — ce qui compte pour une application distribuée.

Les ports existants (`ConversationStore`, `TaskStore`) ne changent pas : seules leurs implémentations
sont remplacées. Les implémentations JSON sont conservées, car les tests s'en servent et l'export
JSON reste prévu par O6.

## Conséquences

- L'état quitte le dépôt du projet pour le profil utilisateur : un `git clean` ne détruit plus les
  tâches en cours, et deux projets ne se marchent plus dessus.
- Écritures atomiques et lectures indexées, là où le JSON réécrivait un fichier entier à chaque
  transition — le moteur de tâches persiste après *chaque* transition (§6).
- Une migration est nécessaire pour les tâches et conversations déjà écrites en JSON.
- `node:sqlite` est marqué expérimental par Node : à surveiller lors des montées de version
  d'Electron. Le port permet de revenir au JSON ou de passer à un autre moteur sans toucher au cœur.
