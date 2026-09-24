import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { EVENT_CHANNELS, REQUEST_CHANNELS } from "../shared/channels.js";
import type { RendererApi } from "../shared/ipc-contract.js";

/**
 * Preload minimal (§10.2) : seuls les canaux du contrat sont exposés, jamais `ipcRenderer`.
 */
const requestChannels = new Set<string>(REQUEST_CHANNELS);
const eventChannels = new Set<string>(EVENT_CHANNELS);

const api: RendererApi = {
  invoke(channel, input) {
    if (!requestChannels.has(channel)) return Promise.reject(new Error(`Canal inconnu : ${channel}`));
    return ipcRenderer.invoke(channel, input);
  },
  on(channel, cb) {
    if (!eventChannels.has(channel)) throw new Error(`Canal inconnu : ${channel}`);
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload as never);
    ipcRenderer.on(channel, listener);
    return () => void ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("agentStudio", api);
