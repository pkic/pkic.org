import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, vi } from "vitest";
import type { RegistrationManageReadResponse } from "../../../assets/shared/schemas/registration";
import { ConfirmDialogHost } from "../../../assets/ts/components/ConfirmDialog";
import { ParticipantRegistration } from "../../../assets/ts/components/events/ParticipantRegistration";
import {
  REGISTRATION_ID,
  ENDPOINT,
  EVENT,
  readResponse,
  FORMS,
  identityApi,
  type SessionIdentity,
} from "./participant-registration-fixtures";

const mounted: HTMLElement[] = [];

export function installApi(
  read: RegistrationManageReadResponse = readResponse(),
  options: { forms?: typeof FORMS; refusePatch?: unknown; identities?: SessionIdentity[] } = {},
) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ method, path: url.pathname, body });
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
      if (method === "GET" && url.pathname === ENDPOINT) return json(read);
      const identityReply = options.identities && identityApi(method, url.pathname, options.identities);
      if (identityReply) return json(identityReply);
      if (method === "GET" && url.pathname.endsWith("/forms/placements/event_registration")) {
        return json({ ...(options.forms ?? FORMS), eventDays: read.eventDays });
      }
      if (method === "PATCH" && url.pathname === ENDPOINT && options.refusePatch) {
        return new Response(JSON.stringify(options.refusePatch), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (method === "PATCH" && url.pathname === ENDPOINT) {
        return json({ success: true, sponsorSharing: read.sponsorSharing });
      }
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export async function mount(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  await act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <ParticipantRegistration registrationId={REGISTRATION_ID} eventId={EVENT.id} slug={EVENT.slug} />
      </>,
      container,
    ),
  );
  await settle();
  await settle();
  return container;
}

export function button(root: ParentNode, label: string): HTMLButtonElement | null {
  return (
    [...root.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.trim() === label && !b.closest("[hidden]"),
    ) ?? null
  );
}

export function facts(root: ParentNode): Record<string, string> {
  const terms = [...root.querySelectorAll("dl.pk-datalist:not(.pk-alert dl) > dt")];
  return Object.fromEntries(terms.map((term) => [term.textContent ?? "", term.nextElementSibling?.textContent ?? ""]));
}

export async function click(target: HTMLElement | null): Promise<void> {
  if (!target) throw new Error("control not found");
  await act(async () => target.click());
  await settle();
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});
