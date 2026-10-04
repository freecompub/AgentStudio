# SPDX-License-Identifier: GPL-3.0-or-later
"""Indicateurs de difficulté (difficulty.ts, computeIndicators ; effects.ts, repositoryShape).

Entrée : {"story": <champs de la story>, "fichiers": [chemins du dépôt]}.
Sortie : {"criteres", "modules-touches", "integration-externe", "questions-ouvertes"}.
"""
import re
from skraft_commun import lire_parametres, rendre, AVANT_MOT, APRES_MOT

EXTERNE = re.compile(
    rf"{AVANT_MOT}(API|REST|GraphQL|webhook|base de données|SQL|file de messages|Kafka|RabbitMQ|service externe|FHIR|HL7|SMTP|S3){APRES_MOT}",
    re.I,
)


def forme_du_depot(fichiers: list) -> dict:
    modules: dict = {}
    for f in fichiers:
        m = re.match(r"(?:Sources|src|packages)/([^/]+)/", f)
        if not m:
            continue
        mots = modules.setdefault(m.group(1), {})
        base = re.sub(r"\.[^.]+$", "", f.split("/")[-1], count=1)
        for w in re.split(r"(?=[A-Z])|[-_]", base):
            if len(w) > 3:
                mots[w.lower()] = True
    return {"modules": list(modules), "mots": {k: list(v) for k, v in modules.items()}}


p = lire_parametres()
story, fichiers = p["story"], p["fichiers"]
textes_criteres = "\n".join(c["texte"] for c in story["criteres"])
texte = f"{story['titre']}\n{story['enonce']}\n{textes_criteres}".lower()
depot = forme_du_depot(fichiers)
touches = [m for m in depot["modules"] if m.lower() in texte or any(k.lower() in texte for k in depot["mots"].get(m, []))]
externe = EXTERNE.search(f"{story['enonce']}\n{textes_criteres}")
cite_dans_le_code = externe is not None and any(externe.group(1).lower() in f.lower() for f in fichiers)
rendre([], {
    "criteres": len(story["criteres"]),
    "modules-touches": len(touches),
    "integration-externe": externe is not None and not cite_dans_le_code,
    "questions-ouvertes": len(story["questions-ouvertes"]),
})
