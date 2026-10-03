import { afterEach, describe, it, expect } from "vitest";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { hasEventAgendaPermission } from "../../assets/ts/member-flows/portal/sections/events/event-agenda-access";
import { portalSessionFixture } from "../helpers/portal-session";
afterEach(() => {
  portalSession.value = null;
});
function grant(permission: string, contextType: string, contextId: string) {
  portalSession.value = portalSessionFixture({
    staff: true,
    staffRole: "event_staff",
    grants: [{ permission, contextType, contextId }],
  });
}
describe("event scanning controls reflect exact scope", () => {
  it("admits contextual scanners only for their event", () => {
    grant("agenda:scan", "event", "first");
    expect(hasEventAgendaPermission("first", "agenda:scan")).toBe(true);
    expect(hasEventAgendaPermission("second", "agenda:scan")).toBe(false);
  });
  it("does not turn admission scanning into exception permission", () => {
    grant("agenda:scan", "event", "first");
    expect(hasEventAgendaPermission("first", "agenda:admit_exceptions")).toBe(false);
  });
  it("requires canonical sponsor scope for lead capture", () => {
    grant("agenda:leads_capture", "event", "first");
    expect(hasEventAgendaPermission("first", "agenda:leads_capture", "sponsor")).toBe(false);
    grant("agenda:leads_capture", "event_sponsor", "sponsor");
    expect(hasEventAgendaPermission("first", "agenda:leads_capture", "sponsor")).toBe(true);
    expect(hasEventAgendaPermission("first", "agenda:leads_capture", "other")).toBe(false);
  });
  it("retains the existing administrator permission behavior", () => {
    portalSession.value = portalSessionFixture({ staff: true });
    expect(hasEventAgendaPermission("first", "agenda:scan")).toBe(true);
  });
});
