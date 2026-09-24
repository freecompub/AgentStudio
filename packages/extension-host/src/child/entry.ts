/**
 * Point d'entrée du processus hôte d'extension (bundle ESM autonome). Canal : `process.parentPort`
 * dans un utilityProcess Electron, IPC Node (`process.send`) sinon.
 */
import type { MessageChannelLike, RpcMessage } from "../rpc/protocol.js";
import { runExtensionChild } from "./runtime.js";

interface ParentPort {
  postMessage(m: unknown): void;
  on(ev: "message", cb: (e: { data: unknown }) => void): void;
  off?(ev: "message", cb: (e: { data: unknown }) => void): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;

const channel: MessageChannelLike = parentPort
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

// Le principal a disparu : l'hôte s'arrête.
process.on("disconnect", () => process.exit(0));
runExtensionChild(channel);
