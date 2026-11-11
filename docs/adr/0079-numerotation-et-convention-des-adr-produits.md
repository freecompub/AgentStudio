# ADR 0079 — La numérotation et la convention des ADR produits par skraft

## Statut

**Accepté** le 2026-11-11 par le responsable du projet :
- « la porte ne doit pas juger les ADR existants mais plutôt les ADR qu'on produit » ;
- « il faut transmettre à l'architecte la bonne raison : soit le fichier n'existe pas, soit il ne
  suit pas la convention skraft » ;
- « déjà dans la sortie de l'architecte, on s'aperçoit que le fichier produit ne respecte pas le
  format ».

Concerne la porte de cohérence de DESIGN, dans l'extension (`extensions/skraft`) et dans le
workflow (`workflows/skraft`), donc dans le serveur MCP.

## Contexte

skraft écrit ses ADR selon sa convention : `docs/adr/adr-NNN-titre.md`, titre `# ADR-NNN — Titre`.
Un projet peut avoir la sienne : AgentStudio range les siens en `docs/adr/0078-titre.md`, titrés
`# ADR 0078 — Titre`.

Deux runs réels de LEC-1 (freecompub/AgentStudio#32), les 2 et 3, se sont arrêtés en DESIGN sur
la numérotation, pour 33 $ au total (20,54 $ et 12,44 $) :
- La porte ne lisait que les `adr-NNN-*.md`. Les 78 ADR d'AgentStudio lui étaient invisibles, et
  elle réclamait « ADR-001 manque … ADR-078 manque ».
- Une fois ces ADR lus, l'architecte a numéroté depuis 001, et la porte a répondu « ADR-001 en
  double », sans dire avec quel fichier, ni quel numéro prendre.
- Dans les deux cas, l'architecte ne pouvait pas réparer : renuméroter crée un nouveau fichier, et
  il ne peut pas supprimer l'ancien. Chaque essai était refusé, jusqu'à épuiser le budget.

## Décision

1. **Les ADR existants ne sont pas jugés.** La porte lit tout `docs/adr/` (sauf `supersessions.md`).
   Un ADR existant compte par son numéro, lu dans son titre ou son nom de fichier, quel que soit son
   format (`numeroAdr`). Un doublon ou un trou entre ADR du projet n'est pas reproché à la story.
2. **Le code calcule le numéro.** Dans l'extension, `render_adr` numérote après tous les ADR du
   projet. Dans le workflow, le dossier de passation de l'architecte qui décide donne le numéro à
   prendre (« ton prochain ADR est ADR-079 »).
3. **L'erreur est refusée au moment de l'écriture**, dans le workflow, où l'architecte écrit ses
   fichiers lui-même :
   - son périmètre d'écriture se limite à `docs/adr/adr-???-*.md` et `docs/adr/supersessions.md` :
     un nom hors convention est refusé par la garde ;
   - les numéros pris par les autres ADR du projet sont en lecture seule pendant son tour ;
   - le titre est contrôlé dès la fin de son tour, avant la porte de cohérence.

   Un fichier mal nommé ou mal numéroté n'existe donc jamais sur le disque.
4. **Chaque motif donne la cause et ce qui est attendu :**
   - « ADR-005 manque : aucun fichier de docs/adr/ ne porte ce numéro » ;
   - « ADR-079 existe (chemin) mais ne suit pas la convention skraft : fichier attendu …, titre
     attendu … » ;
   - « ADR-001 est déjà pris par `docs/adr/0001-….md` : (chemin) doit prendre le prochain numéro
     libre, ADR-079 » ;
   - « ADR-002 en double : (chemin) et (chemin). Le prochain numéro libre est ADR-003 ».

## Conséquences

- Sur un projet qui a sa propre convention, les ADR de skraft gardent la leur : `adr-079-….md` à
  côté de `0078-….md`. Ils sont numérotés à la suite, sans collision.
- Le message de la garde `lectureSeule` (`readOnlyGuard`) devient générique : « en lecture seule
  pour ce tour (tests gelés, ou fichier que ton dossier de passation t'interdit) ».
- Le moteur de workflow ne sait toujours pas supprimer de fichier. On évite l'erreur plutôt que de
  la réparer après coup.

## Alternatives

- **Renuméroter après coup, par le code.** Impossible sans suppression de fichier dans l'API du
  workflow ; et réparer un fichier déjà écrit est plus fragile que d'empêcher son écriture.
- **Adopter la convention du projet**, déclarée dans `projet.yaml` (section `adr` : dossier, gabarit
  du nom, gabarit du titre). Non tranchée ; elle viendrait en plus de cette décision, sans la
  remplacer.
- **Garder un motif générique** (« ADR-001 en double »). C'est ce qui a fait boucler le run 3.
