# ADR 0059 — Lever le gel après refus de DISTILL, puis regeler les tests corrigés

## Statut

Accepté le 2026-10-10, à la demande de l'utilisateur.

## Contexte

Le run réel US-2 `63e98c3d` a échoué avant le premier agent DELIVER. La revue de DISTILL
avait demandé un test supplémentaire, ajouté par `skraft-acceptance` puis approuvé.
L'empreinte conservée restait celle du premier passage des portes : la condition « seulement
si aucune empreinte » empêchait de prendre en compte le fichier ajouté. L'extension et le
workflow indépendant partageaient ce défaut.

## Décision

L'empreinte issue des portes de DISTILL représente l'essai courant, pas encore la sortie
définitive de la phase. Un refus, une interruption ou une panne invalide cette empreinte et
les non-régressions associées avant correction ou reprise. Le rembobinage de DISTILL les
invalide également. Les portes vérifient à nouveau les valeurs et le RED d'acceptance de
l'ensemble corrigé, puis enregistrent sa nouvelle empreinte et ses non-régressions.

L'approbation de la revue conserve cet ensemble pour DELIVER. Un refus en DELIVER ne lève
jamais le gel : la correction de cette phase reste soumise à ses périmètres habituels.

## Conséquences

`skraft-acceptance` peut ajouter ou réécrire un test demandé en revue de DISTILL, sans
affaiblir les portes ni déplacer la décision vers le LLM. Le réducteur invalide les données
de gel sur les chemins de réessai et d'escalade de DISTILL. Le workflow les efface avant
chaque essai, à sa sortie non approuvée et après rembobinage.

Les scénarios jumeaux ajoutent un fichier après un refus de revue, puis atteignent réellement
le premier agent DELIVER. Les tests purs couvrent aussi rejet définitif, délai, panne et
épuisement du budget ; les portes de DELIVER continuent de refuser une empreinte altérée.
Le run échoué est conservé comme preuve : ce correctif ne transforme pas son résultat en
livraison et ne relance pas la campagne.
