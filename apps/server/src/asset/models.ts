export type AssetStatus = "Active" | "Retired";
export type Asset = Readonly<{
  assetId: string;
  assetType: "WindowsEndpoint";
  displayName: string;
  externalInventoryId?: string;
  status: AssetStatus;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AssetEndpointLink = Readonly<{
  linkId: string;
  assetId: string;
  observedEndpointId: string;
  confirmedAt: Date;
  confirmedBy: "local_operator";
  confirmationMethod: "HumanReview";
  status: "Active" | "Revoked";
  revokedAt?: Date;
  revokedBy?: "local_operator";
  revocationReason?: string;
}>;

export type UnreviewedObservedEndpoint = Readonly<{
  observedEndpointId: string;
  observedMachineName?: string;
  platform: string;
  firstObservedAt: Date;
  lastObservedAt: Date;
  latestPreflight?: Readonly<{
    preflightRunId: string;
    completedAt: Date;
    status: string;
    completenessPercent?: number;
    factsByCapability: Readonly<Record<string, unknown>>;
  }>;
}>;

export type HumanReview = Readonly<{
  actorType: "local_operator";
  confirmationMethod: "HumanReview";
}>;

export const localHumanReview: HumanReview = { actorType: "local_operator", confirmationMethod: "HumanReview" };
