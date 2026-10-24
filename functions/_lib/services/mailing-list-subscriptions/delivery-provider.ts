/** Provider-neutral mailing-list membership and delivery boundary. */
export interface MailingListDeliveryMember {
  email: string;
  protected: boolean;
  delivery: "all" | "none";
}
export interface MailingListDeliveryChange {
  email: string;
  delivery?: "all" | "none";
  action: "subscribe" | "unsubscribe" | "disable_delivery";
}
export interface MailingListDeliveryProvider {
  listMembers(listEmail: string): Promise<{ members: MailingListDeliveryMember[]; complete: boolean }>;
  applyChange(listEmail: string, change: MailingListDeliveryChange): Promise<void>;
}
