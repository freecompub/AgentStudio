# ADR 0082 — L'agent se vérifie avec l'outil de sa porte

## Statut

**Accepté** le 2026-11-11 par le responsable du projet :
- « que penses-tu de mettre les gates comme tools pour les agents, comme ça ils peuvent s'auto-évaluer
  avant de rendre la réponse » ;
- les niveaux 1 et 2 de la proposition : mesurer chaque appel, et rappeler une fois la vérification
  avant la sortie ;
- « il faut annuler la décision du 8/10, je ne vois pas les raisons pour lesquelles un agent ne
  pourrait pas utiliser un outil et qu'il soit évalué avec le même outil ».

**Révise l'ADR 0055, point 3** : un workflow peut apporter ses propres outils à ses agents. Le reste
de l'ADR 0055 tient : pas de hooks, pas d'API `ctx` pour le script, qui n'a que les appels `w.*`.

Concerne le cœur, l'hôte d'extensions, le moteur de workflow et skraft (extension et workflow).

## Contexte

Une porte du code juge le travail d'un agent après son tour. Quand elle refuse, l'agent repart pour
un essai complet : une session neuve, son dossier de passation relu, tout refait. Au run 4 de LEC-1
(freecompub/AgentStudio#32), un refus de la porte des valeurs a coûté un essai d'environ 11 minutes.
L'agent ne pouvait pas savoir, avant de rendre son travail, ce que la porte en dirait.

L'ADR 0055 (point 3) interdisait à un workflow d'apporter des outils : ses agents n'avaient que ceux
de la plateforme (`list_files`, `run_tests`, `run_lint`, `report_blocker`).

## Décision

1. **Un outil de vérification par porte mécanique.** L'agent l'appelle pendant son tour ; il reçoit
   les motifs que la porte donnerait. La porte et l'outil appellent la **même fonction pure** :
   l'agent est jugé comme il s'est vérifié. La porte reste rejouée par le code après le tour.
2. **L'hôte lit les fichiers.** À l'appel de l'agent, l'orchestrateur désigne l'outil et les fichiers
   qu'il examine : `ctx.agents.run(…, { verification: { outil, fichiers, donnees } })`, ou
   `w.agent(…, { verification })` dans un workflow. Quand l'agent appelle l'outil, l'hôte lit
   lui-même ces fichiers et les passe à l'outil avec `donnees`. L'outil ne lit rien d'autre.
3. **Niveau 1, mesurer.** Chaque appel est compté. Le résultat de l'agent rapporte
   `verification: { appels, dernier }`, et le bilan du run le nomme.
4. **Niveau 2, rappeler une fois.** Si l'agent appelle son outil terminal sans avoir vérifié, ou
   après avoir modifié les fichiers vérifiés depuis son dernier appel (comparaison d'empreintes), le
   code refuse **une seule fois** la sortie, avec un rappel. Le second appel est accepté : la porte
   jugera. Le cœur le permet par un contrôle facultatif de l'outil terminal (`avantSortie`).
5. **Un workflow apporte ses outils** (révision de l'ADR 0055, point 3) :
   - il les déclare dans `meta.outils` (nom, description), et ses agents les citent dans `outils` ;
   - leur code est une fonction exportée par le script (`export const outils = { nom: ({ args, fichiers, donnees }) => texte }`) ;
   - le processus isolé du workflow l'exécute à la demande de l'hôte. Elle ne lit ni n'écrit rien :
     le journal et le rejeu ne changent pas.
6. **Dans skraft**, le premier outil est `verifier_scenarios`, pour l'agent d'acceptance : portes
   gherkin, valeurs et plan de test. Le RED d'acceptance reste prouvé par les tests, après le tour.

## Conséquences

- Un défaut de forme se corrige pendant le tour, sans consommer d'essai.
- Les agents simulés des essais réagissent au rappel comme un agent qui l'ignore : ils rappellent
  `report_phase`. Les essais écrits avant l'outil gardent leur déroulé.
- Un faux positif de porte coûte maintenant en qualité plus qu'en temps : l'agent peut écrire pour
  passer la porte. Les faux positifs connus sont à corriger avant d'exposer une porte (ADR 0080).
- `verifier_conception` (DESIGN) suivra, sur le même modèle.

## Alternatives

- **Un seul outil de plateforme, `verifier`**, qui lance la porte de la phase en cours, pour garder
  l'ADR 0055 intact. Écarté par le responsable : rien ne justifie d'interdire à un workflow ses
  propres outils.
- **Exiger une vérification sans motif avant la sortie** (niveau 3). Écarté : la porte est rejouée
  de toute façon, et un agent qui ne sait pas corriger n'aurait plus d'issue.
- **Exposer aussi les lentilles de revue.** Écarté : ce sont des LLM, chers, et leur intérêt est
  d'être un regard extérieur.
