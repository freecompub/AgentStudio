import { describe, expect, it } from "vitest";
import { createTaskAgentGuard } from "../src/guards/task-agent-guard.js";

const ROOT = "/projets/demo";
const guard = createTaskAgentGuard({ root: ROOT, writable: ["tests/**"] });

describe("Garde des agents de tâche (périmètre par rôle, §8.4)", () => {
  it("écriture dans le périmètre : autorisée (chemin relatif ou absolu)", async () => {
    expect(await guard.check({ kind: "write", toolName: "edit", path: "tests/a.test.ts" })).toEqual({ decision: "allow" });
    expect(await guard.check({ kind: "write", toolName: "edit", path: "/projets/demo/tests/b.ts" })).toEqual({ decision: "allow" });
  });

  it("écriture hors périmètre : refus avec le périmètre autorisé dans le motif", async () => {
    const r = await guard.check({ kind: "write", toolName: "edit", path: "src/a.ts" });
    expect(r).toEqual({ decision: "deny", reason: expect.stringContaining("tests/**") });
    expect(r).toEqual({ decision: "deny", reason: expect.stringContaining("src/a.ts") });
  });

  it.each(["../x/tests/a.ts", "/tmp/tests/a.ts", "tests/../src/a.ts"])("évasion refusée : %s", async (path) => {
    expect(await guard.check({ kind: "write", toolName: "edit", path })).toMatchObject({ decision: "deny" });
  });

  it("lecture seule (aucun périmètre) : toute écriture refusée", async () => {
    const ro = createTaskAgentGuard({ root: ROOT, writable: [] });
    expect(await ro.check({ kind: "write", toolName: "edit", path: "tests/a.ts" })).toMatchObject({ decision: "deny" });
  });

  it("lecture dans le projet autorisée, hors projet refusée", async () => {
    expect(await guard.check({ kind: "read", toolName: "view", path: "src/a.ts" })).toEqual({ decision: "allow" });
    expect(await guard.check({ kind: "read", toolName: "view", path: "/etc/passwd" })).toMatchObject({ decision: "deny" });
  });

  it("shell, réseau et MCP refusés, sans exception", async () => {
    // Le motif du refus de shell est vérifié à part (ADR 0033) : ici seul le refus compte.
    expect(await guard.check({ kind: "shell", toolName: "bash", command: "npm test" })).toMatchObject({ decision: "deny" });
    expect(await guard.check({ kind: "url", toolName: "fetch", url: "https://x" })).toMatchObject({ decision: "deny" });
    expect(await guard.check({ kind: "mcp", toolName: "x/y" })).toMatchObject({ decision: "deny" });
    expect(await guard.check({ kind: "other", toolName: "memory" })).toMatchObject({ decision: "deny" });
  });

  it("nos outils restent autorisés", async () => {
    expect(await guard.check({ kind: "custom-tool", toolName: "report_phase" })).toEqual({ decision: "allow" });
  });
});

/**
 * Ce qu'un refus de shell répond à l'agent (ADR 0033).
 *
 * Observé dans la trace du 29/09 : le chercheur tentait
 *
 *   ls -la .skraft/us-2/research/ 2>/dev/null && find .skraft -type f
 *
 * — il voulait **lire**. La garde refusait, à juste titre : on ne peut pas décider qu'une commande
 * est inoffensive sans l'analyser, et `ls -la .skraft; rm -rf /` passerait n'importe quelle liste
 * blanche. Mais elle répondait « les tests sont lancés par l'orchestrateur, modifie les fichiers
 * avec les outils d'édition » : une justification qui ne concerne pas ce qu'il faisait, et une
 * consigne qui l'oriente vers l'écriture alors qu'il cherchait à lire.
 *
 * Au run précédent, dix-huit refus successifs n'ont pas suffi à lui faire trouver la sortie.
 */
describe("Refus de shell : dire ce que le rôle PEUT faire", () => {
  const refus = async (outils: string[] = [], writable: string[] = [".skraft/**"]) => {
    const g = createTaskAgentGuard({ root: "/p", writable, outils });
    const d = await g.check({ kind: "shell", toolName: "shell", command: "ls -la" });
    expect(d.decision).toBe("deny");
    return (d as { reason: string }).reason;
  };

  it("refuse toujours : une commande ne peut pas être jugée inoffensive sans être analysée", async () => {
    expect(await refus()).toMatch(/shell est désactivé/i);
  });

  it("nomme la lecture, que l'ancien message passait sous silence", async () => {
    expect(await refus()).toMatch(/lire|lecture/i);
  });

  it("nomme l'écriture ET le périmètre où elle est permise", async () => {
    expect(await refus([], ["docs/adr/**"])).toContain("docs/adr/**");
  });

  it("ne parle de tests que si le rôle a `run_tests` : le chercheur n'en lance aucun", async () => {
    expect(await refus([])).not.toMatch(/test/i);
    expect(await refus(["run_tests"])).toMatch(/run_tests/);
  });

  it("un rôle en lecture seule ne s'entend pas proposer d'écrire", async () => {
    const r = await refus([], []);
    expect(r).toMatch(/lire|lecture/i);
    expect(r).not.toMatch(/outils d'édition/i);
  });
});

/**
 * Casse des chemins dans les gardes (ADR 0035).
 *
 * Windows et macOS ont un système de fichiers insensible à la casse par défaut. Un refus qui
 * compare la casse ne refuse donc rien : il suffit d'une majuscule pour écrire le même fichier.
 */
describe("Les refus ne se contournent pas par une majuscule", () => {
  const g = createTaskAgentGuard({ root: ROOT, writable: ["**"] });

  it("un dossier de workflow est gelé pour tout agent, même à périmètre total, quelle que soit la casse (ADR 0055)", async () => {
    const g = createTaskAgentGuard({ root: "/projets/demo", writable: ["**"] });
    for (const p of [".agent-studio/workflows/skraft/workflow.mjs", ".Agent-Studio/WORKFLOWS/skraft/portes/a.mjs"])
      expect(await g.check({ kind: "write", toolName: "edit", path: p }), p).toMatchObject({ decision: "deny", reason: expect.stringMatching(/workflow/) });
    expect(await g.check({ kind: "write", toolName: "edit", path: ".agent-studio/stack.yaml" })).toEqual({ decision: "allow" });
  });

  it("`.git` reste interdit quelle que soit la casse", async () => {
    for (const p of [".git/config", ".GIT/config", "sous/.Git/HEAD"])
      expect(await g.check({ kind: "write", toolName: "edit", path: p }), p).toMatchObject({ decision: "deny" });
  });

  it("le périmètre d'écriture, lui, reste sensible : ailleurs c'est un autre dossier", async () => {
    // Accorder est l'opération qu'on veut la plus étroite possible ; sur un Linux sensible à la
    // casse, `.SKRAFT/` n'est pas `.skraft/`, et rien ne justifie de l'ouvrir.
    const s = createTaskAgentGuard({ root: ROOT, writable: [".skraft/**"] });
    expect(await s.check({ kind: "write", toolName: "edit", path: ".skraft/a.md" })).toMatchObject({ decision: "allow" });
    expect(await s.check({ kind: "write", toolName: "edit", path: ".SKRAFT/a.md" })).toMatchObject({ decision: "deny" });
  });
});
