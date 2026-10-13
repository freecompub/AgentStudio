// Organigrammes SVG verticaux, lisibles sur PC comme sur smartphone (largeur fixe, mise à l'échelle).
// Types de nœud : agent (LLM), code (porte ou calcul du code), humain (décision), etat (stade),
// donnee (fichier ou information transmise).

const COULEURS = {
  agent: { fond: "#e3eefc", bord: "#2f6fd6", etiquette: "AGENT" },
  code: { fond: "#e4f5e6", bord: "#2e8b42", etiquette: "CODE" },
  humain: { fond: "#fdf0dc", bord: "#d9822b", etiquette: "HUMAIN" },
  etat: { fond: "#eceff3", bord: "#6b7684", etiquette: "ÉTAT" },
  donnee: { fond: "#f6effc", bord: "#8a4fc7", etiquette: "DONNÉE" },
};

const echapper = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Découpe un texte en lignes d'au plus `max` caractères, sur les espaces. */
function lignes(texte, max) {
  const mots = String(texte).split(/\s+/);
  const res = [];
  let cour = "";
  for (const m of mots) {
    if ((cour + " " + m).trim().length > max && cour) {
      res.push(cour);
      cour = m;
    } else cour = (cour + " " + m).trim();
  }
  if (cour) res.push(cour);
  return res;
}

/**
 * Organigramme vertical.
 * etapes : [{ id, type, titre, detail? }] dans l'ordre du premier passage.
 * boucles : [{ de, vers, libelle }] flèches de retour (rejeu), dessinées à droite.
 * sorties : [{ de, type, titre }] issues latérales (escalade, attente), dessinées à droite.
 */
export function organigramme({ etapes, boucles = [], sorties = [], titre }, { compact = false } = {}) {
  // Compact (smartphone) : nœuds plus étroits, texte replié plus court, image moins large, donc
  // moins réduite à l'impression.
  const L = compact ? 250 : 300; // largeur d'un nœud
  const X = compact ? 8 : 24; // marge gauche
  const LS = compact ? 128 : 230; // largeur d'une sortie latérale
  const C = compact ? { titre: 27, detail: 35, sortie: 17, boucle: 12 } : { titre: 34, detail: 44, sortie: 26, boucle: 22 };
  const largeur = compact ? X + L + 34 + LS + 6 : 640;
  const pas = 26; // espace vertical entre nœuds
  const positions = new Map();
  // Titre replié s'il dépasse la largeur (édition smartphone).
  const lignesTitre = titre ? lignes(titre, compact ? 36 : 70) : [];
  let y = titre ? 20 + lignesTitre.length * 20 : 16;
  const morceaux = [];
  lignesTitre.forEach((l, i) => morceaux.push(`<text x="${X}" y="${24 + i * 20}" font-family="Roboto" font-weight="700" font-size="16" fill="#13213a">${echapper(l)}</text>`));
  for (const e of etapes) {
    const c = COULEURS[e.type];
    const t = lignes(e.titre, C.titre);
    const d = e.detail ? lignes(e.detail, C.detail) : [];
    const h = 22 + t.length * 16 + d.length * 13 + 8;
    positions.set(e.id, { y, h });
    const rx = e.type === "humain" ? 16 : e.type === "etat" ? 18 : 6;
    morceaux.push(`<rect x="${X}" y="${y}" width="${L}" height="${h}" rx="${rx}" fill="${c.fond}" stroke="${c.bord}" stroke-width="1.6"/>`);
    morceaux.push(`<text x="${X + 8}" y="${y + 13}" font-family="Roboto" font-weight="700" font-size="9" letter-spacing="0.6" fill="${c.bord}">${c.etiquette}</text>`);
    t.forEach((l, i) => morceaux.push(`<text x="${X + 8}" y="${y + 30 + i * 16}" font-family="Roboto" font-weight="600" font-size="13" fill="#1d2430">${echapper(l)}</text>`));
    d.forEach((l, i) => morceaux.push(`<text x="${X + 8}" y="${y + 30 + t.length * 16 + i * 13}" font-family="Roboto" font-size="11" fill="#46505e">${echapper(l)}</text>`));
    y += h + pas;
  }
  // Flèches principales (premier passage).
  for (let i = 0; i + 1 < etapes.length; i++) {
    const a = positions.get(etapes[i].id);
    const b = positions.get(etapes[i + 1].id);
    const xm = X + L / 2;
    morceaux.push(`<line x1="${xm}" y1="${a.y + a.h}" x2="${xm}" y2="${b.y - 3}" stroke="#3a4250" stroke-width="1.6" marker-end="url(#pointe)"/>`);
  }
  // Sorties latérales.
  let xs = X + L + 18;
  sorties.forEach((s) => {
    const a = positions.get(s.de);
    const c = COULEURS[s.type];
    const t = lignes(s.titre, C.sortie);
    const h = 20 + t.length * 14;
    const ys = a.y + Math.max(0, (a.h - h) / 2);
    const xb = largeur - (compact ? 6 : 16) - LS;
    morceaux.push(`<line x1="${X + L}" y1="${a.y + a.h / 2}" x2="${xb - 3}" y2="${ys + h / 2}" stroke="#b5442c" stroke-width="1.3" stroke-dasharray="4 3" fill="none" marker-end="url(#pointe-rouge)"/>`);
    morceaux.push(`<rect x="${xb}" y="${ys}" width="${LS}" height="${h}" rx="10" fill="${c.fond}" stroke="${c.bord}" stroke-width="1.4" stroke-dasharray="5 3"/>`);
    t.forEach((l, i) => morceaux.push(`<text x="${xb + 8}" y="${ys + 16 + i * 14}" font-family="Roboto" font-weight="600" font-size="11.5" fill="#8a2f1c">${echapper(l)}</text>`));
  });
  // Boucles de rejeu, à droite des nœuds, décalées pour ne pas se chevaucher.
  // Libellés des boucles qui reviennent au même nœud : empilés, pas superposés.
  const lignesDejaEcrites = new Map();
  boucles.forEach((b, k) => {
    const de = positions.get(b.de);
    const vers = positions.get(b.vers);
    const xb = X + L + 10 + k * 12;
    const y1 = de.y + de.h / 2 + 8;
    const y2 = vers.y + 10;
    morceaux.push(`<path d="M ${X + L} ${y1} H ${xb} V ${y2} H ${X + L + 3}" stroke="#8a4fc7" stroke-width="1.4" fill="none" marker-end="url(#pointe-boucle)"/>`);
    const tl = lignes(b.libelle, C.boucle);
    const deja = lignesDejaEcrites.get(b.vers) ?? 0;
    lignesDejaEcrites.set(b.vers, deja + tl.length + 0.4);
    // À droite de tous les couloirs de boucles : aucune ligne verticale ne traverse un libellé.
    const xl = X + L + 10 + (boucles.length - 1) * 12 + 5;
    tl.forEach((l, i) => morceaux.push(`<text x="${xl}" y="${y2 + 13 + (deja + i) * 12}" font-family="Roboto" font-style="italic" font-size="10.5" fill="#6b3aa3">${echapper(l)}</text>`));
  });
  const hauteur = y + 4;
  return `<svg viewBox="0 0 ${largeur} ${hauteur}" xmlns="http://www.w3.org/2000/svg" role="img">
<defs>
<marker id="pointe" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#3a4250"/></marker>
<marker id="pointe-rouge" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#b5442c"/></marker>
<marker id="pointe-boucle" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8a4fc7"/></marker>
</defs>
${morceaux.join("\n")}
</svg>`;
}

/** Légende des couleurs, à placer une fois en tête de document. */
export function legende() {
  const items = ["agent", "code", "humain", "etat", "donnee"];
  const libelles = { agent: "exécuté par un agent (LLM)", code: "exécuté par le code", humain: "décision humaine", etat: "stade ou point de passage", donnee: "donnée transmise" };
  const h = items.length * 26 + 50;
  const parts = items.map((k, i) => {
    const c = COULEURS[k];
    const y = 10 + i * 26;
    return `<rect x="10" y="${y}" width="70" height="20" rx="4" fill="${c.fond}" stroke="${c.bord}" stroke-width="1.4"/><text x="16" y="${y + 14}" font-family="Roboto" font-weight="700" font-size="9" letter-spacing="0.6" fill="${c.bord}">${c.etiquette}</text><text x="92" y="${y + 15}" font-family="Roboto" font-weight="600" font-size="13" fill="#1d2430">${libelles[k]}</text>`;
  });
  const y0 = 10 + items.length * 26;
  parts.push(`<line x1="10" y1="${y0 + 8}" x2="70" y2="${y0 + 8}" stroke="#3a4250" stroke-width="1.6" marker-end="url(#lp)"/><text x="92" y="${y0 + 12}" font-family="Roboto" font-weight="600" font-size="13" fill="#1d2430">premier passage</text>`);
  parts.push(`<path d="M 10 ${y0 + 28} H 70" stroke="#8a4fc7" stroke-width="1.4" fill="none" marker-end="url(#lb)"/><text x="92" y="${y0 + 32}" font-family="Roboto" font-weight="600" font-size="13" fill="#1d2430">rejeu (retour en arrière)</text>`);
  return `<svg viewBox="0 0 420 ${h + 6}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="lp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#3a4250"/></marker><marker id="lb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#8a4fc7"/></marker></defs>${parts.join("")}</svg>`;
}
