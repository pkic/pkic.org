// @vitest-environment jsdom
/**
 * Vouching from the contact record.
 *
 * The panel never computes a vouch count itself: both endpoints answer with
 * the recounted set and the panel renders that. These tests hold that line,
 * and they hold the refusal path — a vouch the rules reject must say so, not
 * fail silently, because "nothing happened" is indistinguishable from a bug.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemberSkillsPanel } from "../../assets/ts/member-flows/portal/sections/system-users/UserMemberProfilePanels";

const apiClient = vi.hoisted(() => ({
  getJson: vi.fn(),
  postJson: vi.fn(),
  deleteJson: vi.fn(),
}));
vi.mock("../../assets/ts/shared/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/shared/api-client")>()),
  ...apiClient,
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock("../../assets/ts/member-flows/portal/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../assets/ts/member-flows/portal/ui")>()),
  toast,
}));

const USER_ID = "00000000-0000-4000-8000-000000000001";

function skills(vouchedByViewer: boolean, vouchCount: number) {
  return {
    skills: [
      { skillId: "skill-1", slug: "eidas", name: "eIDAS", vouchCount, vouchedByViewer },
      { skillId: "skill-2", slug: "cbom", name: "CBOM", vouchCount: 1, vouchedByViewer: false },
    ],
    totalVouches: vouchCount + 1,
  };
}

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const container of mounted) {
    render(null, container);
    container.remove();
  }
  mounted.length = 0;
  vi.clearAllMocks();
});

async function mountPanel(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() => render(<MemberSkillsPanel userId={USER_ID} canRead />, container));
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

/**
 * The chip's control. Its accessible name is the skill alone — the count sits
 * in a sibling span, so a screen reader announces "eIDAS", not "eIDAS 21".
 */
function chipNamed(container: HTMLElement, name: string): HTMLButtonElement {
  const chip = [...container.querySelectorAll("button")].find((candidate) =>
    (candidate.textContent ?? "").includes(name),
  );
  if (!chip) throw new Error(`missing chip: ${name}`);
  return chip;
}

/** The whole pill, which is where the count is rendered. */
function chipFor(container: HTMLElement, name: string): HTMLElement {
  const wrapper = chipNamed(container, name).closest(".pk-chip");
  if (!(wrapper instanceof HTMLElement)) throw new Error(`missing chip wrapper: ${name}`);
  return wrapper;
}

describe("vouching from a contact record", () => {
  it("marks a skill the viewer has already vouched for as pressed", async () => {
    apiClient.getJson.mockResolvedValue(skills(true, 3));
    const container = await mountPanel();

    expect(chipNamed(container, "eIDAS").getAttribute("aria-pressed")).toBe("true");
    expect(chipNamed(container, "CBOM").getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the count the server recounted rather than one it worked out itself", async () => {
    apiClient.getJson.mockResolvedValue(skills(false, 3));
    // The reply is authoritative: it says 4 and the panel shows 4, even though
    // an optimistic +1 would have landed on the same number by luck.
    apiClient.postJson.mockResolvedValue(skills(true, 4));
    const container = await mountPanel();

    await act(() => chipNamed(container, "eIDAS").click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClient.postJson).toHaveBeenCalledWith(
      `/api/v1/users/${USER_ID}/skills/skill-1/vouches`,
      {},
      expect.anything(),
    );
    expect(chipFor(container, "eIDAS").textContent).toContain("4");
    expect(chipNamed(container, "eIDAS").getAttribute("aria-pressed")).toBe("true");
  });

  it("withdraws a vouch already given", async () => {
    apiClient.getJson.mockResolvedValue(skills(true, 3));
    apiClient.deleteJson.mockResolvedValue(skills(false, 2));
    const container = await mountPanel();

    await act(() => chipNamed(container, "eIDAS").click());
    await act(async () => {
      await Promise.resolve();
    });

    expect(apiClient.deleteJson).toHaveBeenCalled();
    expect(apiClient.postJson).not.toHaveBeenCalled();
    expect(chipNamed(container, "eIDAS").getAttribute("aria-pressed")).toBe("false");
  });

  it("says so when the rules refuse the vouch, and leaves the count alone", async () => {
    apiClient.getJson.mockResolvedValue(skills(false, 3));
    apiClient.postJson.mockRejectedValue(new Error("Only members who share a group with this person can vouch."));
    const container = await mountPanel();

    await act(() => chipNamed(container, "eIDAS").click());
    await act(async () => {
      await Promise.resolve();
    });

    // The refusal is the rule working; it has to reach the reader.
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("share a group"), "error");
    // And nothing moved: no optimistic count was left behind.
    expect(chipFor(container, "eIDAS").textContent).toContain("3");
    expect(chipNamed(container, "eIDAS").getAttribute("aria-pressed")).toBe("false");
  });

  it("does not offer a vouch on the reader's own record", async () => {
    apiClient.getJson.mockResolvedValue(skills(false, 3));
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(() => render(<MemberSkillsPanel userId={USER_ID} canRead canVouch={false} />, container));
    await act(async () => {
      await Promise.resolve();
    });

    // Nobody vouches for themselves, which the write path refuses. A chip that
    // can only ever answer with that refusal reads as a broken control rather
    // than as a rule, so the chips are stated and not offered.
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.textContent).toContain("Nobody vouches for their own skills");
    expect(container.textContent).toContain("eIDAS");
  });

  it("renders nothing at all when the member claims no skills", async () => {
    apiClient.getJson.mockResolvedValue({ skills: [], totalVouches: 0 });
    const container = await mountPanel();

    // An empty panel would claim a feature with nothing behind it.
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the skills cannot be loaded", async () => {
    apiClient.getJson.mockRejectedValue(new Error("HTTP 503"));
    const container = await mountPanel();

    // A record still reads without its skills.
    expect(container.textContent).toBe("");
  });
});
