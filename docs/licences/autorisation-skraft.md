# Autorisation de reprise de skraft-plugin — dossier

> **Statut : PARTIELLEMENT RÉUNIE au 2026-09-25.** Conditions 1 et 3 remplies, condition 2 en
> suspens. Une première reprise a été faite sous la licence appliquée par défaut ci-dessous
> (GPL-3.0-or-later) ; elle est réversible tant que la condition 2 n'est pas tranchée.

skraft-plugin 1.5.2 est distribué sous **GPL-3.0-or-later**. ADR 0012 retient l'**option C** :
l'auteur autorise la reprise. La décision est prise ; ce qui manque, ce sont les pièces qui la
rendent opposable et matériellement applicable.

## Condition 1 — la trace écrite

**Remplie, sous la forme d'une déclaration du responsable du projet.** Consignée telle qu'elle a
eu lieu, sans rien y ajouter :

| Champ | Valeur |
| --- | --- |
| Qui autorise | Le responsable du projet agent-studio, se déclarant porteur de l'autorisation de l'auteur de skraft-plugin (Sébastien Degodez) |
| Quoi exactement | La branche `refactor/v1.6.0-tracking-substrate` du dépôt `github.com/SebastienDegodez/skraft-plugin` — « on est autorisé a utiliser cette branche » |
| Pour quel usage | Reprise dans l'extension `skraft` d'agent-studio |
| Date de la déclaration | 2026-09-25 |
| Sous quelle forme | Déclaration au fil d'une session de travail, reportée ici par l'assistant |

**Ce que cette trace n'est pas.** Ce n'est pas un accord signé de l'auteur : c'est la déclaration
d'un tiers rapportant cet accord. Elle suffit à engager le responsable du projet, pas à opposer
quoi que ce soit à l'auteur. Verser la pièce d'origine — courriel, message, licence — à côté de ce
fichier reste à faire, et c'est ce qui rendrait la condition pleinement remplie.

## Condition 2 — la licence de redistribution

Une autorisation dit *que* l'on peut reprendre ; elle ne dit pas *sous quelle licence* redistribuer.
Sans cette précision, la GPL-3.0-or-later continue de s'appliquer par défaut à l'œuvre dérivée.

**Point bloquant constaté le 2026-09-25 :** le dépôt agent-studio n'a **aucun fichier `LICENSE`**,
et aucun champ `license` dans ses `package.json`. La formule « l'extension reste sous la licence de
l'application » n'a donc pas de sens tant que l'application n'en déclare pas une. Deux choses à
trancher, dans cet ordre :

1. La licence d'agent-studio lui-même.
2. Celle de l'extension `skraft` après reprise — la même, ou GPL-3.0-or-later si l'auteur n'accorde
   qu'une dispense d'usage sans changement de licence.

### Licence appliquée par défaut, en attendant

**L'extension `skraft` est traitée comme GPL-3.0-or-later.** C'est le défaut que la licence
d'origine impose à une œuvre dérivée, et l'autorisation recueillie porte sur l'usage de la branche,
non sur un changement de licence — personne n'a dit le contraire, donc rien ne permet de supposer
mieux. Ce défaut est tenable ici pour une raison de fait : `skraft` **n'est pas distribuée avec
l'application** mais à part, en paquet `.asx` (ADR 0021), et elle s'exécute dans son propre
processus derrière l'API `ctx`. C'est exactement l'isolation que l'option B de l'ADR 0012 décrivait.

Ce choix est réversible : il suffirait que l'auteur précise une autre licence. Tant qu'il tient,
distribuer `skraft` oblige à en fournir les sources.

## Condition 3 — l'accès au dépôt source

**Remplie le 2026-09-25.** Source : `github.com/SebastienDegodez/skraft-plugin`, branche
`refactor/v1.6.0-tracking-substrate` — donc la **1.6.0 en cours**, et non la 1.5.2 auditée dans
`docs/02-analyse-technique-skraft-plugin.md`. L'audit ne décrit donc pas exactement ce qui a été
repris ; c'est la branche qui fait foi.

La structure diffère de celle que l'ADR 0012 supposait : les agents sont sous
`plugins/skraft-framework/com.anthropic.claude-code/agents/`, les skills sous
`plugins/skraft-framework/skills/` (37, et non 36), et la configuration des phases dans
`skraft-framework.config.json`.

## Ce que la reprise touchera, exactement

Recensé pour que le jour venu le travail soit un remplacement, et non une enquête. Tout le reste du
code de `skraft` est notre propre conception (SPEC-skraft §5 à §11) et n'est pas concerné.

| Artefact | Fait le 2026-09-25 | Source dans la branche |
| --- | --- | --- |
| `review.ts` → `REVIEW_QUESTIONS`, `assessQuestions`, `synthesize` | Quatre questions pondérées, note au minimum, arrêt sur question non couverte, aucun score total | `skills/adversarial-review-lenses/SKILL.md` ; correspondance lentille → question reprise telle quelle de `agents/software-engineer-reviewer.md` |
| `roles.ts` → `LENS_FOCUS` | Quatre lentilles (ajout de `quality-gates`), substance de chacune | `agents/{cold-reader,test-integrity,architecture-boundaries,quality-gates}-lens.md` |
| `roles.ts` → `ROLES` | Substance de `researcher`, `acceptance`, `test`, `dev` et du bloc commun | `agents/{solution-researcher,acceptance-designer,software-engineer}.md` |

Ce qui a été **écarté sciemment**, et pourquoi :

- **Les lentilles `contract-fidelity` et `mock-fidelity`** : conditionnelles, et écrites pour .NET
  (`A.Fake<>`, WAF+HttpClient, Microcks). Les reprendre rendrait l'extension dépendante d'une pile,
  ce qu'elle ne doit pas être.
- **Les Object Calisthenics et les seuils de qualité de forme** : chez nous c'est le linter du
  projet qui en juge, avec ses propres seuils (ADR 0022). Deux autorités contradictoires
  bloqueraient du code que la CI du projet accepte.
- **« Un test qui ne tue aucun mutant, supprime-le »** : contredit notre règle « tu ne modifies
  jamais un test ». La porte de mutation est exécutée par le code ; c'est à elle de le dire, pas à
  l'agent qui écrit le code de supprimer une preuve gênante.
- **Toute la procédure que notre code exécute déjà** : commits, journal de changements, collecte
  des preuves, lancement des portes. La reprendre dans un prompt déplacerait vers le LLM des
  décisions que le code prend — exactement ce que le principe directeur interdit.

Deux garde-fous à tenir pendant la reprise :

- **Les prompts repris restent des prompts.** Les portes, les schémas d'outils terminaux et la
  synthèse des verdicts sont exécutés par le code (principe directeur : *le LLM propose, le code
  décide et vérifie*). Reprendre un prompt ne doit jamais déplacer une décision vers le LLM.
- **Chaque artefact repris est identifié comme tel** dans le code, avec sa provenance et la licence
  sous laquelle il l'est — c'est ce qui permettra plus tard de savoir ce qui est à nous.

## Quand ce dossier est-il complet ?

Quand les trois conditions sont remplies et la pièce d'autorisation versée. Le critère
`reprise-skraft` de `features.json` ne passe à `true` qu'à ce moment, et la reprise elle-même est un
travail distinct, à mener ensuite.
