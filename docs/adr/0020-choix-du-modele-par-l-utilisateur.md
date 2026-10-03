# ADR 0020 — Choix du modèle par l'utilisateur

- Statut : **décidé** — sans effet du 24/09 au 03/10 ; **le Copilot CLI honore le choix depuis le
  2026-10-03** (mesure en fin de document)
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

## Mesuré le 2026-09-24 : le runtime n'honore pas le choix

Sur le compte de développement, la fonctionnalité ne peut pas tenir sa promesse :

| Voie | Résultat |
| --- | --- |
| `client.listModels()` | un seul modèle, d'identifiant `auto` |
| API Copilot (`/models`) | 57 modèles, dont 13 autorisés : GPT-5.6 Luna, Claude Haiku 4.5, GPT-4.1, GPT-5 mini, Kimi K3, MAI-Code… |
| `createSession({ model })` | ignoré : `claude-haiku-4.5` puis `gpt-4.1` demandés, `mai-code-1.1-flash` utilisé |
| `session.setModel()` | accepté sans erreur, sans effet : même modèle avant et après |

Le CLI route donc lui-même, et son choix varie dans le temps (`gpt-5.6-luna` le matin,
`mai-code-1.1-flash` l'après-midi). Brancher la vraie liste par `onListModels` ne servirait à
rien : l'utilisateur choisirait sans que rien ne change — une liste déroulante mensongère.

### D'où vient la limite : l'offre **et** l'intégration

Deux causes distinctes, mesurées séparément :

- **L'offre gratuite** explique les 21 modèles `disabled`. Demander `claude-opus-5` à l'API
  répond `model_not_supported`.
- **L'intégration** explique le reste, et c'est elle qui bloque vraiment. Sur les 13 modèles
  autorisés, l'API **respecte** le modèle demandé : `gpt-4.1` renvoie bien
  `gpt-4.1-2025-04-14`. Mais l'API a été interrogée avec `Copilot-Integration-Id: vscode-chat`,
  alors que le CLI utilise la sienne — et n'expose qu'`auto`. GitHub restreint donc les modèles
  par intégration, indépendamment de ce que le compte autorise.

Autrement dit, le choix de modèle est techniquement possible sur ce compte, mais **pas par la
voie que l'application emprunte** (port `AgentRuntime` → Copilot SDK → CLI, D3/D35). Le
contourner en appelant l'API directement reviendrait à court-circuiter le CLI, qui apporte les
outils, les permissions et la reprise de session : ce n'est pas un compromis acceptable.

**Conséquence retenue** : le code reste en place, mais `auto` est écarté (doublon du choix
automatique), donc la liste ne s'affiche pas tant qu'aucun choix réel n'est offert. Elle
apparaîtra d'elle-même si le runtime expose un jour de vrais modèles.

**À revérifier** avec une offre Copilot payante — plausible mais non vérifié : rien ne prouve que
l'intégration CLI exposerait alors plus qu'`auto` — et à chaque montée de version du SDK
(`copilotCliVersion` 1.0.85 ici).

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

## Mesuré le 2026-10-03 : le runtime honore désormais le choix

Le compte a changé d'offre (1 500 requêtes premium par mois). Même voie qu'au 24/09 (port
`AgentRuntime` → Copilot SDK → CLI) :

| Voie | Résultat |
| --- | --- |
| `listModels()` | 15 modèles : Claude Sonnet 5 et 5.5, Claude Haiku 4.5, GPT-5.6 Luna et Terra, GPT-6 Luna, GPT-5.4 et mini, GPT-5.3-Codex, GPT-5 mini, MAI-Code-1.1-Flash, Grok 4.5 à 4.7, Kimi K3 |
| `openSession({ model: "claude-haiku-4.5" })` | modèle utilisé (événement `usage`) : `claude-haiku-4.5`, 2,04 requêtes pour une réponse d'un mot |
| `openSession({ model: "gpt-5-mini" })` | `gpt-5-mini`, 0,33 requête |

Sans modèle demandé, tous les runs du 03/10 ont tourné sur `claude-sonnet-5`, de façon stable.

Conséquence : le choix **par rôle** (D38), écarté faute d'effet, redevient possible. Il fera l'objet
d'un ADR propre. Un seul échantillon par modèle : le coût relatif des modèles reste à mesurer sur un
vrai tour, où le contexte domine (un appel de Sonnet 5 coûtait de 2,8 à 4 requêtes en DESIGN).

