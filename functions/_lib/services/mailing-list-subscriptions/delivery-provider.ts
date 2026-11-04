export const MAX_DELIVERY_INSPECTIONS = 25;

/** Provider-neutral mailing-list membership and delivery boundary. */
export interface MailingListDeliveryMember {
  email: string;
  protected: boolean;
  delivery: "all" | "none" | "unknown";
}
export interface MailingListDeliveryChange {
  email: string;
  delivery?: "all" | "none";
  action: "subscribe" | "unsubscribe" | "disable_delivery" | "enable_delivery";
}
export interface MailingListDeliveryProvider {
  listMembers(listEmail: string): Promise<{ members: MailingListDeliveryMember[]; complete: boolean }>;
  readDelivery(listEmail: string, emails: readonly string[]): Promise<MailingListDeliveryMember[]>;
  /** True only when a provider write changed membership or delivery. */
  applyChange(listEmail: string, change: MailingListDeliveryChange): Promise<boolean>;
}
