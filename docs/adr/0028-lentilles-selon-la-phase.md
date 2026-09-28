# ADR 0028 — Une lentille qui n'a rien à mesurer ne siège pas

- Statut : **décidé**, 2026-09-28
- Contexte amont : SPEC-skraft §9 (revue, quatre questions), ADR 0024 (lentilles en Markdown),
  §8.3 (effets du niveau de difficulté)

## Contexte

Le 2026-09-28, la revue de DESIGN sur US-2 du projet d'essai .NET a été refusée **deux fois de
suite**, à chaque fois par la même lentille, sur le même motif :

> [quality-gates, major] Le texte présente le flux cible […] comme l'implémentation actuelle et le
> référence à `CalculDuPanier.cs:15-22`. Or le code cité ne contient ni port injecté, ni appel de
> service de domaine, ni `ResultatDeChiffrage`.

Deux choses ne vont pas dans ce reproche.

**Il est mécaniquement insatisfaisable.** Un document de conception décrit ce qui n'existe pas
encore ; c'est sa fonction. À chaque essai l'architecte réécrit, et à chaque essai la lentille
retrouve le même écart entre le texte et le code. Le budget de phase s'épuise, la tâche escalade.

**Il sort de son mandat.** Cette lentille confronte les livrables aux faits **mesurés** par le
code — tests, couverture, mutation, lint. En DESIGN, rien de cela n'existe : aucun test n'a encore
été écrit. `reviewFacts` ne lui donnait que des lignes de la forme « Livrable X : porte de DESIGN
validée à l'essai 1 (sha256 …) » — l'existence d'un fichier, pas une mesure. Son instruction lui
disait pourtant « les faits ci-dessous font foi : vérifie que les livrables leur sont fidèles ».
Sommée de rendre un verdict sans matière, elle a cherché ailleurs et trouvé un grief dans une
catégorie voisine.

Le projet répète qu'**une porte ne doit jamais attester ce qu'elle n'a pas mesuré**. C'est le même
défaut, retourné : elle ne doit pas non plus le **reprocher**.

## Décision

1. **Les lentilles convoquées dépendent de la phase**, pas seulement du niveau de difficulté
   (`lensesForPhase`). `quality-gates` ne siège pas en DESIGN. Elle siège en DISTILL et en DELIVER,
   où le code mesure réellement quelque chose.
2. **L'invariant qui rend ce retrait légitime est vérifié par le code**, pas supposé : les quatre
   questions de `review.ts` doivent rester couvertes pour **chaque couple (niveau, phase)**. Un
   test les parcourt tous. Sans lui, écarter une lentille laisserait une question ouverte, et la
   synthèse refuserait d'approuver — la revue tournerait en rond autrement.
   Le compte y est : `completeness` et `quality` retombent sur `test-integrity`, `businessFit` sur
   `cold-reader`, `risk` sur les trois.
3. **Filet pour les phases où elle siège sans mesure disponible** — une stack sans outil de
   couverture, un DISTILL sans exécution de tests. Son instruction ne présente alors plus des
   empreintes comme des faits : elle dit « aucune mesure n'existe à ce stade », lui interdit
   d'inventer un défaut qu'elle ne peut confronter à rien, et **conserve son seul vrai mandat dans
   ce cas** : dénoncer un livrable qui *se prévaut* d'une qualité que rien n'a mesurée.
4. Les trois autres lentilles ne sont jamais retirées. On n'en écarte qu'une, pour une raison
   nommée, et un test l'exige.

## Conséquences

- La revue de DESIGN compte désormais trois lentilles au lieu de quatre. Deux tests qui affirmaient
  l'ancienne règle ont été corrigés **délibérément**, pas pour redevenir verts : leurs intitulés
  portent la nouvelle règle et renvoient à cette ADR.
- Le niveau de difficulté conserve ses quatre lentilles dans l'état : c'est la phase qui en écarte
  une au moment de convoquer. `state.lenses` reste donc le réglage, et non le résultat.
- Ceci ne corrige pas la cause du blocage observé, seulement son symptôme le plus coûteux. Il reste
  que rien, dans le code, n'empêche une lentille de rendre un défaut hors de son mandat. Les
  verdicts sont à schéma, mais le **contenu** d'un défaut n'est pas contraint — et ne peut
  probablement pas l'être. À surveiller sur les prochains runs réels.
