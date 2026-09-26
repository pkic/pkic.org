import type { GroupLabel } from "../../../../assets/shared/schemas/groups";
import type { ResourceGrantCapability, ResourceGrantKind } from "./definitions";

export interface ResourceGroupGrant<K extends ResourceGrantKind = ResourceGrantKind> {
  granteeGroup: GroupLabel;
  capability: ResourceGrantCapability<K>;
  createdByUserId: string | null;
  createdAt: string;
}

export interface ResourceGrantListQuery<K extends ResourceGrantKind = ResourceGrantKind> {
  limit: number;
  offset: number;
  q?: string;
  sort?: string;
  granteeGroupId?: string;
  capability?: ResourceGrantCapability<K>;
}

export interface ResourceGrantMutationInput<K extends ResourceGrantKind = ResourceGrantKind> {
  granteeGroupId: string;
  capability: ResourceGrantCapability<K>;
}
