# SPDX-License-Identifier: GPL-3.0-or-later
"""Porte « RED d'acceptance » de DISTILL (distill.ts, checkAcceptanceRed).

Rouge sur assertion ou symbole manquant : accepté. Autre erreur : rejeté. Test déjà vert :
requalifié en non-régression s'il est justifié dans le plan de test, sinon rejeté.

Entrée : {"plan-de-test": "<chemin de test-plan.md>",
          "resultats": [{"id", "file", "status", "failureKind"?, "message"?}]} (sortie de lancer-tests).
Sortie : {"non-regressions": [identifiants]} ; ko avec les motifs.
"""
import re
from skraft_commun import critere_de, lire_fichier, lire_parametres, rendre


def verifier(plan: str, resultats: list) -> tuple:
    motifs, regressions = [], []
    acceptance = [r for r in resultats if critere_de(r["id"]) is not None]
    if not acceptance:
        if not resultats:
            return ["Aucun test n'a été exécuté : la suite n'a produit aucun résultat."], regressions
        vus = ", ".join(f"« {r['id']} »" for r in resultats[:3])
        return [f"{len(resultats)} test(s) exécuté(s), aucun ne porte de marqueur « ac-<n> » dans son NOM (vus : {vus}…). "
                "Nomme chaque test d'acceptance d'après son critère — par exemple « Ac2_… », « ac_2_… » ou « ac-2 » — "
                "sinon la porte ne peut pas le relier au critère qu'il pilote."], regressions

    def justifie(n: int) -> bool:
        return any(re.search(rf"@ac-{n}(?![0-9])", l) and re.search(r"r[ée]gression", l, re.I) and re.search(r"justification\s*:\s*\S", l, re.I)
                   for l in plan.split("\n"))

    for r in acceptance:
        if r["status"] == "failed":
            if r.get("failureKind") == "other_error":
                motifs.append(f"Le test d'acceptance « {r['id']} » échoue pour une mauvaise raison : {(r.get('message') or '').split(chr(10))[0]}")
            continue
        if r["status"] == "skipped":
            motifs.append(f"Le test d'acceptance « {r['id']} » est ignoré.")
            continue
        n = critere_de(r["id"])
        if n is not None and justifie(n):
            regressions.append(r["id"])
        else:
            critere = f" (critère {n})" if n is not None else ""
            motifs.append(f"Le test d'acceptance « {r['id']} »{critere} passe déjà : requalifiez-le en non-régression avec une "
                          "justification dans test-plan.md, ou faites-le piloter un nouveau comportement.")
    return motifs, regressions


if __name__ == "__main__":
    p = lire_parametres()
    plan = lire_fichier(p["plan-de-test"])
    if plan is None:
        rendre([f"Plan de test absent : {p['plan-de-test']}"])
    motifs, regressions = verifier(plan, p["resultats"])
    rendre(motifs, {"non-regressions": regressions})
