/** Point d'entrée du processus enfant d'un workflow (bundle ESM autonome), comme celui des extensions. */
import type { MessageChannelLike, RpcMessage } from "@agent-studio/extension-host";
import { lancerEnfantWorkflow } from "./enfant.js";

interface ParentPort {
  postMessage(m: unknown): void;
  on(ev: "message", cb: (e: { data: unknown }) => void): void;
  off?(ev: "message", cb: (e: { data: unknown }) => void): void;
}
const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

const canal: MessageChannelLike = parentPort
  ? {
      send: (m) => parentPort.postMessage(m),
      onMessage(cb) {
        const l = (e: { data: unknown }) => cb(e.data as RpcMessage);
        parentPort.on("message", l);
        return () => parentPort.off?.("message", l);
      },
    }
  : {
      send: (m) => void process.send?.(m),
      onMessage(cb) {
        const l = (m: unknown) => cb(m as RpcMessage);
        process.on("message", l);
        return () => void process.off("message", l);
      },
    };

process.on("disconnect", () => process.exit(0));
lancerEnfantWorkflow(canal);
