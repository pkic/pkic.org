import { expect, it } from "vitest";
import { accountPolicyOfTerm } from "../../assets/shared/account-policies";

it("treats an event term as an account policy only when it is required and links to that policy's page", () => {
  const term = { termKey: "code-of-conduct", contentRef: "/code-of-conduct/", required: true };
  expect(accountPolicyOfTerm(term)?.version).toBe("2021-03-25");
  expect(accountPolicyOfTerm({ ...term, contentRef: "/code-of-conduct" })?.termKey).toBe("code-of-conduct");
  expect(accountPolicyOfTerm({ ...term, contentRef: "https://pkic.org/code-of-conduct/" })).not.toBeNull();
  // The event's own document, another site, no link, or an optional term is asked as is.
  expect(accountPolicyOfTerm({ ...term, contentRef: "/events/pqc-2026/rules/" })).toBeNull();
  expect(accountPolicyOfTerm({ ...term, contentRef: "https://example.test/code-of-conduct/" })).toBeNull();
  expect(accountPolicyOfTerm({ ...term, contentRef: null })).toBeNull();
  expect(accountPolicyOfTerm({ ...term, required: false })).toBeNull();
  expect(accountPolicyOfTerm({ ...term, termKey: "photo-policy" })).toBeNull();
});
