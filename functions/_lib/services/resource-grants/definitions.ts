import {
  EVENT_GROUP_CAPABILITIES,
  FORM_GROUP_CAPABILITIES,
  MAILING_LIST_GROUP_CAPABILITIES,
  VOTE_GROUP_CAPABILITIES,
  type EventGroupCapability,
  type FormGroupCapability,
  type MailingListGroupCapability,
  type VoteGroupCapability,
} from "../../../../assets/shared/schemas/resource-grants";

export interface ResourceGrantCapabilityMap {
  formPlacement: FormGroupCapability;
  event: EventGroupCapability;
  vote: VoteGroupCapability;
  mailingList: MailingListGroupCapability;
}

export type ResourceGrantKind = keyof ResourceGrantCapabilityMap;
export type ResourceGrantCapability<K extends ResourceGrantKind> = ResourceGrantCapabilityMap[K];

export interface ResourceGrantDefinition<K extends ResourceGrantKind = ResourceGrantKind> {
  kind: K;
  resourceTable: string;
  ownerGroupColumn: string;
  grantTable: string;
  grantResourceColumn: string;
  auditEntityType: string;
  capabilities: readonly ResourceGrantCapability<K>[];
  grantingCapabilities: Readonly<Record<ResourceGrantCapability<K>, readonly ResourceGrantCapability<K>[]>>;
  participantCapabilities: readonly ResourceGrantCapability<K>[];
  managerCapabilities: readonly ResourceGrantCapability<K>[];
}

const DEFINITIONS: { [K in ResourceGrantKind]: ResourceGrantDefinition<K> } = {
  formPlacement: {
    kind: "formPlacement",
    resourceTable: "form_placements",
    ownerGroupColumn: "owner_group_id",
    grantTable: "form_placement_group_grants",
    grantResourceColumn: "placement_id",
    auditEntityType: "form_placement",
    capabilities: FORM_GROUP_CAPABILITIES,
    grantingCapabilities: {
      view_definition: ["view_definition", "submit", "view_responses", "manage"],
      submit: ["submit"],
      view_responses: ["view_responses", "manage"],
      manage: ["manage"],
    },
    participantCapabilities: ["submit"],
    managerCapabilities: ["view_responses", "manage"],
  },
  event: {
    kind: "event",
    resourceTable: "events",
    ownerGroupColumn: "owner_group_id",
    grantTable: "event_group_grants",
    grantResourceColumn: "event_id",
    auditEntityType: "event",
    capabilities: EVENT_GROUP_CAPABILITIES,
    grantingCapabilities: {
      view: ["view", "register", "attend", "manage_attendance", "manage"],
      register: ["register"],
      attend: ["attend"],
      manage_attendance: ["manage_attendance", "manage"],
      manage: ["manage"],
    },
    participantCapabilities: ["register", "attend"],
    managerCapabilities: ["manage_attendance", "manage"],
  },
  vote: {
    kind: "vote",
    resourceTable: "votes",
    ownerGroupColumn: "owner_group_id",
    grantTable: "vote_group_grants",
    grantResourceColumn: "vote_id",
    auditEntityType: "vote",
    capabilities: VOTE_GROUP_CAPABILITIES,
    grantingCapabilities: {
      view: ["view", "participate", "view_results", "manage"],
      participate: ["participate"],
      view_results: ["view_results", "manage"],
      manage: ["manage"],
    },
    participantCapabilities: ["participate"],
    managerCapabilities: ["manage"],
  },
  mailingList: {
    kind: "mailingList",
    resourceTable: "mailing_lists",
    ownerGroupColumn: "group_id",
    grantTable: "mailing_list_group_grants",
    grantResourceColumn: "mailing_list_id",
    auditEntityType: "mailing_list",
    capabilities: MAILING_LIST_GROUP_CAPABILITIES,
    grantingCapabilities: {
      view: ["view", "subscribe", "post", "moderate", "manage"],
      subscribe: ["subscribe"],
      post: ["post"],
      moderate: ["moderate", "manage"],
      manage: ["manage"],
    },
    participantCapabilities: ["subscribe", "post"],
    managerCapabilities: ["moderate", "manage"],
  },
};

export function getResourceGrantDefinition<K extends ResourceGrantKind>(kind: K): ResourceGrantDefinition<K> {
  return DEFINITIONS[kind];
}

export function isResourceGrantCapability<K extends ResourceGrantKind>(
  definition: ResourceGrantDefinition<K>,
  capability: string,
): capability is ResourceGrantCapability<K> {
  return (definition.capabilities as readonly string[]).includes(capability);
}

export function isManagerResourceCapability<K extends ResourceGrantKind>(
  definition: ResourceGrantDefinition<K>,
  capability: ResourceGrantCapability<K>,
): boolean {
  return (definition.managerCapabilities as readonly string[]).includes(capability);
}

export function isParticipantResourceCapability<K extends ResourceGrantKind>(
  definition: ResourceGrantDefinition<K>,
  capability: ResourceGrantCapability<K>,
): boolean {
  return (definition.participantCapabilities as readonly string[]).includes(capability);
}

export function resourceGrantCapabilitiesFor<K extends ResourceGrantKind>(
  definition: ResourceGrantDefinition<K>,
  capability: ResourceGrantCapability<K>,
): readonly ResourceGrantCapability<K>[] {
  return definition.grantingCapabilities[capability];
}

export function memberResourceGrantCapabilitiesFor<K extends ResourceGrantKind>(
  definition: ResourceGrantDefinition<K>,
  capability: ResourceGrantCapability<K>,
): readonly ResourceGrantCapability<K>[] {
  return resourceGrantCapabilitiesFor(definition, capability).filter(
    (candidate) => !isManagerResourceCapability(definition, candidate),
  );
}

export function visibleResourceGrantCapabilitiesForContext<K extends ResourceGrantKind>(
  definition: ResourceGrantDefinition<K>,
  capability: ResourceGrantCapability<K>,
  access: { member: boolean; manager: boolean },
): ResourceGrantCapability<K>[] {
  const accepted = new Set<ResourceGrantCapability<K>>();
  if (access.member) {
    for (const candidate of memberResourceGrantCapabilitiesFor(definition, capability)) accepted.add(candidate);
  }
  if (access.manager) {
    for (const candidate of resourceGrantCapabilitiesFor(definition, capability)) {
      if (isManagerResourceCapability(definition, candidate)) accepted.add(candidate);
    }
  }
  return [...accepted];
}

export function effectiveResourceCapabilitiesForContext<K extends ResourceGrantKind>(
  definition: ResourceGrantDefinition<K>,
  access: {
    owner: boolean;
    member: boolean;
    manager: boolean;
    grantedCapabilities: readonly ResourceGrantCapability<K>[];
  },
): ResourceGrantCapability<K>[] {
  const granted = new Set<ResourceGrantCapability<K>>(access.grantedCapabilities);
  return definition.capabilities.filter((capability) => {
    const participant = isParticipantResourceCapability(definition, capability);
    const memberAllowed =
      access.member &&
      !isManagerResourceCapability(definition, capability) &&
      (access.owner ||
        memberResourceGrantCapabilitiesFor(definition, capability).some((candidate) => granted.has(candidate)));
    const managerAllowed =
      access.manager &&
      !participant &&
      (access.owner ||
        resourceGrantCapabilitiesFor(definition, capability).some(
          (candidate) => isManagerResourceCapability(definition, candidate) && granted.has(candidate),
        ));
    return memberAllowed || managerAllowed;
  });
}
