# J1 — Blocages levés et critères de sortie

- Date d'origine : 2026-09-23 (branche `feat/j1-socle`)
- Mise à jour : 2026-09-24, sur poste macOS
- État : **terminé**. Les deux blocages sont levés et les trois critères de sortie sont vérifiés
  en réel, hors interface *et* dans l'application.

## Critères de sortie de J1 (SPEC §14)

| Critère | État | Vérifié par |
| --- | --- | --- |
| Conversation complète sur un dépôt cloné | ✅ réel + interface | `pnpm smoke:copilot` (l'agent crée `hello.txt` par `apply_patch`), puis dans l'application |
| Checkpoint et annulation en un geste | ✅ réel + interface | même essai ; puis « Annuler depuis ici » en deux temps : message barré et fichier défait sur le disque |
| Reprise de la conversation après redémarrage | ✅ réel + interface | même essai (3 messages restaurés) ; puis fermeture et réouverture de la fenêtre, conversation et tour annulé conservés |

Ces trois points étaient jusqu'ici couverts par les seuls tests automatisés
(`main-session.test.ts`, `checkpoints.test.ts`, `json-conversation-store.test.ts`, `app.test.tsx`).

## Blocage 1 — Jeton GitHub refusé par Copilot — **levé**

- **Constat d'origine** : `gh` était connecté avec un jeton personnel classique (`ghp_…`) ;
  l'API Copilot répondait `400 Bad Request` (« Personal Access Tokens are not supported »).
- **Levée** : le compte est désormais connecté par OAuth (`gho_…`). `auth.status()` renvoie
  `tokenKind: "oauth"`, `copilotCompatible: true`, et l'essai réel aboutit sur le modèle
  `gpt-5.6-luna`.
- La détection du type de jeton (ADR 0005) reste en place : l'application continue de refuser de
  démarrer une conversation avec un PAT classique et propose la reconnexion.

## Blocage 2 — Electron ne démarrait pas — **levé**

- **Constat d'origine** : machine Linux sans GTK ni écran
  (`error while loading shared libraries: libatk-1.0.so.0`, `DISPLAY` vide). L'interface n'avait
  jamais été vue à l'écran.
- **Levée** : le développement se fait maintenant sur macOS. `pnpm dev` démarre l'application et
  l'interface s'affiche.
- Trois défauts ont dû être corrigés pour y parvenir, tous invisibles en tests :
  paquets internes externalisés du bundle du processus principal, course entre deux
  `workspace:current` concurrents, et un effet React renvoyant autre chose qu'une fonction de
  nettoyage (écran vide). Voir les commits `fix(desktop)` du 2026-09-24.

## Validation dans l'interface — faite le 2026-09-24

Les trois gestes ont été refaits à l'écran, sur un vrai projet : l'agent écrit le fichier,
« Voir les changements » liste le diff du checkpoint, « Annuler depuis ici » (confirmation en deux
temps) barre le message **et** supprime le fichier du disque, et la conversation est restaurée
telle quelle après fermeture de la fenêtre.

## Points à surveiller (non bloquants)

- `koffi`, dépendance du Copilot SDK utilisée seulement par le transport en processus expérimental,
  a un script de build ignoré par pnpm. Il n'est pas utilisé (transport stdio).
- La purge des vieux checkpoints (`refs/agent-studio/checkpoints/*`) n'est toujours pas faite
  (ADR 0003).
- La persistance JSON de la conversation reste provisoire (O6, ADR 0004).
