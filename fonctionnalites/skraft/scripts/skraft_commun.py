# SPDX-License-Identifier: GPL-3.0-or-later
"""
Analyses de texte communes aux scripts de la fonctionnalité skraft.

Portage en Python, à l'identique, des fonctions pures de l'extension skraft
(extensions/skraft/src/story.ts, text-analysis.ts, adr.ts, distill.ts). Les tests de parité
(extensions/skraft/test/fonctionnalite-generique.test.ts) comparent les deux implémentations.

Écarts de moteur d'expressions régulières, traités explicitement :
- `\\w`, `\\d` et `\\b` de JavaScript ne connaissent que l'ASCII ; ceux de Python, tout Unicode.
  On écrit donc `[A-Za-z0-9_]`, `[0-9]` et des assertions de bord explicites.
- `String.split` de JavaScript ne coupe jamais sur une correspondance vide en position 0.

Contrat d'un script (docs/08 §5.4) : paramètres en JSON sur l'entrée standard, résultat en JSON
sur la sortie standard ; code de retour 0 = ok, 1 = ko (motifs rendus), autre = erreur
d'environnement. Le répertoire courant est la racine du dépôt.
"""
import json
import re
import sys
import unicodedata

W = "A-Za-z0-9_"
AVANT_MOT = f"(?<![{W}])"
APRES_MOT = f"(?![{W}])"


# ── Contrat d'entrée et de sortie ────────────────────────────────────────────────────────────

def lire_parametres() -> dict:
    try:
        donnees = json.load(sys.stdin)
    except json.JSONDecodeError as e:
        erreur(f"Paramètres illisibles (JSON attendu sur l'entrée standard) : {e}")
    if not isinstance(donnees, dict):
        erreur("Paramètres attendus : un objet JSON.")
    return donnees


def rendre(motifs: list, sorties: dict | None = None) -> None:
    """Rend le résultat : ok si aucun motif, ko sinon."""
    json.dump({"motifs": motifs, "sorties": sorties or {}}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    sys.exit(1 if motifs else 0)


def erreur(message: str) -> None:
    """Erreur d'environnement ou d'usage : ni ok ni ko, la plateforme escalade."""
    sys.stderr.write(message + "\n")
    sys.exit(2)


def lire_fichier(chemin: str) -> str | None:
    try:
        with open(chemin, encoding="utf-8", newline="") as f:
            return f.read()
    except FileNotFoundError:
        return None


def etendre(motifs: list) -> list:
    """Fichiers du dépôt qui correspondent à des motifs (`src/**/*.cs`), relatifs, triés, sans doublon."""
    import glob
    import os
    vus = {}
    for motif in motifs:
        for f in glob.glob(motif, recursive=True):
            if os.path.isfile(f):
                vus[f.replace(os.sep, "/")] = True
    return sorted(vus)


def split_js(motif: str, texte: str, drapeaux: int = 0) -> list:
    """`texte.split(/motif/)` de JavaScript pour un motif de largeur nulle."""
    morceaux = re.split(motif, texte, flags=drapeaux)
    if len(morceaux) > 1 and morceaux[0] == "":
        morceaux = morceaux[1:]
    return morceaux


# ── Story (story.ts) ─────────────────────────────────────────────────────────────────────────

ENTETE_STORY = re.compile(r"^#\s+([A-Za-z][A-Za-z0-9_-]*-[0-9]+)\s*[—–-]\s*(.+?)\s*$", re.M)
UNITE = r"(?:\s?(?:%|[A-Za-zµ]{1,4}(?:/[A-Za-z]{1,4})?)(?![A-Za-z0-9_À-ÿ]))?"
NOMBRE = re.compile(r"(?<![A-Za-z0-9_.,])[0-9]+(?:[.,][0-9]+)?" + UNITE)
GUILLEMETS = re.compile(r"«\s*([^»]+?)\s*»|\"([^\"]+)\"|“([^”]+)”")
UNITE_RETENUE = re.compile(r"(%|[A-Zµ][A-Za-z]{0,3}|[a-z]{1,3}(?:/[A-Za-z]{1,4})|mg|ml|mL|kg|g|h|min|s|ms|km|m|cm|mm)")


def section(md: str, titre: re.Pattern) -> str | None:
    lignes = md.split("\n")
    debut = next((i for i, l in enumerate(lignes) if re.match(r"##\s+", l) and titre.search(l)), -1)
    if debut == -1:
        return None
    fin = next((i for i, l in enumerate(lignes) if i > debut and re.match(r"##?\s+", l)), -1)
    return "\n".join(lignes[debut + 1:] if fin == -1 else lignes[debut + 1:fin])


def extraire_litteraux(texte: str) -> list:
    trouves = []

    def masquer(m: re.Match) -> str:
        valeur = m.group(1) or m.group(2) or m.group(3) or ""
        trouves.append((m.start(), re.sub(r"\s+", " ", valeur).strip()))
        return " " * len(m.group(0))

    masque = GUILLEMETS.sub(masquer, texte)
    for m in NOMBRE.finditer(masque):
        valeur = m.group(0).strip()
        unite = re.sub(r"^[0-9]+(?:[.,][0-9]+)?\s?", "", valeur, count=1)
        garder = unite == "" or UNITE_RETENUE.fullmatch(unite) is not None
        trouves.append((m.start(), valeur if garder else re.sub(r"\s?[^0-9]+$", "", valeur, count=1)))
    trouves.sort(key=lambda t: t[0])
    return [v for _, v in trouves]


def normaliser_litteral(s: str) -> str:
    s = re.sub("[   ]", " ", s)
    s = re.sub(r"([0-9]),([0-9])", r"\1.\2", s)
    return re.sub(r"\s+", " ", s).strip()


def slug_de(identifiant: str) -> str:
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", identifiant.lower()))


def lire_story(md: str) -> dict:
    """Champs typés de la story, ou {"erreurs": [...]}."""
    erreurs = []
    h = ENTETE_STORY.search(md)
    if not h:
        erreurs.append("Titre attendu « # <IDENTIFIANT> — <titre> » : identifiant absent (ex. US-12).")
    texte_criteres = section(md, re.compile(r"crit[èe]res d'acceptation", re.I)) or ""
    criteres = []
    for m in re.finditer(r"^\s*([0-9]+)\.\s+(.+)$", texte_criteres, re.M):
        texte = m.group(2).strip()
        criteres.append({"n": int(m.group(1)), "texte": texte, "litteraux": extraire_litteraux(texte)})
    if not criteres:
        erreurs.append("Aucun critère d'acceptation numéroté (section « Critères d'acceptation »).")
    if erreurs:
        return {"erreurs": erreurs}
    apres_titre = md[h.end():]
    enonce = re.split(r"^##\s+", apres_titre, flags=re.M)[0].strip()
    questions = section(md, re.compile(r"questions ouvertes", re.I)) or ""
    ouvertes = [m.group(1).strip() for m in re.finditer(r"^\s*[-*]\s+(.+)$", questions, re.M)]
    return {
        "id": h.group(1),
        "titre": h.group(2),
        "slug": slug_de(h.group(1)),
        "enonce": enonce,
        "criteres": criteres,
        "questions-ouvertes": [q for q in ouvertes if q],
        "brut": md,
    }


# ── Citations et identifiants (text-analysis.ts) ─────────────────────────────────────────────

CHEMIN = re.compile(
    rf"(?<![{W}/.:-])((?:[{W}.-]+/)*[{W}.-]+\.[A-Za-z][A-Za-z0-9]{{0,9}})(?::([0-9]+)(?:-([0-9]+))?)?(?![{W}/])"
)
URL = re.compile(rf"{AVANT_MOT}https?://[^\s)`>\]]+")
PASCAL = re.compile(rf"{AVANT_MOT}[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+{APRES_MOT}")
BLOC_DE_CODE = re.compile(r"```[^\n]*\n([\s\S]*?)```")
PAS_UN_TYPE = {"return", "new", "await", "throw", "yield", "else", "case", "in", "is", "as", "not", "and", "or"}


def citations(md: str) -> dict:
    urls = [re.sub(r"[.,;:]+$", "", m.group(0)) for m in URL.finditer(md)]
    sans_urls = URL.sub(" ", md)
    chemins, vus = [], set()
    for m in CHEMIN.finditer(sans_urls):
        chemin = m.group(1)
        if re.fullmatch(r"[0-9]+(\.[0-9]+)+", chemin):
            continue
        if not re.search(r"[A-Za-z]", chemin.split(".")[-1]):
            continue
        c = {"path": chemin}
        if m.group(2):
            c["start"] = int(m.group(2))
            c["end"] = int(m.group(3) or m.group(2))
        cle = f"{chemin}:{c.get('start', '')}-{c.get('end', '')}"
        if cle in vus:
            continue
        vus.add(cle)
        chemins.append(c)
    return {"paths": chemins, "urls": urls}


def identifiants_du_code(md: str) -> list:
    sortie = {}
    for m in BLOC_DE_CODE.finditer(md):
        for i in PASCAL.findall(m.group(1)):
            sortie[i] = True
    for m in re.finditer(r"`([^`\n]+)`", BLOC_DE_CODE.sub("", md)):
        for i in PASCAL.findall(m.group(1)):
            sortie[i] = True
    return list(sortie)


def identifiants_cites(md: str) -> list:
    sortie = []
    for m in re.finditer(r"`([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+)`", md):
        if m.group(1) not in sortie:
            sortie.append(m.group(1))
    return sortie


def identifiants_declares(md: str) -> list:
    """Noms que les blocs de code d'un contrat déclarent (ADR 0047)."""
    sortie = {}

    def type_precedent(avant: str) -> bool:
        m = re.search(rf"([A-Za-z_][{W}]*)(?:<[^<>]*>)?\??(?:\[\])?\s+\Z", avant)
        return m is not None and m.group(1) not in PAS_UN_TYPE and not re.search(r"\.\s*\Z", avant)

    for bloc in BLOC_DE_CODE.finditer(md):
        code = re.sub(r"/\*[\s\S]*?\*/", "", bloc.group(1))
        code = re.sub(r"//.*$", "", code, flags=re.M)
        for m in re.finditer(rf"{AVANT_MOT}(?:class|struct|record|interface|enum|trait|protocol|type)\s+([A-Z][{W}]*)", code):
            sortie[m.group(1)] = True
        for m in re.finditer(rf"([A-Z][{W}]*)\s*(?:\(|\{{\s*(?:get|set|init){APRES_MOT}|=>)", code):
            if type_precedent(code[:m.start()]):
                sortie[m.group(1)] = True
    return list(sortie)


# ── ADR (adr.ts) ─────────────────────────────────────────────────────────────────────────────

SECTIONS_ADR = ["Contexte", "Décision", "Conséquences", "Alternatives"]
FICHIER_ADR = re.compile(r"docs/adr/adr-[0-9]{3,}-[^/]+\.md")


def id_adr(n: int) -> str:
    return f"ADR-{n:03d}"


def lire_adr(md: str) -> dict:
    h = re.search(r"^#\s+ADR-([0-9]+)\s*[—–-]\s*(.+?)\s*$", md, re.M)
    statut = re.search(r"^-\s*Statut\s*:\s*(\S+)", md, re.M)
    remplace = re.search(r"^-\s*Remplace\s*:\s*(.+)$", md, re.M)
    remplaces = [x for x in re.split(r"[,\s]+", remplace.group(1) if remplace else "") if re.fullmatch(r"ADR-[0-9]+", x)]
    manquantes = [s for s in SECTIONS_ADR if not re.search(rf"^##\s+{s}\s*$", md, re.M)]
    numero = int(h.group(1)) if h else None
    return {
        "numero": numero,
        "id": id_adr(numero) if h else "",
        "titre": h.group(2) if h else "",
        "statut": statut.group(1) if statut else "",
        "remplace": remplaces,
        "manquantes": manquantes,
    }


def lire_remplacements(md: str) -> list:
    return [{"par": m.group(1), "remplace": m.group(2)}
            for m in re.finditer(r"^-\s*(ADR-[0-9]+)\s+remplace\s+(ADR-[0-9]+)\s*$", md, re.M)]


def poser_statut_adr(md: str, statut: str) -> str:
    return re.sub(r"^(-\s*Statut\s*:\s*)\S+", lambda m: m.group(1) + statut, md, count=1, flags=re.M)


# ── Acceptance (distill.ts) ──────────────────────────────────────────────────────────────────

def critere_de(identifiant: str) -> int | None:
    """Numéro de critère porté par un identifiant de test (`ac-2`, `Ac2`, `ac_2`)."""
    m = re.search(r"(?<![A-Za-z0-9])ac[-_]?([0-9]+)(?![0-9])", identifiant, re.I) or re.search(r"(?<=[a-z])Ac([0-9]+)(?![0-9])", identifiant)
    return int(m.group(1)) if m else None


def normaliser_titre(s: str) -> str:
    return re.sub("[̀-ͯ]", "", unicodedata.normalize("NFD", s)).lower().strip()
