import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { dispatchRequestMethod, methodNotAllowed } from "../functions/_lib/http";
import worker from "../functions/router";
import { onRequest as speakerPresentationDispatch } from "../functions/api/v1/proposals/speaker/[token]/presentation";
import { onRequest as registrationHeadshotDispatch } from "../functions/api/v1/registrations/manage/[token]/headshot";

function context(method: string) {
  return { req: { raw: new Request("https://app.test/resource", { method }) } };
}

describe("HTTP method dispatch", () => {
  it("calls only the exact method handler", async () => {
    const get = vi.fn(() => new Response("read"));
    const post = vi.fn(() => new Response("write"));

    const response = await dispatchRequestMethod(context("POST"), { GET: get, POST: post });

    expect(await response.text()).toBe("write");
    expect(get).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledOnce();
  });

  it("returns the canonical error envelope and Allow header", async () => {
    const response = await dispatchRequestMethod(context("DELETE"), {
      GET: () => new Response("read"),
      PATCH: () => new Response("update"),
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, PATCH");
    await expect(response.json()).resolves.toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
  });

  it("can build a canonical 405 response directly", async () => {
    const response = methodNotAllowed(["POST"]);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it.each([
    {
      label: "registration confirmation",
      path: "/events/event/registrations/confirm-email",
      method: "DELETE",
      allow: "GET, POST",
      mounted: true,
    },
    {
      label: "event registration collection",
      path: "/events/event/registrations",
      method: "PUT",
      allow: "GET, POST",
      mounted: true,
    },
    {
      label: "speaker presentation",
      path: "/proposals/speaker/token/presentation",
      method: "POST",
      allow: "PUT",
      handler: speakerPresentationDispatch,
    },
    {
      label: "speaker self-management",
      path: "/proposals/speaker/token",
      method: "DELETE",
      allow: "GET, POST, PATCH",
      mounted: true,
    },
    {
      label: "proposer speaker invitation",
      path: "/proposals/manage/token/speakers",
      method: "GET",
      allow: "POST",
      mounted: true,
    },
    {
      label: "proposer speaker reminder",
      path: "/proposals/manage/token/speakers/remind",
      method: "GET",
      allow: "POST",
      mounted: true,
    },
    {
      label: "proposer speaker management",
      path: "/proposals/manage/token/speakers/user",
      method: "POST",
      allow: "PATCH, DELETE",
      mounted: true,
    },
    {
      label: "registration self-management",
      path: "/registrations/manage/token",
      method: "POST",
      allow: "GET, PATCH",
      mounted: true,
    },
    {
      label: "registration headshot",
      path: "/registrations/manage/token/headshot",
      method: "PATCH",
      allow: "PUT, DELETE",
      handler: registrationHeadshotDispatch,
    },
  ])("returns the canonical mounted 405 for a $label route", async ({ path, method, allow, handler, mounted }) => {
    if (mounted) {
      const response = await worker.fetch(new Request(`https://app.test/api/v1${path}`, { method }), env, {
        passThroughOnException: () => {},
        waitUntil: () => {},
      } as any);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe(allow);
      await expect(response.json()).resolves.toEqual({
        error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
      });
      return;
    }
    const app = new Hono();
    app.all(path, (c) => handler!(c as any));

    const response = await app.request(path, { method });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(allow);
    await expect(response.json()).resolves.toEqual({
      error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" },
    });
  });
});
