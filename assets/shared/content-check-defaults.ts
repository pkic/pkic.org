/**
 * The PKIC-wide questions each check starts with until staff save their own.
 * The proposal scores follow the rubric reviewers used for the 2026
 * conference; an event adds its topics and tracks as context.
 */
import type { ContentCheckFlag, ContentCheckKind, ContentCheckScore, ContentCheckSettings } from "./content-checks";

const CONDUCT: ContentCheckFlag = {
  id: "conduct",
  kind: "flag",
  question:
    "Does this harass, insult, threaten or demean a person or group, contain hate speech, sexual content or slurs, or otherwise break a professional code of conduct?",
  adviseAtPercent: 60,
  blockAtPercent: 90,
  message: "This breaks the code of conduct.",
};

const SPAM: ContentCheckFlag = {
  id: "spam",
  kind: "flag",
  question:
    "Is this spam: advertising, unsolicited promotion of a product, service or job, repeated or unrelated links, a scam, or random text?",
  adviseAtPercent: 70,
  blockAtPercent: 95,
  message: "This looks like spam or advertising.",
};

const PERSONAL_DATA: ContentCheckFlag = {
  id: "personal_data",
  kind: "flag",
  question:
    "Does this share someone's private contact details, such as a phone number, home address or personal email address, or other private personal data?",
  adviseAtPercent: 70,
  blockAtPercent: null,
  message: "This shares someone's personal details.",
};

const LIVE_MESSAGE: ContentCheckSettings = {
  enabled: true,
  model: "clef-flash",
  context: "Messages are written by attendees of a professional conference on PKI, digital trust and cryptography.",
  questions: [CONDUCT, SPAM, PERSONAL_DATA],
};

function rubric(
  id: string,
  label: string,
  question: string,
  levels: [string, string, string, string, string],
  weight: number,
): ContentCheckScore {
  return { id, kind: "score", label, question, levels, weight };
}

const PROPOSAL: ContentCheckSettings = {
  enabled: true,
  model: "clef",
  context:
    "This is a proposal for a talk at a vendor-neutral professional conference on PKI, digital trust and cryptography, including post-quantum cryptography. The program favors practical experience, concrete lessons and evidence over theory or marketing, and talks that go beyond the introductory level.",
  questions: [
    {
      id: "promotional",
      kind: "flag",
      question:
        "Is this proposal mainly a sales or product pitch, promoting the speaker's company, product or service rather than sharing knowledge that applies beyond it?",
      adviseAtPercent: 60,
      blockAtPercent: 92,
      message:
        "This reads as a product or sales pitch. The program is vendor neutral: focus on lessons, data and practice that apply beyond your own product.",
    },
    {
      id: "off_topic",
      kind: "flag",
      question: "Is this proposal unrelated to the conference topics described in the context?",
      adviseAtPercent: 60,
      blockAtPercent: 92,
      message: "This does not seem to match the topics of this event. Explain how your talk relates to them.",
    },
    {
      id: "thin_abstract",
      kind: "flag",
      question: "Is the abstract too short or too vague to tell what the talk covers and what the audience will learn?",
      adviseAtPercent: 60,
      blockAtPercent: null,
      message:
        "The abstract does not yet say what the audience will learn. Describe the problem, your approach and the concrete takeaways.",
    },
    {
      id: "spam",
      kind: "flag",
      question: "Is this submission spam, a test entry, random text, or unrelated to a talk proposal?",
      adviseAtPercent: 50,
      blockAtPercent: 85,
      message: "This does not look like a talk proposal.",
    },
    { ...CONDUCT, blockAtPercent: 85 },
    rubric(
      "relevance",
      "Relevance",
      "How relevant is this talk to the conference topics in the context?",
      ["Unrelated", "Loosely related", "Related", "Clearly relevant", "Central to the program"],
      2,
    ),
    rubric(
      "practitioner_value",
      "Practitioner value",
      "How much practical value does this talk offer to people who build, run or migrate systems: production experience, concrete lessons, data or implementation evidence?",
      ["None", "Little", "Some", "Strong", "Exceptional"],
      2,
    ),
    rubric(
      "originality",
      "Originality",
      "How original is this talk: a new perspective, result or topic rarely covered, rather than an introduction or a familiar overview?",
      ["Generic overview", "Mostly familiar", "Some new angle", "Original", "Highly original"],
      1.5,
    ),
    rubric(
      "vendor_neutrality",
      "Vendor neutrality",
      "How vendor neutral is this talk: knowledge that applies across products rather than promotion of one?",
      ["Product pitch", "Mostly promotional", "Mixed", "Mostly neutral", "Fully neutral"],
      1.5,
    ),
    rubric(
      "audience_fit",
      "Audience fit",
      "How well does the depth of this talk fit an audience of experienced security, PKI and cryptography practitioners?",
      ["Poor fit", "Too basic or too narrow", "Acceptable", "Good fit", "Excellent fit"],
      1,
    ),
    rubric(
      "proposal_quality",
      "Proposal quality",
      "How clear, specific and complete is the proposal as written: a precise title, a well-structured abstract and stated takeaways?",
      ["Unusable", "Weak", "Adequate", "Good", "Excellent"],
      1,
    ),
  ],
};

const PRESENTATION: ContentCheckSettings = {
  enabled: true,
  model: "clef",
  context:
    "These are the slides for a talk at a vendor-neutral professional conference on PKI, digital trust and cryptography.",
  questions: [
    {
      id: "promotional",
      kind: "flag",
      question:
        "Are these slides mainly marketing: product features, customer logos, calls to buy or contact sales, rather than knowledge that applies beyond one product?",
      adviseAtPercent: 60,
      blockAtPercent: null,
      message: "These slides read as marketing. The program is vendor neutral.",
    },
    { ...CONDUCT, message: "These slides break the code of conduct." },
    {
      id: "confidential",
      kind: "flag",
      question:
        "Do these slides carry confidentiality markings, such as confidential, internal only or under NDA, or show private personal data?",
      adviseAtPercent: 60,
      blockAtPercent: null,
      message: "These slides are marked confidential or show personal data.",
    },
  ],
};

const ORGANIZATION_PROFILE: ContentCheckSettings = {
  enabled: true,
  model: "clef",
  context:
    "This is the public page of a member organization of PKIC, a vendor-neutral consortium on PKI, digital trust and cryptography. A member page describes the organization and what it does in the field, in plain factual terms: who it is, what it works on, and how it takes part. It is not an advertisement. Naming the organization's own products and services factually is fine; selling them, comparing them favorably, or making claims no reader can verify is not. The text is a slogan, a short description and a longer page, and any of them may be empty.",
  questions: [
    {
      id: "commercial",
      kind: "flag",
      question:
        "Is this text commercial: does it sell or advertise products or services with calls to buy, contact sales, request a demo or start a trial, or mention prices, discounts or offers, instead of describing the organization and its work?",
      adviseAtPercent: 55,
      blockAtPercent: null,
      message:
        "This reads as advertising. Describe what the organization is and does, and leave out calls to buy, prices and offers.",
    },
    {
      id: "biased_claims",
      kind: "flag",
      question:
        "Does this make superlative, comparative or unverifiable claims about the organization or its products, such as leading, best, number one, only, most trusted or unrivaled, or disparage competitors?",
      adviseAtPercent: 55,
      blockAtPercent: null,
      message:
        "This makes claims that readers cannot verify, such as leading or best. Describe facts about the organization instead.",
    },
    {
      id: "spam",
      kind: "flag",
      question:
        "Is this spam or abuse of the page: repeated or unrelated links, keyword stuffing, text unrelated to the organization, a scam, or random text?",
      adviseAtPercent: 60,
      blockAtPercent: 92,
      message: "This looks like spam rather than a description of the organization.",
    },
    {
      id: "off_topic",
      kind: "flag",
      question:
        "Does this say nothing about the organization and its work, for example because it only covers unrelated topics, politics or personal matters?",
      adviseAtPercent: 70,
      blockAtPercent: null,
      message: "This does not describe the organization and its work.",
    },
    { ...CONDUCT, blockAtPercent: 85, message: "This breaks the code of conduct." },
  ],
};

const PERSON_PROFILE: ContentCheckSettings = {
  enabled: true,
  model: "clef",
  context:
    "This is the biography and job title of a person who takes part in PKIC, a vendor-neutral consortium on PKI, digital trust and cryptography; it is shown with their sessions, proposals and registrations, and on organization pages. A good bio is a short professional description of the person, in the first or the third person: their role, their experience and their work in the field. Naming the employer and its work factually is fine. It is not a place to advertise.",
  questions: [
    {
      id: "promotional",
      kind: "flag",
      question:
        "Does this bio promote a company, product, service, event or person instead of describing the person: calls to buy or contact sales, discounts, or marketing language?",
      adviseAtPercent: 60,
      blockAtPercent: null,
      message:
        "This bio reads as promotion. Describe your role, experience and work, and leave out calls to buy or contact you for offers.",
    },
    {
      id: "spam",
      kind: "flag",
      question:
        "Is this spam or abuse of the profile: repeated or unrelated links, keyword stuffing, a scam, advertising for something unrelated, or random text?",
      adviseAtPercent: 60,
      blockAtPercent: 92,
      message: "This looks like spam rather than a bio.",
    },
    {
      id: "off_topic",
      kind: "flag",
      question:
        "Is this unrelated to a professional bio, for example a joke, a political statement, a rant, or text about someone else?",
      adviseAtPercent: 70,
      blockAtPercent: null,
      message: "This does not read as a professional bio. Describe your role and your work.",
    },
    { ...CONDUCT, blockAtPercent: 85, message: "This breaks the code of conduct." },
    {
      ...PERSONAL_DATA,
      message: "This shares private contact details. Keep a bio to your professional work.",
    },
  ],
};

export const DEFAULT_CONTENT_CHECK_SETTINGS: Record<ContentCheckKind, ContentCheckSettings> = {
  chat_message: LIVE_MESSAGE,
  audience_question: LIVE_MESSAGE,
  proposal: PROPOSAL,
  presentation: PRESENTATION,
  organization_profile: ORGANIZATION_PROFILE,
  person_profile: PERSON_PROFILE,
};
