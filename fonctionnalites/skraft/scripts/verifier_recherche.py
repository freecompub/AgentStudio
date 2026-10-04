# SPDX-License-Identifier: GPL-3.0-or-later
"""Porte « citations » de RESEARCH (research.ts, checkResearch ; effects.ts, researchGate).

Entrée : {"document": "<chemin de research.md>", "questions-connues": [questions déjà posées]}.
Sortie : {"questions-ouvertes": [nouvelles questions du passage de relais]} ; ko avec les motifs.
"""
import os
import re
from urllib.parse import urlsplit
from skraft_commun import citations, lire_fichier, lire_parametres, normaliser_titre, rendre

SECTIONS = [
    "Périmètre et critères de succès", "Fichiers analysés", "Recherches effectuées", "Conventions du projet",
    "Découvertes", "Approches évaluées", "Recommandation", "Passage de relais",
]


def sections(md: str) -> dict:
    sortie = {}
    for partie in re.split(r"^##\s+(?!#)", md, flags=re.M)[1:]:
        titre, _, reste = partie.partition("\n")
        sortie[normaliser_titre(titre)] = reste.strip()
    return sortie


def questions_ouvertes(md: str) -> list:
    relais = sections(md).get(normaliser_titre("Passage de relais"), "")
    sous = re.search(r"^###\s+Questions ouvertes\s*$([\s\S]*?)(?=^#{2,3}\s|$(?![\s\S]))", relais, re.I | re.M)
    if sous:
        return [q for q in (m.group(1).strip() for m in re.finditer(r"^\s*[-*]\s+(.+)$", sous.group(1), re.M)) if q]
    lignes = [re.sub(r"^\s*[-*]\s+", "", l, count=1).strip() for l in relais.split("\n")]
    return [l for l in lignes if l.endswith("?") and not l.startswith("#")]


def url_bien_formee(u: str) -> bool:
    try:
        r = urlsplit(u)
        r.port
    except ValueError:
        return False
    hote = r.hostname or ""
    return r.scheme in ("http", "https") and ("." in hote or hote == "localhost")


def verifier(md: str, nombre_de_lignes) -> tuple:
    motifs = []
    secs = sections(md)
    for s in SECTIONS:
        if normaliser_titre(s) not in secs:
            motifs.append(f"Section manquante : « {s} ».")
    c = citations(md)
    for cit in c["paths"]:
        chemin = cit["path"]
        if "/" not in chemin or chemin.startswith(".skraft/"):
            continue
        plage = ""
        if "start" in cit:
            plage = f":{cit['start']}" + (f"-{cit['end']}" if cit["end"] != cit["start"] else "")
        cite = f"`{chemin}{plage}`"
        lignes = nombre_de_lignes(chemin)
        if lignes is None:
            motifs.append(f"{cite} : fichier inexistant dans le dépôt.")
            continue
        if "start" not in cit:
            continue
        if cit["end"] < cit["start"]:
            motifs.append(f"{cite} : plage inversée.")
        elif cit["start"] < 1 or cit["end"] > lignes:
            motifs.append(f"{cite} : plage hors du fichier, qui compte {lignes} lignes.")
    for u in c["urls"]:
        if not url_bien_formee(u):
            motifs.append(f"URL mal formée : {u}")
    reco = secs.get(normaliser_titre("Recommandation"))
    if reco is not None:
        elements = len(re.findall(r"^\s*(?:[-*]|[0-9]+\.)\s+\S", reco, re.M))
        if not reco.strip():
            motifs.append("La recommandation est absente.")
        elif elements > 1:
            motifs.append(f"Une seule recommandation est attendue ({elements} trouvées).")
    return motifs, questions_ouvertes(md)


if __name__ == "__main__":
    p = lire_parametres()
    md = lire_fichier(p["document"])
    if md is None:
        rendre([f"Document de recherche absent : {p['document']}"])
    def nombre_de_lignes(chemin: str):
        # Seuls les fichiers du dépôt comptent : un chemin absolu ou qui remonte n'y est jamais.
        if os.path.isabs(chemin) or ".." in chemin.split("/") or not os.path.isfile(chemin):
            return None
        contenu = lire_fichier(chemin) or ""
        return len(re.sub(r"\n\Z", "", contenu, count=1).split("\n"))

    motifs, questions = verifier(md, nombre_de_lignes)
    deja = set(p.get("questions-connues", []))
    rendre(motifs, {"questions-ouvertes": [q for q in questions if q not in deja]})
