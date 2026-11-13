# ADR 0088 — Le slug d'une story : son numéro et l'empreinte de son titre

## Statut

**Accepté** le 2026-11-13 par le responsable du projet, qui a fixé la règle (« une combinaison du sha
du titre de l'US et du numéro de l'US ») et choisi le format court.

Concerne l'extension (`extensions/skraft`), le workflow (`workflows/skraft`) et le serveur MCP, qui
calcule la branche d'une story tirée d'une issue GitHub.

## Contexte

Le slug d'une story nomme sa branche (`skraft/<slug>`), son dossier de travail (`.skraft/<slug>/`) et
son registre des erreurs. Il n'était tiré que de l'identifiant (`US-2` donnait `us-2`) : deux stories
différentes au même numéro partageaient branche et dossier. Pour relancer une US et reprendre son
travail, il faut qu'une même story retrouve toujours le même slug, et qu'une autre story n'y tombe pas.

## Décision

1. **Format** : le préfixe de l'identifiant en minuscules, sans séparateur, puis son numéro sur au
   moins deux chiffres, un tiret, et les 8 premiers caractères hexadécimaux du sha256 du titre. Par
   exemple, « US-2 — Remise par palier de quantité » donne `us02-` suivi de l'empreinte du titre.
2. **Titre normalisé** avant l'empreinte : espaces de début et de fin retirés, espaces répétés réduits
   à un seul. Le reste compte, casse et accents compris : un autre titre est une autre story.
3. **Une seule formule** pour le workflow et le serveur MCP : `slugOf` de `workflows/skraft/story.mjs`,
   avec un sha256 sans dépendance (`sha256.mjs`). Le processus isolé d'un workflow n'a ni
   `node:crypto` ni `TextEncoder`, et le serveur importe ce module directement. L'extension calcule le
   même slug avec `node:crypto`.
4. **Issue GitHub** : la branche où le serveur commite la story est calculée à partir du titre écrit
   dans le fichier de la story, qu'un agent de mise en forme a pu changer. C'est celle que le run
   retrouve.

## Conséquences

- Une story déjà lancée avec l'ancien slug (`skraft/us-2`, `.skraft/us-2/`) n'est pas retrouvée : un
  nouveau run part sur la nouvelle branche.
- Corriger le titre d'une story change son slug : c'est voulu, la story n'est plus la même.
- Deux titres ont une chance sur environ quatre milliards d'avoir la même empreinte courte, pour un
  même numéro.

## Alternatives

- **Le sha256 complet** : aucun risque de collision, mais des branches et des dossiers de plus de
  soixante-dix caractères. Écarté par le responsable.
- **Une empreinte convertie en chiffres, en quatre groupes** (`us02-76546-8765-76544-87654`) : plus
  long, sans gain. Écarté par le responsable.
