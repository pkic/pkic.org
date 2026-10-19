import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { useServerCollection, type CollectionLoader } from "../../assets/ts/hooks/useServerCollection";
import { ApiClientError } from "../../assets/ts/shared/api-client";
const schema = z.object({ contact: z.string() });
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
describe("Sensitive collection revalidation", () => {
  for (const status of [0, 403])
    it(`clears contacts during reload and after ${status} refusal`, async () => {
      const requests: ReturnType<typeof deferred>[] = [];
      const load: CollectionLoader = async (_url, _signal, responseSchema) => {
        const request = deferred();
        requests.push(request);
        return responseSchema.parse(await request.promise);
      };
      let refresh: () => Promise<void> = async () => {};
      function Harness() {
        const state = useServerCollection({
          endpoint: "/contacts",
          responseSchema: schema,
          load,
          clearDataOnReload: true,
          retainDataOnError: false,
        });
        refresh = state.reload;
        return <span>{state.data?.contact ?? "No contacts"}</span>;
      }
      const host = document.createElement("div");
      document.body.append(host);
      await act(() => render(<Harness />, host));
      await act(async () => {
        requests[0].resolve({ contact: "Private person" });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.textContent).toBe("Private person");
      await act(() => {
        void refresh();
      });
      expect(host.textContent).toBe("No contacts");
      await act(async () => {
        requests[1].reject(new ApiClientError({ error: { code: "TEST", message: "Unavailable" } }, status));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.textContent).toBe("No contacts");
      await act(() => render(null, host));
      host.remove();
    });
});
