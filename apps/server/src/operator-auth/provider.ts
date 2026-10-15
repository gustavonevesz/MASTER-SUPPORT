import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import type { ProviderIdentity } from "./models.js";

export type ProviderStart = Readonly<{ redirectUrl: string; context: unknown }>;
export interface OperatorAuthProvider {
  readonly id: string;
  begin(input: Readonly<{ state:string;nonce:string;redirectUri:string }>): Promise<ProviderStart>;
  complete(input: Readonly<{ callbackUrl:string;state:string;nonce:string;redirectUri:string;context:unknown }>): Promise<ProviderIdentity>;
}

export class OidcOperatorAuthProvider implements OperatorAuthProvider {
  public readonly id: string;
  private constructor(id:string,private readonly configuration:oidc.Configuration){this.id=id;}
  public static async discover(input:{id:string;issuer:string;clientId:string;clientSecret:string}):Promise<OidcOperatorAuthProvider>{
    const issuer=new URL(input.issuer);if(issuer.protocol!=="https:")throw new Error("oidc_issuer_requires_https");
    const configuration=await oidc.discovery(issuer,input.clientId,input.clientSecret);
    return new OidcOperatorAuthProvider(input.id,configuration);
  }
  public async begin(input:{state:string;nonce:string;redirectUri:string}):Promise<ProviderStart>{
    const codeVerifier=oidc.randomPKCECodeVerifier();const codeChallenge=await oidc.calculatePKCECodeChallenge(codeVerifier);
    const url=oidc.buildAuthorizationUrl(this.configuration,{redirect_uri:input.redirectUri,scope:"openid",state:input.state,nonce:input.nonce,
      code_challenge:codeChallenge,code_challenge_method:"S256"});
    return {redirectUrl:url.href,context:{codeVerifier}};
  }
  public async complete(input:{callbackUrl:string;state:string;nonce:string;redirectUri:string;context:unknown}):Promise<ProviderIdentity>{
    const context=object(input.context);if(typeof context["codeVerifier"]!=="string")throw new Error("invalid_provider_context");
    const tokens=await oidc.authorizationCodeGrant(this.configuration,new URL(input.callbackUrl),{pkceCodeVerifier:context["codeVerifier"],expectedState:input.state,expectedNonce:input.nonce,idTokenExpected:true});
    const claims=tokens.claims();if(!claims||typeof claims.sub!=="string")throw new Error("oidc_subject_missing");
    const displayName=typeof claims.name==="string"?claims.name:claims.sub;
    return {provider:this.id,providerSubject:claims.sub,displayName};
  }
}

export class HarnessOperatorAuthProvider implements OperatorAuthProvider {
  private readonly codes=new Map<string,ProviderIdentity>();
  public constructor(public readonly id:string,private readonly identity:ProviderIdentity,private readonly accept=true){}
  public async begin(input:{state:string;redirectUri:string}):Promise<ProviderStart>{
    const code=randomBytes(24).toString("base64url");this.codes.set(code,this.identity);const url=new URL(input.redirectUri);url.searchParams.set("state",input.state);url.searchParams.set("code",code);
    return {redirectUrl:url.href,context:{}};
  }
  public async complete(input:{callbackUrl:string}):Promise<ProviderIdentity>{const code=new URL(input.callbackUrl).searchParams.get("code")??"";const identity=this.codes.get(code);this.codes.delete(code);
    if(!this.accept||!identity)throw new Error("provider_authentication_failed");return identity;}
}
function object(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
