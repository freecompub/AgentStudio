# SPDX-License-Identifier: GPL-3.0-or-later
"""Lecteur `story-markdown` : découpe la story en champs typés (story.ts, parseStory).

Entrée : {"texte": "<la story>"}. Sortie : les champs de la story ; ko si la story est invalide.
"""
from skraft_commun import lire_parametres, lire_story, rendre, erreur

p = lire_parametres()
if not isinstance(p.get("texte"), str):
    erreur("Paramètre « texte » attendu.")
story = lire_story(p["texte"])
if "erreurs" in story:
    rendre(story["erreurs"])
rendre([], story)
