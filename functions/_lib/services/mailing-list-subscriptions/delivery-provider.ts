/** A roster establishes membership and privileges, never delivery settings. */
export interface MailingListDeliveryMember {
  email: string;
  protected: boolean;
}
export interface MailingListDeliveryChange {
  email: string;
  delivery?: "none";
  action: "subscribe" | "unsubscribe";
}
export interface MailingListDeliveryProvider {
  listMembers(listEmail: string): Promise<{ members: MailingListDeliveryMember[]; complete: boolean }>;
  /** True only when a provider write changed membership or delivery. */
  applyChange(listEmail: string, change: MailingListDeliveryChange): Promise<boolean>;
}
