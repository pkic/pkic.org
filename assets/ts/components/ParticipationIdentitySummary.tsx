import type { z } from "zod";
import { eventProposalProofPersonSchema } from "../../shared/schemas/event-proposal-proof";
import { DescriptionList } from "../ui/DescriptionList";
import type { MemberJoinApplicantKind } from "../../shared/schemas/member-join";

/** Known person and affiliation details stay readable without asking for them again. */
export function ParticipationIdentitySummary({
  person,
  applicantKind,
  knownOnly = false,
  scope = "all",
}: {
  person: z.infer<typeof eventProposalProofPersonSchema>;
  applicantKind?: MemberJoinApplicantKind;
  knownOnly?: boolean;
  scope?: "all" | "person" | "representation";
}) {
  const personal = [
    { term: "Name", value: [person.firstName, person.lastName].filter(Boolean).join(" ") },
    ...(scope === "all" ? [{ term: "Email", value: person.email }] : []),
  ];
  const representation = [
    ...(scope === "representation"
      ? [
          {
            term: person.organizationName || applicantKind === "organization" ? "Organization email" : "Verified email",
            value: person.email,
          },
        ]
      : []),
    {
      term: "Organization",
      value:
        person.organizationName ??
        (applicantKind === "organization"
          ? knownOnly
            ? null
            : "Organization details needed"
          : "Individual participation"),
    },
    { term: "Job title", value: person.jobTitle },
  ];
  const items =
    scope === "person" ? personal : scope === "representation" ? representation : [...personal, ...representation];
  const visible = items.filter((item) => !knownOnly || Boolean(item.value));
  return visible.length ? <DescriptionList items={visible} /> : null;
}
