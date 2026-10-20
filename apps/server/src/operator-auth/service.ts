import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "../session/clock.js";
import type { OperatorRole,OperatorStatus, ProviderIdentity } from "./models.js";
import { consoleReadPermission } from "./models.js";
import { hash, OperatorAuthRepository } from "./repository.js";

export class OperatorAuthService {
  public constructor(public readonly repository:OperatorAuthRepository,private readonly clock:Clock,public readonly idleTtlMs=30*60_000,public readonly absoluteTtlMs=8*60*60_000){if(idleTtlMs<60_000||absoluteTtlMs<idleTtlMs)throw new Error("invalid_operator_session_ttl");}
  public async authenticate(identity:ProviderIdentity):Promise<{token:string;operatorSessionId:string}>{const now=this.clock.now();const operator=await this.repository.findIdentity(identity);if(!operator){await this.repository.audit("operator.authentication_failed",now,"rejected",undefined,undefined,identity.provider,"not_provisioned");throw new Error("operator_not_provisioned");}if(operator.status!=="Active"){await this.repository.audit("operator.authentication_failed",now,"rejected",operator.operatorId,undefined,identity.provider,"operator_disabled");throw new Error("operator_disabled");}const token=randomBytes(32).toString("base64url");await this.repository.authenticated(operator.operatorId,identity.displayName,now);const operatorSessionId=await this.repository.createSession(operator.operatorId,hash(token),now,this.idleTtlMs,this.absoluteTtlMs);await this.repository.audit("operator.authentication_succeeded",now,"accepted",operator.operatorId,operatorSessionId,identity.provider);return {token,operatorSessionId};}
  public async authorize(token:string|undefined,permission:string=consoleReadPermission){if(!token)return {status:401 as const};const result=await this.repository.lookup(hash(token),this.clock.now(),this.idleTtlMs);if(result.state!=="valid")return {status:401 as const};if(!result.operator.permissions.includes(permission)){await this.repository.audit("authorization.denied",this.clock.now(),"rejected",result.operator.operatorId,result.operatorSessionId,undefined,`missing_${permission.replace(".","_")}`);return {status:403 as const,session:result};}return {status:200 as const,session:result,csrfToken:csrf(token)};}
  public logout(token:string){return this.repository.revoke(hash(token),this.clock.now());}
  public list(){return this.repository.list();}
  public provision(identity:ProviderIdentity,role:OperatorRole="OperatorReader"){return this.repository.provision(identity,this.clock.now(),role);}
  public setStatus(id:string,status:OperatorStatus){return this.repository.setStatus(id,status,this.clock.now());}
}
export function csrf(token:string):string{return createHash("sha256").update(`master-support-csrf:${token}`).digest("base64url");}
