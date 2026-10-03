# ADR 0050 — Le dépôt et la mémoire reviennent au même point

- Statut : **décidé**, 2026-09-29
- Complète : ADR 0029 (point 3, « l'escalade annule toujours »), ADR 0039 (une session par phase),
  ADR 0040 (un rejet ne remet pas le compteur à zéro)
- Contexte amont : D10 (les extensions ne voient que `ctx`), règle de sécurité n°1 (aucun objet du
  SDK n'est exposé à une extension)

## Contexte

L'ADR 0040 a levé une incohérence pour le **réessai** : l'agent garde sa session, donc on cesse de
rembobiner sous lui. Le raisonnement était *garder le souvenir et retirer la chose est la pire des
deux combinaisons*.

La même incohérence restait entière sur le chemin de l'**escalade**, où l'ADR 0029 veut au
contraire que le dépôt redevienne propre :

```ts
const rollback = cp && epuise ? [{ kind: "rollback", to: cp }] : [];
```

Le rollback partait. Les sessions, elles, ne sont libérées que par `releaseTask`, **à la fin de la
tâche**, ou par les plafonds de tour. L'escalade ne faisait ni l'un ni l'autre.

Quand l'utilisateur répondait « Relancer la phase », l'architecte revenait donc avec, dans sa
conversation, les appels d'outils qui avaient créé `contracts.md`, `event-model.md`,
`domain-model.md` — et un disque qui ne les contenait plus. Il édite un fichier absent et échoue,
ou il retape de mémoire.

**Jamais observé dans un run, pour une mauvaise raison.** Le banc répondait `po` à une escalade qui
exige développeur, architecte ou administrateur ; la réponse était refusée, le refus avalé en
silence, et la relance n'avait jamais lieu (ADR 0044). Deux runs gelés là-dessus.

## Décision

1. **Rembobiner et oublier vont ensemble.** Une fonction unique du réducteur fabrique la paire
   `rollback` + `forgetSessions`, et les trois chemins qui rembobinent l'utilisent : budget épuisé,
   panne d'environnement, phase sautée.
2. **L'oubli porte sur tous les rôles de la phase**, pas sur celui du tour en cours.
   `specialistRole` rend un rôle ; `phaseRoles` rend l'ensemble — DESIGN en a deux
   (`architect-model`, `architect-decide`), DELIVER aussi (`test`, `dev`). Oublier le second en
   laissant le premier reconstituerait exactement le défaut.
3. **Un réessai n'oublie rien**, puisqu'il ne rembobine rien (ADR 0040). La règle est symétrique :
   la mémoire suit le dépôt, dans les deux sens.
4. **`ctx.agents.forget(taskId, noms)`** ouvre ce pouvoir aux extensions. Seuls des **noms de
   rôles** franchissent la frontière ; aucun objet de session, aucun identifiant du SDK (règle de
   sécurité n°1). Le cœur préfixe par l'identifiant d'extension avant de chercher les clés de
   continuité.
5. **`TaskAgentRunner.releaseRoles(taskId, rôles)`** en est la contrepartie côté cœur, à côté de
   `releaseTask` : celle-ci clôt une tâche terminée, celle-là libère une partie d'une tâche qui
   continue.

## Conséquences

- **L'alternative écartée** était de ne plus rembobiner non plus à l'escalade. Elle retire à
  l'humain la garantie de retrouver un dépôt net quand la main lui revient — le point 3 de
  l'ADR 0029, qui reste valable.
- Trois tests affirmaient le `rollback` **seul** à l'escalade. Réécrits, pas supprimés : ils
  exigent désormais la paire, et disent pourquoi.
- La clé de continuité (`<taskId>/<extension>/<rôle>`) sert de filtre. Elle n'était pas conçue pour
  ça ; elle s'y prête sans changement, et c'est ce qui rend la correction petite.
- **NON COUVERT** : une session oubliée alors que le rôle n'en avait pas ouvert ne fait rien, mais
  rien ne signale non plus qu'un nom de rôle inconnu a été passé. Un appel mal orthographié est
  silencieux.
- **À VÉRIFIER au prochain run réel.** Ce chemin n'a jamais été parcouru de bout en bout ; le banc
  est corrigé pour y arriver, mais le comportement reste une déduction tant qu'aucune escalade
  n'aura été relancée pour de vrai.
