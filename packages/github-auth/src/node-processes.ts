import { execFile, spawn } from "node:child_process";
import type { CommandRunner, InteractiveProcess, ProcessSpawner } from "./protocols.js";

/** `CommandRunner` Node : sans shell, délai borné, code de sortie renvoyé plutôt que levé. */
export function createNodeCommandRunner(timeoutMs = 30_000): CommandRunner {
  return {
    run: (cmd, args) =>
      new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: timeoutMs, encoding: "utf8", env: { ...process.env, GH_PROMPT_DISABLED: "1" } }, (err, stdout, stderr) => {
          if (err && typeof err.code !== "number") return reject(err);
          resolve({ code: err ? Number(err.code) : 0, stdout, stderr });
        });
      }),
  };
}

export function createNodeProcessSpawner(): ProcessSpawner {
  return {
    spawn(cmd, args, opts): InteractiveProcess {
      const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], ...(opts?.env ? { env: { ...process.env, ...opts.env } } : {}) });
      const exited = new Promise<number>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code ?? 1));
      });
      return {
        onOutput(cb) {
          child.stdout.setEncoding("utf8").on("data", cb);
          child.stderr.setEncoding("utf8").on("data", cb);
        },
        write: (data) => void child.stdin.write(data),
        kill: () => void child.kill("SIGTERM"),
        exited,
      };
    },
  };
}
