/**
 * Options de lancement d'une extension isolée (§4.1, §10.1). Le modèle de permissions de Node
 * compare les chemins **réels** : un chemin passant par un lien symbolique n'autorise rien.
 */
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cheminReel, isolationExecArgv } from "../src/launchers/protocol.js";

const run = promisify(execFile);
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "agent-studio-argv-"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("isolationExecArgv", () => {
  it("restreint la lecture, interdit l'écriture et borne la mémoire", () => {
    const argv = isolationExecArgv({ entry: "/x/entry.mjs", readPaths: [], maxOldSpaceMb: 128 });
    expect(argv).toContain("--permission");
    expect(argv).toContain("--max-old-space-size=128");
    expect(argv.some((a) => a.startsWith("--allow-fs-write"))).toBe(false);
    expect(argv.some((a) => a.startsWith("--allow-child-process"))).toBe(false);
  });

  it("résout les liens symboliques des chemins autorisés", async () => {
    // Sur macOS, `tmpdir()` passe par /var → /private/var : sans résolution, Node refuse tout.
    const reel = await realpath(dir);
    const argv = isolationExecArgv({ entry: join(dir, "e.mjs"), readPaths: [dir] });
    expect(argv).toContain(`--allow-fs-read=${reel}`);
  });

  it("un vrai processus Node démarre avec ces options", async () => {
    const entry = join(dir, "vivant.mjs");
    await writeFile(entry, 'console.log("vivant");\n');
    const argv = isolationExecArgv({ entry, readPaths: [dir] });
    // Comme les lanceurs : le script d'entrée est lui aussi passé par son chemin réel.
    const { stdout } = await run(process.execPath, [...argv, cheminReel(entry)]);
    expect(stdout.trim()).toBe("vivant");
  });

  it("un chemin inexistant est conservé tel quel plutôt que de faire échouer le lancement", () => {
    const absent = join(dir, "jamais-cree");
    expect(isolationExecArgv({ entry: "/x", readPaths: [absent] })).toContain(`--allow-fs-read=${absent}`);
  });
});
