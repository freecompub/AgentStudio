/**
 * Phase DESIGN en workflow : modélisation, décisions, porte cohérence, revue à lentilles (`revue.ts`),
 * ratification des ADR. Reproduit le réducteur de skraft ; les écarts du §13 de `docs/09` ne sont
 * pas tranchés ici.
 */
import { essayer, PanneEnvironnement, type Rejet, type W } from "@agent-studio/workflow";
import { parseAdr, setAdrStatus } from "./adr.js";
import type { Dossier } from "./brief.js";
import { checkDesign } from "./design.js";
import { lensesForPhase, type LensName } from "./difficulty.js";
import { SUPERSESSIONS } from "./render-adr-tool.js";
import { reviewFacts } from "./review-brief.js";
import { ecrireRapport, enregistrerLivrables, nouveauSuivi, reviser, specialiste, type Suivi } from "./revue.js";
import { commitMessage, creerDossiers, sha256 } from "./support.js";

const ADR_FILE = /^docs\/adr\/adr-\d{3,}-[^/]+\.md$/;
const DESIGN_DOCS = ["event-model.md", "domain-model.md", "context-map.md", "contracts.md", "diagrams.md", "consistency-matrix.md"];

export async function concevoir(w: W, d: Dossier, lentilles: readonly LensName[], max: number): Promise<boolean> {
  const suivi = nouveauSuivi();
  const faite = await w.phase(
    "DESIGN",
    async (cp) => {
      await essayer(w, { max }, (motifs, essai) => unEssai(w, d, suivi, cp, lensesForPhase(lentilles, "DESIGN"), motifs, essai));
      await statuerAdrs(w, d);
      for (const r of suivi.revues) await ecrireRapport(w, d.slug, "DESIGN", r.essai, r.lentilles);
      return true;
    },
    { commit: commitMessage("DESIGN", d.slug), apresRembobinage: () => creerDossiers(w, d.slug) },
  );
  return faite === true;
}

/**
 * Un essai : modélisation puis décisions avec les mêmes motifs, porte, revue, ratification. Un
 * amendement ne relance que les décisions et ne consomme pas d'essai (§13, écart 3).
 */
async function unEssai(w: W, d: Dossier, s: Suivi, cp: string, lentilles: LensName[], motifs: readonly string[], essai: number): Promise<Rejet> {
  await specialiste(w, d, s, "DESIGN", "skraft-architect-model", motifs);
  let retour = motifs;
  for (;;) {
    await specialiste(w, d, s, "DESIGN", "skraft-architect-decide", retour);
    const porte = await porteCoherence(w, d, s, cp, essai);
    if (porte.length) return porte;
    const revue = await reviser(w, d, s, cp, "DESIGN", lentilles, essai, reviewFacts(s.livrables, "DESIGN"));
    if (revue) return revue;
    const amendements = await ratifier(w, d);
    if (!amendements.length) return [];
    retour = amendements;
  }
}

/** Porte cohérence (§7.2) : documents et ADR de la phase vérifiés par le code. */
async function porteCoherence(w: W, d: Dossier, s: Suivi, cp: string, essai: number): Promise<string[]> {
  // Document absent : la porte le signale s'il est requis. Une panne, elle, remonte.
  const lire = (p: string) => w.lireFichier(p).catch((e: unknown) => (e instanceof PanneEnvironnement ? Promise.reject(e) : undefined));
  const docs: Record<string, string> = {};
  for (const doc of DESIGN_DOCS) {
    const md = await lire(`.skraft/${d.slug}/design/${doc}`);
    if (md !== undefined) docs[doc] = md;
  }
  const changes = await w.fichiersModifies(cp);
  const ajoutes = new Set(changes.filter((f) => f.status === "added").map((f) => f.path));
  const modifiedExistingAdrs = changes.filter((f) => f.status !== "added" && ADR_FILE.test(f.path)).map((f) => f.path);
  const adrs: { path: string; md: string; isNew: boolean }[] = [];
  for (const path of (await w.listerFichiers()).filter((p) => ADR_FILE.test(p))) adrs.push({ path, md: await w.lireFichier(path), isNew: ajoutes.has(path) });
  const reasons = checkDesign({ docs, adrs, supersessions: (await lire(SUPERSESSIONS)) ?? "", modifiedExistingAdrs });
  if (reasons.length) return reasons;
  await enregistrerLivrables(w, s, changes.filter((c) => c.status !== "deleted").map((c) => c.path), essai, sha256);
  const connus = new Set(d.adrs.map((a) => a.id));
  for (const a of adrs.filter((x) => x.isNew)) {
    const id = parseAdr(a.md).id;
    if (!connus.has(id)) d.adrs = [...d.adrs, { id, path: a.path, status: "Proposed" }];
  }
  return [];
}

/** Ratification de tous les ADR proposés, à la fois ; rend les amendements demandés. */
async function ratifier(w: W, d: Dossier): Promise<string[]> {
  const proposes = d.adrs.filter((a) => a.status === "Proposed");
  const decisions = await Promise.all(
    proposes.map((a) =>
      w.humain("ratifier-adr", `Ratifier ${a.id}`, [
        { id: "accept", label: "Accepter" },
        { id: "reject", label: "Rejeter" },
        { id: "amend", label: "Demander un amendement" },
      ], { detail: `Décision d'architecture proposée : ${a.path}` }),
    ),
  );
  const amendements: string[] = [];
  for (const [i, a] of proposes.entries()) {
    const dec = decisions[i]!;
    if (dec.decision === "amend") amendements.push(`Amendement demandé sur ${a.id} : ${dec.commentaire ?? "(sans précision)"}`);
    else d.adrs = d.adrs.map((x) => (x.id === a.id ? { ...x, status: dec.decision === "accept" ? "Accepted" : "Rejected" } : x));
  }
  return amendements;
}

/** Statuts basculés dans les fichiers par le code, une fois tous les ADR décidés. */
async function statuerAdrs(w: W, d: Dossier): Promise<void> {
  for (const a of d.adrs.filter((x) => x.status !== "Proposed")) await w.ecrireFichier(a.path, setAdrStatus(await w.lireFichier(a.path), a.status as "Accepted" | "Rejected"));
}

