# ADR 0041 — Une porte reconnaît ses tests à sa propre marque, pas à leur rangement

- Statut : **décidé**, 2026-09-29
- Contexte amont : D10 (les extensions sont indépendantes des langages), D20 (les preuves sont
  produites par notre code), D25 (panne d'environnement ≠ défaut de travail), ADR 0016 (portes
  valeurs et RED de DISTILL), ADR 0033 (ce qu'un refus répond)

## Contexte

Le 2026-09-29, la phase DISTILL a épuisé ses trois essais sur le projet d'essai .NET. Les trois
rejets, dans l'ordre :

1. les valeurs des critères ne figuraient pas mot pour mot dans les tests — vrai, corrigé ;
2. « Aucun test d'acceptance n'a été exécuté. » ;
3. « Aucun test d'acceptance n'a été exécuté. »

Au troisième essai l'agent a relancé `run_tests` — la seule chose qu'un tel reproche appelle — et
obtenu 8 réussis / 2 échecs, dont **deux tests d'acceptance rouges sur assertion métier**, soit
exactement le rouge que la porte attend. Il a été escaladé quand même.

La cause est dans `effects.ts` :

```ts
const results = run.results.filter((r) => matchesAny(acceptanceGlobs, r.file) || matchesAny(acceptanceGlobs, r.id));
```

`acceptanceGlobs` vaut `layout.acceptanceTests`, c'est-à-dire `tests/**/*AcceptanceTests.cs` : des
**chemins**. Or un rapport JUnit exprime `file` comme un **nom de classe** (`file: c.classname`,
`read-report.ts:17`) et `id` comme un nom .NET qualifié :

```
attendu par le glob   tests/Tarification.Tests/RemiseParPalierAcceptanceTests.cs
fourni par .NET       Tarification.Tests.RemiseParPalierAcceptanceTests
```

Aucune chaîne ne peut être les deux. Le filtre rendait toujours zéro, sur tout profil à rapport
JUnit — .NET, Java, Kotlin. Le profil TypeScript y échappait parce que Vitest rend de vrais chemins,
ce qui explique que douze mois de tests ne l'aient jamais montré.

Le même glob servait à deux tâches. Pour **lire les fichiers** (`files.filter(...)`, ligne 351) il
est juste, et le premier rejet le prouve : la porte lisait bien les tests. Pour **reconnaître un
résultat**, il ne pouvait rien.

## Décision

1. **La porte reconnaît ses tests au marqueur qu'elle exige elle-même.** `acOf(r.id)` — le marqueur
   `ac-<n>` que DISTILL impose à l'agent — remplace l'appariement par glob. Le filtre disparaît de
   `effects.ts` : la suite entière est transmise, et `checkAcceptanceRed` sélectionne.
2. **`checkValues` et `checkAcceptanceRed` cherchent la marque au même endroit** : dans le **nom**
   du test. Le brief de DISTILL le dit désormais explicitement — un marqueur en commentaire ou en
   attribut satisfaisait la première porte et restait invisible à la seconde.
3. **Deux constats que « aucun test d'acceptance » confondait** sont désormais distingués :
   aucun résultat du tout (la suite n'a rien produit), et des résultats sans marqueur — ce dernier
   message dit combien de tests ont tourné, en cite trois, et rappelle où placer la marque.
4. Le champ `layout.acceptanceTests` reste ce qu'il est : des globs de **fichiers**, pour lire les
   fichiers. Aucun champ n'est ajouté au profil.

## Conséquences

- **Rien de spécifique à un langage n'entre dans skraft**, et rien n'en sort non plus : l'extension
  n'a plus besoin de savoir qu'un résultat s'identifie par un chemin, un nom de classe, un point ou
  une barre oblique (D10). Les deux solutions envisagées d'abord — un champ `acceptanceTestIds` dans
  le profil, puis un `acceptanceResultPattern` transporté comme `testFilePattern` — construisaient
  une mécanique pour un problème dont la réponse était **deux lignes plus bas**, déjà appelée par
  la porte pour relier un résultat à son critère.
- Un test unitaire vert n'est plus jugé par la porte RED. Il ne l'était pas non plus avant, par
  accident de filtrage ; il ne l'est plus par décision.
- La convention de nommage devient **structurante** : un projet dont les tests d'acceptance ne
  portent pas `ac-<n>` dans leur nom est refusé — mais avec un motif qui dit quoi faire, et dès le
  premier essai.
- Le reproche du 29/09 appartient à la famille que le projet traque depuis deux semaines : la porte
  a mesuré « aucun identifiant ne ressemble à un chemin » et a rapporté « aucun test n'a été
  exécuté ». **Une porte ne doit pas affirmer plus que ce qu'elle a mesuré**, y compris quand ce
  qu'elle affirme paraît anodin.
- NON TRAITÉ : le budget d'essais a été consommé par un reproche insatisfaisable. Rien n'empêche
  encore qu'une porte défectueuse épuise trois essais ; D25 ne s'applique qu'aux pannes que le code
  sait nommer.
