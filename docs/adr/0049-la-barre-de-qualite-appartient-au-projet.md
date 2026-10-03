# ADR 0049 — La barre de qualité appartient au projet

- Statut : **décidé**, 2026-10-03 (demandé par le responsable du projet ; commande de mutation
  dans `stack.yaml` et mutation en fin de DELIVER retenues sur recommandation)
- Contexte amont : SPEC-skraft §7.4 (portes de fin de scénario), ADR 0028 (la lentille
  `quality-gates` confronte aux faits), ADR 0034 (la barre n'est pas modifiable par ceux qu'elle
  juge), ADR 0046 (correction de revue routée)

## Contexte

Le 03/10, sur US-2 : `Montant.cs`, dans `src/Tarification.Domaine/`, est passé à **70 %** de
couverture alors que la barre du projet exige 90 % pour le cœur. skraft reconnaissait le cœur aux
noms de couches `Domain` et `Application` comme segment de chemin ; `Tarification.Domaine` n'en est
pas un. Tout le domaine était jugé au seuil du reste, sans que rien ne le dise — la lentille
`quality-gates`, elle, a appliqué la bonne règle et réclamé ce que la porte avait accepté.

Trois autres manques :
- la barre (`.skraft/quality.json`) était **propre à skraft**, alors que `tdd` en aurait besoin ;
- on ne pouvait pas **refuser la mutation** : elle tournait dès que la stack savait la faire ;
- la mutation tournait **à chaque scénario**, ce qu'un outil comme Stryker, qui relance la suite
  pour chaque mutant, rend très lent.

## Décision

1. **`.agent-studio/quality.yaml`**, à côté de `stack.yaml`, commun aux extensions, décidé par
   l'utilisateur. Il dit **ce qui est exigé** :

   ```yaml
   coeur:
     domaine: ["src/Tarification.Domaine/**"]
     application: ["src/Tarification.Application/**"]
   couverture: { domaine: 100, application: 90, reste: 70 }
   mutation: { active: true, domaine: 100, application: 90, reste: 80, moment: fin-de-phase }
   dependances:
     - { module: Tarification.Domaine, interdits: [Tarification.Application] }
   ```

2. **`stack.yaml` dit comment** lancer les outils, commande de mutation comprise : une commande y
   est vérifiée contre les programmes autorisés et son écriture confirmée par l'utilisateur, et le
   code doit savoir lire le rapport, pas seulement le lancer. La barre ne lance rien.
3. **Le cœur se définit par des chemins**, domaine et application séparément, avec chacun ses seuils.
   Sans déclaration, des noms usuels sont reconnus, français et préfixés compris (`**/Domain/**`,
   `**/*.Domaine/**`…).
4. **Chaque seuil est facultatif.** Sans seuil de couverture, elle est rapportée, pas exigée ; la
   mutation est active par défaut (100 / 100 / 90). `active: false` la désactive, et les lentilles
   en sont informées.
5. **Validation stricte** : une clé inconnue, un seuil hors de 0 à 100 ou un moment inconnu arrêtent
   la porte (panne d'environnement) avec la clé fautive nommée. Une barre appliquée à moitié
   attesterait d'une exigence qu'elle n'a pas.
6. **Une couche déclarée qui ne correspond à aucun fichier est signalée** aux lentilles, au lieu
   d'appliquer en silence le seuil du reste.
7. **La mutation tourne en fin de DELIVER par défaut**, une fois, sur tous les fichiers de
   production modifiés depuis le début de la phase ; `moment: scenario` rétablit l'ancien
   comportement.
8. **Un mutant survivant ne relance pas la phase** : chaque motif devient un défaut adressé au
   **testeur** (un mutant qui survit est d'abord un test trop faible), par la correction de
   l'ADR 0046. Code superflu : le testeur le déclare `outOfScope` et il part au développeur (ADR
   0047). Le budget d'essais de la phase s'applique, puis l'escalade.
9. **La barre reste hors d'atteinte des agents** : le nouveau fichier rejoint `GELÉS`, et
   `.agent-studio/` n'est dans le périmètre d'écriture d'aucun rôle.
10. **Transition** : sans `quality.yaml`, `.skraft/quality.json` est relu, converti, avec un
    avertissement aux lentilles.

## Conséquences

- Le défaut de `Montant.cs` disparaît même sans migration : les noms usuels par défaut reconnaissent
  `Tarification.Domaine`.
- `tdd` peut lire la même barre (`parseQualityBar` est dans `stack-adapters`, réexporté par
  `extension-api`) ; ce n'est pas encore fait (`docs/07-ameliorer-tdd.md`).
- **Mutants équivalents** : aucun test ne peut les tuer. Le même mutant revient jusqu'à l'escalade,
  où l'humain tranche. Une liste de mutants ignorés dans la barre serait l'étape suivante.

## Reste ouvert

- ~~Aucun lecteur Stryker~~ — **fait le 03/10** : lecteur `stryker-json` (schéma
  `mutation-testing-elements`, commun à Stryker.NET, StrykerJS et Stryker4s) et jeton `{dossier}`
  pour un outil qui range lui-même son rapport. Écrit sur un rapport réel de Stryker.NET 5.0.0, et
  éprouvé de bout en bout sur le code livré d'US-2 : 72 % en 32 s, le score affiché par Stryker.
  Commande type dans `stack.yaml` :
  `[dotnet, stryker, --solution, Tarification.sln, --reporter, json, --output, "{dossier}"]`.
- **Mutations des messages d'erreur — tranché le 03/10 : exclues.** Sur US-2, 4 survivants sur 7
  ne mutaient que le texte d'une exception, que les tests ne vérifient pas ; au seuil de 100 % du
  domaine, ils auraient valu au testeur des demandes sans valeur. Le projet d'essai les écarte dans
  `stryker-config.json` (`"ignore-mutations": ["string"]`, Stryker.NET n'a pas d'option en ligne de
  commande) : score 72 % → 85,7 %, restent les deux vrais trous de `Montant.Multiplie`. Baisser le
  seuil du domaine a été écarté : un vrai trou aurait pu passer.
- **Aucune interface** pour régler la barre : le fichier seulement. `/stack doctor` pourrait
  afficher la barre retenue et les fichiers reconnus comme cœur.
- Le projet d'essai porte encore l'ancien `.skraft/quality.json`.
