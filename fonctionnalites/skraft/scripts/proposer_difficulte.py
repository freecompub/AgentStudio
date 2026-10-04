# SPDX-License-Identifier: GPL-3.0-or-later
"""Niveau de difficulté proposé par la grille (difficulty.ts, gradeDifficulty).

Entrée : {"indicateurs": <sortie de mesurer_indicateurs>, "grille": <reglages.grille>}.
Sortie : {"niveau": "simple" | "medium" | "medium-hard" | "challenging"}.
"""
from skraft_commun import lire_parametres, rendre

p = lire_parametres()
i, g = p["indicateurs"], p["grille"]
if (i["integration-externe"] and i["modules-touches"] >= g["challenging-modules"]) or i["questions-ouvertes"] >= g["challenging-questions"]:
    niveau = "challenging"
elif i["criteres"] > g["hard-criteres"] or i["modules-touches"] >= g["hard-modules"] or i["questions-ouvertes"] >= 1:
    niveau = "medium-hard"
elif i["criteres"] >= g["medium-criteres"] or i["modules-touches"] >= g["medium-modules"]:
    niveau = "medium"
else:
    niveau = "simple"
rendre([], {"niveau": niveau})
