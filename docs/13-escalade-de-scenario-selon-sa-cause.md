# Escalade d'un scénario selon sa cause

- Date : 2026-10-13, branche `feat/workflow-rejouable`.
- Décision : ADR 0066, au statut **proposé**.
- Portée : l'extension `skraft` et le workflow `workflows/skraft/`, avec le même comportement.
- Statut : **à faire.** Un point est à trancher avant de coder (§4).

---

## 1. Le problème

Un scénario de DELIVER qui échoue est repris, puis escaladé à l'humain une fois son budget épuisé.
L'escalade propose toujours « relancer », « sauter », « abandonner ». Pour deux causes, aucune de
ces options ne peut réussir.

### 1.1 Un test existant devenu rouge

La story change un comportement que décrit un test plus ancien : ce test est obsolète.

Exemple, US-12 (plafonner le bolus). Le projet contenait avant la story :

```ts
it("la dose proposée est celle du calcul", () => expect(proposer(12.5)).toBe(12.5));
```

Avec le plafond à 10 U, ce test devient rouge **dès le pas vert** du développeur. Les portes des
pas exigent une suite verte (workflow : `porteVerte`, `problemesDeSuite` ; extension :
`verifyUnitGreen`), donc le pas est refusé, puis le scénario échoue et escalade.

Personne ne peut mettre ce test à jour :
- le développeur ne touche pas aux tests ;
- le testeur ne fait que des ajouts aux tests existants (D10 de `docs/12`) ;
- en DISTILL, l'agent d'acceptance n'écrit que les tests d'acceptance, les sources et `.skraft/`.

La porte « suite finale » de fin de DELIVER, elle, n'est jamais atteinte dans ce cas.

### 1.2 Des lignes non couvertes écrites pendant le scénario

Exemple, une ligne défensive inatteignable :

```ts
if (max < 0) throw new Error("plafond négatif"); // l'écran de réglage l'interdit déjà
```

La couverture du diff est mesurée à la porte de **chaque scénario** (`porteScenario`, `scenarioGate`).
La ligne fait échouer le scénario, et l'escalade ne propose pas de l'exempter. L'arbitrage humain
de la couverture (ADR 0065, complété le 2026-10-13) ne s'applique qu'à la porte de fin de DELIVER,
donc aux sources écrites hors des scénarios.

---

## 2. Décisions du responsable du projet

- Pour le test obsolète : **remonter à l'humain**, en lui présentant le problème, avec deux
  options :
  - **« Rejouer DISTILL »** : le travail de DELIVER est **entièrement effacé**, DISTILL est
    rejouée avec le problème en motif, puis DELIVER est refaite ;
  - **« Mettre en pause »** : l'humain corrige ; à la reprise, **on lui demande d'où repartir**.
- Pour la couverture : l'humain tranche, comme en fin de DELIVER.

---

## 3. Proposition (ADR 0066)

1. **La cause est connue du code.** Au moment de l'escalade, le dernier refus dit :
   - quels tests rouges **existaient et passaient avant DELIVER** (référence prise au début de la
     phase) ;
   - quelles lignes du scénario restent non couvertes.

   La question à l'humain présente le problème en clair : tests cités, lignes citées.
2. **Test existant devenu rouge.**
   - **« Rejouer DISTILL »** : rembobinage de DELIVER et oubli de ses sessions (ADR 0050). DISTILL
     est rejouée avec le problème en motif, puis DELIVER est refaite.
   - **« Mettre en pause »** : la tâche attend. À la reprise, la question « d'où repartir ? »
     propose « ce scénario », « toute la phase DELIVER » ou « DISTILL ».
   - « relancer », « sauter » et « abandonner » restent proposés.
3. **Lignes non couvertes.** Option **« exempter ces lignes »** : même dérogation qu'en fin de
   DELIVER (lignes hors du calcul, tracée et commitée dans `derogations.md`), puis le scénario est
   relancé.
4. Chaque choix est tracé : entrée `arbitrage` pour une dérogation, rejet pour le reste.

---

## 4. Point tranché, et révision (07/11)

Le responsable a retenu l'option A (aucun agent ne réécrit un test existant), puis remplacé
« rejouer DISTILL » et « mettre en pause » par le principe des défauts hors du changement : l'humain
déclare le test obsolète, il sort des portes, le cycle se termine, et le bilan rappelle de le mettre
à jour. Raison : un retour au début de DELIVER, ou à DISTILL, passe par un rollback Git qui effacerait
la correction faite par l'humain pendant la pause. Voir ADR 0066.

---

## 5. Mise en œuvre (07/11)

1. **Référence des tests d'avant DELIVER** : `avantDeliver` (extension : `DELIVER_PLANNED` ;
   workflow : `planifier`).
2. **Cause portée par chaque refus** : tests en échec (`rouges`) et, à la porte du scénario, lignes
   non couvertes (`lignes`) — extension : `STEP_FAIL`, `SCENARIO_FAIL`, `derniereCause` ; workflow :
   `PasRefuse`, `ScenarioEchoue.cause`.
3. **Fonctions pures, en deux copies** (`deliver.ts`, `deliver.mjs`) : `causeDEchec`,
   `optionsSelonLaCause`, `texteDeLaCause`, `sansTestsObsoletes`.
4. **Escalade selon la cause** : options « Déclarer ces tests obsolètes et continuer » et
   « Exempter ces lignes et continuer », avant relancer, sauter, abandonner ; chaque décision tracée.
5. **Effets** : tests obsolètes retirés des résultats que lisent les portes (et code de sortie rendu à
   0 si leurs échecs étaient les seuls) ; lignes exemptées hors du calcul à la porte du scénario ;
   `derogations.md` et rappel au bilan.
6. **Tests de bout en bout** dans les deux implémentations : `e2e-escalade-cause`.
