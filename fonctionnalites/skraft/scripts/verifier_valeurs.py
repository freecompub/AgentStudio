# SPDX-License-Identifier: GPL-3.0-or-later
"""Porte « valeurs » de DISTILL (distill.ts, checkValues) : chaque littéral d'un critère est recopié
mot pour mot dans son scénario `@ac-<n>` et dans son test d'acceptance (marqueur `ac-<n>`).

Entrée : {"criteres": [{"n", "texte", "litteraux"}], "features": [motifs .feature],
          "tests-acceptance": [motifs des tests d'acceptance]}.
Sortie : {} ; ko avec les motifs.
"""
import re
from skraft_commun import critere_de, etendre, lire_fichier, lire_parametres, normaliser_litteral, rendre, split_js


def scenarios_par_critere(feature: str) -> dict:
    sortie = {}
    for bloc in split_js(r"(?=^\s*@)", feature, re.M):
        tags = re.match(r"\s*(@[^\n]+)", bloc)
        for m in re.finditer(r"@ac-([0-9]+)", tags.group(1) if tags else ""):
            n = int(m.group(1))
            sortie[n] = f"{sortie.get(n, '')}\n{bloc}"
    return sortie


def contient(texte: str, litteral: str) -> bool:
    return normaliser_litteral(litteral) in normaliser_litteral(texte)


def code_contient(code: str, litteral: str) -> bool:
    nombre = re.fullmatch(r"([0-9]+(?:[.,][0-9]+)?)(?:\s?\S+)?", litteral.strip())
    if not nombre or re.search(r"[«\"“]", litteral):
        return contient(code, litteral)
    valeur = nombre.group(1).replace(",", ".", 1)
    return re.search(rf"(?<![0-9.]){valeur.replace('.', '[.,]', 1)}(?![0-9])", code) is not None or contient(code, litteral)


def verifier(criteres: list, features: list, tests: list) -> list:
    motifs = []
    scenarios = {}
    for f in features:
        for n, texte in scenarios_par_critere(f["content"]).items():
            avant = scenarios.get(n)
            scenarios[n] = {"text": (avant["text"] if avant else "") + texte, "path": avant["path"] if avant else f["path"]}
    for c in criteres:
        scenario = scenarios.get(c["n"])
        siens = [t for t in tests if any(critere_de(l) == c["n"] for l in t["content"].split("\n"))]
        if not scenario:
            motifs.append(f"Aucun scénario tagué @ac-{c['n']} pour le critère {c['n']}.")
        if not siens:
            motifs.append(f"Aucun test d'acceptance ne porte le marqueur ac-{c['n']} (critère {c['n']}).")
        for litteral in c["litteraux"]:
            if scenario and not contient(scenario["text"], litteral):
                motifs.append(f"La valeur « {litteral} » du critère {c['n']} n'apparaît pas dans le scénario @ac-{c['n']} ({scenario['path']}).")
            if siens and not any(code_contient(t["content"], litteral) for t in siens):
                motifs.append(f"La valeur « {litteral} » du critère {c['n']} n'apparaît pas dans le test d'acceptance du critère {c['n']} ({', '.join(t['path'] for t in siens)}).")
    return list(dict.fromkeys(motifs))


if __name__ == "__main__":
    p = lire_parametres()
    lus = lambda chemins: [{"path": f, "content": lire_fichier(f) or ""} for f in etendre(chemins)]
    rendre(verifier(p["criteres"], lus(p["features"]), lus(p["tests-acceptance"])))
