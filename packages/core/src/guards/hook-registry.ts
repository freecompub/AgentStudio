import type { ToolCallGuard } from "../protocols/agent-runtime.js";

export interface HookRegistry {
  /** Ajoute la garde `onPreToolUse` d'une extension ; renvoie de quoi la retirer. */
  add(extensionId: string, guard: ToolCallGuard): () => void;
  /** Gardes des extensions actives, dans l'ordre d'enregistrement (après celles du cœur, §5.5). */
  guards(): ToolCallGuard[];
  removeExtension(extensionId: string): void;
}

export function createHookRegistry(): HookRegistry {
  const entries: { extensionId: string; guard: ToolCallGuard }[] = [];
  return {
    add(extensionId, guard) {
      const entry = { extensionId, guard };
      entries.push(entry);
      return () => {
        const i = entries.indexOf(entry);
        if (i >= 0) entries.splice(i, 1);
      };
    },
    guards: () => entries.map((e) => e.guard),
    removeExtension(extensionId) {
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i]!.extensionId === extensionId) entries.splice(i, 1);
    },
  };
}
