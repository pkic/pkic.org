// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRef, render } from "preact";
import { act } from "preact/test-utils";
import { SpeakerFormCard } from "../../assets/ts/components/SpeakerFormCard";
import type { ProfileLinksHandle } from "../../assets/ts/components/ProfileLinksInput";
import { ProposalSpeakersPanel } from "../../assets/ts/components/proposals/ProposalSpeakersPanel";
import { proposalSpeakerEndpoints } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/SpeakerCard";
import { applyFieldErrors } from "../../assets/ts/shared/form/validation-map";
import {
  proposalSpeakersResponseSchema,
  type ProposalSpeaker,
  type ProposalSpeakersResponse,
} from "../../assets/shared/schemas/proposal-speakers";
import { PROPOSAL_SPEAKER_ROLES } from "../../assets/shared/schemas/participant-roles";
import { buttonNamed, controlFor, groupNames, labelNames, markdownControl } from "./helpers/labeled-control";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";

vi.mock("../../assets/ts/components/ConfirmDialog", async (original) => ({
  ...(await original<typeof import("../../assets/ts/components/ConfirmDialog")>()),
  confirmAction: vi.fn(async () => true),
}));

let container: HTMLElement | null = null;

afterEach(() => {
  vi.unstubAllGlobals();
  if (!container) return;
  void act(() => render(null, container!));
  container.remove();
  container = null;
});

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ── SpeakerFormCard ──────────────────────────────────────────────────────────

function speakerCard(overrides: Partial<Parameters<typeof SpeakerFormCard>[0]> = {}) {
  return (
    <form>
      <SpeakerFormCard
        title="Speaker 1"
        idPrefix="spk-1"
        fields={{
          firstName: "speaker.1.firstName",
          lastName: "speaker.1.lastName",
          email: "speaker.1.email",
          role: "speaker.1.role",
        }}
        profile={{
          bioFieldName: "speaker.1.bio",
          bioHelp: "A short professional biography.",
          linksFieldName: "speaker.1.links",
          linksRef: createRef<ProfileLinksHandle>(),
        }}
        emailHelp="This person receives a personal confirmation link."
        errorPaths={{
          firstName: "speakers.1.firstName",
          lastName: "speakers.1.lastName",
          email: "speakers.1.email",
          bio: "speakers.1.bio",
        }}
        {...overrides}
      />
    </form>
  );
}

describe("SpeakerFormCard", () => {
  it("reuses a verified person summary while keeping session biography, role, and links editable", async () => {
    const root = mount(
      speakerCard({ personSummary: <p>Ada Lovelace · Example Labs · Engineer · ada@example.test</p> }),
    );
    await settle();
    expect(root.textContent).toContain("Ada Lovelace · Example Labs · Engineer · ada@example.test");
    for (const name of ["firstName", "lastName", "email"])
      expect(root.querySelector(`[name="speaker.1.${name}"]`)).toBeNull();
    expect(await markdownControl(root, "Bio")).not.toBeNull();
    expect(root.querySelector('[name="speaker.1.role"]')).not.toBeNull();
    expect(root.querySelector('input[type="url"]')).not.toBeNull();
  });
  it("names every control through its own for/id pair and every group by a legend", async () => {
    const root = mount(speakerCard());
    const form = root.querySelector("form")!;

    expect(labelNames(form)).toEqual([
      "First name",
      "Last name",
      "Email",
      "Bio",
      "Proposer",
      "Speaker",
      "Co-speaker",
      "Moderator",
      "Panelist",
    ]);
    // Resolved through the pair itself, so the lookup fails exactly when the
    // accessibility contract is broken rather than when the markup is restyled.
    expect(controlFor(form, "First name").getAttribute("name")).toBe("speaker.1.firstName");
    // The bio is the shared Markdown editor (#114), reached through the same pair.
    expect((await markdownControl(form, "Bio")).closest(".pk-markdown-editor")).not.toBeNull();
    expect(controlFor(form, "Email").type).toBe("email");
    // The visible "Role" and "Profile links" text used to be <label>s pointing
    // at no control at all; they are group names now, which is what a reader
    // hears on entering the group.
    expect(groupNames(form)).toEqual(["Role", "Profile links (optional)"]);
  });

  it("names the card as a region so one speaker can be told from the next", async () => {
    const root = mount(speakerCard({ title: "You — as a speaker", idPrefix: "pspk" }));

    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("You — as a speaker");
    expect(root.querySelector("h4")?.textContent).toBe("You — as a speaker");
  });

  it("points each control at its help and error text before either says anything", async () => {
    const root = mount(speakerCard());
    const form = root.querySelector("form")!;

    const email = controlFor(form, "Email");
    const describedBy = (email.getAttribute("aria-describedby") ?? "").split(" ");
    expect(describedBy).toHaveLength(2);
    expect(form.querySelector(`#${describedBy[0]}`)?.textContent).toBe(
      "This person receives a personal confirmation link.",
    );
    // The error slot is empty at first paint and filled imperatively, so it has
    // to be a live region or the message is written where nobody is listening.
    const slot = form.querySelector(`#${describedBy[1]}`)!;
    expect(slot.getAttribute("aria-live")).toBe("polite");
    expect(slot.getAttribute("data-field-error")).toBe("speakers.1.email");
  });

  it("routes a rejected field to the slot its own control describes", async () => {
    const root = mount(speakerCard());
    const form = root.querySelector("form")!;

    applyFieldErrors(form, {
      "speakers.1.email": "Enter a work email address.",
      "speakers.1.bio": "A biography needs at least 40 characters.",
    });

    const email = controlFor(form, "Email");
    const errorId = (email.getAttribute("aria-describedby") ?? "").split(" ")[1];
    expect(form.querySelector(`#${errorId}`)?.textContent).toBe("Enter a work email address.");
    expect(form.querySelector('[data-field-error="speakers.1.bio"]')?.textContent).toBe(
      "A biography needs at least 40 characters.",
    );
    // A field with no error keeps an empty slot rather than borrowing another's.
    expect(form.querySelector('[data-field-error="speakers.1.firstName"]')?.textContent).toBe("");
  });

  it("draws each role as a real radio rather than an operating-system default", async () => {
    const root = mount(speakerCard({ defaultRole: "moderator" }));
    const form = root.querySelector("form")!;

    const moderator = form.querySelector<HTMLInputElement>('input[name="speaker.1.role"][value="moderator"]')!;
    expect(moderator.checked).toBe(true);
    // All three parts of the choice control, because one alone renders the
    // platform's own checkbox and nothing else complains.
    expect(moderator.className).toContain("pk-check__input");
    // The label wraps the control, so the whole line is the hit target and no
    // `for` can go stale.
    const label = moderator.closest("label")!;
    expect(label.className).toContain("pk-check");
    expect(label.querySelector("input")).toBe(moderator);
    expect(label.querySelector(".pk-check__label")?.textContent).toBe("Moderator");
  });

  it("draws one radio for every role the contract knows", async () => {
    const root = mount(speakerCard({ defaultRole: "moderator" }));
    const form = root.querySelector("form")!;

    // The public speaker form and the two management role selects all read the
    // same vocabulary, so a role added to the contract cannot reach one surface
    // and miss another.
    const offered = [...form.querySelectorAll<HTMLInputElement>('input[name="speaker.1.role"]')].map(
      (radio) => radio.value,
    );
    expect(offered).toEqual([...PROPOSAL_SPEAKER_ROLES]);
  });

  it("names the card it removes, and offers no removal when the card cannot be removed", async () => {
    vi.mocked(confirmAction).mockClear();
    const onRemove = vi.fn();
    const root = mount(speakerCard({ onRemove, removeLabel: "Remove speaker 1" }));

    const remove = buttonNamed(root, "Remove speaker 1");
    expect(remove.type).toBe("button");
    // An empty card holds nothing to lose, so it goes without a question.
    await act(async () => remove.click());
    expect(confirmAction).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledOnce();

    void act(() => render(null, container!));
    const fixed = mount(speakerCard());
    expect(() => buttonNamed(fixed, "Remove")).toThrow();
    expect(() => buttonNamed(fixed, "Remove speaker 1")).toThrow();
  });

  it("confirms before discarding a card that already holds details", async () => {
    vi.mocked(confirmAction).mockClear();
    vi.mocked(confirmAction).mockResolvedValueOnce(false);
    const onRemove = vi.fn();
    const root = mount(speakerCard({ onRemove, removeLabel: "Remove speaker 1" }));
    controlFor(root, "First name").value = "Ada";

    await act(async () => buttonNamed(root, "Remove speaker 1").click());
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Remove speaker 1?", confirmLabel: "Remove speaker 1", tone: "danger" }),
    );
    expect(onRemove).not.toHaveBeenCalled();

    await act(async () => buttonNamed(root, "Remove speaker 1").click());
    expect(confirmAction).toHaveBeenCalledTimes(2);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("omits the role group entirely when the caller collects no role", async () => {
    const root = mount(
      speakerCard({
        fields: {
          firstName: "proposerSpeakerFirstName",
          lastName: "proposerSpeakerLastName",
          email: "proposerSpeakerEmail",
        },
      }),
    );

    expect(groupNames(root.querySelector("form")!)).toEqual(["Profile links (optional)"]);
    expect(root.querySelector('input[type="radio"]')).toBeNull();
  });

  it("asks only who to invite when the card is for someone else", async () => {
    const root = mount(speakerCard({ profile: undefined }));
    const form = root.querySelector("form")!;

    // An invited speaker writes their own bio, links and photo when they confirm.
    expect(labelNames(form)).toEqual([
      "First name",
      "Last name",
      "Email",
      "Proposer",
      "Speaker",
      "Co-speaker",
      "Moderator",
      "Panelist",
    ]);
    expect(form.querySelector(".pk-markdown-editor")).toBeNull();
    expect(form.querySelector('input[type="url"]')).toBeNull();
    expect(groupNames(form)).toEqual(["Role"]);
  });
});

// ── ProposalSpeakersPanel ────────────────────────────────────────────────────

function rosterSpeaker(overrides: Partial<ProposalSpeaker> = {}): ProposalSpeaker {
  return {
    actingIdentityId: null,
    actingIdentitySelectedAt: null,
    actingIdentitySelection: "unrecorded",
    userId: "30000000-0000-4000-8000-000000000001",
    role: "co_speaker",
    status: "confirmed",
    email: "speaker@example.test",
    firstName: "Casey",
    lastName: "Speaker",
    organizationName: null,
    jobTitle: null,
    links: [],
    headshotUpdatedAt: null,
    headshotUrl: null,
    confirmedAt: "2026-08-01T00:00:00.000Z",
    declinedAt: null,
    declineReason: null,
    termsAcceptedAt: null,
    inviteExpiresAt: null,
    addedAt: "2026-08-01T00:00:00.000Z",
    biography: null,
    profileComplete: false,
    hasHeadshot: false,
    hasBio: false,
    ...overrides,
  };
}

function roster(
  speakers: Array<
    ProposalSpeaker & {
      identityId?: string | null;
      registration?: ProposalSpeakersResponse["speakers"][number]["registration"];
    }
  >,
): ProposalSpeakersResponse {
  // Built through the canonical transport contract rather than cast, so the
  // fixture cannot drift away from what the endpoint actually returns.
  return proposalSpeakersResponseSchema.parse({
    proposal: {
      id: "10000000-0000-4000-8000-000000000001",
      title: "Post-quantum migration",
      status: "submitted",
      presentationDeadline: null,
      presentationUploaded: false,
      presentationUploadedAt: null,
    },
    summary: {
      total: speakers.length,
      confirmed: speakers.length,
      pending: 0,
      declined: 0,
      profileComplete: 0,
      presentationUploaded: 0,
    },
    speakers: speakers.map((speaker) => ({
      registration: null,
      identityId: null,
      ...speaker,
      independentCapacity: null,
    })),
  });
}

function speakersPanel(overrides: Partial<Parameters<typeof ProposalSpeakersPanel>[0]> = {}) {
  return (
    <ProposalSpeakersPanel
      endpoint="/api/v1/proposals/proposal-1"
      proposalId="proposal-1"
      access={{ canReview: true, canFinalize: false }}
      proposal={{ proposer_user_id: "proposer-1", status: "submitted", proposal_type: "talk" }}
      endpoints={proposalSpeakerEndpoints()}
      {...overrides}
    />
  );
}

describe("ProposalSpeakersPanel", () => {
  it("states a refused roster load instead of rendering an empty roster", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "FORBIDDEN", message: "Speaker access requires proposal read permission" } },
          {
            status: 403,
          },
        ),
      ),
    );

    const root = mount(speakersPanel());
    await settle();

    expect(root.textContent).toContain("Speaker access requires proposal read permission");
    // A failure must not be mistaken for "nobody is assigned yet".
    expect(root.textContent).not.toContain("No speakers assigned yet");
  });

  it("names the region and says an empty roster in words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(roster([]))),
    );

    const root = mount(speakersPanel());
    await settle();

    expect(root.querySelector("section")?.getAttribute("aria-label")).toBe("Proposal speakers");
    const status = root.querySelector('[role="status"]');
    expect(status?.textContent).toContain("No speakers assigned yet");
    expect(root.textContent).toContain("0 speakers");
  });

  it("reads the roster again when the page says something outside it changed the roster", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        urls.push(String(input));
        return Response.json(roster([rosterSpeaker()]));
      }),
    );

    const root = mount(speakersPanel({ refreshKey: 1 }));
    await settle();
    expect(urls).toEqual(["/api/v1/proposals/proposal-1/speakers"]);
    expect(root.textContent).toContain("1 speaker");
    // No refresh button: the roster is not something a reader reloads by
    // hand. An invitation accepted elsewhere bumps the key and it reads again.
    expect([...root.querySelectorAll("button")].some((button) => button.textContent?.includes("Refresh"))).toBe(false);

    await act(() => render(speakersPanel({ refreshKey: 2 }), root));
    await settle();
    expect(urls).toHaveLength(2);
  });

  it("offers the invitation as a link to its own page only to an operator who may finalize", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(roster([rosterSpeaker()]))),
    );

    const reader = mount(speakersPanel({ invitePath: "/x/speakers/new" }));
    await settle();
    expect(reader.querySelector('a[href="/x/speakers/new"]')).toBeNull();
    void act(() => render(null, reader));
    reader.remove();

    const operator = mount(
      speakersPanel({ access: { canReview: true, canFinalize: true }, invitePath: "/x/speakers/new" }),
    );
    await settle();
    const invite = operator.querySelector('a[href="/x/speakers/new"]');
    expect(invite?.textContent).toBe("Invite co-speaker");
    // The form itself is not on the roster: nothing here asks for an address.
    expect(operator.querySelector("form")).toBeNull();
  });

  describe("a speaker's standing on the card", () => {
    const registered = {
      identityId: "60000000-0000-4000-8000-000000000001",
      ...rosterSpeaker({
        userId: "20000000-0000-4000-8000-000000000001",
        firstName: "Mira",
        lastName: "Lind",
        role: "speaker",
        status: "confirmed",
        confirmedAt: "2026-10-03T09:00:00.000Z",
        hasBio: true,
        hasHeadshot: true,
        headshotUrl: "https://app.test/api/v1/users/20000000-0000-4000-8000-000000000001/headshots/face.webp",
      }),
      registration: {
        id: "30000000-0000-4000-8000-000000000001",
        status: "registered" as const,
        attendanceType: "in_person" as const,
      },
    };
    const pending = rosterSpeaker({
      userId: "20000000-0000-4000-8000-000000000002",
      firstName: "Pavel",
      lastName: "Petrov",
      role: "co_speaker",
      status: "invited",
      confirmedAt: null,
      inviteExpiresAt: "2026-11-01T00:00:00.000Z",
      hasBio: false,
      hasHeadshot: false,
      headshotUrl: null,
    });

    async function organizerRoster(): Promise<HTMLElement> {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(roster([registered, pending]))),
      );
      const root = mount(
        speakersPanel({
          access: { canReview: true, canFinalize: true },
          profileAccess: { canEditIdentity: true, canEditHeadshot: true },
          userHref: (userId) => `#/users/${userId}`,
          identityHref: (userId) => `#/users/${userId}/profile`,
          registrationHref: (registrationId) => `#/events/pqc/registrations/detail/${registrationId}`,
        }),
      );
      await settle();
      return root;
    }

    function card(root: HTMLElement, name: string): HTMLElement {
      return root.querySelector<HTMLElement>(`article[aria-label="Speaker ${name}"]`)!;
    }

    it("says the role, answer and registration in plain text, with no row of pills", async () => {
      const root = await organizerRoster();
      const mira = card(root, "Mira Lind");

      expect(mira.querySelector(".pk-badge")).toBeNull();
      const standing = [...mira.querySelectorAll(".pk-speaker-portrait-standing > dd")].map((dd) => dd.textContent);
      expect(standing[0]).toBe("Speaker");
      expect(standing[1]).toMatch(/^Accepted .+ · Registered \(in-person\)$/);
      // Nothing to chase: no checklist at all.
      expect(mira.querySelector(".pk-attention-list")).toBeNull();
    });

    it("lists only what an organizer has to chase, as a checklist", async () => {
      const root = await organizerRoster();
      const pavel = card(root, "Pavel Petrov");

      expect(pavel.querySelector(".pk-badge")).toBeNull();
      const standing = [...pavel.querySelectorAll(".pk-speaker-portrait-standing > dd")].map((dd) => dd.textContent);
      expect(standing).toEqual(["Co-speaker", "Not registered"]);
      const checklist = pavel.querySelector('ul.pk-attention-list[aria-label="Still needed for Pavel Petrov"]');
      const items = [...(checklist?.querySelectorAll("li") ?? [])].map((item) => item.textContent);
      expect(items).toHaveLength(2);
      expect(items[0]).toMatch(/^Not yet accepted \(invitation expires .+\)$/);
      expect(items[1]).toBe("No bio");
      // The empty photo already says the headshot is missing; the checklist does not repeat it.
      expect(items.join(" ")).not.toContain("headshot");
    });

    it("shows a missing headshot in the photo's place, with the way to add the person's own", async () => {
      const root = await organizerRoster();
      const pavel = card(root, "Pavel Petrov");
      const mira = card(root, "Mira Lind");

      const missing = pavel.querySelector(".pk-speaker-portrait-missing");
      expect(missing?.textContent).toContain("No headshot");
      expect(pavel.querySelector(".pk-avatar__initials")).toBeNull();
      expect(buttonNamed(missing!, "Add headshot")).not.toBeNull();
      await act(() => buttonNamed(missing!, "Add headshot")!.click());
      // The way to add it is the shared picture tile on the person's own headshot, in a dialog.
      expect(root.querySelector('dialog button[aria-label$="photo of Pavel Petrov"]')).not.toBeNull();
      // A speaker with a photo shows the photo.
      expect(mira.querySelector(".pk-speaker-portrait-missing")).toBeNull();
      expect(mira.querySelector("img")).not.toBeNull();
    });

    it("opens the user, the identity they speak as and their registration from the card's menu", async () => {
      const root = await organizerRoster();
      const links = async (name: string) => {
        const menu = card(root, name).querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!;
        await act(() => menu.click());
        const found = Object.fromEntries(
          [...card(root, name).querySelectorAll<HTMLAnchorElement>('[role="menu"] a')].map((link) => [
            link.textContent?.trim(),
            link.getAttribute("href"),
          ]),
        );
        await act(() => menu.click());
        return found;
      };
      // Navigation lives in the menu, not as a row of links on the card.
      expect(card(root, "Mira Lind").querySelector(".pk-agenda-speaker-directory__footer")).toBeNull();

      expect(await links("Mira Lind")).toEqual({
        "Open user": "#/users/20000000-0000-4000-8000-000000000001",
        "Open identity": "#/users/20000000-0000-4000-8000-000000000001/profile",
        "Open registration": "#/events/pqc/registrations/detail/30000000-0000-4000-8000-000000000001",
      });
      expect(await links("Pavel Petrov")).toEqual({ "Open user": "#/users/20000000-0000-4000-8000-000000000002" });
    });

    it("leaves out the links a viewer may not open", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(roster([registered]))),
      );
      const root = mount(speakersPanel({ userHref: () => undefined }));
      await settle();

      const menu = card(root, "Mira Lind").querySelector<HTMLButtonElement>(
        'button[aria-label="Actions for Mira Lind"]',
      )!;
      await act(() => menu.click());
      expect(card(root, "Mira Lind").querySelector('[role="menu"] a')).toBeNull();
    });
  });
});
