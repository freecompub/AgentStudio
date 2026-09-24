# ADR 0020 — Choix du modèle par l'utilisateur

- Statut : **décidé** (tranche la première moitié de D38)
- Date : 2026-09-24
- Jalon : hors jalon (dette reprise après S6)

## Contexte

D38 posait deux questions : le **choix du modèle par rôle** (fort pour la conception et les revues,
léger pour les tâches mécaniques) et la **politique de fournisseur par projet**. Les deux étaient
ouvertes, et l'application laissait le runtime décider seul.

Le responsable du projet tranche la partie visible : **une liste déroulante où l'utilisateur
choisit le modèle.**

## Décision

Une liste déroulante dans la barre du haut, à côté du sélecteur de mode.

- Les modèles proviennent de `client.listModels()` du Copilot SDK, qui renvoie pour chacun son `id`,
  son `name` et son `billing.multiplier`. Rien n'est codé en dur : la liste suit ce que le compte
  autorise réellement.
- Le multiplicateur de facturation est affiché à côté du nom. C'est la seule information de coût dont
  dispose l'utilisateur avant de lancer un tour, et l'usage est déjà compté par état (ADR 0010).
- Un modèle dont `policy.state` vaut `disabled` n'est pas proposé.
- Le choix est **par projet**, enregistré avec les réglages, et s'applique aux sessions suivantes.
  Laisser le choix vide conserve le comportement actuel : le runtime décide.
- Le port `AgentRuntime` gagne `listModels()`. Comme pour le reste, aucun objet du SDK ne sort de
  `runtime-copilot` (D10) : seules des données sérialisables traversent.

## Ce qui reste ouvert

- **Le modèle par rôle** (seconde moitié de D38) : un modèle fort pour la conception et les revues,
  léger pour les tâches mécaniques. Le choix décidé ici est global au projet ; l'affiner par rôle
  reste à faire, et la structure de configuration le permettra.
- **La politique de fournisseur par projet** : sans objet tant que Copilot est le seul adaptateur
  (D35).

## Conséquences

- L'utilisateur peut arbitrer coût et qualité sans toucher à un fichier de configuration.
- La liste dépend d'un appel réseau au démarrage de session ; elle est mise en cache par le SDK et
  son échec ne doit pas empêcher de converser — dans ce cas la liste est vide et le runtime décide.
- Le choix étant par projet, deux projets ouverts successivement peuvent utiliser des modèles
  différents, ce qui est le but.
