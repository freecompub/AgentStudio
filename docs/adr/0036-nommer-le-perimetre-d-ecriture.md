# ADR 0036 — Le contrat nomme le périmètre d'écriture, et dit ce qu'il interdit

- Statut : **décidé**, 2026-09-29
- Contexte amont : ADR 0033 (un refus dit ce que le rôle peut faire), ADR 0034 (annoncer les
  absences), D28

## Contexte

Le contrat d'exécution disait :

> Tu n'écris que dans ton périmètre : toute autre écriture est refusée.

**Sans nommer le périmètre.** `composeAgentPrompt` recevait les globs du manifeste — ceux-là mêmes
que la garde applique — et les réduisait à un booléen avant de rédiger la consigne. L'agent devait
donc deviner où il avait le droit d'écrire, ou l'apprendre par un refus.

C'est le défaut corrigé le matin même pour le shell (ADR 0033), resté intact ici : un refus est un
filet, il ne remplace pas une consigne. Et c'est le même motif que la commande refusée non
journalisée ou que les compteurs de cache — **l'information existait et était jetée à la dernière
étape**.

## Décision

1. **Le contrat nomme les chemins autorisés**, tels que le manifeste les déclare.
2. **Il dit aussi ce qu'il interdit** : ne modifier ni supprimer aucun autre fichier du projet.
   Nommer ce qui est permis ne suffit pas — un agent peut lire « voilà où tu écris » sans en
   conclure « et nulle part ailleurs ». L'interdiction de **supprimer**, en particulier, n'est pas
   impliquée par une permission d'écrire.
3. **Une seule source.** Le périmètre annoncé vient du manifeste, comme celui que la garde
   applique ; un test le vérifie. Deux sources pour une même règle finiraient par diverger.
4. `writes` passe de `boolean` à `readonly string[]` dans `contractBlock` : c'est ce booléen qui
   était la cause.

## Conséquences

- Un rôle sans périmètre continue de lire « Tu n'écris aucun fichier », sans inventer de chemins.
- **Le contrôle a posteriori a été écarté.** La proposition examinée était de laisser l'agent lancer
  ses propres commandes et de vérifier ensuite, par Git, qu'il n'a modifié que l'autorisé. Cela
  fonctionne pour un processus **confiné**, et c'est ce que font les outils qui tournent en
  conteneur. Sans confinement, la vérification ne voit rien de ce qui compte le plus :
  - ce qui se passe **hors du dépôt** — Git ne le montre pas ;
  - une **exfiltration**, qui ne modifie rien par construction ;
  - un effet déjà sorti de la machine, qu'aucun rollback ne défait.
- **Reste ouvert** : un outil `search` à paramètres structurés, exécuté en argv sans shell
  (`ProcessRunner` le fait déjà, D47/O12 fournit la liste de programmes). L'agent composerait sa
  recherche, le code l'exécuterait — même frontière que `run_tests`. C'est ce qui répondrait
  vraiment au besoin derrière la proposition ci-dessus.
- **Reste ouvert** : le périmètre est `.skraft/**` et non `.skraft/<slug>/**`. Le manifeste ne sait
  pas substituer le slug ; le défaut sérieux — la barre de qualité — est traité par un gel
  (ADR 0034), l'isolation entre stories ne l'est pas.
