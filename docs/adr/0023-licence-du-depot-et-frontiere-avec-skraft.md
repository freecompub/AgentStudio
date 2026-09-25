# ADR 0023 — Licence du dépôt, et frontière avec l'extension skraft

- Statut : **décidé**, 2026-09-25
- Date : 2026-09-25
- Contexte amont : ADR 0012 (licence de skraft-plugin), ADR 0021 (distribution de skraft en `.asx`)

## Contexte

Constaté le 2026-09-25 en ouvrant le dossier de reprise de skraft : **le dépôt ne déclarait aucune
licence.** Ni fichier `LICENSE`, ni champ `license` dans les quatorze `package.json`.

Ce n'était pas seulement une négligence de forme. La reprise du 25 septembre a versé dans
`extensions/skraft/` du matériel dérivé de skraft-plugin, sous **GPL-3.0-or-later**. La question
« sous quelle licence redistribuer » — condition 2 du dossier d'autorisation — n'avait alors pas de
réponse possible : la formule « l'extension reste sous la licence de l'application » ne désignait
rien.

Trois faits cadraient la décision :

1. Les quatorze paquets sont `private: true` : rien n'est publié sur un registre.
2. Sans fichier `LICENSE`, le droit d'auteur s'applique par défaut — **tous droits réservés**. Ce
   n'est pas un vide juridique, c'est l'état le plus fermé qui soit.
3. `apps/desktop` ne dépend que de `@agent-studio/ext-tdd`. `ext-skraft` n'est pas dans ses
   dépendances : l'extension se distribue à part, en `.asx`, et s'exécute dans son propre
   processus derrière l'API `ctx` (ADR 0021).

## Décision

**Le dépôt est sous licence propriétaire — tous droits réservés —, à l'exception de
`extensions/skraft/`, qui est sous GPL-3.0-or-later.**

`LICENSE` à la racine porte la notice propriétaire et nomme l'exception ;
`extensions/skraft/LICENSE` porte le texte de la GPL, que la licence exige de fournir à qui reçoit
l'œuvre. Les `package.json` déclarent `UNLICENSED`, sauf `@agent-studio/ext-skraft` qui déclare
`GPL-3.0-or-later`.

### Pourquoi propriétaire, et pas une licence ouverte

Parce que c'est ce qui est **déjà vrai** : le formuler ne change rien à la situation, cela la rend
lisible. Et parce que le choix n'est réversible que dans un sens — ce dépôt pourra être ouvert plus
tard, alors qu'une licence ouverte, une fois publiée, ne se reprend pas. Rien n'obligeait à trancher
dans l'urgence le sens le plus coûteux.

### Pourquoi les deux licences peuvent coexister

Parce que l'extension n'est pas livrée avec l'application. Elle s'installe séparément, elle vit dans
un `utilityProcess` distinct, et elle ne communique avec le cœur que par un RPC bridé derrière
l'API `ctx` — aucun objet du SDK ne lui est jamais exposé (règle de sécurité n°1). C'est exactement
l'isolation que l'option B de l'ADR 0012 décrivait, et elle était déjà en place pour des raisons de
sécurité, non de licence.

**Cet argument tient sur un fait technique, pas sur une intention.** C'est sa force et sa fragilité.

## Le garde-fou

Un `pnpm add` distrait suffirait à faire de `skraft` une dépendance de `apps/desktop`. La frontière
tomberait alors en silence, et la GPL s'appliquerait à l'ensemble distribué — sans qu'aucune erreur
ne se manifeste, puisque le code fonctionnerait parfaitement.

D'où `extensions/skraft/test/licence.test.ts`, qui échoue si `@agent-studio/ext-skraft` apparaît
dans les dépendances de l'application, de développement comprises : c'est l'arbre installé qui est
distribué, pas l'intention de celui qui a déclaré la dépendance. Le test vérifie aussi que les
licences déclarées n'ont pas bougé et que le texte de la GPL est bien présent.

Une frontière juridique qui repose sur un fait technique doit être défendue par un test, sinon elle
n'est qu'un souvenir.

## Conséquences

- La condition 2 du dossier `docs/licences/autorisation-skraft.md` est remplie : l'extension est
  redistribuée sous GPL-3.0-or-later. Distribuer le `.asx` oblige donc à en fournir les sources.
- Aucune contrainte nouvelle sur l'application : elle ne contient rien de dérivé de skraft-plugin.
- **Reste à faire si l'extension est un jour distribuée publiquement** : la GPL demande que chaque
  fichier source porte une notice de licence. Aujourd'hui seuls `roles.ts` et `review.ts` portent
  leur provenance, et le `LICENSE` couvre le dossier. C'est suffisant pour une distribution
  restreinte, pas pour une diffusion large.
- Rien n'est publié sur npm : les paquets restent `private: true`. `UNLICENSED` est la convention
  npm pour « aucune licence accordée », et non une licence en soi.

## Ce que cet ADR ne fait pas

Il ne constitue pas un avis juridique. La frontière décrite est raisonnée à partir de faits
techniques vérifiables ; si le dépôt devait être distribué largement, ou l'extension intégrée à
l'application, la question mériterait d'être posée à un juriste.
