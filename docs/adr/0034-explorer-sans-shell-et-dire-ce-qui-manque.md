# ADR 0034 — Explorer sans shell, dire ce qui manque, et soustraire la barre à ceux qu'elle juge

- Statut : **décidé**, 2026-09-29
- Contexte amont : ADR 0032 (trace), ADR 0033 (ce qu'un refus répond), D20, D28

## Contexte

Trois constats, tous venus des runs réels et de la trace.

**L'exploration coûtait dix fois son prix.** Lire un dossier est permis — la trace montre
`allow read` sur la racine du projet —, mais un aller-retour par niveau, et chacun réemporte tout
le contexte accumulé. D'où la tentative observée : `ls -la .skraft/us-2/research/ && find .skraft`.

**Le contrat taisait les absences.** Il énumérait les outils disponibles — outil de fin,
`run_tests`, `run_lint`, `report_blocker`, `load_skill` — et ne disait nulle part qu'il n'y a ni
shell, ni réseau. L'agent le découvrait en s'y cognant : trois refus sur un run, dix-huit sur un
autre, où il avait fini par déclarer sa phase sans document.

**La barre de qualité était dans le périmètre d'écriture.** Les rôles écrivent dans `.skraft/**`,
et `.skraft/quality.json` y vit : seuils de couverture, score de mutation, règles de dépendance —
tout ce que la porte de livraison lit pour juger. Un agent pouvait abaisser le critère sur lequel
il allait être jugé, et la porte l'aurait validé en toute bonne foi. Personne ne l'avait voulu :
`.skraft/**` avait été écrit comme « son dossier de travail », sans remarquer ce qui s'y trouvait.

## Décision

1. **Un outil `list_files`**, fourni par le cœur, borné à 200 chemins, avec un motif optionnel.
   Même réponse que pour les tests : l'agent ne lance pas la commande, le code la lui rend — sans
   analyse de commande, sans liste blanche à maintenir. Donné aux six rôles qui explorent ; pas aux
   lentilles, qui reçoivent déjà leurs fichiers.
2. **La liste tronquée dit ce qu'elle omet.** Une troncature muette se lirait comme une liste
   complète, et l'agent conclurait que le projet ne contient que ce qu'il voit.
3. **Le contrat énonce les absences** : ni shell, ni réseau, ni outil externe, aucune commande même
   en lecture — et nomme l'alternative. Un refus est un filet ; il ne remplace pas une consigne.
4. **L'alternative proposée est celle que le rôle possède.** Proposer `list_files` à un rôle qui ne
   l'a pas enverrait l'agent contre un second mur. Un test l'exige.
5. **`.skraft/quality.json` est gelé** pour tous les agents du pipeline, par le mécanisme `readOnly`
   qui existe déjà et que DELIVER emploie pour les tests. Un test vérifie qu'il est **transmis**, et
   pas seulement déclaré : une constante que personne ne passe ne protège rien.

## Conséquences

- L'exploration passe de dix aller-retours à un appel, et le contrat évite les tours perdus avant
  même que le filet ne serve.
- **Le périmètre reste `.skraft/**`.** La proposition initiale était `.skraft/<slug>/**`, mais le
  manifeste ne résout que `@stack:*` et le slug n'est connu qu'à l'exécution : il aurait fallu
  inventer une mécanique de substitution. Le gel traite le défaut sérieux ; **l'isolation entre
  stories reste ouverte** — un agent d'US-2 peut toujours écrire dans `.skraft/us-5/`.
- Les outils restent déclarés dans le **manifeste**, jamais dans les fichiers `agent.md` (ADR 0024
  §2). Le manifeste est validé et croisé avec les permissions ; un fichier Markdown ne l'est pas, et
  il doit rester chargeable par des harnais où nos outils n'existent pas. Un rôle peut décrire sa
  **capacité** — « tu ne lances jamais de commande » — sans nommer d'outil.
- **Relevé, non traité** : `skraft-acceptance` peut écrire dans les sources
  (`write: [SKRAFT_DIR, ACCEPTANCE, SOURCES]`). Un rédacteur de scénarios d'acceptance n'a pas de
  raison évidente de modifier le code de production.
