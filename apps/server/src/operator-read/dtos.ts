export type Page<T> = Readonly<{ items:readonly T[]; page:number; pageSize:number; total:number; totalPages:number }>;

export type AssetSummaryDto = Readonly<{ assetId:string;displayName:string;externalInventoryId?:string;assetType:"WindowsEndpoint";
  status:"Active"|"Retired";lastObservedAt?:string;latestPreflightStatus?:string;knownState?:string }>;

export type EndpointSummaryDto = Readonly<{ observedEndpointId:string;observedMachineName?:string;platform:string;firstObservedAt:string;
  lastObservedAt:string;linkStatus:"Active"|"Revoked";confirmationMethod:"HumanReview";sessionId:string }>;

export type PreflightSummaryDto = Readonly<{ preflightRunId:string;sessionId:string;observedEndpointId:string;capturedAt:string;
  status:string;completenessPercent?:number;observationCount:number;factsByCapability:Readonly<Record<string,unknown>> }>;

export type AssetDetailDto = Readonly<{ asset:AssetSummaryDto;identity:Readonly<{state:"Confirmed Asset";method:"HumanReview"}>;
  latestObservedEndpoint?:EndpointSummaryDto;latestPreflight?:PreflightSummaryDto;endpoints:readonly EndpointSummaryDto[] }>;

export type TimelineEventDto = Readonly<{ eventId:string;occurredAt:string;kind:string;title:string;detail?:string;sessionId?:string;
  preflightRunId?:string;observedEndpointId?:string }>;

export type SessionSummaryDto = Readonly<{ sessionId:string;historicalStatus:string;agentVersion?:string;protocolVersion:string;createdAt:string;
  lastSeenAt:string;endedAt?:string;endReason?:string;observedEndpoint?:Readonly<{observedEndpointId:string;observedMachineName?:string}>;
  asset?:Readonly<{assetId:string;displayName:string;externalInventoryId?:string}> }>;

export type UnreviewedEndpointDto = Readonly<{ observedEndpointId:string;observedMachineName?:string;platform:string;firstObservedAt:string;
  lastObservedAt:string;reviewState:"Pending human review";latestPreflight?:PreflightSummaryDto }>;
