export function validateOperationalMode(mode: string | undefined, host: string): asserts mode is "secure" | "development" {
  if (mode !== "secure" && mode !== "development") throw new Error("MASTER_SUPPORT_MODE must explicitly be secure or development");
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (mode === "development" && !loopback) throw new Error("development mode is restricted to loopback");
}
