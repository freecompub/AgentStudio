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

## 4. Point à trancher

**Qui met à jour un test unitaire obsolète quand on « rejoue DISTILL » ?**

| Option | Principe | Risque |
|---|---|---|
| **A** (recommandée) | « Rejouer DISTILL » ne sert qu'aux tests **d'acceptance** obsolètes. Pour un test **unitaire**, seule « mettre en pause » est proposée : l'humain le met à jour | Aucun agent ne réécrit un test existant |
| **B** | Pendant ce rejeu, l'agent d'acceptance reçoit le droit d'écrire **ce seul fichier** de test, avec une justification dans `test-plan.md` | Un agent modifie un test existant ; la garde doit être limitée au fichier cité |
| **C** | Pas de rejeu de DISTILL. Une fois l'obsolescence confirmée par l'humain, le testeur de DELIVER met le test à jour (droit limité à ce fichier) | Même risque que B, plus tard dans le pipeline |

---

## 5. Plan de mise en œuvre (une fois le §4 tranché)

1. **Référence des tests d'avant DELIVER** : la garder (workflow : `planifier` ; extension :
   `DELIVER_PLANNED`) pour reconnaître un test existant devenu rouge.
2. **Cause structurée du dernier refus** : tests existants rouges, lignes non couvertes. Elle est
   portée jusqu'à l'escalade du scénario (workflow : `ScenarioEchoue` ; extension : `scenarioFailure`).
3. **Escalade selon la cause** : options et texte de la question ; traces.
4. **Exempter des lignes** : réutiliser `derogationsCouverture` et `sansLignesExemptees` à la porte
   du scénario.
5. **Rejouer DISTILL** :
   - workflow : `workflow.mjs` doit pouvoir revenir de DELIVER à DISTILL (aujourd'hui, les phases
     s'enchaînent sans retour) ;
   - extension : un retour de DELIVER à DISTILL dans le réducteur (rembobinage, oubli des sessions,
     DISTILL relancée avec le motif, gel recalculé).
6. **Mettre en pause** : une question d'attente, puis la question « d'où repartir ? ».
7. **Tests**, de bout en bout dans les deux implémentations, chacun vérifié en échec avant le
   correctif :
   - test existant obsolète : « rejouer DISTILL », « mettre en pause » puis chaque point de reprise ;
   - lignes non couvertes dans un scénario : « exempter ces lignes » ;
   - traces de chaque choix.
