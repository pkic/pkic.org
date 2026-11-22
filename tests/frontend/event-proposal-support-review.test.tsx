// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_FIRST_COPY, PROOF_SUPPORT_COPY } from "../../assets/shared/email-first-copy";
import { CONSORTIUM_CONTACT_HREF } from "../../assets/shared/consortium-contact";
import { radioNamed } from "./helpers/labeled-control";
import { mountProposalIdentityStep, SPEAKER_LINK } from "./helpers/proposal-identity-fixture";
import { proposalProofResponse as response, proposalProofToken as TOKEN } from "./helpers/proposal-proof-response";
let host: HTMLDivElement | undefined;
afterEach(async () => {
  const mounted = host;
  if (mounted) await act(() => render(null, mounted));
  document.body.innerHTML = "";
  host = undefined;
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});
/** A proposer signs in instead of confirming a mailbox, so the review notice is reached through a speaker's link. */
describe("speaker address review", () => {
  it.each(["organization_domain_review", "address_review"] as const)(
    "retains the address and explains the next step for %s",
    async (reason) => {
      const email = "casey@research.example.test";
      history.replaceState({}, "", `/events/2026/pqc-2026/speaker/#verify=${TOKEN}`);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          response({
            status: "support_required",
            email,
            applicantKind: reason === "organization_domain_review" ? "organization" : "individual",
            reason,
          }),
        ),
      );
      host = await mountProposalIdentityStep({ enabled: true, onChange: () => {}, ...SPEAKER_LINK });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const alert = host.querySelector<HTMLElement>("[role=alert], .pk-alert")!;
      expect(alert.textContent).toContain(PROOF_SUPPORT_COPY[reason].title);
      expect(alert.textContent).toContain("Nothing was submitted.");
      expect(host.querySelector<HTMLInputElement>("input[type=email]")!.value).toBe(email);
      expect(
        [...alert.querySelectorAll<HTMLAnchorElement>("a")].find(
          (link) => link.textContent === PROOF_SUPPORT_COPY.contactAction,
        )?.href,
      ).toBe(CONSORTIUM_CONTACT_HREF);
      const personal = [...alert.querySelectorAll("button")].find(
        (button) => button.textContent === PROOF_SUPPORT_COPY.personalAction,
      );
      if (reason === "organization_domain_review") {
        expect(personal).toBeDefined();
        await act(() => personal!.click());
        expect(host.textContent).not.toContain(PROOF_SUPPORT_COPY[reason].title);
        expect(radioNamed(host, EMAIL_FIRST_COPY.speaker.personal.title).checked).toBe(true);
        expect(host.querySelector<HTMLInputElement>("input[type=email]")!.value).toBe("");
      } else expect(personal).toBeUndefined();
    },
  );
});
