import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { env } from "cloudflare:workers";
import { dispatchRequestMethod, methodNotAllowed } from "../functions/_lib/http";
import { onRequest as eventFormsDispatch } from "../functions/api/v1/events/[eventSlug]/forms";
import worker from "../functions/router";
import { onRequest as retentionDispatch } from "../functions/api/v1/internal/retention/run";
import { onRequest as registrationConfirmDispatch } from "../functions/api/v1/events/[eventSlug]/registrations/confirm-email";
import { onRequest as registrationCreateDispatch } from "../functions/api/v1/events/[eventSlug]/registrations";
import { onRequest as speakerPresentationDispatch } from "../functions/api/v1/proposals/speaker/[token]/presentation";
import { onRequest as speakerManageDispatch } from "../functions/api/v1/proposals/speaker/[token]";
import { onRequest as proposerSpeakersDispatch } from "../functions/api/v1/proposals/manage/[token]/speakers";
import { onRequest as registrationManageDispatch } from "../functions/api/v1/registrations/manage/[token]";
import { onRequest as registrationHeadshotDispatch } from "../functions/api/v1/registrations/manage/[token]/headshot";
import { onRequest as waitlistPromoteDispatch } from "../functions/api/v1/admin/events/[eventSlug]/waitlist/promote";
import { onRequest as adminRegistrationDispatch } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/index";
import { onRequest as registrationAdmitDispatch } from "../functions/api/v1/admin/events/[eventSlug]/registrations/[registrationId]/admit";

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
      label: "GET-only",
      path: "/forms",
      method: "POST",
      allow: "GET",
      handler: eventFormsDispatch,
    },
    {
      label: "POST-only",
      path: "/retention",
      method: "GET",
      allow: "POST",
      handler: retentionDispatch,
    },
    {
      label: "registration confirmation",
      path: "/events/event/registrations/confirm-email",
      method: "DELETE",
      allow: "GET, POST",
      handler: registrationConfirmDispatch,
    },
    {
      label: "registration creation",
      path: "/events/event/registrations",
      method: "GET",
      allow: "POST",
      handler: registrationCreateDispatch,
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
      handler: speakerManageDispatch,
    },
    {
      label: "proposer speaker invitation",
      path: "/proposals/manage/token/speakers",
      method: "GET",
      allow: "POST",
      handler: proposerSpeakersDispatch,
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
      handler: registrationManageDispatch,
    },
    {
      label: "registration headshot",
      path: "/registrations/manage/token/headshot",
      method: "PATCH",
      allow: "PUT, DELETE",
      handler: registrationHeadshotDispatch,
    },
    {
      label: "waitlist promotion",
      path: "/admin/events/event/waitlist/promote",
      method: "GET",
      allow: "POST",
      handler: waitlistPromoteDispatch,
    },
    {
      label: "admin registration management",
      path: "/admin/events/event/registrations/registration",
      method: "POST",
      allow: "GET, PATCH",
      handler: adminRegistrationDispatch,
    },
    {
      label: "registration admission",
      path: "/admin/events/event/registrations/registration/admit",
      method: "GET",
      allow: "POST",
      handler: registrationAdmitDispatch,
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
