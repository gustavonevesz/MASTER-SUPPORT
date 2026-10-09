export type PreflightStatus = "created"|"running"|"completed"|"partial"|"failed"|"cancelled"|"interrupted";
export type PreflightSnapshot = Readonly<{ preflightRunId:string; capturedAt:string; agentVersion?:string; protocolVersion:"1.0";
  capabilityVersions:Readonly<Record<string,string>>; observationIds:readonly string[]; completenessPercent:number; dataClassification:"INTERNAL" }>;
export type ObservedEndpoint = { observedEndpointId:string; sessionId:string; preflightRunId:string; observedMachineName?:string;
  firstObservedAt:string; lastObservedAt:string; platform:string };
export type PreflightRun = { preflightRunId:string; sessionId:string; createdAt:string; startedAt?:string; completedAt?:string;
  status:PreflightStatus; durationMs?:number; capabilityFailureCount:number; requestIds:string[]; observationIds:string[];
  capabilityResults:{capabilityId:string;requestId:string;observationId?:string}[];
  snapshot?:PreflightSnapshot; observedEndpoint?:ObservedEndpoint };
