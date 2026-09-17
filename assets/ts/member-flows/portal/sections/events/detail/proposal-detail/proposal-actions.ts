/**
 * The commands an operator holds over a proposal, as one record actions menu.
 *
 * The old dashboard drew these as eight block buttons stacked in a sidebar —
 * the manage page, two ways to reach the proposer's address, two reminders,
 * two moderation flags and a delete — each sized like a primary control. A
 * record's commands live behind one `…` in its header, the way every other
 * record in the portal offers them, sized by their importance rather than
 * their number; the destructive one is told apart by tone and confirmation.
 */
import type { MenuItem } from "../../../../../../ui/Menu";
import type { ProposalAccess } from "../../types";
import type { ProposalDetailRecord } from "./model";

export type ProposalFlagAction = "spam" | "duplicate" | "delete";
export type ProposalReminderKind = "profile" | "presentation";

export function proposalActions({
  proposal,
  access,
  proposalRequiresPresentation,
  onOpenManage,
  onCopyProposerEmail,
  onRemind,
  onFlag,
}: {
  proposal: ProposalDetailRecord;
  access: ProposalAccess;
  proposalRequiresPresentation: boolean;
  onOpenManage: () => void;
  onCopyProposerEmail: () => void;
  onRemind: (kind: ProposalReminderKind) => void;
  onFlag: (action: ProposalFlagAction) => void;
}): MenuItem[] {
  if (!access.canFinalize) return [];
  const items: MenuItem[] = [
    { id: "manage", label: "Open proposer manage page", onSelect: onOpenManage },
    {
      id: "email",
      label: "Email proposer",
      // A mailto is a navigation the browser hands to the mail client; it
      // has to be assigned, not opened in a tab that would stay blank.
      onSelect: () => window.location.assign(`mailto:${proposal.proposer_email}`),
    },
    { id: "copy-email", label: "Copy proposer email", onSelect: onCopyProposerEmail },
    {
      id: "remind-profile",
      label: "Remind speakers to complete their profile",
      separatorBefore: true,
      onSelect: () => onRemind("profile"),
    },
  ];
  if (proposal.decision_status === "accepted" && proposalRequiresPresentation) {
    items.push({
      id: "remind-presentation",
      label: "Remind speakers to upload their presentation",
      onSelect: () => onRemind("presentation"),
    });
  }
  if (!proposal.decision_status) {
    items.push(
      {
        id: "spam",
        label: proposal.status === "spam" ? "Marked as spam" : "Mark as spam",
        separatorBefore: true,
        disabled: proposal.status === "spam",
        onSelect: () => onFlag("spam"),
      },
      {
        id: "duplicate",
        label: proposal.status === "duplicate" ? "Marked as duplicate" : "Mark as duplicate",
        disabled: proposal.status === "duplicate",
        onSelect: () => onFlag("duplicate"),
      },
      { id: "delete", label: "Delete proposal", danger: true, onSelect: () => onFlag("delete") },
    );
  }
  return items;
}
