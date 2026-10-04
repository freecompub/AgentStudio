# SPDX-License-Identifier: GPL-3.0-or-later
"""Porte « gherkin » de DISTILL (gherkin.ts, checkGherkin) : la partie mécanisable de bdd-methodology.

Entrée : {"features": [motifs des fichiers .feature]}. Sortie : {} ; ko avec les motifs.
"""
import re
from skraft_commun import etendre, lire_fichier, lire_parametres, rendre

AVANT = "(?<![A-Za-zÀ-ÿ0-9])"
APRES = "(?![A-Za-zÀ-ÿ0-9])"
DECLENCHEUR = re.compile(rf"\s*(?:Quand|When){APRES}", re.I)
ASSERTION = re.compile(rf"\s*(?:Alors|Then){APRES}", re.I)
ETAPE = re.compile(rf"\s*(?:Étant donné|Etant donné|Soit|Quand|Alors|Et|Mais|Given|When|Then|And|But){APRES}", re.I)
ETAPES_MAX = 7
FUITES = [
    (re.compile(rf"{AVANT}(?:POST|GET|PUT|DELETE|PATCH|HEAD){APRES}"), lambda t: f"verbe HTTP « {t} »"),
    (re.compile(r"/(?:api|v[0-9]+)/|\s/[a-z][A-Za-z0-9_-]*/[A-Za-z0-9_{}:-]+", re.I), lambda t: f"chemin d'URL « {t.strip()} »"),
    (re.compile(rf"{AVANT}[A-Z][a-zÀ-ÿ0-9]+(?:[A-Z][a-zÀ-ÿ0-9]+)+{APRES}"), lambda t: f"nom de classe « {t} »"),
    (re.compile(rf"{AVANT}(?:bases? de données|database|file d'attente|broker|DTO|schéma SQL|table SQL){APRES}", re.I),
     lambda t: f"vocabulaire d'infrastructure « {t} »"),
]
ASSERTION_VAGUE = re.compile(rf"{AVANT}(?:[çc]a marche|c'est correct|tout est ok|c'est ok|it works|it is correct|everything is fine){APRES}", re.I)
TAG_TECHNIQUE = re.compile(r"@(?:frontend|backend|api|http|ui|infrastructure|database|sql)(?![A-Za-z0-9_])", re.I)


def scenarios(chemin: str, contenu: str) -> list:
    sortie, courant, tags = [], None, ""
    for brute in contenu.split("\n"):
        ligne = re.sub(r"\r$", "", brute)
        if re.match(r"\s*#", ligne):
            continue
        if re.match(r"\s*@", ligne):
            tags = f"{tags} {ligne.strip()}".strip()
            continue
        titre = re.match(r"\s*(?:Scénario|Scenario|Plan du scénario|Scenario Outline)\s*:\s*(.*)$", ligne, re.I)
        if titre:
            if courant:
                sortie.append(courant)
            courant = {"titre": titre.group(1).strip(), "tags": tags, "etapes": []}
            tags = ""
            continue
        if courant and ETAPE.match(ligne):
            courant["etapes"].append(ligne.strip())
    if courant:
        sortie.append(courant)
    return sortie


def verifier(features: list) -> list:
    motifs = []
    for f in features:
        for s in scenarios(f["path"], f["content"]):
            ou = f"{f['path']}, scénario « {s['titre']} »"
            for etape in s["etapes"]:
                for motif, dit in FUITES:
                    m = motif.search(etape)
                    if m:
                        motifs.append(f"{ou} : {dit(m.group(0))} dans « {etape} ». Le Gherkin décrit ce que fait le métier, pas comment le code s'y prend.")
            declencheurs = [e for e in s["etapes"] if DECLENCHEUR.match(e)]
            if len(declencheurs) > 1:
                motifs.append(f"{ou} : {len(declencheurs)} étapes « Quand ». Un seul déclencheur par scénario — deux comportements font deux scénarios.")
            for a in (e for e in s["etapes"] if ASSERTION.match(e) and ASSERTION_VAGUE.search(e)):
                motifs.append(f"{ou} : l'assertion « {a} » ne nomme aucun résultat métier observable.")
            if len(s["etapes"]) > ETAPES_MAX:
                motifs.append(f"{ou} : {len(s['etapes'])} étapes (maximum {ETAPES_MAX}). Un scénario aussi long décrit plusieurs comportements.")
            tag = TAG_TECHNIQUE.search(s["tags"])
            if tag:
                motifs.append(f"{ou} : le tag « {tag.group(0)} » nomme une couche technique. Les tags décrivent un comportement (@happy-path, @error-case).")
    return motifs


if __name__ == "__main__":
    p = lire_parametres()
    rendre(verifier([{"path": f, "content": lire_fichier(f) or ""} for f in etendre(p["features"])]))
