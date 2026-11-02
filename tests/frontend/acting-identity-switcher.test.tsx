// @vitest-environment jsdom
/**
 * The cards offered after sign-in to someone who holds several identities.
 *
 * An organization is offered first and suggested (the primary, green card); a person with only a
 * personal identity is suggested nothing. A card names the identity, then what the person does
 * there and what membership it holds, without repeating itself, and renders any name as text.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { ActingIdentitySwitcher } from "../../assets/ts/member-flows/portal/shell/ActingIdentitySwitcher";
import type { PortalSession } from "../../assets/ts/member-flows/portal/types";
import { portalSessionFixture } from "../helpers/portal-session";

type Choice = PortalSession["actingIdentities"][number];
const identity = (over: Partial<Choice> & { id: string }): Choice => ({
  organizationId: null,
  organizationName: null,
  jobTitle: null,
  membershipCategory: null,
  membershipLabel: null,
  ...over,
});

let host: HTMLDivElement | undefined;
afterEach(() => {
  if (host) void act(() => render(null, host!));
  host?.remove();
  host = undefined;
});

async function offered(actingIdentities: Choice[]) {
  host = document.createElement("div");
  document.body.append(host);
  const session = { ...portalSessionFixture({}), actingIdentities, actingIdentityId: null };
  await act(() => render(<ActingIdentitySwitcher session={session} onChosen={() => {}} />, host!));
  return [...host.querySelectorAll<HTMLButtonElement>(".pk-login__controls button")];
}
const name = (button: HTMLElement) => button.querySelector(".pk-identity-choice__name")?.textContent;
const detail = (button: HTMLElement) => button.querySelector(".pk-identity-choice__detail")?.textContent;

describe("the identity cards after sign-in", () => {
  it("offers a member organization first, as the one suggestion", async () => {
    const buttons = await offered([
      identity({ id: "p" }),
      identity({
        id: "o",
        organizationId: "org-1",
        organizationName: "Alpha Org",
        jobTitle: "Delegate",
        membershipCategory: "A",
        membershipLabel: "Certification Authorities",
      }),
    ]);
    expect(buttons.map(name)).toEqual(["Alpha Org", "Personal"]);
    expect(buttons[0].className).toContain("pk-btn--primary");
    expect(buttons[1].className).not.toContain("pk-btn--primary");
    expect(detail(buttons[0])).toBe("Delegate · Certification Authorities");
    expect(buttons[0].querySelector(".pk-identity-choice__mark")).not.toBeNull();
    expect(buttons[1].querySelector(".pk-identity-choice__mark")).toBeNull();
  });

  it("suggests nothing to a person who only holds personal identities", async () => {
    const buttons = await offered([identity({ id: "a" }), identity({ id: "b" })]);
    expect(buttons.some((button) => button.className.includes("pk-btn--primary"))).toBe(false);
  });

  it("does not repeat the job title when two organizations share a name and the name already carries it", async () => {
    const buttons = await offered([
      identity({ id: "1", organizationId: "o1", organizationName: "Acme", jobTitle: "CTO" }),
      identity({ id: "2", organizationId: "o2", organizationName: "Acme", jobTitle: "Advisor" }),
    ]);
    for (const button of buttons) {
      const shown = name(button)!;
      const title = shown.includes("CTO") ? "CTO" : "Advisor";
      expect(shown).toContain(title);
      expect(detail(button) ?? "").not.toContain(title);
    }
  });

  it("shows any name, however hostile, as text", async () => {
    const hostile = '<img src=x onerror="window.__pwned=1"> & "quoted"';
    const buttons = await offered([
      identity({ id: "o", organizationId: "o", organizationName: hostile, jobTitle: "<b>x</b>" }),
      identity({ id: "p" }),
    ]);
    expect(name(buttons[0])).toBe(hostile);
    expect(buttons[0].querySelector("img[onerror]")).toBeNull();
    expect(buttons[0].querySelector("b")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("lists every identity, in a steady order, when a person holds a hundred", async () => {
    const many = Array.from({ length: 100 }, (_, index) =>
      index % 10 === 0
        ? identity({ id: `p${index}` })
        : identity({
            id: `o${index}`,
            organizationId: `org-${index}`,
            organizationName: `Org ${index}`,
            membershipCategory: index % 3 ? null : "A",
          }),
    );
    const buttons = await offered(many);
    expect(buttons).toHaveLength(100);
    const firstPersonal = buttons.findIndex((button) => name(button) === "Personal");
    expect(buttons.slice(firstPersonal).every((button) => name(button) === "Personal")).toBe(true);
    expect(buttons.filter((button) => button.className.includes("pk-btn--primary"))).toHaveLength(1);
  });
});
