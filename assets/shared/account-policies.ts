import { z } from "zod";
import type { EmailFirstFlow } from "./email-first-copy";

/**
 * The policies every account takes on when it is started: the person agrees
 * to follow the Code of Conduct with a checkbox, and is told about the Privacy
 * Policy (information, not consent). Both versions are recorded. Events do
 * not ask for them: an event's terms are its own, such as a photo policy. The
 * bylaws and the IPR Agreement stay with a membership application, which the
 * organization agrees to as well.
 *
 * Change `version` when the document changes in substance; asking accounts to
 * confirm a new version is a step of its own.
 */
export const ACCOUNT_POLICIES = [
  { termKey: "privacy-policy", version: "2024-09-17", title: "Privacy Policy", href: "/privacy/" },
  { termKey: "code-of-conduct", version: "2021-03-25", title: "Code of Conduct", href: "/code-of-conduct/" },
] as const;

export type AccountPolicy = (typeof ACCOUNT_POLICIES)[number];
export type AccountPolicyKey = AccountPolicy["termKey"];

export const accountPolicyKeySchema = z.enum(ACCOUNT_POLICIES.map((policy) => policy.termKey) as [AccountPolicyKey]);

export const ACCOUNT_POLICIES_COPY = {
  agreeBefore: "I agree to follow the ",
  agreeAfter: ".",
  noticeAfter: ".",
  required: "Agree to follow the Code of Conduct to create your account.",
} as const;

/**
 * The Privacy Policy notice before its link, in the words of what the person is
 * doing: taking part creates their account, so the notice says so.
 */
export const ACCOUNT_PRIVACY_NOTICE: Readonly<Record<EmailFirstFlow, string>> = {
  registration: "Registering for this event creates an account for you. By continuing, you confirm you've read the ",
  proposal: "Submitting a proposal creates an account for you. By continuing, you confirm you've read the ",
  speaker: "Taking part as a speaker creates an account for you. By continuing, you confirm you've read the ",
  join: "Applying for membership creates an account for you. By continuing, you confirm you've read the ",
  representation: "By creating an account, you confirm you've read the ",
};
