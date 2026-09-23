import type { EventChannel, EventPayload, RendererApi, RequestChannel } from "../../src/shared/ipc-contract";

type Handler = (input: unknown) => unknown;

/** Faux `window.agentStudio` : réponses programmées par canal et émission d'événements. */
export class FakeApi implements RendererApi {
  readonly calls: { channel: RequestChannel; input: unknown }[] = [];
  private handlers = new Map<RequestChannel, Handler>();
  private listeners = new Map<EventChannel, Set<(p: unknown) => void>>();

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
