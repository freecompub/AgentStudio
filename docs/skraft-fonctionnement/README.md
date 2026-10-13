# skraft — fonctionnement détaillé (sources du document)

Sources des PDF `docs/pdf/skraft-fonctionnement-pc.pdf` et `docs/pdf/skraft-fonctionnement-smartphone.pdf`.
Une seule source, deux éditions : PC (A4) et smartphone (90 × 160 mm, tableaux en fiches,
organigrammes plus étroits).

- `skraft.typ` : le texte du document (Typst).
- `gabarit.typ` : mise en page des deux éditions, tableaux adaptatifs, encadrés.
- `diagrammes.mjs` : générateur d'organigrammes SVG (agent, code, humain ; premier passage, rejeu).
- `schemas.mjs` : définition des organigrammes ; écrit `schemas/pc/*.svg` et `schemas/mobile/*.svg`.

## Régénérer

Prérequis : Node 22 et [Typst](https://github.com/typst/typst/releases) (binaire autonome,
non commité). Depuis ce dossier :

```bash
node schemas.mjs
typst compile skraft.typ ../pdf/skraft-fonctionnement-pc.pdf
typst compile --input mobile=oui skraft.typ ../pdf/skraft-fonctionnement-smartphone.pdf
```

Le document décrit l'état du code au commit indiqué en couverture : le mettre à jour quand le
pipeline change.
