import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { bundle, createNodeLauncher } from "@agent-studio/extension-host";
import { MemoryTaskStore } from "@agent-studio/task-engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { evaluerScript } from "../src/hote/bac-a-sable.js";
import { compilerWorkflow } from "../src/hote/compiler.js";
import { createRejoueurIsole, type Rejoueur } from "../src/hote/rejoueur.js";
import { createWorkflowTaskDepuis } from "../src/workflow-task.js";
import type { EtatWorkflow } from "../src/protocols.js";
import { fauxContexte, moteurDepuis, sortie } from "./faux-contexte.js";

/**
 * Exécution isolée d'un workflow (ADR 0055, `docs/11` §8) : le script est compilé (imports
 * contrôlés), puis exécuté dans un processus enfant lancé sous le modèle de permissions de Node,
 * dans un contexte sans heure, sans hasard, sans minuteries ni génération de code.
 */

let dossier: string;
let enfant: string;
const rejoueurs: Rejoueur[] = [];

beforeAll(async () => {
  dossier = await mkdtemp(join(tmpdir(), "hote-workflow-"));
  enfant = join(dossier, "runtime", "enfant.mjs");
  await bundle(resolve(import.meta.dirname, "../src/hote/enfant-entree.ts"), enfant);
}, 60_000);

afterAll(async () => {
  for (const r of rejoueurs) r.arreter();
  await rm(dossier, { recursive: true, force: true });
});

async function poserWorkflow(nom: string, fichiers: Record<string, string>): Promise<string> {
  const d = join(dossier, "workflows", nom);
  for (const [rel, contenu] of Object.entries(fichiers)) {
    await mkdir(dirname(join(d, rel)), { recursive: true });
    await writeFile(join(d, rel), contenu);
  }
  return d;
}

const META = `export const meta = { name: "essai", description: "Essai.", commande: "essai" };\n`;

async function isole(script: string, opts: { delaiMs?: number; autres?: Record<string, string> } = {}) {
  const d = await poserWorkflow(`w${rejoueurs.length}`, { "workflow.mjs": META + script, ...(opts.autres ?? {}) });
  const c = await compilerWorkflow(d);
  if (!c.ok) throw new Error(c.motifs.join(" ; "));
  const r = createRejoueurIsole({ code: c.code, launcher: createNodeLauncher(), runtimeEntry: enfant, ...(opts.delaiMs ? { delaiMs: opts.delaiMs } : {}) });
  rejoueurs.push(r);
  return r;
}

const fin = async (m: ReturnType<typeof moteurDepuis>, id: string) => ((await m.store.load(id))!.state as EtatWorkflow).fin;

describe("compilation : seuls les fichiers du dossier et @agent-studio/workflow", () => {
  it("imports relatifs du dossier et @agent-studio/workflow : acceptés, en un seul code", async () => {
    const d = await poserWorkflow("ok", {
      "workflow.mjs": `${META}import { essayer } from "@agent-studio/workflow";\nimport { porte } from "./portes/porte.mjs";\nexport default async function (w) { return porte(); }\n`,
      "portes/porte.mjs": `export const porte = () => "ok";\n`,
    });
    const c = await compilerWorkflow(d);
    expect(c.ok).toBe(true);
  });

  it.each([
    ["un module Node", `import { readFileSync } from "node:fs";`, /import interdit : node:fs/],
    ["un module Node sans préfixe", `import cp from "child_process";`, /import interdit : child_process/],
    ["un paquet", `import _ from "lodash";`, /import interdit : lodash/],
    ["un fichier hors du dossier", `import x from "../ailleurs.mjs";`, /hors du dossier/],
  ])("refusé : %s", async (_cas, ligne, motif) => {
    const d = await poserWorkflow(`refus-${Math.abs(ligne.length)}-${_cas.length}`, { "workflow.mjs": `${META}${ligne}\nexport default async function () {}\n` });
    const c = await compilerWorkflow(d);
    expect(c.ok).toBe(false);
    expect(!c.ok && c.motifs.join(" ")).toMatch(motif);
  });

  it("import dynamique d'un module Node : refusé aussi", async () => {
    const d = await poserWorkflow("dyn", { "workflow.mjs": `${META}export default async function () { await import("node:child_process"); }\n` });
    const c = await compilerWorkflow(d);
    expect(!c.ok && c.motifs.join(" ")).toMatch(/import interdit : node:child_process/);
  });
});

describe("bac à sable : ce qui rend le rejeu faux est absent", () => {
  const essayer = (corps: string) => {
    const { script } = evaluerScript(`module.exports = { meta: {}, default: async function () { ${corps} } };`);
    return script(null as never, null as never);
  };

  it("Date est refusé, avec la marche à suivre", async () => {
    await expect(essayer("return Date.now();")).rejects.toThrow(/w\.maintenant\(\)/);
    await expect(essayer("return new Date();")).rejects.toThrow(/w\.maintenant\(\)/);
  });

  it("Math.random est refusé ; le reste de Math marche", async () => {
    await expect(essayer("return Math.random();")).rejects.toThrow(/hasard/);
    await expect(essayer("return Math.max(1, 2);")).resolves.toBe(2);
  });

  it("ni minuteries, ni process, ni fetch", async () => {
    for (const nom of ["setTimeout", "setInterval", "setImmediate", "process", "fetch", "queueMicrotask"])
      await expect(essayer(`return typeof ${nom};`), nom).resolves.toBe("undefined");
  });

  it("le `require` du code compilé ne connaît que @agent-studio/workflow", async () => {
    await expect(essayer(`return typeof require("@agent-studio/workflow").essayer;`)).resolves.toBe("function");
    await expect(essayer(`return require("node:fs");`)).rejects.toThrow(/import interdit dans un workflow : node:fs/);
  });

  it("pas de génération de code (eval, Function)", async () => {
    await expect(essayer(`return eval("1 + 1");`)).rejects.toThrow(/Code generation from strings disallowed/);
    await expect(essayer(`return new Function("return 1")();`)).rejects.toThrow(/Code generation from strings disallowed/);
  });
});

describe("exécution isolée", () => {
  it("un workflow complet : fichiers, agent, calculs purs de la bibliothèque", async () => {
    const r = await isole(`
import { empreinte, correspond } from "@agent-studio/workflow";
export default async function (w) {
  const story = await w.lireFichier("story.md");
  const a = await w.agent("redacteur", story);
  return { resume: a.sortie.summary, empreinte: empreinte(story).slice(0, 7), test: correspond(["tests/**"], "tests/a.test.ts") };
}`);
    const f = fauxContexte({ redacteur: (c) => sortie({ summary: `lu : ${c}` }) }, { "story.md": "US-2" });
    const m = moteurDepuis(createWorkflowTaskDepuis({ nom: "essai", empreinte: "v1", rejoueur: r }), f.ctx);
    const id = await m.engine.start("essai", null);
    await m.engine.idle(id);
    expect(await fin(m, id)).toEqual({ statut: "fini", valeur: { clair: { resume: "lu : US-2", empreinte: "sha256:", test: true } } });
  }, 30_000);

  it("Date dans le script : la tâche échoue avec la marche à suivre", async () => {
    const r = await isole(`export default async function (w) { return Date.now(); }`);
    const m = moteurDepuis(createWorkflowTaskDepuis({ nom: "essai", empreinte: "v1", rejoueur: r }), fauxContexte().ctx);
    const id = await m.engine.start("essai", null);
    await m.engine.idle(id);
    expect(await fin(m, id)).toMatchObject({ statut: "echec", motif: expect.stringMatching(/w\.maintenant\(\)/) });
  }, 30_000);

  it("évasion par un objet du principal : le processus n'a pas le droit d'écrire sur le disque", async () => {
    const cible = join(dossier, "evasion.txt");
    const r = await isole(`
export default async function (w) {
  const p = w.lireFichier.constructor.constructor("return process")();
  p.getBuiltinModule("node:fs").writeFileSync(${JSON.stringify(cible)}, "écrit");
  return "écrit";
}`);
    const m = moteurDepuis(createWorkflowTaskDepuis({ nom: "essai", empreinte: "v1", rejoueur: r }), fauxContexte().ctx);
    const id = await m.engine.start("essai", null);
    await m.engine.idle(id);
    expect(await fin(m, id)).toMatchObject({ statut: "echec", motif: expect.stringMatching(/ERR_ACCESS_DENIED|Access to this API has been restricted/) });
    await expect(access(cible)).rejects.toThrow();
  }, 30_000);

  it("boucle infinie : la tâche échoue au délai, le processus est remplacé", async () => {
    const r = await isole(`export default async function (w) { await w.lireFichier("a"); for (;;) {} }`, { delaiMs: 1_500 });
    const m = moteurDepuis(createWorkflowTaskDepuis({ nom: "essai", empreinte: "v1", rejoueur: r }), fauxContexte({}, { a: "" }).ctx);
    const id = await m.engine.start("essai", null);
    await m.engine.idle(id);
    expect(await fin(m, id)).toMatchObject({ statut: "echec", motif: expect.stringMatching(/ne rend pas la main/) });
  }, 30_000);

  it("reprise après un crash : un nouveau processus rejoue le journal, rien n'est refait", async () => {
    const script = `export default async function (w) {
  const a = await w.agent("premier", "x");
  const b = await w.agent("second", "y");
  return a.sortie.summary + "+" + b.sortie.summary;
}`;
    const r1 = await isole(script);
    const avant = fauxContexte({ premier: () => sortie({ summary: "A" }), second: () => new Promise(() => {}) });
    const store = new MemoryTaskStore();
    const m1 = moteurDepuis(createWorkflowTaskDepuis({ nom: "essai", empreinte: "v1", rejoueur: r1 }), avant.ctx, store);
    const id = await m1.engine.start("essai", null);
    for (let i = 0; i < 200 && !avant.appels.includes("agent:second"); i++) await new Promise((x) => setTimeout(x, 10));
    r1.arreter();

    const r2 = await isole(script);
    const apres = fauxContexte({ premier: () => sortie({ summary: "JAMAIS" }), second: () => sortie({ summary: "B" }) });
    const m2 = moteurDepuis(createWorkflowTaskDepuis({ nom: "essai", empreinte: "v1", rejoueur: r2 }), apres.ctx, store);
    await m2.engine.resumeAll();
    await m2.engine.idle(id);
    expect(apres.appels).toEqual(["agent:second"]);
    expect(await fin(m2, id)).toEqual({ statut: "fini", valeur: { clair: "A+B" } });
  }, 30_000);

  it("w.maintenant : l'heure est journalisée, et la même au rejeu", async () => {
    const r = await isole(`export default async function (w) {
  const t = await w.maintenant();
  await w.lireFichier("a");
  return t;
}`);
    const m = moteurDepuis(createWorkflowTaskDepuis({ nom: "essai", empreinte: "v1", rejoueur: r }), fauxContexte({}, { a: "" }).ctx);
    const id = await m.engine.start("essai", null);
    await m.engine.idle(id);
    const etat = (await m.store.load(id))!.state as EtatWorkflow;
    const notee = (etat.journal[0]!.resultat as { clair: string }).clair;
    expect(notee).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(etat.fin).toEqual({ statut: "fini", valeur: { clair: notee } });
  }, 30_000);
});
