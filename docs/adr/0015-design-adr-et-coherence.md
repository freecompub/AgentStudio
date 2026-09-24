# ADR 0015 — DESIGN : outils d'extension, ADR rendus par le code, porte cohérence

- Statut : accepté
- Date : 2026-09-23
- Jalon : S3 (SPEC.md §5.4 ; SPEC-skraft §6.5, §7.2, §13.2)

## Contexte

Les ADR du projet cible ne doivent être écrits que par `render_adr`, qui refuse un champ manquant
ou un numéro en double. La conception doit être cohérente avec le modèle d'événements, et DISTILL
ne doit pas démarrer tant qu'un ADR est `Proposed`.

## Décision

1. **Outils d'extension** (`ctx.tools.register`, SPEC §5.4) : l'outil est déclaré dans
   `contributes.tools` ; un agent ne reçoit que les outils qu'il déclare (standard ou de son
   extension). En isolation, l'outil est enregistré par RPC et exécuté dans le processus de
   l'extension.
2. **`render_adr`** : gabarit propre à agent-studio (ADR 0012), fichiers
   `docs/adr/adr-NNN-<slug>.md`, numéro suivant, registre `docs/adr/supersessions.md` tenu à
   jour. Donner un numéro n'est permis que pour **amender un ADR encore `Proposed`**. Aucun rôle n'a
   d'accès direct en écriture à `docs/adr/`.
3. **Porte cohérence** (fonction pure `checkDesign`) : `event-model.md` présent ; tout identifiant
   `PascalCase` (au moins deux mots accolés, entre backticks) cité dans `contracts.md` ou
   `diagrams.md` doit exister dans `event-model.md` ou `domain-model.md`. S'y ajoutent l'en-tête
   et les sections de chaque nouvel ADR (statut `Proposed`), la numérotation sans trou ni doublon,
   les remplacements présents dans l'ADR **et** dans le registre, et les ADR existant au début de la
   phase non modifiés.
4. **Ratification** : une demande par ADR, réservée à l'architecte (`accept`, `reject`, `amend`
   avec texte). `amend` relance la seule session de décisions, avec la demande. Quand tous les ADR
   sont décidés, le code bascule leur statut dans les fichiers, puis enregistre la phase.
5. **Réessai de DESIGN** : rollback au début de la phase ; la modélisation **et** les décisions
   reçoivent le motif du rejet.

## Conséquences

- `domain-model.md` rejoint les documents attendus du modèle (les rôles de substitution le citent).
- Un nom de modèle d'un seul mot (`Bolus`) n'est pas contrôlé : la convention impose des noms composés.
