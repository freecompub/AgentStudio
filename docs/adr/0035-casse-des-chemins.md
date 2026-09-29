# ADR 0035 — Refuser sans tenir compte de la casse, accorder en la respectant

- Statut : **décidé**, 2026-09-29
- Contexte amont : D21/D22 (gel des tests), D28 (garde de permissions), ADR 0034 (gel de la barre)

## Contexte

L'extension vise **Windows, macOS et Linux**. Les deux premiers ont un système de fichiers
insensible à la casse par défaut — vérifié sur la machine de développement : `minuscule.txt` et
`MINUSCULE.TXT` y désignent le même fichier.

Or `globToRegExp` compilait sans drapeau, donc toutes nos comparaisons de chemins étaient sensibles
à la casse. Trois refus, tous adossés à une garantie du projet, se contournaient par une majuscule :

| Chemin écrit | Périmètre `.skraft/**` | Gel `.skraft/quality.json` | Résultat |
| --- | --- | --- | --- |
| `.skraft/quality.json` | accordé | refusé | protégé |
| `.skraft/QUALITY.JSON` | accordé | **manqué** | **écrit** |

Sur ces systèmes, c'est le même fichier. Étaient concernés : le gel de la **barre de qualité**
(ADR 0034, écrite une heure plus tôt), le gel des **tests d'acceptance** (D21/D22, via
`isTestFile`), et l'interdiction d'écrire dans **`.git`** — `.GIT/config` passait.

## Décision

1. **Les comparaisons qui refusent ignorent la casse** : `matchesAnyIgnoringCase`, employée par
   `readOnlyGuard`, par `isTestFile` du profil, et pour `.git`.
2. **Les comparaisons qui accordent la respectent** : `matchesAny`, employée pour le périmètre
   d'écriture, reste inchangée.
3. **Les deux moitiés vont dans le même sens** — refuser par défaut. Rendre les autorisations
   insensibles ouvrirait `.SKRAFT/` sur un Linux où c'est réellement un autre dossier ; on
   accorderait quelque chose que personne n'a demandé, au nom d'une confusion qui n'existe
   qu'ailleurs.
4. **Les noms portent l'intention**, pas le mécanisme, pour qu'on ne puisse pas les confondre à la
   relecture : `matchesAny` pour accorder, `matchesAnyIgnoringCase` pour refuser.

## Conséquences

- C'est la **troisième fois** en une journée qu'une garantie reposait sur une comparaison
  textuelle trop naïve : le lien symbolique dans l'écriture des canaris, le chemin recollé de
  travers par le SDK, et maintenant la casse. À chaque fois le mécanisme était juste et la
  comparaison approximative. À se demander systématiquement, pour toute garde : *que compare-t-elle
  au juste, et le système de fichiers est-il d'accord ?*
- **La CI ne teste que macOS.** Rien de ce qui est corrigé ici n'aurait été vu par un test sur
  Windows ou Linux : il n'y en a aucun. Les tests ajoutés vérifient la logique de comparaison, pas
  le comportement réel d'un système de fichiers.
- **Reste ouvert, sur le même sujet** : normalisation Unicode des chemins (macOS décompose,
  Windows non), lettres de lecteur et chemins UNC sous Windows, et le fait que `seatbelt` — le bac
  à sable du runtime — est propre à macOS, ce qui affaiblit toute idée de s'y adosser pour les
  trois plateformes.
