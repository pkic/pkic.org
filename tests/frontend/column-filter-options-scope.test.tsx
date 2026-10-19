// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useColumnFilterOptions } from "../../assets/ts/hooks/useColumnFilterOptions";
import { listFilterOptionsResponseSchema } from "../../assets/shared/schemas/list-filter-options";
let host: HTMLElement;
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
function Harness({ endpoint, param = "speakerUserId" }: { endpoint: string; param?: string }) {
  const filter = useColumnFilterOptions(endpoint, param, "All speakers");
  return (
    <div>
      {filter.options?.map((option) => (
        <span>{option.label}</span>
      ))}
      {filter.optionNavigation?.map((item) => (
        <button disabled={item.disabled} onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  );
}
const response = (label: string, offset = 0, hasMore = true) =>
  new Response(
    JSON.stringify(
      listFilterOptionsResponseSchema.parse({
        options: [{ value: label, label }],
        page: { limit: 50, offset, total: hasMore ? 100 : offset + 1, hasMore },
      }),
    ),
    { headers: { "content-type": "application/json" } },
  );
describe("column filter scope", () => {
  it.each(["endpoint", "param"] as const)(
    "resets the page immediately when %s changes and discards old choices on refusal",
    async (change) => {
      const requests: URL[] = [];
      let refuse!: () => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: string) => {
          const url = new URL(String(input), "https://example.test");
          requests.push(url);
          if (url.pathname === "/second" || url.searchParams.get("field") === "different")
            return new Promise<Response>((_resolve, reject) => {
              refuse = () => reject(new Error("Unavailable"));
            });
          const offset = Number(url.searchParams.get("offset"));
          return response(offset ? "Old second page" : "Old first page", offset);
        }),
      );
      host = document.createElement("div");
      document.body.append(host);
      await act(() => render(<Harness endpoint="/first" />, host));
      await settle();
      await act(() =>
        [...host.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent === "More choices")!
          .click(),
      );
      await settle();
      expect(host.textContent).toContain("Old second page");
      await act(() =>
        render(
          <Harness
            endpoint={change === "endpoint" ? "/second" : "/first"}
            param={change === "param" ? "different" : undefined}
          />,
          host,
        ),
      );
      expect(host.textContent).not.toContain("Old second page");
      await settle();
      expect(requests.at(-1)!.searchParams.get("offset")).toBe("0");
      expect(
        requests.filter((url) => url.pathname === "/second" || url.searchParams.get("field") === "different"),
      ).toHaveLength(1);
      await act(() => refuse());
      await settle();
      expect(host.textContent).not.toContain("Old first page");
      expect(host.textContent).not.toContain("Old second page");
      expect(host.textContent).toContain("Couldn't load choices — retry");
    },
  );
  it("keeps old choices cleared while retrying a failed load", async () => {
    let resolve!: (value: Response) => void;
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) throw new Error("Unavailable");
        return new Promise<Response>((yes) => {
          resolve = yes;
        });
      }),
    );
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<Harness endpoint="/first" />, host));
    await settle();
    await act(() => host.querySelector<HTMLButtonElement>("button")!.click());
    await settle();
    expect(host.textContent).toContain("Loading choices…");
    expect(host.textContent).toContain("All speakers");
    await act(() => resolve(response("Fresh choice", 0, false)));
    await settle();
    expect(host.textContent).toContain("Fresh choice");
    expect(host.textContent).not.toContain("retry");
  });
});
