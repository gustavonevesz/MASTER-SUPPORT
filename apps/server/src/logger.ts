export type LogLevel = "info" | "error";

export function logEvent(
  level: LogLevel,
  event: string,
  identifiers: { messageId?: string; correlationId?: string; sessionId?: string; agentInstanceId?: string } = {},
): void {
  process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    component: "master-support-server",
    event,
    ...identifiers,
  })}\n`);
}
