# Modifications du 23 et 24 septembre 2026

## Réanalyse de skraft sur la branche 1.6.0

Branche `refactor/v1.6.0-tracking-substrate` (version `1.6.0-hooks.1`) :
- constats C4, C5 et C7 corrigés ; C1, C2, C3, C6 et le « commit vérifié » toujours présents ;
- deux problèmes nouveaux : N1, le routage d'entrée et la ratification des ADR ne peuvent plus être enregistrés ; N2, la garde d'écriture se contourne par un interpréteur ;
- niveaux de difficulté supprimés : les quatre phases s'exécutent toujours ;
- plan de refonte annoncé (`.specs/plan_todo.md`), non implémenté.

Fichiers mis à jour : `docs/02-analyse-technique-skraft-plugin.md` (nouvelle section « Réanalyse de la branche 1.6.0 »), `docs/03-skraft-diagrammes-etat-compares.md` (diagramme et tableaux de la 1.6.0), `docs/04-skraft-pas-a-pas-fragilites-ameliorations.md` (encadré de mise à jour, hooks 1.5.2 et 1.6.0 comparés), `specs/SPEC-skraft.md` (statut 1.6.0 de chaque défaut, N1 et N2, plan de reprise sur les chemins de la 1.6.0, section 8 « Routage d'entrée et difficulté »), `specs/SPEC.md` (section skraft).

## Profils de stack à la place des adaptateurs par langage

- `specs/SPEC.md` : nouvelle section 8 « Profils de stack » (moteur générique, profil déclaratif, parseurs en bac à sable, capacités déclarées, `/stack init` et `/stack doctor` avec tests canaris) ; décisions D43 à D48 ; questions O11 à O13 ; jalon J5 revu ; sections 8 à 17 renumérotées 9 à 18.
- `specs/SPEC-skraft.md` : plus aucun code propre à un langage ; chemins, commandes et seuils lus dans le profil.
- `docs/03` et `docs/04` : passages décrivant notre approche alignés sur les profils de stack.

## Présentations

Les deux présentations sont en ligne et se téléchargent en PowerPoint ou en PDF depuis leur page (voir `presentations/README.md`).
