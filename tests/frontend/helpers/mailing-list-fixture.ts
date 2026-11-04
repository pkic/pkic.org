import type { MailingListSubscriber } from "../../../assets/shared/schemas/mailing-lists";

export function mailingListSubscriberFixture(overrides: Partial<MailingListSubscriber> = {}): MailingListSubscriber {
  return {
    user: {
      id: "b0000000-0000-4000-8000-000000000001",
      email: "ada@example.test",
      first_name: "Ada",
      last_name: "Lovelace",
      organization_name: "Analytical Engines",
      job_title: null,
      headshotUrl: "/api/v1/users/example/headshots/portrait.png",
    },
    eligible: true,
    defaultSubscribed: true,
    preference: null,
    subscribed: true,
    suppressed: false,
    synchronizationStatus: null,
    synchronizationError: null,
    ...overrides,
  };
}
