/**
 * Phase DESIGN en workflow : modélisation, décisions, porte cohérence, revue à lentilles avec ses
 * fils de défauts (ADR 0046), ratification des ADR. Reproduit le réducteur de skraft ; les écarts
 * du §13 de `docs/09` ne sont pas tranchés ici.
 */
import { matchesAny } from "@agent-studio/extension-api";
import { essayer, Escalade, PanneEnvironnement, TourInterrompu, type Rejet, type W } from "@agent-studio/workflow";
import { parseAdr, setAdrStatus } from "./adr.js";
import { buildBrief, type Dossier } from "./brief.js";
import { checkDesign } from "./design.js";
import { lensesForPhase, type LensName } from "./difficulty.js";
import { SUPERSESSIONS } from "./render-adr-tool.js";
import { lensBrief, latestArtifacts, reviewFacts, type LensFiles, type Livrable } from "./review-brief.js";
import { reviewReport, synthesize, type DefectTarget, type LensVerdict } from "./review.js";
import { agentFeedback, applyArbitration, applyResponses, isActive, lensesAfterThreads, lensHistory, numberDefects, reviewRound, type DefectResponse, type DefectThread } from "./review-thread.js";
import { commitMessage, creerDossiers, GELÉS, sha256 } from "./support.js";

const ADR_FILE = /^docs\/adr\/adr-\d{3,}-[^/]+\.md$/;
const DESIGN_DOCS = ["event-model.md", "domain-model.md", "context-map.md", "contracts.md", "diagrams.md", "consistency-matrix.md"];

/** Ce que la phase accumule ; déclaré hors de `w.phase`, comme l'état du réducteur, il survit à « relancer ». */
interface Suivi {
  revues: { essai: number; lentilles: LensVerdict[] }[];
  fils: DefectThread[];
  livrables: Livrable[];
}

type Sortie = { summary: string; files: string[]; responses?: DefectResponse[] };

export async function concevoir(w: W, d: Dossier, lentilles: readonly LensName[], max: number): Promise<boolean> {
  const suivi: Suivi = { revues: [], fils: [], livrables: [] };
  const faite = await w.phase(
    "DESIGN",
    async (cp) => {
      await essayer(w, { max }, (motifs, essai) => unEssai(w, d, suivi, cp, lensesForPhase(lentilles, "DESIGN"), motifs, essai));
      await statuerAdrs(w, d);
      // Rapports de revue réécrits avant le commit : un rembobinage a pu effacer ceux d'avant.
      for (const r of suivi.revues) await ecrireRapport(w, d.slug, r.essai, r.lentilles);
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
  await architecte(w, d, s, "skraft-architect-model", motifs);
  let retour = motifs;
  for (;;) {
    await architecte(w, d, s, "skraft-architect-decide", retour);
    const porte = await porteCoherence(w, d, s, cp, essai);
    if (porte.length) return porte;
    const revue = await reviser(w, d, s, cp, lentilles, essai);
    if (revue) return revue;
    const amendements = await ratifier(w, d);
    if (!amendements.length) return [];
    retour = amendements;
  }
}

/** Tour d'un architecte ; une question bloquante passe à l'humain, puis il repart sans motif. */
async function architecte(w: W, d: Dossier, s: Suivi, nom: string, motifs: readonly string[]): Promise<void> {
  let retour = motifs;
  for (;;) {
    const r = await w.agent<Sortie>(nom, buildBrief(d, "DESIGN", retour), { lectureSeule: GELÉS });
    if (r.sortie) {
      if (r.sortie.responses?.length) s.fils = applyResponses(s.fils, r.sortie.responses, () => true);
      return;
    }
    const choix = r.blocage.choix.length ? r.blocage.choix : ["Répondre"];
    const rep = await w.humain("blocage", "Question de l'agent (DESIGN)", choix.map((c) => ({ id: c, label: c })), { detail: r.blocage.question });
    d.reponses = [...d.reponses, { question: r.blocage.question, answer: rep.commentaire ? `${rep.decision} (${rep.commentaire})` : rep.decision }];
    retour = [];
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
  for (const f of changes.filter((c) => c.status !== "deleted")) s.livrables.push({ path: f.path, sha256: sha256(await w.lireFichier(f.path)), attempt: essai });
  const connus = new Set(d.adrs.map((a) => a.id));
  for (const a of adrs.filter((x) => x.isNew)) {
    const id = parseAdr(a.md).id;
    if (!connus.has(id)) d.adrs = [...d.adrs, { id, path: a.path, status: "Proposed" }];
  }
  return [];
}

/** Revue à lentilles (§9) ; rend `undefined` si elle approuve, le rejet sinon. */
async function reviser(w: W, d: Dossier, s: Suivi, cp: string, lentilles: LensName[], essai: number): Promise<Rejet | undefined> {
  const tour = s.revues.length + 1;
  const disp = await w.disposition();
  const classer = (f: string): DefectTarget | null =>
    matchesAny([...disp.acceptanceTests, ...disp.unitTests], f) ? "test" : matchesAny(disp.sources, f) ? "code" : f.startsWith(".skraft/") || f.startsWith("docs/") ? "deliverable" : null;
  const fichiers = await fichiersDePhase(w, s, cp, disp);
  const faits = reviewFacts(s.livrables, "DESIGN");
  const contexte = { criteria: d.story.criteria, adrs: d.adrs.filter((a) => a.status === "Accepted") };
  const bruts = await Promise.all(
    lentilles.map(async (l) => {
      const r = await w.agent<LensVerdict>(`skraft-lens-${l}`, lensBrief(l, contexte, "DESIGN", fichiers, faits, lensHistory(s.fils, l)));
      if (!r.sortie) throw new TourInterrompu(`Blocage inattendu : ${r.blocage.question}`);
      return r.sortie;
    }),
  );
  const verdicts = numberDefects(bruts, tour, classer);
  await ecrireRapport(w, d.slug, essai, verdicts);
  const r = reviewRound(s.fils, verdicts, tour);
  s.fils = r.threads;
  s.revues.push({ essai, lentilles: verdicts });

  // Contesté deux fois, maintenu deux fois : l'humain tranche, tous les désaccords à la fois.
  let lenses = r.lenses;
  let parHumain = false;
  if (r.persistent.length) {
    const decisions = await Promise.all(r.persistent.map((t) => arbitrer(w, t)));
    for (const [i, t] of r.persistent.entries()) s.fils = applyArbitration(s.fils, `${decisions[i]}:${t.id}`);
    lenses = lensesAfterThreads(verdicts, s.fils);
    parHumain = s.fils.some((t) => t.status === "humanMaintained");
  }
  const verdict = synthesize(lenses);
  if (verdict === "APPROVED") return undefined;
  if (verdict === "REJECTED") throw new Escalade(["Revue : verdict REJECTED"]);
  const actifs = s.fils.filter(isActive);
  return {
    motifs: actifs.length ? agentFeedback(s.fils, () => true) : [sansDefautCorrigible(lenses)],
    revue: true,
    // Première revue de la phase (ADR 0042), ou défaut maintenu par l'humain (§13, écart 9).
    garanti: s.revues.length === 1 || parHumain,
  };
}

async function arbitrer(w: W, t: DefectThread): Promise<string> {
  const d = await w.humain("arbitrer", `Arbitrer un désaccord de revue (${t.id})`, [
    { id: "accept", label: "Donner raison à l'agent : le défaut tombe" },
    { id: "maintain", label: "Donner raison à la lentille : à corriger" },
  ], {
    detail:
      `Défaut ${t.severity} signalé par la lentille ${t.lens} : ${t.description}${t.file ? ` (${t.file}${t.line ? `:${t.line}` : ""})` : ""}\n` +
      `L'agent le conteste : « ${t.contestation ?? "?"} »\n` +
      `La lentille le maintient${t.ruling ? ` : « ${t.ruling} »` : ""}.`,
  });
  return d.decision;
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

/** Fichiers de la phase depuis son checkpoint : livrables, code, tests (rapports de revue exclus). */
async function fichiersDePhase(w: W, s: Suivi, cp: string, disp: { acceptanceTests: string[]; unitTests: string[]; sources: string[] }): Promise<LensFiles> {
  const changes = (await w.fichiersModifies(cp)).filter((f) => f.status !== "deleted" && !f.path.includes("/reviews/")).map((f) => f.path);
  // Approximation du `isTestFile` de l'adaptateur par ses emplacements déclarés.
  const tests = changes.filter((p) => matchesAny([...disp.acceptanceTests, ...disp.unitTests], p));
  const code = changes.filter((p) => !tests.includes(p) && matchesAny(disp.sources, p));
  const existants = new Set(await w.listerFichiers());
  const derniers = latestArtifacts(s.livrables).map((a) => a.path).filter((p) => existants.has(p));
  return { artifacts: [...new Set([...derniers, ...changes.filter((p) => !tests.includes(p) && !code.includes(p))])], code, tests };
}

async function ecrireRapport(w: W, slug: string, essai: number, lentilles: LensVerdict[]): Promise<void> {
  const base = `.skraft/${slug}/reviews/design-review-${essai}`;
  await w.ecrireFichier(`${base}.json`, JSON.stringify(lentilles, null, 2));
  await w.ecrireFichier(`${base}.md`, reviewReport("DESIGN", essai, lentilles));
}

/** Revue « changements demandés » sans défaut blocker ni major. */
function sansDefautCorrigible(lenses: LensVerdict[]): string {
  const verdicts = lenses.map((l) => `${l.lens} : ${l.verdict}${l.defects.length ? ` (${l.defects.map((x) => x.description).join(" ; ")})` : ""}`);
  return `Revue « changements demandés » sans défaut bloquant ni majeur à corriger. Verdicts : ${verdicts.join(" ; ") || "aucune lentille"}.`;
}
