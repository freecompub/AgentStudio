import type { EventChannel, EventPayload, RendererApi, RequestChannel } from "../../src/shared/ipc-contract";

type Handler = (input: unknown) => unknown;

/** Faux `window.agentStudio` : réponses programmées par canal et émission d'événements. */
export class FakeApi implements RendererApi {
  readonly calls: { channel: RequestChannel; input: unknown }[] = [];
  private handlers = new Map<RequestChannel, Handler>();
  private listeners = new Map<EventChannel, Set<(p: unknown) => void>>();

  constructor() {
    // Par défaut : développeur en mode avancé (les tests de profil surchargent).
    this.handle("profile:get", () => ({ role: "developpeur", roleLabel: "Développeur", defaultMode: "advanced", permissionPolicy: "souple", developerMode: false, adminSource: "défaut" }));
    this.handle("ui:get-mode", () => "advanced");
    this.handle("ui:set-mode", () => undefined);
    // Par défaut : Copilot seul, comme une application sans Claude (ADR 0070).
    this.handle("runtime:status", () => ({ choisi: "copilot", disponibles: ["copilot"], claude: null }));
  }

  handle(channel: RequestChannel, h: Handler): this {
    this.handlers.set(channel, h);
    return this;
  }

  async invoke(channel: RequestChannel, input: unknown): Promise<never> {
    this.calls.push({ channel, input });
    const h = this.handlers.get(channel);
    if (!h) throw new Error(`Canal non programmé : ${channel}`);
    return (await h(input)) as never;
  }

  on<C extends EventChannel>(channel: C, cb: (p: EventPayload<C>) => void): () => void {
    const set = this.listeners.get(channel) ?? new Set();
    set.add(cb as (p: unknown) => void);
    this.listeners.set(channel, set);
    return () => set.delete(cb as (p: unknown) => void);
  }

  emit<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
    for (const cb of this.listeners.get(channel) ?? []) cb(payload);
  }
}
