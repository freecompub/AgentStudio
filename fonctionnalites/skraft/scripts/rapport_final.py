# SPDX-License-Identifier: GPL-3.0-or-later
"""Rapport de fin de tâche (effects.ts, finalReport). Lecture seule : rend le texte, la plateforme l'affiche.

Entrée : {"story": "US-2", "branche", "difficulte", "confirmee": bool, "phases": [...], "sautees": [...],
          "adr": [{"id", "statut"}], "revues-rejetees": n, "reessais": {"PHASE": n}}.
Sortie : {"texte": "<markdown>"}.
"""
from skraft_commun import lire_parametres, rendre

p = lire_parametres()
liste = lambda xs, vide: ", ".join(xs) or vide
reessais = liste([f"{ph} {n}" for ph, n in p.get("reessais", {}).items()], "aucun")
rendre([], {"texte": "\n".join([
    f"Pipeline skraft terminé pour **{p['story']}** (branche {p['branche']}).",
    f"Difficulté : {p['difficulte']} ({'confirmée' if p['confirmee'] else 'automatique'}).",
    f"Phases exécutées : {liste(p.get('phases', []), 'aucune')} ; sautées : {liste(p.get('sautees', []), 'aucune')}.",
    f"ADR : {liste([a['id'] + ' (' + a['statut'] + ')' for a in p.get('adr', [])], 'aucun')}. Revues demandant des changements : {p.get('revues-rejetees', 0)}.",
    f"Réessais par phase : {reessais}.",
])})
