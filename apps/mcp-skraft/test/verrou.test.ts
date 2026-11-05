/**
 * Un verrou par projet (ADR 0068, point 5) : deux clients lancent deux serveurs ; seul celui qui
 * tient le verrou lance ou reprend un run. Un verrou laissé par un processus mort est repris.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prendreVerrou } from "../src/verrou.js";

let dossier: string;
beforeAll(async () => {
  dossier = await mkdtemp(join(tmpdir(), "mcp-verrou-"));
});
afterAll(() => rm(dossier, { recursive: true, force: true }));

describe("Verrou par projet (ADR 0068, point 5)", () => {
  it("le premier serveur le prend ; le second est refusé avec le PID du détenteur ; libéré, il est libre", async () => {
    const fichier = join(dossier, "a", "mcp-skraft.lock");
    const vivants = new Set([100, 200]);
    const premier = await prendreVerrou(fichier, { pid: 100, estVivant: (p) => vivants.has(p) });
    expect(premier.ok).toBe(true);
    expect(JSON.parse(await readFile(fichier, "utf8"))).toEqual({ pid: 100 });
    expect(await prendreVerrou(fichier, { pid: 200, estVivant: (p) => vivants.has(p) })).toEqual({ ok: false, pid: 100 });
    if (premier.ok) await premier.liberer();
    expect(await prendreVerrou(fichier, { pid: 200, estVivant: (p) => vivants.has(p) })).toMatchObject({ ok: true });
  });

  it("détenteur mort : le verrou est repris", async () => {
    const fichier = join(dossier, "b.lock");
    await writeFile(fichier, JSON.stringify({ pid: 999 }));
    const r = await prendreVerrou(fichier, { pid: 300, estVivant: (p) => p === 300 });
    expect(r.ok).toBe(true);
    expect(JSON.parse(await readFile(fichier, "utf8"))).toEqual({ pid: 300 });
  });

  it("fichier illisible : traité comme un verrou abandonné", async () => {
    const fichier = join(dossier, "c.lock");
    await writeFile(fichier, "pas du json");
    expect((await prendreVerrou(fichier, { pid: 300, estVivant: () => true })).ok).toBe(true);
  });

  it("libérer ne supprime pas le verrou d'un autre serveur qui l'a repris entre-temps", async () => {
    const fichier = join(dossier, "d.lock");
    const r = await prendreVerrou(fichier, { pid: 400, estVivant: () => true });
    await writeFile(fichier, JSON.stringify({ pid: 500 }));
    if (r.ok) await r.liberer();
    expect(JSON.parse(await readFile(fichier, "utf8"))).toEqual({ pid: 500 });
  });
});
