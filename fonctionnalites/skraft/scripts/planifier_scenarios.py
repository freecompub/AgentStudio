# SPDX-License-Identifier: GPL-3.0-or-later
"""Plan des scénarios de DELIVER (deliver.ts, planScenarios ; deliver-effects.ts, planDeliver).

Un scénario par test d'acceptance, dans l'ordre de impl-plan.md (première mention de `ac-<n>`),
puis les critères non cités par numéro croissant. Les non-régressions sont déjà faites.
Refuse de planifier si un test autre qu'un test d'acceptance est rouge.

Entrée : {"plan": "<chemin de impl-plan.md>", "resultats": [...] (lancer-tests),
          "non-regressions": [identifiants], "tests-acceptance": [motifs des tests d'acceptance]}.
Sortie : {"scenarios": [{"id", "ac", "test-acceptance", "role", "statut"}]} ; ko avec les motifs.
"""
import re
from skraft_commun import critere_de, etendre, lire_fichier, lire_parametres, rendre


def planifier(plan: str, tests_acceptance: list, regressions: list) -> list:
    ordre = []
    for m in re.finditer(r"@?(?<![A-Za-z0-9_])ac-([0-9]+)(?![A-Za-z0-9_])", plan, re.I):
        n = int(m.group(1))
        if n not in ordre:
            ordre.append(n)
    rang = lambda n: ordre.index(n) if n in ordre else len(ordre) + n
    tests = sorted(({"id": i, "ac": critere_de(i)} for i in tests_acceptance if critere_de(i) is not None),
                   key=lambda t: (rang(t["ac"]), t["id"].casefold(), t["id"].swapcase()))
    # Départage : approximation de localeCompare (TS), casse ignorée puis minuscules d'abord. La
    # ponctuation peut encore départager autrement : sans effet tant que les tests d'un même
    # critère ne diffèrent que par leurs lettres et leurs chiffres.
    vus, sortie = {}, []
    for t in tests:
        k = vus.get(t["ac"], 0) + 1
        vus[t["ac"]] = k
        regression = t["id"] in regressions
        sortie.append({
            "id": f"ac-{t['ac']}" if k == 1 else f"ac-{t['ac']}#{k}",
            "ac": t["ac"],
            "test-acceptance": t["id"],
            "role": "regression" if regression else "driver",
            "statut": "done" if regression else "pending",
        })
    return sortie


if __name__ == "__main__":
    p = lire_parametres()
    fichiers_acceptance = set(etendre(p.get("tests-acceptance", [])))
    est_acceptance = lambda r: critere_de(r["id"]) is not None or r.get("file") in fichiers_acceptance
    casses = [r["id"] for r in p["resultats"] if r["status"] == "failed" and not est_acceptance(r)]
    if casses:
        rendre([f"La suite est rouge avant DELIVER : {', '.join(casses)}. Corrigez-la avant de relancer."])
    scenarios = planifier(lire_fichier(p["plan"]) or "", [r["id"] for r in p["resultats"] if est_acceptance(r)], p.get("non-regressions", []))
    rendre([], {"scenarios": scenarios})
