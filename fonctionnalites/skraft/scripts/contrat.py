# SPDX-License-Identifier: GPL-3.0-or-later
"""Noms du contrat de conception présents dans le code (ADR 0047 ; deliver-effects.ts, contractSymbolsPresent).

Relevé au moment de la revue, puis comparé après chaque correction : une correction ne doit retirer
aucun nom du contrat ratifié.

Entrée : {"contrat": "<chemin de contracts.md>", "sources": [motifs du code de production],
          "reference": [noms relevés plus tôt]} — sans « reference », relève seulement.
Sortie : {"noms": [noms présents]} ; ko si un nom de la référence a disparu.
"""
import re
from skraft_commun import etendre, identifiants_declares, lire_fichier, lire_parametres, rendre

p = lire_parametres()
contrat = lire_fichier(p["contrat"])
texte = "\n".join(lire_fichier(f) or "" for f in etendre(p["sources"]))
present = lambda nom: re.search(rf"(?<![A-Za-z0-9_]){re.escape(nom)}(?![A-Za-z0-9_])", texte) is not None
noms = [n for n in identifiants_declares(contrat)] if contrat is not None else []
presents = [n for n in noms if present(n)]
disparus = [n for n in p.get("reference", []) if not present(n)]
rendre([f"Le nom « {n} » du contrat ratifié a disparu du code. Une correction ne retire pas un nom du contrat : "
        "si la revue le demande, conteste le défaut." for n in disparus], {"noms": presents})
