import type { Clock } from "../protocols/conversation.js";
import type { LogFields, Logger } from "../protocols/logger.js";

type Level = "debug" | "info" | "warn" | "error";
const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface JsonLoggerOptions {
  write: (line: string) => void;
  clock?: Clock;
  level?: Level;
}

export function createJsonLogger(opts: JsonLoggerOptions, base: LogFields = {}): Logger {
  const min = RANK[opts.level ?? "debug"];
  const now = () => (opts.clock ?? { now: () => new Date() }).now().toISOString();
  const log = (level: Level) => (msg: string, fields: LogFields = {}) => {
    if (RANK[level] < min) return;
    opts.write(JSON.stringify({ ts: now(), level, msg, ...base, ...fields }));
  };
  return {
    debug: log("debug"),
    info: log("info"),
    warn: log("warn"),
    error: log("error"),
    child: (fields) => createJsonLogger(opts, { ...base, ...fields }),
  };
}
