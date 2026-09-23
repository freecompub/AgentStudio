import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTypeScriptAdapter } from "../src/typescript/typescript-adapter.js";

const MONOREPO_NODE_MODULES = resolve(import.meta.dirname, "../../../node_modules");

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-studio-ts-"));
  await symlink(MONOREPO_NODE_MODULES, join(root, "node_modules"));
  for (const [rel, content] of Object.entries({ "package.json": '{"name":"demo","type":"module","devDependencies":{"vitest":"*"}}', ...files })) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  return root;
}

describe("Adaptateur TypeScript (Vitest)", () => {
  const adapter = createTypeScriptAdapter();
  let root: string;

  beforeAll(async () => {
    root = await project({
      "src/cap.ts": "export const cap = (d: number, m: number) => Math.min(d, m);\n",
      "tests/cap.test.ts": `import { it, expect } from "vitest";
import { cap } from "../src/cap";
it("sous le plafond", () => expect(cap(6, 10)).toBe(6));
it("au-dessus", () => expect(cap(12, 10)).toBe(11));
`,
    });
  });
  afterAll(() => rm(root, { recursive: true, force: true }));

  it("reconnaît un projet Vitest ; pas un dossier quelconque", async () => {
    expect(await adapter.detect(root)).toBe(true);
    const other = await mkdtemp(join(tmpdir(), "agent-studio-empty-"));
    expect(await adapter.detect(other)).toBe(false);
    await rm(other, { recursive: true });
  });

  it("lance les tests en mode non interactif et renvoie les résultats structurés", async () => {
    const out: string[] = [];
    const run = await adapter.runTests({ root, onOutput: (c) => out.push(c) });
    expect(run.timedOut).toBe(false);
    expect(run.results).toEqual([
      { id: "tests/cap.test.ts > sous le plafond", file: "tests/cap.test.ts", status: "passed" },
      expect.objectContaining({ id: "tests/cap.test.ts > au-dessus", status: "failed", failureKind: "assertion" }),
    ]);
    expect(out.length).toBeGreaterThan(0);
  });

  it("aucun fichier de rapport ne reste dans le projet", async () => {
    await adapter.runTests({ root });
    const status = execFileSync("ls", ["-A", root], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
    expect(status).toEqual(["node_modules", "package.json", "src", "tests"]);
  });

  it.each([
    ["tests/cap.test.ts", true],
    ["test/a.ts", true],
    ["src/cap.spec.tsx", true],
    ["src/__tests__/x.ts", true],
    ["src/cap.ts", false],
    ["README.md", false],
  ])("fichier de test : %s → %s", (path, expected) => {
    expect(adapter.isTestFile(path)).toBe(expected);
  });
});
