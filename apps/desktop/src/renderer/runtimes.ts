import type { RuntimeKindDto } from "../shared/ipc-contract";

/** Libellés des runtimes des agents (ADR 0070). */
export const RUNTIMES: Record<RuntimeKindDto, string> = { copilot: "GitHub Copilot", claude: "Claude (Claude Code)" };
