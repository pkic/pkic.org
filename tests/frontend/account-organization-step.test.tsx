// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountOrganizationStep } from "../../assets/ts/member-flows/portal/shell/AccountOrganizationStep";
import { ACCOUNT_ORGANIZATION_COPY } from "../../assets/shared/account-organization-copy";
import { EMAIL_FIRST_ADVISORY_COPY } from "../../assets/shared/email-first-copy";
import { userAuthVerifySchema } from "../../assets/shared/schemas/user-auth";
import { portalSessionFixture } from "../helpers/portal-session";

const FIRST = {
  id: "00000000-0000-4000-8000-0000000000b1",
  name: "First Org",
  token: "first-context-".padEnd(40, "1"),
};
const SECOND = {
  id: "00000000-0000-4000-8000-0000000000b2",
  name: "Second Org",
  token: "second-context-".padEnd(40, "2"),
};

/** The step as the server words it, with one organization already holding the person's job title. */
function step(organization: typeof FIRST, contextToken?: string, personalAllowed = false) {
  return {
    personalAllowed,
    affiliation: {
      email: "ada@claimed.test",
      domain: "claimed.test",
      domains: [],
      organization: null,
      organizations: [
        { id: organization.id, name: organization.name, identityId: null, jobTitle: "Engineer", domain: null },
      ],
      ...(contextToken ? { contextToken } : {}),
    },
  };
}

let host: HTMLDivElement;
let requests: Array<ReturnType<typeof userAuthVerifySchema.parse>>;
const session = portalSessionFixture({});

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  requests = [];
});

afterEach(() => {
  void act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

/** Answers each verify request through `reply`, recording the request body. */
function serve(reply: (body: ReturnType<typeof userAuthVerifySchema.parse>) => unknown | Promise<unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = userAuthVerifySchema.parse(JSON.parse(String(init?.body)));
      requests.push(body);
      return Response.json(await reply(body));
    }),
  );
}

/** What each organization the person picks prepares to, keyed by its id. */
function prepared(body: ReturnType<typeof userAuthVerifySchema.parse>) {
  const affiliation = body.affiliation;
  const organizationId = affiliation && "selection" in affiliation ? affiliation.selection.organizationId : null;
  const organization = organizationId === SECOND.id ? SECOND : FIRST;
  return { success: true, organizationRequired: step(organization, organization.token) };
}

async function mount(onSignedIn = vi.fn(async (_session: unknown) => {}), initial = step(FIRST)) {
  await act(() =>
    render(<AccountOrganizationStep token="synthetic-work-link" step={initial} onSignedIn={onSignedIn} />, host),
  );
  return onSignedIn;
}

function finishButton(): HTMLButtonElement {
  return [...host.querySelectorAll("button")].find(
    (button) => button.textContent === ACCOUNT_ORGANIZATION_COPY.finish,
  )!;
}

it("answers the step with the context token prepared for the chosen organization", async () => {
  serve((body) => (body.organization ? session : prepared(body)));
  const onSignedIn = await mount();
  await act(async () => finishButton().click());
  await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  expect(requests).toEqual([
    {
      token: "synthetic-work-link",
      affiliation: { selection: { domain: "claimed.test", organizationId: FIRST.id, jobTitle: "Engineer" } },
    },
    { token: "synthetic-work-link", organization: { contextToken: FIRST.token } },
  ]);
  expect(onSignedIn.mock.calls[0]![0]).toMatchObject({ sessionId: session.sessionId });
});

it("starts over from the step the server sends back, so the earlier choice is not resent", async () => {
  let answers = 0;
  serve((body) => {
    if (!body.organization) return prepared(body);
    answers += 1;
    // A domain claimed while the step was open: the server asks again, now naming another organization.
    return answers === 1 ? { success: true, organizationRequired: step(SECOND) } : session;
  });
  const onSignedIn = await mount();
  await act(async () => finishButton().click());
  await vi.waitFor(() => expect(host.textContent).toContain(ACCOUNT_ORGANIZATION_COPY.stillRequired));
  expect(onSignedIn).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLSelectElement>("select")?.value).toBe(SECOND.id);

  await act(async () => finishButton().click());
  await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  expect(requests.slice(2)).toEqual([
    {
      token: "synthetic-work-link",
      affiliation: { selection: { domain: "claimed.test", organizationId: SECOND.id, jobTitle: "Engineer" } },
    },
    { token: "synthetic-work-link", organization: { contextToken: SECOND.token } },
  ]);
});

it("sends one answer when Finish is clicked twice while the organization is prepared", async () => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  serve(async (body) => {
    if (body.organization) return session;
    await held;
    return prepared(body);
  });
  const onSignedIn = await mount();
  await act(async () => {
    finishButton().click();
    finishButton().click();
  });
  expect(finishButton().closest("fieldset")?.disabled).toBe(true);
  await act(async () => release());
  await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  expect(requests.map((body) => (body.organization ? "answer" : "prepare"))).toEqual(["prepare", "answer"]);
});

function buttonNamed(name: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find((button) => button.textContent?.trim() === name);
}

it("asks again before an unclaimed work domain is kept as a personal email, and sends nothing on cancel", async () => {
  serve(() => session);
  const onSignedIn = await mount(undefined, step(FIRST, undefined, true));
  const copy = ACCOUNT_ORGANIZATION_COPY.personalConfirm;

  await act(async () => buttonNamed(EMAIL_FIRST_ADVISORY_COPY.usePersonal, host)!.click());
  const dialog = document.querySelector("dialog[open]")!;
  expect(dialog.textContent).toContain(copy.title("claimed.test"));
  expect(dialog.textContent).toContain(copy.consequences("claimed.test")[1]);
  await act(async () => buttonNamed(copy.cancel, dialog)!.click());
  expect(requests).toEqual([]);

  await act(async () => buttonNamed(EMAIL_FIRST_ADVISORY_COPY.usePersonal, host)!.click());
  await act(async () => buttonNamed(copy.confirm, document.querySelector("dialog[open]")!)!.click());
  await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  expect(requests).toEqual([{ token: "synthetic-work-link", organization: { personal: true } }]);
});
