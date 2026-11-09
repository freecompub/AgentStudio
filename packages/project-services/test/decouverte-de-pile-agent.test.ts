/**
 * L'agent de découverte de pile (ADR 0076), joué par un runtime scripté : lecture seule, sortie par
 * `submit_pile`, question par `report_blocker`. Le prompt décrit le format du profil sans nommer de
 * langage ; chaque demande porte les indices du code, les programmes autorisés et, à l'essai suivant,
 * la proposition refusée et ses motifs.
 */
import { createTaskAgentRunner } from "@agent-studio/core";
import { ScriptedRuntime } from "@agent-studio/core/testing";
import { describe, expect, it } from "vitest";
import { createDecouverteParAgent, PROMPT_DECOUVREUR, ROLE_DECOUVREUR } from "../src/decouverte-de-pile-agent.js";

const PILE = { racine: ".", yaml: "id: x\n" };

function monter(comportement: Parameters<ScriptedRuntime["behave"]>[1]) {
  const runtime = new ScriptedRuntime().behave(ROLE_DECOUVREUR, comportement);
  const agents = createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs: 60_000 });
  const deco = createDecouverteParAgent({
    agents: () => agents,
    programmes: { allowedPrograms: ["pytest", "vitest"], origine: "Liste par défaut." },
    lirePile: async () => ({ error: "non utilisé ici" }),
    modele: async () => "modele-standard",
  });
  return { runtime, deco };
}

describe("createDecouverteParAgent", () => {
  it("la pile soumise par l'agent est rendue ; l'agent est en lecture seule, avec le modèle standard", async () => {
    let prompt = "";
    const { runtime, deco } = monter(async (t) => {
      prompt = t.prompt;
      await t.callTool("submit_pile", { piles: [PILE], justification: "parce que" });
    });
    expect(await deco.decouvrir({ indices: "## Fichiers à la racine\n\n- `pyproject.toml`" })).toEqual({ piles: [PILE], justification: "parce que" });
    expect(prompt).toContain("`pyproject.toml`");
    expect(prompt).toMatch(/Programmes autorisés : pytest, vitest\. Liste par défaut\./);
    expect(prompt).toMatch(/Lanceurs BDD connus : reqnroll, /);
    expect(prompt).toMatch(/- tests : junit-xml, vitest-json, tap/);
    const cfg = [...runtime.configs.values()][0]!;
    expect(cfg.model).toBe("modele-standard");
    // Lecture seule : toute écriture est refusée par la garde.
    expect((await cfg.guard.check({ kind: "write", toolName: "write", path: "/projets/demo/x" })).decision).toBe("deny");
    expect((await cfg.guard.check({ kind: "shell", toolName: "shell", command: "ls" })).decision).toBe("deny");
  });

  it("à l'essai suivant, la proposition refusée et ses motifs sont dans la demande", async () => {
    let prompt = "";
    const { deco } = monter(async (t) => {
      prompt = t.prompt;
      await t.callTool("submit_pile", { piles: [PILE], justification: "corrigé" });
    });
    await deco.decouvrir({ indices: "faits", precedent: { piles: [{ racine: ".", yaml: "id: ancien\n" }], motifs: ["« curl » n'est pas un programme autorisé."] } });
    expect(prompt).toMatch(/refusée[\s\S]*id: ancien[\s\S]*« curl » n'est pas un programme autorisé\./);
  });

  it("le journal dit chaque proposition et les motifs du refus précédent : un essai raté se comprend après coup", async () => {
    const lignes: { msg: string; data: unknown }[] = [];
    const logger = { info: (msg: string, data?: unknown) => void lignes.push({ msg, data }), warn: () => {}, error: () => {}, debug: () => {}, child: () => logger };
    const runtime = new ScriptedRuntime().behave(ROLE_DECOUVREUR, async (t) => void (await t.callTool("submit_pile", { piles: [PILE], justification: "j" })));
    const agents = createTaskAgentRunner({ runtime, root: "/projets/demo", idleMs: 60_000 });
    const deco = createDecouverteParAgent({ agents: () => agents, programmes: { allowedPrograms: [] }, lirePile: async () => ({ error: "" }), logger: logger as never });
    await deco.decouvrir({ indices: "faits", precedent: { piles: [PILE], motifs: ["Canari assertion : classé other_error."] } });
    expect(lignes).toContainEqual({ msg: "pile refusée par le code", data: { motifs: "Canari assertion : classé other_error." } });
    expect(lignes).toContainEqual({ msg: "pile proposée par l'agent", data: { racines: ".", justification: "j" } });
  });

  it("une question de l'agent est rendue avec ses réponses possibles", async () => {
    const { deco } = monter(async (t) => {
      await t.callTool("report_blocker", { question: "Quelle commande ?", choices: ["a", "b"] });
    });
    expect(await deco.decouvrir({ indices: "faits" })).toEqual({ question: "Quelle commande ?", choix: ["a", "b"] });
  });

  it("un runtime en échec : une erreur rendue, pas une exception", async () => {
    const runtime = new ScriptedRuntime();
    runtime.openSession = async () => {
      throw new Error("Non connecté à GitHub.");
    };
    const agents = createTaskAgentRunner({ runtime, root: "/p", idleMs: 1_000 });
    const deco = createDecouverteParAgent({ agents: () => agents, programmes: { allowedPrograms: [] }, lirePile: async () => ({ error: "" }) });
    expect(await deco.decouvrir({ indices: "faits" })).toEqual({ erreur: expect.stringContaining("Non connecté à GitHub.") });
  });

  it("le prompt décrit le format sans nommer de langage ni d'outil de test particulier", () => {
    expect(PROMPT_DECOUVREUR).toMatch(/canaries/);
    expect(PROMPT_DECOUVREUR).toMatch(/\{rapport\}/);
    // Les lanceurs BDD connus viennent des données du code, dans la demande (`LANCEURS_BDD`).
    expect(PROMPT_DECOUVREUR).not.toMatch(/\b(python|pytest|dotnet|java|typescript|vitest|jest|node|cargo|maven|gradle|C#|ruby|php|go|eslint|stryker)\b/i);
  });
});
