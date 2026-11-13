/** Appels Git de la reprise d'une story (ADR 0089) : journalisés comme les autres, rejoués sans refaire l'effet. */
import { describe, expect, it } from "vitest";
import type { DeclarationWorkflow } from "../src/protocols.js";
import { fauxContexte, lancer } from "./faux-contexte.js";

describe("tête, historique, retour à un commit, branche recréée", () => {
  it("le script lit la tête et l'historique, revient à un commit, recrée une branche ; chaque effet est fait une fois", async () => {
    const f = fauxContexte();
    const decl: DeclarationWorkflow<never> = {
      nom: "reprise",
      script: async (w) => {
        const base = await w.tete();
        const h = await w.historique();
        const r = await w.revenirA(h[1]!.sha);
        await w.brancher("skraft/us02-x", { depuis: base, ecraser: true });
        // Une question humaine force des rejeux : les appels déjà faits ne sont pas refaits.
        await w.humain("q", "Q ?", [{ id: "ok", label: "OK" }]);
        return { base, sujets: h.map((c) => c.subject), nonSuivis: r.nonSuivis };
      },
    };
    const t = await lancer(decl, f.ctx);
    await t.engine.dispatch(t.id, { type: "HUMAN_DECISION", decision: f.demandes[0]!.options[0]!.id });
    await t.engine.idle(t.id);
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: { base: "h", sujets: ["feat(us02-x): ac-1", "docs(skraft): research de us02-x"], nonSuivis: ["reste.txt"] } } });
    expect(f.appels.filter((a) => a.startsWith("historique") || a.startsWith("revenir") || a.startsWith("branche"))).toEqual(["historique", "revenir:c1", "branche:skraft/us02-x:ecrasee-depuis:h"]);
  });
});
