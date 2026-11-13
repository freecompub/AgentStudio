/**
 * Tours d'agent en parallèle : les agents en lecture seule qu'un script appelle ensemble (`Promise.all`,
 * les lentilles d'une revue) tournent en même temps. Le moteur de tâches exécute ses effets un par un :
 * la tâche les regroupe en un seul effet. Un agent qui écrit reste seul dans le sien.
 */
import type { AgentRunResult } from "@agent-studio/extension-api";
import { describe, expect, it } from "vitest";
import type { DeclarationWorkflow } from "../src/protocols.js";
import { fauxContexte, lancer, sortie } from "./faux-contexte.js";

/** Chaque agent attend que l'autre ait commencé : exécutés l'un après l'autre, ils échouent. */
function rendezVous(noms: string[]) {
  const debuts = new Set<string>();
  const ordre: string[] = [];
  const agent = (nom: string) => async (): Promise<AgentRunResult<never>> => {
    debuts.add(nom);
    ordre.push(`début ${nom}`);
    for (let i = 0; i < 100 && noms.some((x) => !debuts.has(x)); i++) await new Promise((r) => setTimeout(r, 5));
    if (noms.some((x) => !debuts.has(x))) throw new Error(`${nom} a attendu seul : les tours ne sont pas parallèles`);
    ordre.push(`fin ${nom}`);
    return sortie({ v: nom });
  };
  return { agent, ordre };
}

describe("tours d'agent en lecture seule, en parallèle", () => {
  it("deux agents en lecture seule appelés ensemble tournent en même temps ; chacun garde son résultat", async () => {
    const r = rendezVous(["juge-a", "juge-b"]);
    const f = fauxContexte({ "juge-a": r.agent("juge-a"), "juge-b": r.agent("juge-b") });
    const decl: DeclarationWorkflow<never> = {
      nom: "revue",
      agentsEnLectureSeule: ["juge-a", "juge-b"],
      script: async (w) => {
        const [a, b] = await Promise.all([w.agent<{ v: string }>("juge-a", "x"), w.agent<{ v: string }>("juge-b", "y")]);
        return [a.sortie?.v, b.sortie?.v];
      },
    };
    const t = await lancer(decl, f.ctx);
    expect((await t.record()).state.fin).toEqual({ statut: "fini", valeur: { clair: ["juge-a", "juge-b"] } });
    expect(r.ordre.slice(0, 2)).toEqual(["début juge-a", "début juge-b"]);
  });

  it("un agent qui écrit n'est pas regroupé : il tourne seul, avant les suivants", async () => {
    const ordre: string[] = [];
    const agent = (nom: string) => async () => (ordre.push(nom), sortie({ v: nom }));
    const f = fauxContexte({ redacteur: agent("redacteur"), juge: agent("juge") });
    const decl: DeclarationWorkflow<never> = {
      nom: "mixte",
      agentsEnLectureSeule: ["juge"],
      script: async (w) => {
        await Promise.all([w.agent("redacteur", "x"), w.agent("juge", "y")]);
        return true;
      },
    };
    const t = await lancer(decl, f.ctx);
    expect((await t.record()).state.fin?.statut).toBe("fini");
    expect(ordre).toEqual(["redacteur", "juge"]);
  });
});
