/**
 * Zero-dependency structured JSON logger.
 * Always include ids (jobId, submissionId, attestationId, settlementId,
 * txSignature). NEVER log private keys, seed phrases, wallet secrets, or
 * authorization material — no code path in this backend logs them.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  jobId?: string;
  submissionId?: string;
  attestationId?: string;
  settlementId?: string;
  txSignature?: string;
  [key: string]: unknown;
}

export type LogSink = (line: string) => void;

const DEFAULT_SINK: LogSink = (line) => {
  // eslint-disable-next-line no-console
  console.log(line);
};

let sink: LogSink = DEFAULT_SINK;

/** Override the sink in tests to capture structured logs. */
export function setLogSink(next: LogSink | null): void {
  sink = next ?? DEFAULT_SINK;
}

function emit(level: LogLevel, message: string, fields: LogFields = {}): void {
  sink(JSON.stringify({ ts: new Date().toISOString(), level, message, ...fields }));
}

export const logger = {
  debug: (message: string, fields?: LogFields) => emit("debug", message, fields),
  info: (message: string, fields?: LogFields) => emit("info", message, fields),
  warn: (message: string, fields?: LogFields) => emit("warn", message, fields),
  error: (message: string, fields?: LogFields) => emit("error", message, fields),
};
