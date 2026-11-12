# ADR 0084 — Les leçons tirées des erreurs répétées

## Statut

**Accepté** le 2026-11-12 par le responsable du projet, qui a demandé de continuer après LEC-1 et
tranché deux points de LEC-2 (freecompub/AgentStudio#33) :
- l'agent de classement tourne à la fin de chaque run ;
- ratifier ou retirer une leçon est réservé au profil déclaré au serveur MCP (`admin.json`).

Concerne le workflow (`workflows/skraft`), le cœur (outil terminal `submit_lecons`) et le serveur MCP
(outil `skraft_lecons`). L'extension `extensions/skraft` n'est pas concernée (ADR 0054).

## Contexte

LEC-1 (ADR 0083) garde dans le projet les erreurs que le code a établies, groupées par signature. Une
erreur brute est une preuve, pas une consigne : la donner telle quelle à un agent lui transmettrait
un texte libre, écrit par un LLM, souvent propre à une occurrence. Il faut en tirer des règles
générales, sans dériver vers des platitudes (« écrire du code propre »).

## Décision

1. **Classer plutôt que généraliser.** À la fin de chaque run, un agent léger, `skraft-lecons`
   (classe `light`), reçoit les groupes d'erreurs que la story a touchés et qui n'ont pas de leçon. Il
   rattache chacun à une section d'un des cinq catalogues d'anti-patrons des skills, ou propose une
   nouvelle entrée si aucune ne convient. Sa sortie passe par l'outil terminal `submit_lecons`, à
   schéma : règle, quand, quoi faire, exemple, sources, catalogue.
2. **Le code vérifie** (`lecons.mjs`, `verifierLecon`) :
   - la référence de catalogue désigne une section existante, ou une nouvelle entrée d'un catalogue
     connu ;
   - chaque source est une erreur du registre, et du même groupe ;
   - l'exemple est l'une des sources.

   Une proposition refusée est reproposée une fois, avec ses motifs ; au-delà, le groupe attend le run
   suivant. Un classement qui échoue ne fait jamais échouer le run.
3. **Les titres des catalogues sont recopiés** dans `catalogues.mjs` : le script ne lit pas le dossier du
   workflow. Un test les compare aux fichiers des skills, pour qu'ils ne divergent pas.
4. **Le rôle d'une leçon** est tiré de la cible de ses erreurs : `test` au testeur, `code` au
   développeur, `deliverable` à l'agent de la phase. Un refus de porte va à l'agent de sa phase.
5. **Le statut est recalculé à chaque run** par le code :
   - une leçon naît `candidate` ;
   - elle devient `validee` quand ses erreurs couvrent au moins deux stories distinctes ;
   - une leçon qui propose une nouvelle entrée reste `candidate` tant qu'elle n'est pas ratifiée ;
   - une leçon validée sans nouvelle occurrence pendant dix stories consécutives devient `retiree`, et
     le reste.

   L'ordre des stories est tenu dans `.agent-studio/lecons/stories.jsonl`.
6. **Les leçons et l'ordre des stories sont commités** après le registre :
   `docs(skraft): leçons après <slug>`.
7. **L'outil MCP `skraft_lecons`** liste les leçons par statut, avec leurs sources et leur catalogue.
   Ratifier ou retirer une leçon passe par une question que le client pose à l'utilisateur : l'argument
   `action` dit seulement quoi lui proposer. Seuls les profils architecte et administrateur peuvent le
   faire ; sans question possible, la liste est rendue et rien ne change.

## Conséquences

- Chaque run qui a des erreurs coûte un tour d'agent léger de plus, à la fin.
- Une modification d'un catalogue de skill doit être recopiée dans `catalogues.mjs` ; le test le
  rappelle.
- Une ratification ou un retrait par `skraft_lecons` écrit le fichier des leçons sans le commiter :
  il part avec le travail suivant du projet.
- Les leçons ne sont encore données à aucun agent : c'est LEC-3.

## Alternatives

- **Classer à la demande, par `skraft_lecons`.** Écarté par le responsable : les leçons ne bougeraient
  que si on y pense.
- **Laisser l'agent formuler une règle libre.** Écarté par la story : une règle inventée librement
  dérive vers des platitudes, un rattachement à un catalogue se vérifie.
- **Demander le profil à la question de ratification.** Écarté : l'utilisateur pourrait se déclarer
  architecte à chaque fois, ce n'est pas un contrôle.
