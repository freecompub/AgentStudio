# ADR 0076 — La pile découverte par un agent, vérifiée par le code

## Statut

**Accepté** le 2026-11-09 par le responsable du projet (« Oui je veux, que la découverte soit faite
par un agent et vérifiée par le code », puis « Notre agent » et « Indices pour l'agent »).
Concerne `core` (outil terminal), `project-services` (`/stack init`), donc l'application de bureau
et le serveur MCP (`skraft_pile`, ADR 0075). Complète l'ADR 0072 (profils de pile) et l'ADR 0074
(composants, BDD).

## Contexte

`/stack init` proposait un profil par des règles du code (`proposeProfile`) : deux modèles, Python
et TypeScript avec Vitest, choisis sur des fichiers repères. Tout autre projet recevait « Rien de
reconnu », et l'utilisateur écrivait le profil à la main. Écrire une règle par écosystème ne
passe pas à l'échelle, et ferait connaître des langages au code.

Le principe du projet est que le LLM propose et que le code décide et vérifie. La découverte
est une proposition : elle peut revenir au LLM, à condition que tout ce qui sera exécuté soit
vérifié par le code avant d'être écrit.

## Décision

1. **Un agent de découverte**, ouvert par agent-studio (session du runtime, Copilot ou Claude),
   rôle `agent-studio/decouvreur-de-pile`.
   - Il est en **lecture seule** : garde des agents de tâche, sans shell, lecture bornée au projet.
   - Il rend sa proposition par un outil terminal à schéma, `submit_pile` : une pile par racine
     (`.` pour le projet entier, sinon un composant), en YAML au format de la section `pile`, et
     une justification.
   - S'il lui manque une information, il pose sa question (`report_blocker`). Rien n'est écrit, et
     la question est rendue à l'utilisateur.
2. **Les détections du code deviennent des indices.** L'agent reçoit en faits de départ :
   - les fichiers de la racine et les dépendances déclarées ;
   - l'arborescence, bornée ;
   - le BDD détecté (`detecterBdd`) et le modèle que reconnaissent les règles (`proposeProfile`) ;
   - les programmes autorisés et l'origine de la liste ;
   - les options données à `/stack init` (`--lanceur`, `--sans-bdd`…).

   Il reste libre de s'en écarter ; c'est le code qui juge.
3. **Le code vérifie chaque pile proposée, dans cet ordre, avant toute écriture :**
   - la racine : relative, sans `..`, une seule fois ;
   - les programmes : un programme hors de la liste est demandé à l'utilisateur (ADR 0075). Il
     n'est jamais exécuté avant son accord ;
   - le schéma (`parseStackProfile`) ;
   - le BDD : un composant qui en montre les signes doit déclarer `bdd`, ou `bdd: false` ;
   - le diagnostic (`/stack doctor`) : aucun constat de gravité « problème » ;
   - les canaris, lancés dans une copie du projet : aucun « problème ».
4. **Trois essais au plus.** Une proposition refusée repart à l'agent, dans une session neuve, avec
   sa proposition et les motifs du refus.
   - Après le troisième refus, rien n'est écrit. Les derniers motifs et la dernière proposition
     sont montrés.
   - Le budget d'essais est appliqué par le code.
5. **Puis la question d'écriture**, comme avant : « Écrire le profil… ? », en nommant les
   programmes. Une pile à la racine va dans la section `pile`, plusieurs dans `composants`.
6. **Sans runtime** (non connecté), la découverte n'a pas lieu : le refus le dit, et rien n'est
   écrit. Les règles du code ne servent plus de proposition, seulement d'indices.

## Conséquences

- N'importe quel écosystème peut être proposé, sans règle nouvelle dans le code. Ce qui est
  écrit a été exécuté et vérifié.
- Une découverte coûte une à trois sessions d'agent, plus les canaris (la suite de tests, lancée
  une fois par canari).
- Le prompt de l'agent est une constante du cœur (`project-services`) : il ne vit pas dans une
  extension, et le serveur MCP comme l'application l'embarquent sans fichier à copier.
- Les tests de `/stack init` scriptent l'agent (`ScriptedRuntime`) ; aucun appel réel en CI.
- **Essayé le 2026-11-09 avec Copilot CLI 1.0.107** (serveur MCP, `skraft_pile`) :
  - projet uv : profil proposé en 19 s, avec `outils` et `bdd: false`, canaris passés, écrit ;
  - projet JavaScript testé par `node --test`, que les règles du code ne reconnaissent pas : l'agent
    propose `node --test` avec un rapport JUnit et quatre canaris. Le code demande « Autoriser
    « node » ? » avant de le lancer, les canaris passent, le profil est écrit.
