export function requireSafeOperatorAuthConfiguration(input:{host:string;provider:string;developmentEnabled:boolean;publicOrigin:string}):void{
  if(input.host!=="127.0.0.1")throw new Error("operator_auth_requires_127.0.0.1");const origin=new URL(input.publicOrigin);if(origin.hostname!=="127.0.0.1"||origin.username||origin.password)throw new Error("operator_origin_requires_127.0.0.1");
  if(input.provider==="development"&&!input.developmentEnabled)throw new Error("development_auth_requires_explicit_enablement");if(!["development","oidc"].includes(input.provider))throw new Error("unsupported_operator_auth_provider");
}
