import { fork } from "node:child_process";
import type { RpcMessage } from "../rpc/protocol.js";
import { isolationExecArgv, type ProcessLauncher } from "./protocol.js";

/** Lanceur Node (`child_process.fork`) : tests et exécution hors Electron. */
export function createNodeLauncher(opts: { onStderr?: (chunk: string) => void } = {}): ProcessLauncher {
  return {
    launch(launch) {
      const child = fork(launch.entry, [], {
        execArgv: isolationExecArgv(launch),
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: { NODE_ENV: process.env["NODE_ENV"] ?? "production" },
      });
      child.stderr?.setEncoding("utf8").on("data", (c: string) => opts.onStderr?.(c));
      const exits: ((code: number | null) => void)[] = [];
      child.on("exit", (code) => exits.forEach((cb) => cb(code)));
      return {
        pid: child.pid,
        channel: {
          send: (msg) => {
            if (child.connected) child.send(msg);
          },
          onMessage(cb) {
            const l = (m: unknown) => cb(m as RpcMessage);
            child.on("message", l);
            return () => void child.off("message", l);
          },
        },
        onExit: (cb) => void exits.push(cb),
        kill: () => void child.kill("SIGKILL"),
      };
    },
  };
}
