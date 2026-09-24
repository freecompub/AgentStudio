# ADR 0022 — La qualité de forme est jugée par le linter du projet

- Statut : **décidé**
- Date : 2026-09-24
- Jalon : hors jalon (amende l'ADR 0017)

## Contexte

La porte de fin de scénario de DELIVER vérifiait trois mesures de forme — longueur des méthodes,
niveaux d'imbrication, nombre d'attributs par type — avec un analyseur écrit dans l'extension,
à base d'expressions régulières reconnaissant `func`, `class`, `struct` et `actor`.

Cet analyseur n'était pas un choix de conception. Le plan de reprise de skraft-plugin
(SPEC-skraft §4) transformait le skill `skraft-quality-bar` en « **code ou profils** », en
précisant que ce qui dépend du langage revient au **profil de stack**. Les profils n'ayant pas
été livrés (J5 partiellement livré), cette part a été écrite en dur dans l'extension au moment
de S5.

Trois conséquences :

1. **Un fait fabriqué.** Pour tout langage autre que Swift et TypeScript, l'analyseur renvoyait
   zéro motif, et la porte en concluait que les règles étaient respectées : elle versait aux
   lentilles de revue un fait établi affirmant une conformité que rien n'avait vérifiée. Les
   lentilles ont pour consigne de ne pas revérifier les faits. C'est l'inverse du principe
   directeur — *le code décide et vérifie*.
2. **Deux autorités contradictoires.** Un projet déclare déjà ses seuils dans `.eslintrc` ou
   `.swiftlint.yml`. Ceux de la barre de qualité pouvaient les contredire et rejeter du code que
   la CI du projet accepte.
3. **Un travail refait, en moins bien.** Ces trois mesures existent dans tous les linters
   (`max-lines-per-function`, `max-depth`, `function_body_length`, `nesting`…), écrites sur des
   arbres syntaxiques là où nous cherchions des accolades à la main.

## Décision

**La qualité de forme est jugée par le linter du projet**, au même titre que les tests, la
mutation et les règles de dépendance : par l'outil de la stack, jamais par un analyseur maison.

- Le port `StackAdapter` gagne `lint?()`, qui renvoie un `LintReport` ; l'API des extensions
  gagne `ctx.stack.lint()`, soumis à la permission `shell:test` — le linter est un programme du
  projet.
- Les adaptateurs livrés l'implémentent : **ESLint** pour TypeScript, **SwiftLint** pour Swift,
  tous deux en rapport JSON.
- **Ce qui vaut rejet dépend de l'outil.** Pour ESLint, seules les erreurs de règle : `warn` y
  est un niveau choisi règle par règle, qui signifie « ne pas bloquer ». Pour SwiftLint, toutes
  les violations : il met `warning` par défaut sur presque toutes ses règles, si bien que le
  choix du projet y est d'**activer** la règle, pas d'en régler la gravité. N'y retenir que les
  erreurs reviendrait à ne rien reprocher à un projet Swift ordinaire, donc à attester sa
  conformité sans l'avoir vérifiée.
- **« Non examiné » n'est pas « propre ».** Un fichier ignoré par la configuration, ou que le
  parser ne sait pas lire, ne compte ni comme conforme ni comme fautif : `LintReport.analyzed`
  dit ce qui a réellement été lu, et la porte n'atteste que de cela. En faire un motif de rejet
  demanderait à l'agent de réparer une configuration qui ne lui appartient pas, et ferait
  boucler le scénario jusqu'à épuisement du budget.
- **Un outil en échec ne vaut pas « sans erreur ».** Code de sortie inattendu, sortie vide,
  délai dépassé : rien n'est jugé. C'est le piège principal, car l'absence de violation ressemble
  à un succès.
- **Sans linter configuré**, la porte ne juge rien et le dit : « Qualité de forme non mesurée ».
  Aucun fait de conformité n'est produit — exactement ce que fait déjà la mutation.
- Les seuils quittent `.skraft/quality.json` : ils appartiennent à la configuration du linter,
  seul endroit où ils ne peuvent pas se contredire.

## Conséquences

- `skraft` redevient **entièrement générique** : plus aucune ligne dépendante d'un langage. Un
  projet Python ou Java est jugé par ruff ou checkstyle, sans rien ajouter à l'extension.
- 118 lignes d'expressions régulières supprimées.
- skraft ne peut plus imposer une discipline que le projet n'a pas adoptée. C'est assumé :
  l'imposer par regex, et seulement sur deux langages, ne se défendait pas.
- Object Calisthenics reste une discipline de neuf règles, dont trois seulement étaient
  mesurées ainsi. Les six autres — pas de `else`, envelopper les primitifs, collections de
  première classe, un point par ligne, pas d'abréviation, pas d'accesseurs — relèvent de la
  lentille de revue `architecture`, qui lit réellement le code.
- Le linter doit figurer dans la liste des programmes autorisés d'un profil (D47, O12), aux
  côtés des lanceurs de tests et des outils de mutation.
