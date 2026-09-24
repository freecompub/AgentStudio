# ADR 0013 — Pipeline skraft : réducteur unique, effets par ctx, porte minimale en S1

- Statut : accepté
- Date : 2026-09-23
- Jalon : S1 (SPEC-skraft §5, §6, §8, §9.3, §13.1)

## Contexte

S1 exige l'état unifié, le réducteur complet, les invariants, la grille de difficulté, la lecture de
la story, les stages INIT, CLASSIFY, ROUTE et COMMIT, et un pipeline à vide avec agents simulés qui
reprend après redémarrage à chaque stage. La licence de skraft-plugin n'est pas tranchée (ADR 0012).

## Décision

1. **Un seul type d'état** (`SkraftState`, §5.1), validé par schéma. Il comporte quelques champs
   internes nécessaires au réducteur : `designStep` (DESIGN en deux sessions), `blocker`,
   `escalation`, `answers`, `proposed`, `lenses`, `story`, `indicators`.
2. **Réducteur pur** transcrivant le tableau §5.2. `ROUTE` et `VERDICT_GATE` y sont transitoires,
   calculés sans effet ; la synthèse de revue est une fonction pure (§9.3, règles minimales en
   attendant la transcription de la table de pondération, soumise à O9).
3. **Invariants** 1 à 8 vérifiés sur des suites d'événements pseudo-aléatoires. Cette vérification
   a révélé une ratification tardive qui recommitait une phase : seule la porte de DESIGN produit
   des ADR, et une ratification hors DESIGN reprend la route.
4. **Effets par le seul `ctx`** : lecture de la story, branche `skraft/<slug>` (`ctx.git.branch`,
   `git:branch`), points de retour, agents, écriture des rapports de revue par le code
   (`ctx.workspace.writeFile`, limité aux motifs `fs:write`), demandes d'interaction (ratification
   réservée à l'architecte, blocages au PO ou au développeur, escalade au développeur).
5. **Blocage d'agent** : `report_blocker` est un outil terminal du cœur ; `ctx.agents.run` renvoie
   la sortie **ou** la question. La réponse repart dans le dossier de passation.
6. **Porte minimale en S1** : au moins un livrable produit pendant la phase, avec l'empreinte de
   chaque fichier. Les portes spécifiques (citations, cohérence, valeurs, RED d'acceptance, fin de
   scénario) arrivent de S2 à S5.
7. **Moteur** : les effets émis avec l'état terminal (bilan) s'exécutent avant que la tâche soit
   « terminée » ; le nom d'état (`phaseOf`) est publié dans l'enregistrement de tâche, y compris
   pour une extension isolée.

## Conséquences

- Les chemins d'écriture de DISTILL et DELIVER sont provisoires (`Tests/**`, `tests/**`,
  `Sources/**`, `src/**`) jusqu'à la résolution `@stack:*` par l'adaptateur (S4, S5).
- L'extraction des questions ouvertes de la recherche et leur passage à l'utilisateur relèvent de S2.
