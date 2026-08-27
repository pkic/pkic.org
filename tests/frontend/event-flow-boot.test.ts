import { afterEach, describe, expect, it } from "vitest";
import { bootstrap } from "../../assets/ts/event-flows/boot";

describe("event flow boot context", () => {
  afterEach(() => {
    document.body.replaceChildren();
    window.history.replaceState({}, "", "/");
  });

  it("derives the canonical eventPagePath for a registration-confirm shell", () => {
    window.history.replaceState({}, "", "/events/2027/portal-event/register/confirm/?token=abc");
    document.body.innerHTML = `
      <div data-event-registration-confirm data-event-slug="" data-event-page-path="">
        <form></form>
        <p data-flow-status></p>
      </div>
    `;

    const boot = bootstrap("[data-event-registration-confirm]");

    expect(boot?.eventSlug).toBe("portal-event");
    expect(boot?.eventPagePath).toBe("/events/2027/portal-event/");
  });
});
