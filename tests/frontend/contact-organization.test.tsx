// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { ContactOrganization } from "../../assets/ts/components/ContactOrganization";
import {
  PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION,
  PERSONAL_ADDRESS_HANDLED_LAST_LABEL,
  PERSONAL_EMAIL_ADDRESS_LABEL,
} from "../../assets/shared/email-first-copy";

let host: HTMLDivElement | undefined;
afterEach(() => {
  if (host) render(null, host);
  host?.remove();
  host = undefined;
});

async function mount(
  organization: string | null,
  personalEmail: boolean,
  handledLast = false,
  audience: "organizer" | "sponsor" = "sponsor",
) {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <ContactOrganization
        organization={organization}
        personalEmail={personalEmail}
        handledLast={handledLast}
        audience={audience}
      />,
      host!,
    ),
  );
  return host.textContent;
}

describe("contact organization", () => {
  it("marks a personal-mailbox contact instead of naming any organization", async () => {
    expect(await mount("Selected organization", true)).toBe(PERSONAL_EMAIL_ADDRESS_LABEL);
  });

  it("tells organizers why a waiting registrant is handled last in one pill", async () => {
    expect(await mount(null, true, true)).toBe(
      `${PERSONAL_ADDRESS_HANDLED_LAST_LABEL}: ${PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION}`,
    );
    const pills = host!.querySelectorAll(".pk-badge");
    expect(pills).toHaveLength(1);
    expect(pills[0]?.getAttribute("title")).toBe(PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION);
    expect(pills[0]?.querySelector(".pk-sr-only")?.textContent).toContain(PERSONAL_ADDRESS_HANDLED_LAST_DESCRIPTION);
  });

  it("shows organizers the same one pill for every personal-mailbox registrant, waiting or not", async () => {
    const waiting = await mount(null, true, true, "organizer");
    const notWaiting = await mount(null, true, false, "organizer");
    expect(notWaiting).toBe(waiting);
    expect(notWaiting).not.toContain(PERSONAL_EMAIL_ADDRESS_LABEL);
    expect(host!.querySelectorAll(".pk-badge--warn")).toHaveLength(1);
  });

  it("names the organization of a work-address contact", async () => {
    expect(await mount("Selected organization", false)).toBe("Selected organization");
  });
});
