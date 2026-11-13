# ADR 0080 — Les valeurs douteuses de la porte des valeurs sont soumises à l'humain

## Statut

**Remplacé** le 2026-11-13 par l'ADR 0090 : les nombres des critères ne sont plus soumis à
l'humain, et une valeur absente n'est plus un refus.

**Accepté** le 2026-11-11 par le responsable du projet :
- « je pense que la gate est trop restrictive » ;
- « que penses-tu du fait de remonter le problème à l'utilisateur, lui expliquer le problème, qu'il
  fasse le choix de désactiver ou non le contrôle » ;
- « ok on fait ça », sur la proposition : demander au début du run, seulement pour les valeurs
  douteuses, valeur par valeur, et garder le contrôle si personne ne répond.

Précise SPEC-skraft §6.1 et §7.3. Concerne l'extension (`extensions/skraft`) et le workflow
(`workflows/skraft`), donc le serveur MCP.

## Contexte

La porte des valeurs (SPEC-skraft §7.3) exige que chaque valeur d'un critère d'acceptation se
retrouve dans le scénario `@ac-n` et dans le test d'acceptance du critère. Le code extrait ces
valeurs : les textes entre guillemets, les nombres avec leur unité, et les nombres seuls.

Au run 4 de LEC-1 (freecompub/AgentStudio#32), le critère 3 disait « Un défaut réfuté par le
réfutateur (ADR 0069) n'est jamais écrit dans le registre ». La porte a exigé « 0069 » dans le
scénario, et refusé un essai. Un nombre seul peut être une valeur métier (« 3 essais »), mais aussi
un numéro, une date, une référence : le code ne sait pas trancher, et seul l'humain le sait.

Remplacer la porte par une lentille a été écarté : vérifier qu'une valeur est recopiée est un
contrôle mécanique, que le code fait sans erreur ; une lentille laisserait passer une valeur
arrondie ou un message reformulé, qui gardent le sens.

## Décision

1. **Une référence n'est pas une valeur.** « ADR 0069 », « ADR-069 » et « #32 » ne sont pas extraits.
2. **Un nombre seul, sans unité, est une valeur douteuse.** Il est soumis à l'humain dans la phase
   ROUTE, avec les questions ouvertes de la story, avant RESEARCH : « Le critère 3 cite « 3 » … Est-ce
   une valeur que les scénarios et les tests d'acceptance doivent contenir ? ». La demande s'intitule
   « Valeur à tester (US-12, critère 3) », et offre deux réponses, sans texte libre :
   - « Oui : la garder dans la porte des valeurs », en premier ;
   - « Non : la retirer de la porte des valeurs ».
3. **Une valeur sûre n'est pas soumise** : un texte entre guillemets ou un nombre avec unité reste
   exigé sans question.
4. **Le retrait est valeur par valeur.** Une valeur retirée sort de son seul critère ; la porte
   reste active pour toutes les autres.
5. **La décision laisse une trace.** La réponse est écrite dans le dossier de passation, comme les
   autres réponses de l'utilisateur, et transmise aux agents et aux lentilles. Le bilan du run nomme
   chaque valeur retirée.
6. **Sans décision, le contrôle reste.** La première réponse garde la valeur : c'est ce que choisit
   un répondeur qui ne lit pas (`scripts/banc/repondeur.ts` prend la première option d'une demande
   qu'il ne connaît pas).

## Conséquences

- Les questions de valeur portent les identifiants `v1`, `v2`… ; celles de la story et de la
  recherche gardent `q1`, `q2`…
- La demande est réservée aux mêmes profils qu'une question ouverte (PO, développeur, architecte,
  administrateur) ; dans le workflow, elle a sa propre entrée, `valeur-a-tester`.
- Une story qui cite des comptes ou des dates sans unité pose une question par nombre distinct de
  chaque critère. Les stories de référence (US-12, US-15, US-7) n'en ont aucune.

## Alternatives

- **Remplacer la porte par une lentille.** Écarté : voir le contexte.
- **Demander après un refus de la porte.** Écarté : l'essai de l'agent est déjà payé (environ
  11 minutes au run 4), alors que les valeurs sont connues dès la lecture de la story.
- **Désactiver toute la porte sur décision de l'humain.** Écarté : un faux positif ferait perdre la
  protection sur les vraies valeurs.
- **Demander pour toutes les valeurs.** Écarté : une story à dix valeurs ferait dix questions, et on
  finirait par répondre sans lire.
