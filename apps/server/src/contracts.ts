import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import formatsPlugin from "ajv-formats";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type CapabilityDescriptor = Readonly<{ id: string; version: string }>;

export type AgentHello = Readonly<{
  protocolVersion: "1.0";
  messageId: string;
  messageType: "agent.hello";
  timestamp: string;
  payload: Readonly<{
    agentVersion: string;
    agentInstanceId: string;
    supportedProtocolVersions: readonly ["1.0", ..."1.0"[]];
    runtime: string;
    os: string;
    architecture: string;
    supportedCapabilities: readonly CapabilityDescriptor[];
  }>;
}>;

export type ServerHello = Readonly<{
  protocolVersion: "1.0";
  messageId: string;
  messageType: "server.hello";
  sessionId: string;
  correlationId: string;
  timestamp: string;
  expiresAt: string;
  payload: Readonly<{
    serverVersion: string;
    selectedProtocolVersion: "1.0";
    compatibility: "compatible";
    createdAt: string;
    heartbeatIntervalSeconds: number;
    resumeToken?: string;
    resumeTicket?: string;
    resumeTicketExpiresAt?: string;
    authentication?: "support_invitation";
    negotiatedCapabilities: readonly CapabilityDescriptor[];
    developmentOnly: boolean;
  }>;
}>;

export type ValidationResult<T> =
  | Readonly<{ valid: true; value: T }>
  | Readonly<{ valid: false; errors: readonly ErrorObject[] }>;

const schemaRoot = new URL("../../../packages/contracts/schemas/", import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const addFormats = (formatsPlugin as typeof formatsPlugin & { default?: typeof formatsPlugin }).default ?? formatsPlugin;
addFormats(ajv);

async function loadValidator(fileName: string): Promise<ValidateFunction> {
  const schema = JSON.parse(await readFile(new URL(fileName, schemaRoot), "utf8")) as object;
  return ajv.compile(schema);
}

const agentHelloValidator = await loadValidator("agent-hello.schema.json");
const serverHelloValidator = await loadValidator("server-hello.schema.json");
const observationRequestValidator = await loadValidator("observation-request.schema.json");

const sessionValidators = new Map<string, ValidateFunction>([
  ["heartbeat", await loadValidator("heartbeat.schema.json")],
  ["session.close", await loadValidator("session-close.schema.json")],
  ["session.resume.request", await loadValidator("session-resume-request.schema.json")],
  ["observation.accepted", await loadValidator("observation-accepted.schema.json")],
  ["observation.result", await loadValidator("observation-result.schema.json")],
  ["observation.failed", await loadValidator("observation-failed.schema.json")],
  ["observation.cancelled", await loadValidator("observation-cancelled.schema.json")],
]);

const observationCancelValidator = await loadValidator("observation-cancel.schema.json");

function validate<T>(validator: ValidateFunction, value: unknown): ValidationResult<T> {
  return validator(value)
    ? { valid: true, value: value as T }
    : { valid: false, errors: validator.errors ?? [] };
}

export function validateAgentHello(value: unknown): ValidationResult<AgentHello> {
  return validate<AgentHello>(agentHelloValidator, value);
}

export function validateServerHello(value: unknown): ValidationResult<ServerHello> {
  return validate<ServerHello>(serverHelloValidator, value);
}

export function validateSessionMessage(messageType: string, value: unknown): ValidationResult<Record<string, unknown>> {
  const validator = sessionValidators.get(messageType);
  return validator
    ? validate<Record<string, unknown>>(validator, value)
    : { valid: false, errors: [] };
}

export function validateObservationRequest(value: unknown): ValidationResult<Record<string, unknown>> {
  return validate<Record<string, unknown>>(observationRequestValidator, value);
}

export function validateObservationCancel(value: unknown): ValidationResult<Record<string, unknown>> {
  return validate<Record<string, unknown>>(observationCancelValidator, value);
}

export async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

export function repositoryPath(relativePath: string): string {
  return fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));
}
