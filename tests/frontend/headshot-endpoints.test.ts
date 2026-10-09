// @vitest-environment jsdom
/**
 * The two ways a headshot travels to its resource, behind the one interface
 * the tile is written against.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { headshotBodyEndpoint, headshotFormEndpoint } from "../../assets/ts/shared/headshot/endpoints";
import { successResponseSchema } from "../../assets/shared/schemas/api-common";
import {
  headshotUrlResponseSchema,
  registrationHeadshotUploadResponseSchema,
} from "../../assets/shared/schemas/registration";

interface Captured {
  url: string;
  method: string;
  headers: Headers;
  body: BodyInit | null | undefined;
}

function capture(response: unknown): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: init?.body,
      });
      return Response.json(response);
    }),
  );
  return requests;
}

const IMAGE = new Blob(["cropped"], { type: "image/jpeg" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("headshot endpoints", () => {
  it("sends the image as the body, typed by its own media type, and reports the stored URL", async () => {
    const requests = capture({ success: true, headshotUrl: "https://example.test/headshot.jpg" });
    const endpoint = headshotBodyEndpoint("/api/v1/proposals/p-1/speakers/u-1/headshot", headshotUrlResponseSchema);

    await expect(endpoint.upload(IMAGE)).resolves.toBe("https://example.test/headshot.jpg");
    expect(requests[0]).toMatchObject({ url: "/api/v1/proposals/p-1/speakers/u-1/headshot", method: "PUT" });
    expect(requests[0].headers.get("content-type")).toBe("image/jpeg");
    expect(requests[0].body).toBe(IMAGE);
  });

  it("reports no URL when the resource answers with success alone", async () => {
    capture({ success: true });
    const endpoint = headshotBodyEndpoint("/api/v1/users/current/headshot", successResponseSchema);

    await expect(endpoint.upload(IMAGE)).resolves.toBeNull();
  });

  it("sends the image as a form's file field with the fields the route records beside it", async () => {
    const requests = capture({ success: true, headshotUrl: "https://example.test/headshot.jpg" });
    const endpoint = headshotFormEndpoint(
      "/api/v1/registrations/access/token/headshot",
      registrationHeadshotUploadResponseSchema,
      { consent: "true" },
    );

    await endpoint.upload(IMAGE);

    const form = requests[0].body as FormData;
    expect(requests[0].method).toBe("PUT");
    expect(form.get("file")).toBeInstanceOf(Blob);
    expect(form.get("consent")).toBe("true");
  });

  it("removes through the same resource", async () => {
    const requests = capture({ success: true });

    await headshotFormEndpoint("/api/v1/registrations/access/token/headshot", successResponseSchema).remove();

    expect(requests[0]).toMatchObject({ url: "/api/v1/registrations/access/token/headshot", method: "DELETE" });
  });
});
