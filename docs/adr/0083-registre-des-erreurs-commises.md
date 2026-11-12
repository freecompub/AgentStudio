# ADR 0083 — Le registre des erreurs commises

## Statut

**Accepté** le 2026-11-11 par le responsable du projet, qui a demandé de coder LEC-1
(freecompub/AgentStudio#32) et tranché quatre de ses questions ouvertes :
- le périmètre : LEC-1 seule ; LEC-2 et LEC-3 viendront ensuite ;
- le motif d'un défaut de lentille est normalisé comme pour le disjoncteur ;
- seuls les refus qui consomment un essai sont enregistrés ;
- un défaut que l'humain donne à l'agent à l'arbitrage n'est pas enregistré.

Concerne le workflow (`workflows/skraft`), donc le serveur MCP. L'extension `extensions/skraft` n'est
pas concernée : elle diverge sciemment (ADR 0054).

## Contexte

skraft n'apprend qu'à l'intérieur d'un run : un réessai reçoit le motif du refus précédent, et le
disjoncteur (ADR 0073) arrête deux refus identiques. Une fois la story finie, ses défauts restent
dans `.skraft/<slug>/reviews/` et ne sont plus relus ; les mêmes erreurs reviennent d'une story à
l'autre sans que rien ne le mesure. LEC-1 garde la preuve de ces erreurs ; LEC-2 en tirera des
leçons, LEC-3 les réinjectera.

## Décision

1. **Un fichier par story**, `.agent-studio/lecons/brut/<slug>.jsonl`, une erreur par ligne, en ajout
   seul : les lignes d'un run précédent sur la même story sont gardées telles quelles.
2. **Deux sortes d'erreurs** (`workflows/skraft/registre.mjs`) :
   - un défaut de revue retenu : grave ou bloquant, ni réfuté (ADR 0069), ni noté hors du
     changement de la phase, ni abandonné par la lentille, ni donné à l'agent par l'humain ;
   - un refus de porte qui consomme un essai : pas le délai dépassé, ni une panne, ni une question de
     revue, ni le refus de la revue elle-même, dont les défauts sont déjà enregistrés.
3. **Une signature** : la phase, la source (lentille ou porte) et le motif normalisé par
   `normaliserMotifs`, la fonction du disjoncteur, exportée du cœur. Deux erreurs de même signature
   sont la même erreur, quels que soient leur story, leur fichier et leur ligne.
   `regrouperParSignature` regroupe tous les fichiers du registre.
4. **La collecte** : les refus sont relevés au moment où le code les trace (`w.rejet`, par une
   enveloppe de `w` posée au début du script) ; les défauts, dans les fils de revue de chaque phase,
   à son succès ou avant son rembobinage.
5. **L'écriture** : à chaque escalade de phase, après le rembobinage et avant la question (le fichier
   est donc sur le disque avant un éventuel abandon), avant un abandon hors phase, et à la fin du run,
   où il est commité seul (`docs(skraft): registre des erreurs de <slug>`).
6. **La protection** : `.agent-studio/lecons/**` entre dans `GELÉS`, refusé en écriture à tout agent.
   Un fichier qui ne porte plus ce que le code y a écrit est signalé au bilan et rétabli, sauf juste
   après un rembobinage, qui le ramène au checkpoint.

## Conséquences

- **Choix provisoires**, en attendant la décision du responsable sur les questions restantes de LEC-1 :
  - une tâche annulée par l'utilisateur n'écrit rien : le script ne tourne plus après l'annulation ;
  - une relance sur la même story ajoute ses erreurs à la suite du fichier existant ;
  - les champs sont nommés en français (`lentille`, `cible`, `fichier`, `ligne`, `defaut`).
- Un refus déclaré « garanti » (qui ne consomme pas d'essai) n'est pas distingué par la porte qui le
  trace : il est enregistré.
- `regrouperParSignature` n'est appelé par aucun run : c'est l'entrée de LEC-2.

## Alternatives

- **Écrire chaque erreur dès qu'elle est établie.** Écarté : un rembobinage l'effacerait du disque, et
  un défaut abandonné plus tard par la lentille serait déjà écrit.
- **Écrire le registre seulement à la fin du run.** Écarté : un abandon à l'escalade le perdrait.
- **Le faire aussi dans l'extension.** Écarté par la story : l'extension diverge (ADR 0054).
