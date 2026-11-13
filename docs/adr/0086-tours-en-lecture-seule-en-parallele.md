# ADR 0086 — Les tours d'agents en lecture seule tournent en parallèle

## Statut

**Accepté** le 2026-11-12 par le responsable du projet (« On les parallélise »), après avoir constaté
que les lentilles d'une revue du workflow skraft tournaient l'une après l'autre.

Concerne le moteur de workflows (`packages/workflow`), donc le workflow skraft et le serveur MCP.
L'extension `extensions/skraft` lance déjà ses lentilles ensemble (`runReview`, `Promise.all`).

## Contexte

Le script de la revue (`workflows/skraft/revue.mjs`) appelle ses lentilles avec `Promise.all`, et la
réfutation ses lots de même. Mais chaque appel devient un effet, et le moteur de tâches exécute ses
effets un par un (`drain`) : les tours se suivaient. Dans le dernier essai d'US-2 sur l'exemple .NET,
la revue a pris 31 s en DESIGN, 95 s en DISTILL et 116 s en DELIVER, contre environ 14 s, 57 s et
76 s si chaque revue n'avait duré que sa lentille la plus lente.

## Décision

1. **Un agent est en lecture seule** s'il ne déclare aucune écriture et n'a ni `run_tests` ni
   `run_lint` : deux builds lancés en même temps se gêneraient. Le code le déduit du `meta`
   (`agentsEnLectureSeule`) ; le workflow n'a rien à déclarer. Pour skraft : les lentilles, le
   réfutateur, l'arbitre des mutants, le classifieur et l'agent des leçons.
2. **Les tours en lecture seule en attente ensemble deviennent un seul effet**, `agents`, à la place
   du premier d'entre eux. Il faut au moins deux tours. Les autres appels gardent leur effet et leur
   ordre.
3. **L'effet lance les tours en même temps** et rend un seul événement, `RESULTATS`, où chaque
   résultat ou erreur est rangé sous son numéro d'appel. Le journal est le même qu'avant : le rejeu
   ne voit pas la différence.
4. **Un seul checkpoint** pour le groupe. Un groupe interrompu est rejoué en entier depuis ce
   checkpoint, comme un tour seul.

## Conséquences

- La revue dure le temps de sa lentille la plus lente, plus la réfutation.
- Le coût ne change pas : ce sont les mêmes tours.
- Deux lots du réfutateur interrompus en même temps partagent la clé de reprise de leur rôle ; seul
  le dernier reste reprenable. C'est déjà le cas dans l'extension.
- Un agent en lecture seule ajouté à un workflow est parallélisé sans rien déclarer. Un agent qui
  écrit ou lance les tests ne l'est jamais.

## Alternatives

- **Exécuter tous les effets d'un même rejeu en parallèle dans le moteur de tâches.** Écarté : les
  écritures et les tests partagent le dépôt, et le checkpoint d'un effet suppose qu'il est seul.
- **Une option `parallele` dans l'appel `w.agent`.** Écarté : ce serait au script de garantir qu'un
  agent n'écrit pas, alors que le `meta` le dit déjà.
