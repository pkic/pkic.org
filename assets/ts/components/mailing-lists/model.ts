import type { GroupMailingListCreateInput, MailingList } from "../../../shared/schemas/mailing-lists";
import {
  MAILING_LIST_PURPOSES,
  MAILING_LIST_SUBSCRIPTION_DEFAULTS,
  type MailingListModerationPolicy,
  type MailingListPostingPolicy,
} from "../../../shared/schemas/mailing-lists";
import { membershipCategorySchema, type MembershipCategory } from "../../../shared/schemas/membership-categories";

/** The editable representation used by group-scoped mailing-list forms. */
export interface MailingListDraft {
  email: string;
  label: string;
  purpose: (typeof MAILING_LIST_PURPOSES)[number];
  primaryDiscussion: boolean;
  subscriptionDefault: (typeof MAILING_LIST_SUBSCRIPTION_DEFAULTS)[number];
  postingPolicy: MailingListPostingPolicy;
  moderationPolicy: MailingListModerationPolicy;
  /** Empty array means "every membership category" — see MembershipCategoryPicker. */
  autoSyncCategories: MembershipCategory[];
  active: boolean;
}

export function emptyMailingListDraft(): MailingListDraft {
  return {
    email: "",
    label: "",
    purpose: "custom",
    primaryDiscussion: false,
    subscriptionDefault: "none",
    postingPolicy: "subscribers",
    moderationPolicy: "moderated",
    autoSyncCategories: [],
    active: true,
  };
}

export function mailingListToDraft(list: MailingList): MailingListDraft {
  return {
    email: list.email,
    label: list.label,
    purpose: list.purpose,
    primaryDiscussion: list.primaryDiscussion,
    subscriptionDefault: list.subscriptionDefault,
    postingPolicy: list.postingPolicy,
    moderationPolicy: list.moderationPolicy,
    autoSyncCategories: list.autoSyncCategories ?? [],
    active: list.active,
  };
}

function draftFields(draft: MailingListDraft) {
  return {
    email: draft.email.trim(),
    label: draft.label.trim(),
    purpose: draft.purpose,
    primaryDiscussion: draft.primaryDiscussion,
    subscriptionDefault: draft.subscriptionDefault,
    postingPolicy: draft.postingPolicy,
    moderationPolicy: draft.moderationPolicy,
    autoSyncCategories: draft.autoSyncCategories.length
      ? draft.autoSyncCategories.map((category) => membershipCategorySchema.parse(category))
      : null,
    active: draft.active,
  };
}

export function mailingListDraftToPayload(draft: MailingListDraft): GroupMailingListCreateInput {
  return draftFields(draft);
}
