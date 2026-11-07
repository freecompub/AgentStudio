// Gabarit commun : une seule source, deux formats (PC, smartphone), choisis par --input mobile=oui.
#let mobile = sys.inputs.at("mobile", default: "non") == "oui"

#let bleu = rgb("#2f6fd6")
#let encre = rgb("#13213a")

#let reglages(corps) = {
  set document(title: "skraft — fonctionnement détaillé", author: "AgentStudio")
  set page(
    ..if mobile { (width: 90mm, height: 160mm, margin: (x: 5mm, top: 6mm, bottom: 9mm)) } else { (paper: "a4", margin: (x: 18mm, top: 18mm, bottom: 20mm)) },
    numbering: "1 / 1",
    number-align: center,
  )
  set text(font: "Roboto", lang: "fr", size: if mobile { 9.4pt } else { 10.5pt }, hyphenate: true)
  set par(justify: not mobile, leading: 0.62em, spacing: 0.95em)
  set heading(numbering: "1.1")
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    set text(size: if mobile { 15pt } else { 19pt }, fill: encre, weight: 700)
    block(below: 0.9em, stroke: (bottom: 1.5pt + bleu), inset: (bottom: 4pt), width: 100%, it)
  }
  show heading.where(level: 2): it => { set text(size: if mobile { 11.5pt } else { 13pt }, fill: rgb("#1f3d73")); block(above: 1.3em, below: 0.7em, it) }
  show heading.where(level: 3): it => { set text(size: if mobile { 10.2pt } else { 11pt }, fill: rgb("#1f3d73")); block(above: 1.1em, below: 0.6em, it) }
  show raw.where(block: false): it => box(fill: rgb("#f0f2f6"), inset: (x: 2pt), outset: (y: 2pt), radius: 2pt, text(font: "DejaVu Sans Mono", size: 0.9em, it))
  show raw.where(block: true): it => block(fill: rgb("#f0f2f6"), inset: 6pt, radius: 3pt, width: 100%, text(font: "DejaVu Sans Mono", size: if mobile { 7.6pt } else { 8.6pt }, it))
  show table: set par(justify: false)
  set list(indent: 0.4em, body-indent: 0.45em)
  set enum(indent: 0.4em, body-indent: 0.45em)
  corps
}

// Tableau sur PC, fiches empilées sur smartphone (l'en-tête devient l'étiquette de chaque champ).
#let tableau(entetes, ..lignes, largeurs: auto) = {
  let lignes = lignes.pos()
  if mobile {
    for l in lignes {
      block(width: 100%, stroke: 0.6pt + rgb("#c9d1dc"), radius: 3pt, inset: 5pt, below: 5pt, breakable: true, {
        for (i, c) in l.enumerate() {
          if i == 0 { block(below: 3pt, text(weight: 700, fill: encre, c)) } else {
            block(below: 3pt, [#text(weight: 600, fill: rgb("#1f3d73"), entetes.at(i)) : #c])
          }
        }
      })
    }
  } else {
    table(
      columns: if largeurs == auto { entetes.len() } else { largeurs },
      stroke: 0.5pt + rgb("#c9d1dc"),
      inset: 5pt,
      fill: (_, y) => if y == 0 { rgb("#eef2f8") },
      table.header(..entetes.map(e => text(weight: 700, e))),
      ..lignes.flatten(),
    )
  }
}

#let encadre(titre: none, couleur: bleu, fond: rgb("#f2f6fd"), corps) = block(
  width: 100%, fill: fond, stroke: (left: 3pt + couleur), inset: 7pt, radius: (right: 3pt), breakable: true,
  { if titre != none { text(weight: 700, fill: couleur, titre); linebreak() }; corps },
)
#let attention(titre: none, corps) = encadre(titre: titre, couleur: rgb("#d9822b"), fond: rgb("#fdf6ec"), corps)
#let bloquant(titre: none, corps) = encadre(titre: titre, couleur: rgb("#b5442c"), fond: rgb("#fbefec"), corps)

// Organigramme : pleine largeur, mais jamais plus haut que la page (il serait coupé) ; trop haut, il
// est réduit à la hauteur disponible.
#let schema(chemin, largeur: none) = context {
  let w = if largeur != none { largeur } else if mobile { 80mm } else { 150mm }
  let hmax = if mobile { 112mm } else { 215mm }
  let im = image(chemin, width: w)
  let h = measure(im).height
  align(center, block(above: 0.6em, below: 0.9em, if h > hmax { image(chemin, height: hmax) } else { im }))
}

// Étiquettes d'exécutant, en ligne.
#let pastille(t, c) = box(fill: c.lighten(80%), stroke: 0.6pt + c, inset: (x: 3pt, y: 1.5pt), radius: 2pt, text(size: 0.78em, weight: 700, fill: c, t))
#let AGENT = pastille("AGENT", rgb("#2f6fd6"))
#let CODE = pastille("CODE", rgb("#2e8b42"))
#let HUMAIN = pastille("HUMAIN", rgb("#d9822b"))
