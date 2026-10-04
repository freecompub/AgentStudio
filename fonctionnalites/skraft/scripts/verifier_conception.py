# SPDX-License-Identifier: GPL-3.0-or-later
"""Porte « cohérence » de DESIGN (design.ts, checkDesign ; effects.ts, designGate).

Entrée : {"dossier": ".skraft/<slug>/design",
          "adr-existants": [ADR présents au début de la phase],
          "adr-modifies": [ADR existants modifiés depuis]} — facultatif : la règle « creation-seule »
          de la session l'empêche déjà ; le paramètre garde la parité avec la porte actuelle.
Sortie : {"adr-nouveaux": [{"id", "path"}]} ; ko avec les motifs.
"""
import re
from skraft_commun import (FICHIER_ADR, etendre, id_adr, identifiants_cites, identifiants_du_code, lire_adr, lire_fichier,
                           lire_parametres, lire_remplacements, rendre)

DOCS_DU_MODELE = ["event-model.md", "domain-model.md"]
DOCS_QUI_CITENT = ["contracts.md", "diagrams.md"]
DOCS = ["event-model.md", "domain-model.md", "context-map.md", "contracts.md", "diagrams.md", "consistency-matrix.md"]
REMPLACEMENTS = "docs/adr/supersessions.md"


def verifier(docs: dict, adrs: list, remplacements: str, adr_existants_modifies: list) -> list:
    motifs = []
    if "event-model.md" not in docs:
        motifs.append("Document de conception manquant : event-model.md.")
    connus = {i for d in DOCS_DU_MODELE for i in identifiants_du_code(docs.get(d, ""))}
    for doc in DOCS_QUI_CITENT:
        for i in identifiants_cites(docs.get(doc, "")):
            if i not in connus:
                motifs.append(f"`{i}` cité dans {doc} n'existe pas dans {' ni dans '.join(DOCS_DU_MODELE)}.")
    for p in adr_existants_modifies:
        motifs.append(f"ADR existant modifié : {p} (les ADR sont append-only ; en rédiger un nouveau qui le remplace).")

    lus = [dict(a, adr=lire_adr(a["md"])) for a in adrs]
    for a in (x for x in lus if x["nouveau"]):
        if not a["adr"]["id"]:
            motifs.append(f"{a['path']} : titre « # ADR-NNN — titre » absent.")
        for m in a["adr"]["manquantes"]:
            motifs.append(f"{a['path']} : section manquante « {m} ».")
        if a["adr"]["statut"] and a["adr"]["statut"] != "Proposed":
            motifs.append(f"{a['path']} : statut {a['adr']['statut']}, Proposed attendu.")
        suffixe = re.search(r"-(rejected|accepted|deprecated|superseded|rejete|rejeté|accepte|accepté)\.md$", a["path"], re.I)
        if suffixe:
            motifs.append(f"{a['path']} : le nom de fichier porte un verdict (« {suffixe.group(1)} »). "
                          "Il doit nommer le sujet ; le verdict appartient au champ « Statut ».")
        if re.match(r"\s*(?:ne pas |éviter |eviter |toujours |jamais |avoid |always |never |no(?:t)? )", a["adr"]["titre"], re.I):
            motifs.append(f"{a['path']} : « {a['adr']['titre']} » énonce une bonne pratique, pas une décision entre options. "
                          "Un ADR arbitre un choix ; une règle de ce genre relève d'une convention ou du linter.")

    numeros = sorted(a["adr"]["numero"] for a in lus if a["adr"]["numero"] is not None)
    vus = set()
    for n in numeros:
        if n in vus:
            motifs.append(f"Numérotation des ADR : {id_adr(n)} en double.")
        vus.add(n)
    deja_la = [a["adr"]["numero"] for a in lus if not a["nouveau"] and a["adr"]["numero"] is not None]
    depuis = (max(deja_la) if deja_la else 0) + 1
    for n in range(depuis, (numeros[-1] if numeros else 0) + 1):
        if n not in vus:
            motifs.append(f"Numérotation des ADR : {id_adr(n)} manque.")

    registre = lire_remplacements(remplacements)
    for a in (x for x in lus if x["nouveau"]):
        for remplace in a["adr"]["remplace"]:
            if not any(r["par"] == a["adr"]["id"] and r["remplace"] == remplace for r in registre):
                motifs.append(f"{a['adr']['id']} remplace {remplace} mais le registre supersessions.md ne le mentionne pas.")
    for r in registre:
        par = next((a for a in lus if a["adr"]["id"] == r["par"]), None)
        if not par or r["remplace"] not in par["adr"]["remplace"]:
            motifs.append(f"supersessions.md indique qu'{r['par']} remplace {r['remplace']}, mais {r['par']} ne le déclare pas.")
    return motifs


if __name__ == "__main__":
    p = lire_parametres()
    docs = {}
    for d in DOCS:
        contenu = lire_fichier(f"{p['dossier']}/{d}")
        if contenu is not None:
            docs[d] = contenu
    existants = set(p["adr-existants"])
    modifies = p.get("adr-modifies", [])
    adrs = [{"path": f, "md": lire_fichier(f) or "", "nouveau": f not in existants} for f in etendre(["docs/adr/adr-*.md"]) if FICHIER_ADR.fullmatch(f)]
    motifs = verifier(docs, adrs, lire_fichier(REMPLACEMENTS) or "", modifies)
    rendre(motifs, {"adr-nouveaux": [{"id": lire_adr(a["md"])["id"], "path": a["path"]} for a in adrs if a["nouveau"]]})
