// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { expect, it, vi } from "vitest";
import { SessionRecordingVersionField } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionRecordingVersionField";
import { eventRecordingVersionsResponseSchema } from "../../assets/shared/schemas/event-recordings";

it("keeps historical selection visible and uses bounded canonical server search without choosing the newest version", async () => {
  const requests: string[] = [];
  const changed = vi.fn();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    requests.push(String(input));
    return new Response(
      JSON.stringify(
        eventRecordingVersionsResponseSchema.parse({
          versions: [],
          page: { limit: 25, offset: 0, total: 0, hasMore: false },
        }),
      ),
      { headers: { "content-type": "application/json" } },
    );
  });
  const host = document.createElement("div");
  document.body.append(host);
  try {
    await act(async () =>
      render(
        <SessionRecordingVersionField
          slug="synthetic"
          value="11111111-1111-4111-8111-111111111111"
          version={4}
          onChange={changed}
        />,
        host,
      ),
    );
    const input = host.querySelector<HTMLInputElement>('[role="combobox"]')!;
    expect(input.value).toBe("Saved recording · version 4");
    await act(async () => {
      input.focus();
      input.click();
    });
    expect(changed).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Rights, consent and release approval remain separate");
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request).toContain("/api/v1/events/synthetic/recordings/versions");
      expect(new URL(request, "https://example.test").searchParams.get("limit")).toBe("25");
    }
  } finally {
    await act(async () => render(null, host));
    host.remove();
    fetchMock.mockRestore();
  }
});
