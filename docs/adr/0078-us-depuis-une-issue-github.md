# ADR 0078 — La user story donnée par une issue GitHub

## Statut

**Accepté** le 2026-11-10 par le responsable du projet :
- « je veux pouvoir donner une us sur github, il faut être capable de lire l'us et toutes ses
  dépendances, il faut s'assurer que l'outil gh est bien installé » ;
- les commentaires font partie de l'US ;
- « lire et écrire les PR » ;
- « si elle est bloquée on ne peut pas démarrer ».

Concerne `github-auth` et le serveur MCP (`skraft_demarrer`). L'application de bureau suivra.

## Contexte

skraft prend une story sous forme de fichier : `# US-12 — Titre`, un énoncé, des critères numérotés
et des questions ouvertes. Les équipes tiennent leurs US dans des issues GitHub, avec leurs liens
(epic parente, sous-issues, « bloquée par ») et des précisions décidées dans les commentaires.

GitHub expose ces liens en REST, ce que vérifie un appel sur github.com le 10/11 :
- `issues/{n}/parent` (un 404 veut dire « pas de parente ») ;
- `issues/{n}/sub_issues` ;
- `issues/{n}/dependencies/blocked_by` et `…/blocking`.

## Décision

1. **`gh` vérifié avant tout** : installé (`gh --version`), connecté à l'hôte de l'issue
   (`gh auth status --hostname`), dépôt lisible. Sinon, skraft ne démarre pas, et le refus dit quoi
   faire.
2. **Le code lit l'US et ses dépendances, sans agent**, en lecture seule, par `gh api` :
   - l'issue et ses commentaires ;
   - sa parente, ses sous-issues ;
   - ce qui la bloque, ce qu'elle bloque ;
   - les issues citées dans son texte et ses commentaires.

   On ne descend que d'un niveau, et le nombre d'issues lues est borné. Une API absente (instance
   d'entreprise ancienne) n'empêche pas la lecture du reste ; c'est noté dans le contexte.
3. **Une US bloquée ne démarre pas.** Si une issue qui la bloque est encore ouverte, le refus nomme
   le bloqueur. Il n'y a pas de passage outre : il faut livrer ou fermer le bloqueur d'abord.
4. **Ce qui est écrit dans le projet** : `.skraft/github/<ID>.md`, la story, et
   `.skraft/github/<ID>-contexte.md`, l'issue brute, ses commentaires et ses dépendances. L'énoncé
   de la story renvoie au contexte, que les agents de RESEARCH et DESIGN lisent. Les dépendances
   sont du contexte, jamais des critères à livrer.
5. **La mise en forme** : une issue déjà au format de story, sans commentaire, est reprise telle
   quelle. Sinon, un agent la met en forme (brique suivante), et le code vérifie qu'aucune valeur
   n'est inventée : chaque littéral de la story doit venir de l'issue, de ses commentaires ou de
   ses dépendances.
6. **La PR à la fin** (brique suivante) : la branche `skraft/<slug>` est poussée, et une PR liée à
   l'issue est ouverte (« Closes #12 »), après l'accord de l'utilisateur, à chaque fois.

## Conséquences

- La story vient d'une source que l'équipe tient déjà, et ses dépendances arrivent aux agents.
- Une lecture de plus au démarrage : quelques appels `gh api`, bornés.
- Le run dépend de `gh`, et de sa connexion à l'hôte de l'issue, comme déjà la connexion Copilot.
