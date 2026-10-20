import { simulationAction,type ActionRequestCommand,type PolicyResult,type Risk } from "./models.js";
import { resolveAction } from "./catalog.js";

export const policyVersion="core-003-policy-v1";
export type PolicyContext=Readonly<{simulationEnabled:boolean;development:boolean;loopback:boolean;risk?:Risk}>;
export function evaluatePolicy(command:ActionRequestCommand,context:PolicyContext):PolicyResult{
  const definition=resolveAction(command);const risk=context.risk??definition?.risk??"R4";
  const deny=(reason:string):PolicyResult=>({policyVersion,decision:"Deny",risk,reasonCodes:[reason]});
  if(!definition)return deny("unknown_action_version_or_target");
  if(["R2","R3","R4"].includes(risk))return deny("risk_not_permitted");
  if(!context.simulationEnabled)return deny("simulation_disabled");
  if(!context.development)return deny("simulation_forbidden_outside_development");
  if(!context.loopback)return deny("simulation_requires_loopback");
  return {policyVersion,decision:simulationAction.requiresApproval?"RequireApproval":"Allow",risk,reasonCodes:["simulation_r1_requires_explicit_approval"]};
}
