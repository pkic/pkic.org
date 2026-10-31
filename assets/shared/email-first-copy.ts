/**
 * Every word the email-first entry says, once, for each flow that starts from
 * it. Registration and proposals speak event-neutrally — a person continues
 * with their work email and confirms it is theirs; nobody "signs up" or makes
 * an "account". Joining keeps the eligibility wording membership requires.
 *
 * The two refusals are also the shared request contract's messages, so the
 * browser and the server say the same thing whichever of them refuses.
 */

/** The steer for a consumer mailbox (gmail.com and the like) when no individual capacity was chosen. */
export const WORK_EMAIL_STEER = "Please use your work address, so we can connect you to your organization.";
export const DISPOSABLE_EMAIL_REFUSED = "Disposable email providers are not accepted.";

export type EmailFirstFlow = "registration" | "proposal" | "speaker" | "join" | "representation";

/** One of the two ways in: the card that explains it, then the field and action it leads to. */
export interface EmailFirstChoiceCopy {
  /** Names the card's radio. */
  title: string;
  /** The word in the title that sets the two cards apart, drawn with emphasis. */
  emphasis: string;
  description?: string;
  /** What this choice gives (work) or costs (personal), said before it is chosen. */
  points: readonly string[];
  label: string;
  /** An address that cannot belong to anyone (RFC 2606), showing what this kind of address looks like. */
  placeholder: string;
  action: string;
}

export interface EmailFirstCopy {
  work: EmailFirstChoiceCopy;
  personal: EmailFirstChoiceCopy;
  /** A signed-in person's switch to taking part as an individual, where no email step is shown. */
  individualSwitch?: string;
  sentTitle: string;
  sent: (email: string) => string;
  changeEmail: string;
}

/** Example work address for placeholders and help; example.* domains never belong to anyone (RFC 2606). */
export const EXAMPLE_WORK_EMAIL = "name@organization.example";
export const EXAMPLE_PERSONAL_EMAIL = "name@example.com";

/** Said wherever a registrant weighs a personal address: it is handled last on every waiting list. */
export const PERSONAL_ADDRESS_WAITLIST =
  "Registrations with a personal email address are handled last and placed at the end of every waiting list. Use your work address to keep your place.";

/** The question the two cards answer, in every flow: read to assistive technology, not drawn. */
export const EMAIL_FIRST_CHOICE_QUESTION = "Which email will you use?";

/**
 * Advice on the field when the address and the chosen card disagree. The
 * server's classification of the domain decides; the browser never guesses.
 */
export const EMAIL_FIRST_ADVISORY_COPY = {
  /** Work chosen and the server steered a free mailbox ({@link WORK_EMAIL_STEER}): the two ways on. */
  enterWork: "Enter a work address",
  usePersonal: "Use it as a personal email",
  /** Personal chosen, and the server reads the domain as an organization's. */
  looksWork: "This looks like a work address. Use it as your work email?",
  useAsWork: "Use it as my work email",
} as const;

const NO_ORGANIZATION_SHOWN = "No organization on your badge or in the event app";
const ORGANIZATION_SHOWN = "Your organization on your badge and in the event app";

const eventWork = {
  title: "Use your work email (recommended)",
  emphasis: "work",
  description: "The address at the organization you represent or work for.",
  label: "Your work email address",
  placeholder: EXAMPLE_WORK_EMAIL,
  action: "Verify your work email",
} as const;

const eventPersonal = {
  title: "Use a personal email",
  emphasis: "personal",
  description: "An address not associated with an organization you represent or work for.",
  label: "Your personal email address",
  placeholder: EXAMPLE_PERSONAL_EMAIL,
  action: "Verify your personal email",
} as const;

const eventCopy = {
  sentTitle: "Check your email",
  sent: (email: string) => `We sent a verification link to ${email}. Open it to continue.`,
  changeEmail: "Change email address",
} as const;

const SPEAKER_OWN_TRAVEL = "You usually arrange and pay for your own travel and attendance";
const INDEPENDENCE_DISCLOSURE = "You'll be asked for a short independence disclosure, which reviewers verify";

/** One rule for every individual path: work done for an organization is contributed through that organization. */
export const ORGANIZATION_CONTRIBUTION_RULE =
  "contributing on behalf of an organization requires that organization's representation";

export const EMAIL_FIRST_COPY: Readonly<Record<EmailFirstFlow, EmailFirstCopy>> = {
  representation: {
    ...eventCopy,
    work: {
      ...eventWork,
      points: [
        "Connect to your organization after confirming your email",
        "Use your organization and job title across the portal",
      ],
    },
    personal: { ...eventPersonal, points: ["Use your personal identity without an organization"] },
  },
  registration: {
    ...eventCopy,
    work: {
      ...eventWork,
      points: [
        ORGANIZATION_SHOWN,
        "Your normal place on every waiting list",
        "You take part on behalf of your organization",
      ],
    },
    personal: {
      ...eventPersonal,
      points: [NO_ORGANIZATION_SHOWN, "Handled last on every waiting list"],
    },
  },
  proposal: {
    ...eventCopy,
    work: {
      ...eventWork,
      points: [ORGANIZATION_SHOWN, "You submit on behalf of your organization, which authorizes the talk"],
    },
    personal: { ...eventPersonal, points: [NO_ORGANIZATION_SHOWN, SPEAKER_OWN_TRAVEL, INDEPENDENCE_DISCLOSURE] },
    individualSwitch: "I'm proposing as an individual",
  },
  speaker: {
    ...eventCopy,
    work: {
      ...eventWork,
      points: [ORGANIZATION_SHOWN, "You present on behalf of your organization, which authorizes the talk"],
    },
    personal: { ...eventPersonal, points: [NO_ORGANIZATION_SHOWN, SPEAKER_OWN_TRAVEL, INDEPENDENCE_DISCLOSURE] },
    individualSwitch: "I'm presenting as an individual",
  },
  join: {
    work: {
      ...eventWork,
      description: "The official address of the organization you work for or own.",
      label: "Your official work or organization email address",
      points: ["You take part on behalf of your organization", "We show the membership options for your organization"],
    },
    personal: {
      ...eventPersonal,
      description: "I am not employed by and do not own an organization.",
      label: "Your personal or university email address",
      points: [
        "Limited to the categories for people who are not employed by, do not own, and are not acting for an organization",
        `Covers only your own contributions: ${ORGANIZATION_CONTRIBUTION_RULE}`,
      ],
    },
    sentTitle: eventCopy.sentTitle,
    sent: (email) => `We sent an email to ${email} with your next step. Follow the instructions to continue.`,
    changeEmail: "Change email address",
  },
};

/** The job title asked wherever someone takes part on behalf of an organization: always required there. */
export const ORGANIZATION_JOB_TITLE_COPY = {
  label: "Job title",
  help: "Your role at the organization you represent, shown with your name.",
} as const;

/** The organization a verified work address names when its domain resolves to none. */
export const REGISTRATION_ORGANIZATION_COPY = {
  pendingReviewHelp:
    "You can register while our team reviews your organization affiliation. Your organization will appear on your registration after approval.",
  reviewRequired:
    "Our team will check the organization you named before it appears on your registration. You don't need to do anything.",
} as const;

/** A confirmed address that already belongs to someone else's saved details: nothing was linked or changed. */
export const ADDRESS_IN_USE_COPY = {
  title: "This address is already in use",
  body: (email: string) =>
    `Sign in with ${email} and return to this page to continue. Nothing was changed. If both addresses are yours, the secretariat can merge them.`,
  action: "Sign in",
} as const;

/** Where a person adds and verifies another email address of their own. */
export const ACCOUNT_EMAIL_ADDRESSES_HREF = "/portal/#/users/current/emails/new";

/** The gentle follow-up after registering with a personal address. */
export const PERSONAL_ADDRESS_FOLLOW_UP_COPY = {
  title: "Add your work address",
  body: "You registered with a personal email address. Add and verify your work address to connect with your organization and colleagues, show your affiliation on your badge, and receive your member benefits.",
  action: "Add a work address",
} as const;

/** A personal-address registrant waiting for a day or session seat: where they stand and how to regain their place. */
export const PERSONAL_ADDRESS_WAITLIST_COPY = {
  title: "On the waiting list — personal address, handled last",
  body: PERSONAL_ADDRESS_WAITLIST,
  action: "Use my work address",
} as const;

/** How organizers and sponsors see a personal-mailbox contact, in place of an organization. Never shown to attendees. */
export const PERSONAL_EMAIL_ADDRESS_LABEL = "Personal email address";

/** Organizers see that a waiting registrant holds no verified work address — a short pill… */
export const PERSONAL_ADDRESS_HANDLED_LAST_LABEL = "Personal email";
/** …whose consequence is its tooltip and accessible description. */
export const PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION =
  "No verified work address, so this registrant is handled last on every waiting list.";

/**
 * The independent-capacity disclosure a speaker completes before taking part
 * as an individual. A talk that draws on an organization's work is given on
 * that organization's behalf, so the questions confirm the person is truly
 * independent for this topic and accountable for what they present. Changing
 * this wording means issuing a new `INDEPENDENT_CAPACITY_DISCLOSURE_VERSION`.
 */
export const INDEPENDENT_CAPACITY_COPY = {
  title: "Taking part as an individual",
  intro:
    "A talk connected to an organization's work is given on that organization's behalf. These questions confirm that taking part as an individual is right for this talk.",
  question:
    "Are you currently employed by, contracted to, or representing an organization in connection with this topic?",
  yes: "Yes",
  no: "No",
  questionRequired: "Choose yes or no.",
  connectedTitle: "Please take part on behalf of your organization",
  connectedSteer:
    "Because your work for an organization relates to this topic, the talk needs to be given on its behalf. Continue with your work email address so we can connect you to it.",
  useWorkEmail: "Use my work email instead",
  noRelatedEngagement: "No current employer, client, or contract of mine is connected to this topic.",
  noRelatedEngagementRequired: "Confirm that no current employer, client, or contract is connected to this topic.",
  formerAffiliationsLabel: "Former employers or clients relevant to this topic",
  formerAffiliationsHelp:
    "Reviewers see this. If any are relevant, mention them in your speaker bio as well. Write “None” if there are none.",
  formerAffiliationsRequired: "List relevant former employers or clients, or write “None”.",
  currentPositionLabel: "Your current position",
  currentPositionHelp: "For example: Independent consultant, Retired, or Student at your university.",
  currentPositionRequired: "Describe your current position.",
  confirmationsLabel: "Please confirm",
  accountability: "I take personal responsibility for the content I present.",
  accountabilityRequired: "Confirm that you take personal responsibility for your content.",
  policyBefore: "I have read the ",
  iprPolicy: "IPR Agreement",
  iprPolicyHref: "/ipr/",
  policyBetween: " and the ",
  codeOfConduct: "Code of Conduct",
  codeOfConductHref: "/code-of-conduct/",
  policyAfter: `, and I understand that ${ORGANIZATION_CONTRIBUTION_RULE}.`,
  policyRequired: "Confirm that you have read the IPR Agreement and the Code of Conduct.",
} as const;

/** What reviewers see and do about an independent speaker's disclosure. */
export const INDEPENDENT_CAPACITY_REVIEW_COPY = {
  status: {
    pending: "Independent — affiliation to verify",
    verified: "Independent — verified",
    representation_requested: "Organizational representation requested",
  },
  formerAffiliations: "Former employers or clients",
  currentPosition: "Current position",
  emailAddress: "Email address",
  emailKind: { personal: PERSONAL_EMAIL_ADDRESS_LABEL, work: "Work email address" },
  attestedAt: "Disclosed",
  reviewedAt: "Reviewed",
  verify: "Mark affiliation verified",
  verifyConsequence: "The disclosure is recorded as verified by you.",
  requestRepresentation: "Request organizational representation",
  requestConsequence: "The speaker is emailed a link to choose the organization they represent.",
  verifiedToast: "Affiliation marked verified",
  requestedToast: "Organizational representation requested",
  appearanceWarningTitle: "Independent affiliation not verified",
  appearanceWarning: (names: string) =>
    `${names} takes part as an independent speaker, and the affiliation has not been verified yet. Approve this appearance anyway?`,
  appearanceApprove: "Approve anyway",
} as const;
