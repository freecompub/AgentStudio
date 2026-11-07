# ADR 0060 — Couverture du code modifié et précontrôle sans agent

## Statut

Accepté le 2026-10-10. L'utilisateur choisit les exigences sur le code modifié et une
notification non bloquante pour la dette de couverture existante.

## Contexte

L'essai de reprise US-2 `eda055a6` a franchi le gel de DISTILL, puis a été abandonné
sur la couverture des fichiers entiers modifiés : `CalculDuPanier.cs` à 75 % et
`Panier.cs` à 87,5 %, pour un minimum de 90 %. Les lignes non couvertes,
`Facture.ATPayer` et `Panier.Lignes`, existaient déjà sur `main`. Sur cette base,
la couverture était respectivement de 66,7 % et 85,7 % : aucune dégradation,
mais le scénario devait réparer une dette antérieure à son intervention.

## Décision

Avant le classifieur et tout appel LLM, le code lance les tests du projet.
Un test rouge ou ignoré, un délai dépassé ou une sortie non nulle bloque le lancement
avec les motifs précis. L'exécution est enregistrée sous `INIT_BASELINE`.
Les seuils déclarés sont comparés à la couverture globale existante : les écarts
sont notifiés dans le chat comme **avertissements non bloquants**. Une couverture
absente est signalée comme non mesurée, jamais comme conforme.

Pendant DELIVER, les seuils par couche portent uniquement sur les lignes exécutables
ajoutées ou remplacées. Le Workspace calcule leurs numéros dans l'arbre courant
par un diff Git sans contexte, depuis un checkpoint ; il inclut les fichiers
non suivis, sans déplacer HEAD ni l'index. Un nouveau fichier est entièrement
dans le diff ; les suppressions n'ajoutent aucune ligne à couvrir. Les renommages,
déjà traités sans détection de renommage par le Workspace, sont des suppressions
et ajouts. Le rapport Cobertura conserve désormais le détail par ligne et le
calcul pur partagé en fait l'intersection avec le diff. Une ligne déplacée par
un ajout antérieur mais inchangée n'est pas comptée.

La porte de scénario utilise son checkpoint. Une vérification finale utilise un
checkpoint initial de toute la tâche, enregistré avant les agents et conservé au
redémarrage : elle inclut donc aussi les sources écrites pendant DESIGN ou DISTILL,
et empêche d'échapper au seuil en répartissant les changements entre phases.
Une nouvelle tâche a une nouvelle référence initiale ; elle n'est pas la reprise
de l'état persisté de la précédente. Un ancien état sans ce champ garde une
vérification depuis le début de DELIVER, avec cette limitation explicitement signalée.

Un détail de couverture ou de diff indisponible n'est pas remplacé par le taux
du fichier entier : le périmètre est signalé **non mesuré** selon D45. Aucun taux
fictif n'est calculé s'il n'y a pas de ligne exécutable modifiée.
Les seuils ne sont ni abaissés ni imposés aux projets qui n'en déclarent pas.

## Conséquences

L'extension skraft et le workflow indépendant appliquent la même politique.
Les calculs communs sont fournis par la plateforme ; le workflow n'importe pas
l'extension. Les motifs de rejet indiquent les numéros des lignes modifiées
non couvertes. Les faits transmis aux lentilles identifient la couverture du diff,
pas celle du fichier entier.

Les tests passent par les hôtes isolés : rouge initial = zéro session d'agent ;
dette initiale = avertissement puis classifieur ; ajout couvert = livraison malgré
la dette ; ligne modifiée non couverte = refus ciblé. Les suites de reprise et de
gel restent compatibles. Aucun nouveau run Copilot réel n'est lancé pour ce correctif.

Un nouveau lancement sur un dépôt contenant déjà les tests d'acceptance rouges
d'une tâche précédente est désormais bloqué par le précontrôle : il faut reprendre
la tâche persistée, ou revenir à une base verte pour démarrer une nouvelle tâche.
Cette décision ne rouvre pas les runs abandonnés et ne modifie pas leurs résultats.
