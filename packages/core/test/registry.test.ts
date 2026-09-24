import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/registry/registry.js";
import { routeIntent } from "../src/registry/intent-router.js";

const cmd = (extensionId: string, name: string) => ({
  extensionId,
  name,
  title: `Titre ${name}`,
  description: `Décrit ${name}`,
  handler: async () => {},
});

describe("Registre des capacités (D12)", () => {
  it("adresse une commande par nom complet et par alias court sans collision", () => {
    const r = createRegistry();
    r.addCommand(cmd("diabeo.tdd", "tdd"));
    expect(r.command("diabeo.tdd/tdd")?.name).toBe("tdd");
    expect(r.command("tdd")?.extensionId).toBe("diabeo.tdd");
  });

  it("en cas de collision, l'alias court devient ambigu : seul le nom complet fonctionne", () => {
    const r = createRegistry();
    r.addCommand(cmd("a.x", "build"));
    r.addCommand(cmd("b.y", "build"));
    expect(r.command("build")).toBeUndefined();
    expect(r.command("a.x/build")?.extensionId).toBe("a.x");
    expect(r.command("b.y/build")?.extensionId).toBe("b.y");
  });

  it("refuse un doublon exact et une commande sans titre ni description (D5)", () => {
    const r = createRegistry();
    r.addCommand(cmd("a.x", "build"));
    expect(() => r.addCommand(cmd("a.x", "build"))).toThrow(/déjà enregistrée/);
    expect(() => r.addCommand({ ...cmd("a.x", "vide"), title: "" })).toThrow(/titre/);
  });

  it("liste les commandes pour l'autocomplétion, avec leur alias utilisable", () => {
    const r = createRegistry();
    r.addCommand(cmd("diabeo.tdd", "tdd"));
    r.addCommand(cmd("a.x", "build"));
    r.addCommand(cmd("b.y", "build"));
    expect(r.commands().map((c) => c.invocation).sort()).toEqual(["a.x/build", "b.y/build", "tdd"]);
  });

  it("agents : même adressage, retrait par extension", () => {
    const r = createRegistry();
    r.addAgent({ extensionId: "diabeo.tdd", name: "tdd-test", systemPrompt: "p", writable: ["tests/**"], output: "report_phase" });
    expect(r.agent("diabeo.tdd/tdd-test")?.writable).toEqual(["tests/**"]);
    r.addCommand(cmd("diabeo.tdd", "tdd"));
    r.removeExtension("diabeo.tdd");
    expect(r.agent("tdd-test")).toBeUndefined();
    expect(r.command("tdd")).toBeUndefined();
  });
});

describe("Routeur d'intention", () => {
  const r = createRegistry();
  r.addCommand(cmd("diabeo.tdd", "tdd"));

  it("/commande arguments → commande", () => {
    expect(routeIntent(r, "/tdd Plafonner le bolus")).toEqual({ kind: "command", command: r.command("tdd"), args: "Plafonner le bolus" });
    expect(routeIntent(r, "  /diabeo.tdd/tdd  x ")).toMatchObject({ kind: "command", args: "x" });
  });

  it("commande inconnue : signalée, jamais envoyée à l'agent", () => {
    expect(routeIntent(r, "/inconnue x")).toEqual({ kind: "unknown-command", name: "inconnue" });
  });

  it("texte libre → session principale", () => {
    expect(routeIntent(r, "Bonjour /tdd")).toEqual({ kind: "chat", text: "Bonjour /tdd" });
  });
});
