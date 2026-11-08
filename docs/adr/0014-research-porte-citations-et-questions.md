# ADR 0014 — RESEARCH : porte citations et questions ouvertes

- Statut : accepté
- Date : 2026-09-23
- Jalon : S2 (SPEC-skraft §7.1, §11, §13.2)

## Contexte

RESEARCH n'a pas de reviewer LLM : une porte exécutée par le code la remplace. Les questions
ouvertes (celles de la story et celles de la recherche) doivent être tranchées par l'utilisateur
avant la phase suivante.

## Décision

1. **Présélection** par le code : mots-clés métier de la story, score par occurrence dans les
   chemins (poids fort) puis dans les contenus fournis (poids faible), vingt fichiers au plus, hors
   dossiers techniques. La liste est ajoutée au dossier de passation de RESEARCH (non persistée).
2. **Porte citations** (fonction pure `checkResearch` et index des fichiers fourni par l'effet) : les
   huit sections du gabarit, les chemins cités qui existent (un simple nom de fichier et les
   livrables sous `.skraft/` ne sont pas contrôlés), des plages non inversées et dans les limites
   (le motif donne la longueur réelle), des URL bien formées, une seule recommandation. Chaque motif
   est transmis tel quel au réessai.
3. **Questions ouvertes** : celles de la story sont reprises à l'initialisation, celles de la
   recherche à la sortie de la porte. **Avant toute phase autre que RESEARCH**, le réducteur attend
   dans le stage `ROUTE`, avec `phase = null`, que chaque question ait une réponse libre ou soit
   explicitement reportée. Chaque question est posée une seule fois, par une demande à réponse libre
   réservée au PO, au développeur, à l'architecte ou à l'administrateur. Les réponses entrent dans
   le dossier de passation.
4. Les demandes d'interaction gagnent `freeText`. L'interface affiche alors un champ de réponse.

## Révision du 08/11 : les questions de la story avant RESEARCH

Décidée par le responsable le 08/11. Aux deux runs réels du jour (US-2), le chercheur s'est arrêté
pour poser lui-même une question que la story annonçait dans ses « Questions ouvertes » : un tour de
plus à chaque fois, la réponse n'arrivant qu'après RESEARCH.

1. Les questions **de la story** sont tranchées en `ROUTE` **avant RESEARCH** ; le chercheur reçoit
   leurs réponses dans son dossier de passation (et `passation.md`).
2. Les questions **levées par la recherche** sont tranchées avant DESIGN, comme avant.
3. Une question tranchée n'est jamais reposée. Extension (`route`, réducteur) et workflow
   (`trancher`, `workflow.mjs`).

## Conséquences

- `ROUTE` devient un stage d'attente persisté en plus d'un calcul transitoire ; les invariants
  restent vérifiés (le test à données pseudo-aléatoires inclut réponses et reports).
- Une story `simple` ou `medium` qui a des questions les pose avant DESIGN, puisque RESEARCH est sautée.
