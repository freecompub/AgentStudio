/**
 * Trace d'exécution (ADR 0032).
 *
 * Deux exigences se contredisent et doivent tenir ensemble : **tout garder**, parce qu'on a été
 * aveugle sur des runs entiers faute d'avoir conservé une commande refusée ou une liste de fichiers
 * déclarés ; et **rester lisible**, parce qu'un tour d'architecte compte des dizaines d'appels dont
 * les contenus se chiffrent en centaines de kilo-octets.
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createJsonlTraceStore, tronquer, LIMITE_TEXTE } from "../src/trace/jsonl-trace-store.js";
import type { TraceEntry } from "../src/protocols/trace.js";

const entree = (o: Partial<TraceEntry> = {}): TraceEntry =>
  ({ taskId: "t1", at: "2026-09-29T10:00:00.000Z", kind: "message", texte: "bonjour", ...o }) as TraceEntry;

describe("tronquer", () => {
  it("laisse intact ce qui tient dans la limite", () => {
    expect(tronquer("court")).toBe("court");
  });

  it("coupe ce qui déborde, et DIT combien a été coupé", () => {
    // Une troncature muette ferait lire un texte amputé comme s'il était entier — c'est la même
    // faute que de taire ce qu'on n'a pas mesuré.
    const t = tronquer("x".repeat(LIMITE_TEXTE + 500));
    expect(t.length).toBeLessThan(LIMITE_TEXTE + 100);
    expect(t).toMatch(/\[\.\.\. 500 caractères coupés\]$/);
  });

  it("ne touche pas à ce qui n'est pas du texte", () => {
    expect(tronquer(42 as never)).toBe(42);
    expect(tronquer(null as never)).toBe(null);
  });
});

describe("createJsonlTraceStore", () => {
  const store = async () => createJsonlTraceStore(await mkdtemp(join(tmpdir(), "trace-")));

  it("écrit une ligne par entrée, relue à l'identique", async () => {
    const s = await store();
    await s.append(entree({ kind: "message", texte: "un" } as Partial<TraceEntry>));
    await s.append(entree({ kind: "message", texte: "deux" } as Partial<TraceEntry>));
    const lues = await s.list("t1");
    expect(lues.map((e) => (e as { texte: string }).texte)).toEqual(["un", "deux"]);
  });

  it("tronque les textes trop longs à l'écriture, pas à la lecture", async () => {
    const s = await store();
    await s.append(entree({ kind: "tour-début", prompt: "y".repeat(LIMITE_TEXTE + 10), repris: false } as Partial<TraceEntry>));
    const [e] = await s.list("t1");
    expect((e as { prompt: string }).prompt).toMatch(/caractères coupés\]$/);
  });

  it("un tour de tâche inconnu rend une liste vide, pas une erreur", async () => {
    expect(await (await store()).list("jamais-vu")).toEqual([]);
  });

  it("une ligne tronquée par un arrêt brutal est ignorée, les autres sont rendues", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trace-"));
    const s = createJsonlTraceStore(dir);
    await s.append(entree({ texte: "entière" } as Partial<TraceEntry>));
    const { appendFile } = await import("node:fs/promises");
    await appendFile(join(dir, "t1.jsonl"), '{"taskId":"t1","kind":"mes');
    const lues = await s.list("t1");
    expect(lues).toHaveLength(1);
  });

  it("refuse un identifiant de tâche qui sortirait du dossier", async () => {
    const s = await store();
    await expect(s.append(entree({ taskId: "../evade" }))).rejects.toThrow(/invalide/);
  });

  it("les écritures concurrentes ne s'entrelacent pas", async () => {
    const dir = await mkdtemp(join(tmpdir(), "trace-"));
    const s = createJsonlTraceStore(dir);
    await Promise.all(Array.from({ length: 40 }, (_, i) => s.append(entree({ texte: `n${i}` } as Partial<TraceEntry>))));
    const brut = await readFile(join(dir, "t1.jsonl"), "utf8");
    expect(brut.trim().split("\n")).toHaveLength(40);
    expect((await s.list("t1")).length).toBe(40);
  });
});

/**
 * Un livrable archivé est gardé ENTIER, à côté de la trace (ADR 0038).
 *
 * Il l'a d'abord été *dans* le JSONL, borné à 200 000 caractères. C'était le même travers que le
 * plafond d'un million de tokens : un seuil qu'on n'a pas mesuré est un seuil qui sera faux. La
 * bonne réponse n'était pas de mieux régler le nombre, c'était de supprimer le besoin d'en avoir
 * un — le fichier est écrit à côté, la trace n'en garde qu'une référence.
 */
describe("Livrables archivés : entiers, à côté de la trace", () => {
  const store = async () => {
    const dir = await mkdtemp(join(tmpdir(), "trace-"));
    return { dir, s: createJsonlTraceStore(dir) };
  };

  it("garde le document entier, quelle que soit sa taille", async () => {
    const { dir, s } = await store();
    const doc = "# Recherche\n".repeat(40_000); // très au-delà de toute limite de narration
    await s.archive("t1", "RESEARCH essai 1", [{ path: ".skraft/us-2/research/research.md", content: doc }]);
    expect(await readFile(join(dir, "t1", "RESEARCH essai 1", ".skraft/us-2/research/research.md"), "utf8")).toBe(doc);
  });

  it("la trace n'en garde qu'une référence, et reste légère", async () => {
    const { dir, s } = await store();
    await s.archive("t1", "RESEARCH essai 1", [{ path: "a.md", content: "x".repeat(100_000) }]);
    const [e] = await s.list("t1");
    expect(e).toMatchObject({ kind: "livrable-rejeté", étiquette: "RESEARCH essai 1", chemin: "a.md" });
    expect((await readFile(join(dir, "t1.jsonl"), "utf8")).length).toBeLessThan(1_000);
  });

  it("plusieurs livrables d'un même essai cohabitent", async () => {
    const { dir, s } = await store();
    await s.archive("t1", "DESIGN essai 2", [{ path: "d/a.md", content: "A" }, { path: "d/b.md", content: "B" }]);
    expect(await readFile(join(dir, "t1", "DESIGN essai 2", "d/a.md"), "utf8")).toBe("A");
    expect(await readFile(join(dir, "t1", "DESIGN essai 2", "d/b.md"), "utf8")).toBe("B");
    expect((await s.list("t1")).length).toBe(2);
  });

  it("un chemin qui tenterait de sortir du dossier d'archive est refusé", async () => {
    const { s } = await store();
    await expect(s.archive("t1", "x", [{ path: "../../evade.md", content: "z" }])).rejects.toThrow();
  });

  it("une étiquette qui tenterait la même chose est refusée", async () => {
    const { s } = await store();
    await expect(s.archive("t1", "../..", [{ path: "a.md", content: "z" }])).rejects.toThrow();
  });
});
