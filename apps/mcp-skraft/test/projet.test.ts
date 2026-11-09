/**
 * Projet de l'appelant (ADR 0068, point 6) : détecté dans l'ordre argument, roots du client, dossier
 * courant ; puis borné, car le serveur écrit sans bac à sable : un dépôt Git, dans un root du client
 * ou dans un dossier autorisé par la configuration.
 */
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resoudreProjet } from "../src/projet.js";

let base: string;
let depot: string;
let autre: string;
let pasGit: string;
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "mcp-projet-"));
  depot = join(base, "roots", "depot");
  autre = join(base, "ailleurs", "autre");
  pasGit = join(base, "roots", "pas-git");
  for (const d of [join(depot, ".git"), join(autre, ".git"), pasGit]) await mkdir(d, { recursive: true });
  await symlink(autre, join(base, "roots", "lien"));
});
afterAll(() => rm(base, { recursive: true, force: true }));

describe("Projet de l'appelant (ADR 0068, point 6)", () => {
  it("l'argument l'emporte sur les roots et le dossier courant", async () => {
    const r = await resoudreProjet({ argument: depot, roots: [join(base, "ailleurs")], cwd: autre, autorises: [join(base, "roots")] });
    expect(r).toEqual({ ok: true, root: depot });
  });

  it("sans argument, le premier root du client ; sans root, le dossier courant", async () => {
    expect(await resoudreProjet({ roots: [depot, autre], cwd: autre, autorises: [] })).toEqual({ ok: true, root: depot });
    expect(await resoudreProjet({ roots: [], cwd: depot, autorises: [join(base, "roots")] })).toEqual({ ok: true, root: depot });
  });

  it("un argument relatif se lit depuis le premier root, sinon depuis le dossier courant", async () => {
    expect(await resoudreProjet({ argument: "depot", roots: [join(base, "roots")], cwd: autre, autorises: [] })).toMatchObject({ ok: true, root: depot });
    expect(await resoudreProjet({ argument: "depot", roots: [], cwd: join(base, "roots"), autorises: [join(base, "roots")] })).toMatchObject({ ok: true, root: depot });
  });

  it("hors des roots du client et des dossiers autorisés : refusé, avec ce qu'il faut faire", async () => {
    const r = await resoudreProjet({ argument: autre, roots: [depot], cwd: depot, autorises: [join(base, "roots")] });
    // `horsBornes` : le seul refus que l'utilisateur peut lever en acceptant le dépôt (ADR 0075).
    expect(r).toEqual({ ok: false, horsBornes: true, root: autre, motif: expect.stringMatching(/hors des dossiers.*autorises/s) });
    // Sans root ni dossier autorisé, le dossier courant n'est pas accepté d'office.
    expect(await resoudreProjet({ roots: [], cwd: depot, autorises: [] })).toMatchObject({ ok: false });
  });

  it("un lien symbolique est jugé sur sa cible réelle", async () => {
    const r = await resoudreProjet({ argument: join(base, "roots", "lien"), roots: [], cwd: depot, autorises: [join(base, "roots")] });
    expect(r).toMatchObject({ ok: false, motif: expect.stringContaining(autre) });
  });

  it("pas un dépôt Git, ou dossier absent : refusé", async () => {
    expect(await resoudreProjet({ argument: pasGit, roots: [join(base, "roots")], cwd: depot, autorises: [] })).toEqual({ ok: false, motif: expect.stringMatching(/pas un dépôt Git/) });
    expect(await resoudreProjet({ argument: join(base, "roots", "absent"), roots: [join(base, "roots")], cwd: depot, autorises: [] })).toEqual({ ok: false, motif: expect.stringMatching(/introuvable/) });
  });
});
