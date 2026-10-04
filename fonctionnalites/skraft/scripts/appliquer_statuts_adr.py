# SPDX-License-Identifier: GPL-3.0-or-later
"""Applique la ratification des ADR (adr.ts, setAdrStatus ; effects.ts, applyAdrStatuses).

Seule la ligne « Statut » change. Si un amendement est demandé, rien n'est écrit : ko, avec la
demande de l'humain comme motif, et la phase DESIGN reprend. Script en écriture, limité à
docs/adr/** par la fonctionnalité.

Entrée : {"ratifications": [{"element": {"id", "path"}, "sortie": {"choix", "commentaire"?}}]}
         (sortie de la primitive pour-chaque sur l'action ratifier-adr).
Sortie : {"modifies": [chemins]}.
"""
from skraft_commun import erreur, lire_fichier, lire_parametres, poser_statut_adr, rendre

STATUTS = {"accepter": "Accepted", "rejeter": "Rejected"}
p = lire_parametres()
ratifications = p["ratifications"]
amendements = [r for r in ratifications if r["sortie"]["choix"] == "demander-un-amendement"]
if amendements:
    rendre([f"{r['element']['id']} : amendement demandé — {r['sortie'].get('commentaire') or 'sans précision'}" for r in amendements])
modifies = []
for r in ratifications:
    statut = STATUTS.get(r["sortie"]["choix"])
    if statut is None:
        erreur(f"Choix inattendu pour {r['element']['id']} : {r['sortie']['choix']}")
    chemin = r["element"]["path"]
    md = lire_fichier(chemin)
    if md is None:
        rendre([f"ADR introuvable : {chemin}"])
    with open(chemin, "w", encoding="utf-8", newline="") as f:
        f.write(poser_statut_adr(md, statut))
    modifies.append(chemin)
rendre([], {"modifies": modifies})
