import { z } from "zod";

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
  noticeBefore: "By starting an account, you confirm you've read the ",
  noticeAfter: ".",
  required: "Agree to follow the Code of Conduct to start your account.",
} as const;
