import type {
  GroupMailingListCreateInput,
  MailingList,
  MailingListCreateInput,
} from "../../../shared/schemas/mailing-lists";
import { MAILING_LIST_PURPOSES, MAILING_LIST_SUBSCRIPTION_DEFAULTS } from "../../../shared/schemas/mailing-lists";
import { membershipCategorySchema } from "../../../shared/schemas/membership-categories";

/** The editable representation shared by global and group-scoped forms. */
export interface MailingListDraft {
  email: string;
  label: string;
  purpose: (typeof MAILING_LIST_PURPOSES)[number];
  groupId: string;
  primaryDiscussion: boolean;
  subscriptionDefault: (typeof MAILING_LIST_SUBSCRIPTION_DEFAULTS)[number];
  postingPolicy: string;
  moderationPolicy: string;
  autoSyncCategories: string;
  active: boolean;
}

export type MailingListFormScope = "admin" | "group";

export function emptyMailingListDraft(): MailingListDraft {
  return {
    email: "",
    label: "",
    purpose: "custom",
    groupId: "",
    primaryDiscussion: false,
    subscriptionDefault: "none",
    postingPolicy: "subscribers",
    moderationPolicy: "moderated",
    autoSyncCategories: "",
    active: true,
  };
}

export function mailingListToDraft(list: MailingList): MailingListDraft {
  return {
    email: list.email,
    label: list.label,
    purpose: list.purpose,
    groupId: list.groupId ?? "",
    primaryDiscussion: list.primaryDiscussion,
    subscriptionDefault: list.subscriptionDefault,
    postingPolicy: list.postingPolicy,
    moderationPolicy: list.moderationPolicy,
    autoSyncCategories: list.autoSyncCategories?.join(", ") ?? "",
    active: list.active,
  };
}

function draftFields(draft: MailingListDraft) {
  const categories = draft.autoSyncCategories.trim()
    ? draft.autoSyncCategories
        .split(",")
        .map((category) => category.trim())
        .filter(Boolean)
    : null;
  return {
    email: draft.email.trim(),
    label: draft.label.trim(),
    purpose: draft.purpose,
    primaryDiscussion: draft.primaryDiscussion,
    subscriptionDefault: draft.subscriptionDefault,
    postingPolicy: draft.postingPolicy.trim(),
    moderationPolicy: draft.moderationPolicy.trim(),
    autoSyncCategories: categories ? categories.map((category) => membershipCategorySchema.parse(category)) : null,
    active: draft.active,
  };
}

export function mailingListDraftToPayload(draft: MailingListDraft, scope: "admin"): MailingListCreateInput;
export function mailingListDraftToPayload(draft: MailingListDraft, scope: "group"): GroupMailingListCreateInput;
export function mailingListDraftToPayload(
  draft: MailingListDraft,
  scope: MailingListFormScope = "admin",
): MailingListCreateInput | GroupMailingListCreateInput {
  const fields = draftFields(draft);
  return scope === "group" ? fields : { ...fields, groupId: draft.groupId.trim() || null };
}
