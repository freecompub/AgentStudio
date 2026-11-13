import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openWorkspace } from "../src/workspace.js";
import type { Workspace } from "../src/protocols.js";
import { git, initRepo, put, tempDir } from "./helpers.js";

/** Reprise d'une story (ADR 0089) : recréer sa branche, lire son historique, revenir à un commit. */
describe("Dépôt : reprise d'une branche de story", () => {
  let root: string;
  let cleanup: () => Promise<void>;
  let ws: Workspace;
  let base: string;
  beforeEach(async () => {
    ({ path: root, cleanup } = await tempDir());
    await initRepo(root, { "README.md": "v1\n" });
    ws = await openWorkspace(root);
    base = await ws.repo.head();
    await ws.repo.switchBranch("skraft/us02-abcd1234");
    await put(root, "a.txt", "a\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "docs(skraft): research de us02-abcd1234");
    await put(root, "b.txt", "b\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "feat(us02-abcd1234): ac-1");
  });
  afterEach(() => cleanup());

  it("historique : les commits de HEAD, du plus récent au plus ancien, avec leur sujet", async () => {
    const h = await ws.repo.log();
    expect(h.map((c) => c.subject)).toEqual(["feat(us02-abcd1234): ac-1", "docs(skraft): research de us02-abcd1234", "init"]);
    expect(h[0]!.sha).toBe(await ws.repo.head());
  });

  it("revenir à un commit : ce qui a été commité ou modifié après disparaît ; les fichiers non suivis restent, et sont nommés", async () => {
    const research = (await ws.repo.log())[1]!.sha;
    await put(root, "a.txt", "modifié\n");
    await put(root, "nouveau.txt", "non suivi\n");
    const r = await ws.repo.resetTo(research);
    expect(await ws.repo.head()).toBe(research);
    expect(existsSync(join(root, "b.txt"))).toBe(false);
    expect(await git(root, "show", "HEAD:a.txt")).toBe("a");
    expect(await git(root, "status", "--porcelain")).toBe("?? nouveau.txt");
    expect(r.nonSuivis).toEqual(["nouveau.txt"]);
    expect(await git(root, "branch", "--show-current")).toBe("skraft/us02-abcd1234");
  });

  it("revenir à un commit qui n'est pas dans l'historique de la branche : refusé, rien ne bouge", async () => {
    await git(root, "switch", "-q", "-c", "autre", base);
    await put(root, "x.txt", "x\n");
    await git(root, "add", "-A");
    await git(root, "commit", "-q", "-m", "ailleurs");
    const ailleurs = await ws.repo.head();
    await git(root, "switch", "-q", "skraft/us02-abcd1234");
    const avant = await ws.repo.head();
    await expect(ws.repo.resetTo(ailleurs)).rejects.toThrow(/historique/);
    expect(await ws.repo.head()).toBe(avant);
  });

  it("recréer la branche depuis un commit : la session précédente est écrasée, la branche de départ intacte", async () => {
    await ws.repo.switchBranch("skraft/us02-abcd1234", { depuis: base, ecraser: true });
    expect(await git(root, "branch", "--show-current")).toBe("skraft/us02-abcd1234");
    expect(await ws.repo.head()).toBe(base);
    expect(existsSync(join(root, "a.txt"))).toBe(false);
    expect(await git(root, "rev-parse", "main")).toBe(base);
  });
});
