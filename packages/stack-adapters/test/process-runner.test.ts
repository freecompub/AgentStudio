import { describe, expect, it } from "vitest";
import { createNodeProcessRunner } from "../src/process/node-process-runner.js";

const runner = createNodeProcessRunner();

describe("NodeProcessRunner", () => {
  it("capture sortie et code de sortie, sans shell", async () => {
    const r = await runner.run("node", ["-e", "console.log('ok'); console.error('err'); process.exit(3)"], { cwd: process.cwd(), timeoutMs: 10_000 });
    expect(r).toMatchObject({ exitCode: 3, timedOut: false });
    expect(r.stdout.trim()).toBe("ok");
    expect(r.stderr.trim()).toBe("err");
  });

  it("relaie la sortie au fil de l'eau", async () => {
    const chunks: string[] = [];
    await runner.run("node", ["-e", "console.log('a'); console.log('b')"], { cwd: process.cwd(), timeoutMs: 10_000, onOutput: (c) => chunks.push(c) });
    expect(chunks.join("")).toContain("a\nb");
  });

  it("au-delà du délai, tue tout l'arbre de processus", async () => {
    // Le parent lance un enfant qui écrit son pid, puis tous deux attendent indéfiniment.
    const script = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      console.log(child.pid);
      setInterval(() => {}, 1000);`;
    const r = await runner.run("node", ["-e", script], { cwd: process.cwd(), timeoutMs: 1_500 });
    expect(r.timedOut).toBe(true);
    const childPid = Number(r.stdout.trim());
    await new Promise((res) => setTimeout(res, 200));
    expect(() => process.kill(childPid, 0)).toThrow();
  });

  it("annulation par signal : arbre tué", async () => {
    const ac = new AbortController();
    const p = runner.run("node", ["-e", "setInterval(() => {}, 1000)"], { cwd: process.cwd(), timeoutMs: 60_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 200);
    const r = await p;
    expect(r.exitCode).not.toBe(0);
  });

  it("commande introuvable : erreur explicite", async () => {
    await expect(runner.run("commande-qui-n-existe-pas", [], { cwd: process.cwd(), timeoutMs: 5_000 })).rejects.toThrow(/introuvable/);
  });
});
