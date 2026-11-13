# ADR 0089 — Reprise d'une story arrêtée

## Statut

**Accepté** le 2026-11-13 par le responsable du projet : relancer une US arrêtée doit pouvoir la
continuer. Au relancement, l'utilisateur choisit de continuer la session précédente ou d'en ouvrir une
nouvelle, et une nouvelle session écrase la précédente.

Concerne le workflow (`workflows/skraft`), donc le serveur MCP, et la plateforme qu'il utilise (Workspace,
API des extensions, moteur de workflows). L'extension `extensions/skraft` n'est pas concernée (ADR 0054).
Suppose le slug de l'ADR 0088 : une même story retrouve toujours sa branche.

## Contexte

Un run abandonné (`skraft_arreter`) ne reprend pas : son journal ne vaut que pour lui. Relancer la story
démarrait un nouveau run, qui basculait sur la branche `skraft/<slug>` existante et refaisait tout depuis
RESEARCH, par-dessus les commits des phases déjà approuvées.

## Décision

1. **L'état d'une phase approuvée** est noté par le code dans `.skraft/<slug>/etat.json`, à la fin de la
   phase, et commité avec elle : les phases approuvées, le niveau, la recherche, les questions et leurs
   réponses, les ADR, le gel des tests d'acceptance, le plan de test, les tests de la story, les
   dérogations, les erreurs déjà commises et les leçons données. Rien n'est déduit des messages de commit.
2. **Au relancement**, une fois sur la branche de la story, la tâche relit ce fichier. Il est ignoré s'il
   vient d'une autre story, d'un autre slug ou d'une autre version. S'il est valide, une question est
   posée à l'utilisateur (« US-12 a déjà une session : la continuer ? »), qui dit les phases approuvées,
   où la session reprendrait et ce qu'une nouvelle session effacerait.
3. **Continuer** : la branche revient au commit de la dernière phase approuvée (le plus récent à son
   message). Ce qui avait été fait après est effacé ; les fichiers non suivis restent en place, et sont
   nommés à l'utilisateur. L'état est restauré : la difficulté n'est pas redemandée, les questions
   tranchées ne sont pas reposées, les phases approuvées ne sont pas refaites. Au départ, les tests
   d'acceptance de la story, rouges en attendant DELIVER, ne bloquent pas le précontrôle ; un autre test
   rouge le bloque toujours.
4. **Nouvelle session** : la branche est recréée depuis le point de départ de la première session (noté
   dans l'état), et le run repart de zéro. La branche de départ n'est jamais touchée.
5. **La plateforme** apprend trois opérations Git, par le Workspace, seul service à toucher Git :
   - `branch(nom, { depuis, ecraser })` recrée une branche, sous `git:branch` ;
   - `log()` rend l'historique de la branche, sans permission ;
   - `resetTo(sha)` ramène la branche à un commit **de son historique**, sous `git:revert`.

   Le moteur les expose au script : `w.brancher(nom, { depuis, ecraser })`, `w.tete()`,
   `w.historique()`, `w.revenirA(sha)`, journalisés et rejoués comme les autres appels.

## Conséquences

- Une phase à moitié faite est refaite entière : la reprise se fait à la phase, pas au scénario.
- Une story livrée qu'on relance propose de continuer (rien n'est refait) ou de recommencer.
- La question de reprise, comme toute question depuis l'ADR 0087, est ouverte à tous.
- Un run arrêté par le moteur seul garde ses questions en attente ; `skraft_arreter`, qui passe par les
  services, les annule.

## Alternatives

- **Reprendre au scénario près en DELIVER.** Écarté pour l'instant : l'état d'un scénario à moitié fait
  (tests écrits, code partiel) est bien plus délicat à restaurer. À reprendre si le besoin se confirme.
- **Relire le journal du run abandonné** (`~/.agent-studio/mcp-skraft/tasks/`). Écarté : il n'existe que
  sur la machine qui l'a lancé, et il ne vaut que pour le même script.
- **Déduire les phases faites des messages de commit.** Écarté : les messages disent qu'une phase est
  faite, pas ce qu'elle a laissé aux suivantes.
