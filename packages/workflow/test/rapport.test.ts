/**
 * Rapport d'un run de workflow (ADR 0068, `skraft_rapport`) : tiré de l'état persisté de la tâche,
 * sans rien relancer. Les messages du script (`w.informer`, dont le bilan final), sa fin, ses rejets
 * et ses arbitrages.
 */
import { describe, expect, it } from "vitest";
import { ranger } from "../src/contenus.js";
import type { EtatWorkflow } from "../src/protocols.js";
import { rapportDuWorkflow } from "../src/rapport.js";

function etat(o: Partial<EtatWorkflow> & { informer?: string[] } = {}): EtatWorkflow {
  const contenus: Record<string, string> = {};
  const journal = (o.informer ?? []).map((texte, i) => ({ n: i, appel: "informer" as const, args: ranger({ texte }, contenus), resultat: ranger(null, contenus) }));
  return { script: { nom: "demo", empreinte: "e" }, entree: null, journal: [...journal, ...(o.journal ?? [])], contenus, ...(o.fin ? { fin: o.fin } : {}), ...(o.lastRejection !== undefined ? { lastRejection: o.lastRejection } : {}), ...(o.arbitrages ? { arbitrages: o.arbitrages } : {}) };
}

describe("Rapport d'un run de workflow", () => {
  it("run terminé : la valeur rendue par le script et ses messages, dans l'ordre, y compris un long relu du magasin", () => {
    const long = "bilan ".repeat(500);
    const e = etat({ informer: ["Précontrôle : rien à signaler.", long] });
    e.fin = { statut: "fini", valeur: ranger({ slug: "us-2", niveau: "M" }, e.contenus) };
    expect(rapportDuWorkflow(e)).toEqual({ statut: "fini", valeur: { slug: "us-2", niveau: "M" }, messages: ["Précontrôle : rien à signaler.", long], dernierRejet: null, arbitrages: [] });
  });

  it("run en cours : pas de fin ; le dernier rejet d'une porte est donné", () => {
    const r = rapportDuWorkflow(etat({ informer: ["Lancé."], lastRejection: { gate: "RED", reasons: ["aucun test rouge"] } }));
    expect(r).toEqual({ statut: "en-cours", messages: ["Lancé."], dernierRejet: { gate: "RED", reasons: ["aucun test rouge"] }, arbitrages: [] });
  });

  it("run en échec ou annulé : le motif", () => {
    expect(rapportDuWorkflow(etat({ fin: { statut: "echec", motif: "budget épuisé" } }))).toMatchObject({ statut: "echec", motif: "budget épuisé" });
    expect(rapportDuWorkflow(etat({ fin: { statut: "annule" } }))).toMatchObject({ statut: "annule" });
  });

  it("un message en attente (pas encore exécuté) n'est pas encore dit", () => {
    const e = etat({ informer: ["Dit."] });
    e.journal.push({ n: 9, appel: "informer", args: ranger({ texte: "Pas encore." }, e.contenus) });
    expect(rapportDuWorkflow(e).messages).toEqual(["Dit."]);
  });
});
