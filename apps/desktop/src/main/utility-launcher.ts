import { utilityProcess } from "electron";
import { isolationExecArgv, type ProcessLauncher, type RpcMessage } from "@agent-studio/extension-host";

/**
 * Lanceur Electron : un `utilityProcess` par extension (D9), sous le modèle de permissions Node
 * (lecture limitée au dossier de l'extension et du runtime, ni écriture ni sous-processus).
 */
export function createUtilityProcessLauncher(opts: { onStderr?: (chunk: string) => void } = {}): ProcessLauncher {
  return {
    launch(launch) {
      const child = utilityProcess.fork(launch.entry, [], {
        execArgv: isolationExecArgv(launch),
        serviceName: "agent-studio-extension",
        stdio: ["ignore", "ignore", "pipe"],
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (c: string) => opts.onStderr?.(c));
      const exits: ((code: number | null) => void)[] = [];
      child.on("exit", (code) => exits.forEach((cb) => cb(code)));
      return {
        get pid() {
          return child.pid;
        },
        channel: {
          send: (msg) => child.postMessage(msg),
          onMessage(cb) {
            const l = (m: unknown) => cb(m as RpcMessage);
            child.on("message", l);
            return () => void child.off("message", l);
          },
        },
        onExit: (cb) => void exits.push(cb),
        kill: () => void child.kill(),
      };
    },
  };
}
