# J1 — Blocages levés et critères de sortie

- Date d'origine : 2026-09-23 (branche `feat/j1-socle`)
- Mise à jour : 2026-09-24, sur poste macOS
- État : **les deux blocages sont levés ; les trois critères de sortie sont vérifiés en réel**,
  hors interface. La validation des mêmes gestes *dans* l'application reste à faire.

## Critères de sortie de J1 (SPEC §14)

| Critère | État | Vérifié par |
| --- | --- | --- |
| Conversation complète sur un dépôt cloné | ✅ réel | `pnpm smoke:copilot` (2026-09-24) : l'agent crée `hello.txt` par `apply_patch` |
| Checkpoint et annulation en un geste | ✅ réel | même essai : après `undo`, le fichier n'existe plus |
| Reprise de la conversation après redémarrage | ✅ réel | même essai : 3 messages restaurés, l'agent rappelle la demande initiale |

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

## Reste à faire sur l'interface

- Refaire les gestes de J1 **dans l'application** : annulation d'un tour depuis la conversation et
  reprise après fermeture de la fenêtre. L'essai `smoke:copilot` les valide au niveau de la session,
  pas de l'interface.

## Points à surveiller (non bloquants)

- `koffi`, dépendance du Copilot SDK utilisée seulement par le transport en processus expérimental,
  a un script de build ignoré par pnpm. Il n'est pas utilisé (transport stdio).
- La purge des vieux checkpoints (`refs/agent-studio/checkpoints/*`) n'est toujours pas faite
  (ADR 0003).
- La persistance JSON de la conversation reste provisoire (O6, ADR 0004).
