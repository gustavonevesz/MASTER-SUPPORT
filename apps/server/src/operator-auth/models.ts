export const consoleReadPermission = "console.read" as const;
export type OperatorStatus = "Active" | "Disabled";
export type OperatorRole = "OperatorReader";
export type ProviderIdentity = Readonly<{ provider: string; providerSubject: string; displayName: string }>;
export type AuthenticatedOperator = Readonly<{ operatorId: string; displayName: string; role?: OperatorRole; permissions: readonly string[] }>;
export type OperatorSessionView = Readonly<{ operatorSessionId: string; operator: AuthenticatedOperator; csrfToken: string }>;
export type OperatorRecord = Readonly<{ operatorId:string;provider:string;providerSubject:string;displayName:string;status:OperatorStatus;role?:OperatorRole;createdAt:string;lastAuthenticatedAt?:string }>;
