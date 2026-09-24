import { spawn } from "node:child_process";
import type { ProcessRunner } from "../protocols.js";

const MAX_CAPTURE = 4 * 1024 * 1024;

/**
 * `ProcessRunner` Node : sans shell, dans son propre groupe de processus pour pouvoir tuer
 * tout l'arbre (délai dépassé ou annulation), jamais d'entrée standard (mode non interactif).
 */
export function createNodeProcessRunner(): ProcessRunner {
  return {
    run(cmd, args, opts) {
      return new Promise((resolve, reject) => {
        const started = Date.now();
        const child = spawn(cmd, args, {
          cwd: opts.cwd,
          env: { ...process.env, CI: "1", FORCE_COLOR: "0", ...opts.env },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const killTree = () => {
          if (child.pid === undefined || child.exitCode !== null) return;
          try {
            if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"]);
            else process.kill(-child.pid, "SIGKILL");
          } catch {
            // déjà terminé
          }
        };
        const timer = setTimeout(() => {
          timedOut = true;
          killTree();
        }, opts.timeoutMs);
        const onAbort = () => killTree();
        opts.signal?.addEventListener("abort", onAbort, { once: true });

        child.stdout.setEncoding("utf8").on("data", (c: string) => {
          if (stdout.length < MAX_CAPTURE) stdout += c;
          opts.onOutput?.(c);
        });
        child.stderr.setEncoding("utf8").on("data", (c: string) => {
          if (stderr.length < MAX_CAPTURE) stderr += c;
          opts.onOutput?.(c);
        });
        child.on("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
          reject(err.code === "ENOENT" ? new Error(`Commande introuvable : ${cmd}`, { cause: err }) : err);
        });
        child.on("close", (code) => {
          clearTimeout(timer);
          opts.signal?.removeEventListener("abort", onAbort);
          killTree(); // descendants éventuellement restés en vie
          resolve({ exitCode: code, stdout, stderr, timedOut, durationMs: Date.now() - started });
        });
        if (opts.signal?.aborted) killTree();
      });
    },
  };
}
