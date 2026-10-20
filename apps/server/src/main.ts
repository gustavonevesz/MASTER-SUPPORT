import { buildApp } from "./app.js";
import { logEvent } from "./logger.js";
import { PostgresPersistence } from "./persistence/postgres.js";
import { readFile } from "node:fs/promises";
import { SupportInvitationRepository, SupportInvitationService } from "./trust/invitation.js";
import { systemClock } from "./session/clock.js";
import { validateOperationalMode } from "./trust/config.js";
import { requireLoopbackOperatorConsole } from "./operator-read/config.js";
import { OperatorReadRepository } from "./operator-read/repository.js";
import { OperatorReadService } from "./operator-read/service.js";
import { requireSafeOperatorAuthConfiguration } from "./operator-auth/config.js";
import { HarnessOperatorAuthProvider, OidcOperatorAuthProvider } from "./operator-auth/provider.js";
import { OperatorAuthRepository } from "./operator-auth/repository.js";
import { OperatorAuthService } from "./operator-auth/service.js";
import { requireSafeSimulationConfiguration } from "./actions/config.js";
import { InMemorySimulationState,SimulatedActionExecutor,SimulatedActionVerifier,UnavailableActionExecutor,UnavailableActionVerifier } from "./actions/ports.js";
import { ActionRepository } from "./actions/repository.js";
import { ActionService } from "./actions/service.js";

const host = process.env["MASTER_SUPPORT_HOST"] ?? "127.0.0.1";
const port = Number(process.env["MASTER_SUPPORT_PORT"] ?? "3000");
try {
  const databaseUrl = process.env["MASTER_SUPPORT_DATABASE_URL"];
  if (!databaseUrl) throw new Error("MASTER_SUPPORT_DATABASE_URL is required; refusing non-durable operation.");
  const mode = process.env["MASTER_SUPPORT_MODE"];
  validateOperationalMode(mode, host);
  const operatorConsole=process.env["MASTER_SUPPORT_OPERATOR_CONSOLE"]==="true";
  requireLoopbackOperatorConsole(operatorConsole,host);
  const simulatedActions=process.env["MASTER_SUPPORT_ENABLE_SIMULATED_ACTIONS"]==="true";
  const actionScenario=scenario(process.env["MASTER_SUPPORT_SIMULATION_SCENARIO"]);
  requireSafeSimulationConfiguration({enabled:simulatedActions,mode:mode==="secure"?"secure":"development",host,...(actionScenario?{scenario:actionScenario}:{})});
  const authProviderName=process.env["MASTER_SUPPORT_OPERATOR_AUTH_PROVIDER"]??"oidc";
  const publicOrigin=process.env["MASTER_SUPPORT_OPERATOR_ORIGIN"]??"http://127.0.0.1:4173";
  if(operatorConsole)requireSafeOperatorAuthConfiguration({host,provider:authProviderName,developmentEnabled:process.env["MASTER_SUPPORT_DEV_AUTH"]==="true",publicOrigin});
  let https: { key: Buffer; cert: Buffer } | undefined;
  if (mode === "secure") {
    const certPath = process.env["MASTER_SUPPORT_TLS_CERT_PATH"]; const keyPath = process.env["MASTER_SUPPORT_TLS_KEY_PATH"];
    if (!certPath || !keyPath) throw new Error("secure mode requires MASTER_SUPPORT_TLS_CERT_PATH and MASTER_SUPPORT_TLS_KEY_PATH");
    https = { cert: await readFile(certPath), key: await readFile(keyPath) };
  }
  const durability = await PostgresPersistence.start(databaseUrl);
  const invitationRepository = mode === "secure" ? await SupportInvitationRepository.start(databaseUrl) : undefined;
  const operatorReadRepository=operatorConsole?await OperatorReadRepository.start(databaseUrl):undefined;
  const operatorRead=operatorReadRepository?new OperatorReadService(operatorReadRepository):undefined;
  const operatorAuthRepository=operatorConsole?await OperatorAuthRepository.start(databaseUrl):undefined;
  const actionRepository=operatorConsole?await ActionRepository.start(databaseUrl):undefined;
  let operatorAuth;
  if(operatorAuthRepository){const provider=authProviderName==="development"
      ?new HarnessOperatorAuthProvider("development",{provider:"development",providerSubject:required("MASTER_SUPPORT_DEV_OPERATOR_SUBJECT"),displayName:required("MASTER_SUPPORT_DEV_OPERATOR_DISPLAY_NAME")})
      :await OidcOperatorAuthProvider.discover({id:"oidc",issuer:required("MASTER_SUPPORT_OIDC_ISSUER"),clientId:required("MASTER_SUPPORT_OIDC_CLIENT_ID"),clientSecret:required("MASTER_SUPPORT_OIDC_CLIENT_SECRET")});
    operatorAuth={service:new OperatorAuthService(operatorAuthRepository,systemClock,Number(process.env["MASTER_SUPPORT_OPERATOR_IDLE_TTL_MS"]??"1800000"),Number(process.env["MASTER_SUPPORT_OPERATOR_ABSOLUTE_TTL_MS"]??"28800000")),provider,clock:systemClock,publicOrigin,secureCookie:new URL(publicOrigin).protocol==="https:",developmentProvider:authProviderName==="development"};}
  let actions:ActionService|undefined;
  if(actionRepository){const simulationState=simulatedActions?new InMemorySimulationState():undefined;const executor=simulationState?new SimulatedActionExecutor(simulationState,actionScenario):new UnavailableActionExecutor();const verifier=simulationState?new SimulatedActionVerifier(simulationState,actionScenario):new UnavailableActionVerifier();actions=new ActionService(actionRepository,systemClock,executor,verifier,{simulationEnabled:simulatedActions,development:mode!=="secure",loopback:host==="127.0.0.1"},Number(process.env["MASTER_SUPPORT_APPROVAL_TTL_MS"]??"900000"));await actions.reconcileAndResume();}
  const reconciled = await durability.reconcileRestart();
  const invitations = invitationRepository ? new SupportInvitationService(invitationRepository, systemClock,
    Number(process.env["MASTER_SUPPORT_INVITATION_TTL_MS"] ?? "600000")) : undefined;
  const { app, observations } = buildApp({ mode, ...(https ? { https } : {}), ...(invitations ? { invitations } : {}),...(operatorRead?{operatorRead}:{}),...(operatorAuth?{operatorAuth}:{}),...(actions?{actions}:{}), exposeDevelopmentSessions: mode === "development", durability,
    connectionTicketTtlMs: Number(process.env["MASTER_SUPPORT_CONNECTION_TICKET_TTL_MS"] ?? "60000"),
    resumeTicketTtlMs: Number(process.env["MASTER_SUPPORT_RESUME_TICKET_TTL_MS"] ?? "300000"),
    sessionOptions: { leaseDurationMs: Number(process.env["MASTER_SUPPORT_SESSION_LEASE_MS"] ?? "15000") } });
  if (invitationRepository) app.addHook("onClose", async () => invitationRepository.close());
  if(operatorReadRepository)app.addHook("onClose",async()=>operatorReadRepository.close());
  if(operatorAuthRepository)app.addHook("onClose",async()=>operatorAuthRepository.close());
  if(actionRepository)app.addHook("onClose",async()=>actionRepository.close());
  observations.metrics.increment("restart_reconciliations");
  for (let index = 0; index < reconciled.observations; index++) observations.metrics.increment("abandoned_after_restart");
  if (mode === "development") logEvent("error", "server.development_mode_loopback_only");
  if (authProviderName === "development" && operatorConsole) logEvent("error", "operator.development_auth_enabled_loopback_only");
  if (simulatedActions) logEvent("error", "actions.simulation_enabled_development_loopback_only");
  await app.listen({ host, port });
  logEvent("info", "server.started", { serverInstanceId: durability.serverInstanceId,
    restartSessions: reconciled.sessions, restartObservations: reconciled.observations });
} catch (error: unknown) {
  logEvent("error", "server.start_failed");
  process.stderr.write(`${error instanceof Error ? error.message : "Server startup failed."}\n`);
  process.exitCode = 1;
}
function required(name:string):string{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value;}
function scenario(value:string|undefined):"success"|"execution-fail"|"verification-fail"|"inconclusive"{if(value===undefined||value==="success")return "success";if(value==="execution-fail"||value==="verification-fail"||value==="inconclusive")return value;throw new Error("invalid_simulation_scenario");}
