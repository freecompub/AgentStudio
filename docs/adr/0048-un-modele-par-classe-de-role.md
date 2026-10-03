# ADR 0048 — Un modèle par classe de rôle

- Statut : **décidé**, 2026-10-03
- Contexte amont : D38 (choix du modèle par rôle, ouvert), ADR 0020 (choix du modèle par projet ;
  le runtime honore le choix depuis le 03/10), docs/05 D7 et A6 (skraft-plugin route ses rôles vers
  des modèles différents)

## Contexte

Le 03/10, le Copilot CLI respecte enfin le modèle demandé à l'ouverture de session (ADR 0020,
mesure en fin de document) et expose 15 modèles. Tous nos agents tournaient pourtant sur le même :
le choix par projet de l'ADR 0020 ne s'appliquait qu'à la conversation principale, **jamais aux
agents des tâches**. skraft-plugin, lui, répartit ses rôles entre trois modèles (sur son run du
29/09 : 25,64 $ de Sonnet, 10,47 $ d'Opus, 1,71 $ de Haiku).

Une lentille qui confronte des livrables à des faits déjà mesurés n'a pas besoin du modèle d'un
architecte. Mais **la disponibilité des modèles dépend de l'abonnement** de l'utilisateur, et elle
change : une extension qui nommerait un modèle serait fausse chez la moitié de ses utilisateurs,
et elle choisirait ce qu'ils paient.

## Décision

1. **Une extension déclare la classe d'un agent, jamais un modèle** : `strong` (concevoir),
   `standard` (produire), `light` (classer, confronter des faits). Champ `modelClass` du manifeste ;
   un identifiant de modèle y est refusé.
2. **Le projet associe chaque classe à un modèle réel** (réglage `modelClasses`, par projet).
3. **Résolution par le cœur** (`resolveModel`, pure), à chaque tour : le modèle de la classe, sinon
   le modèle du projet (ADR 0020), sinon aucun — le runtime décide, comme avant.
4. **Un modèle que l'abonnement ne propose pas est ignoré** : la résolution passe au suivant. La
   liste vient de `listModels()` ; illisible, rien n'est filtré.
5. **skraft** : architectes `strong` ; chercheur, acceptance, testeur, développeur et trois
   lentilles `standard` ; classifieur et lentille `quality-gates` `light` (elle ne rejuge rien,
   ADR 0028).
6. Le bilan d'un run note les modèles réellement utilisés par étape ; le banc accepte
   `--modeles=strong:x,light:y`.

## Conséquences

- Sans réglage, rien ne change : même comportement qu'avant.
- Les fichiers `.md` des agents ne bougent pas : leur contenu reste partageable avec Copilot CLI et
  Claude Code, la classe est une affaire d'orchestration.
- L'économie se mesure : la trace donne déjà, par appel, le modèle et le coût (`nanoAiu`).
- Mesure unique au 03/10 : une réponse d'un mot a coûté 2,04 requêtes sur `claude-haiku-4.5` et
  0,33 sur `gpt-5-mini`. Le coût relatif des modèles sur un vrai tour, où le contexte domine,
  reste à mesurer : c'est l'objet du run complet prévu après le 01/11.

## Reste ouvert

- **Aucune interface** pour régler `modelClasses` : le fichier de réglages seulement, ou
  `--modeles` au banc. La liste déroulante de l'ADR 0020 pourrait s'étendre aux trois classes.
- **Association par défaut** : le port prévoit un multiplicateur de facturation par modèle ; quand
  le runtime le renseigne, il permettrait de proposer une association raisonnable par classe.
