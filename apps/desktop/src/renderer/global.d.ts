import type { RendererApi } from "../shared/ipc-contract";

declare global {
  interface Window {
    agentStudio: RendererApi;
  }
}
