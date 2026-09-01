/**
 * Logos are SVG-only for organizations AND sponsorships, and both routes must
 * share one sanitization pipeline: every case below runs against each
 * endpoint, and the stored bytes must be identical across them — any drift
 * between the two upload paths fails the matrix.
 *
 * Sanitization is by reconstruction: uploads are reparsed through resvg's
 * usvg tree and re-serialized, so scripts, event handlers, metadata,
 * comments, DOCTYPEs, and editor cruft cannot survive. The stored file is
 * normalized — paint-order-first full-canvas backgrounds dropped, viewBox
 * cropped to the rendered content, root width/height removed.
 */
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleError } from "../functions/_lib/http";
import app from "../functions/router";
import { onRequest as organizationLogoRequest } from "../functions/api/v1/organizations/[organizationId]/logo";
import { sanitizeSvgLogo } from "../functions/_lib/utils/svg-logo";
import { createAdminSession } from "./helpers/auth";
import { createContext, queryAll, seedEventAndAdmin } from "./helpers/context";
import { validJpegBytes } from "./helpers/raster-images";
import { resetDb } from "./helpers/reset-db";

async function setupAdmin(): Promise<string> {
  await seedEventAndAdmin(env.DB);
  const [{ id }] = await queryAll<{ id: string }>(
    env.DB,
    "SELECT id FROM users WHERE email = 'admin@pkic.org' LIMIT 1",
  );
  return createAdminSession(env.DB, id, `logo-svg-token-${crypto.randomUUID()}`);
}

interface LogoTarget {
  name: string;
  insert: () => Promise<string>;
  put: (token: string, id: string, body: BodyInit, contentType: string) => Promise<Response>;
}

async function putOrganizationLogo(token: string, id: string, body: BodyInit, contentType: string): Promise<Response> {
  const request = new Request(`https://app.test/api/v1/organizations/${id}/logo`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": contentType },
    body,
  });
  const context = createContext(env, request, { organizationId: id });
  const pending: Promise<unknown>[] = [];
  context.executionCtx.waitUntil = (promise: Promise<unknown>) => {
    pending.push(promise);
  };
  let response: Response;
  try {
    response = await organizationLogoRequest(context);
  } catch (error) {
    response = handleError(error);
  }
  await Promise.all(pending);
  return response;
}

async function putSponsorLogo(token: string, id: string, body: BodyInit, contentType: string): Promise<Response> {
  const request = new Request(`https://app.test/api/v1/sponsors/${id}/logo`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": contentType },
    body,
  });
  const pending: Promise<unknown>[] = [];
  const response = await app.fetch(
    request,
    env as never,
    {
      passThroughOnException: () => {},
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    } as never,
  );
  await Promise.all(pending);
  return response;
}

const TARGETS: LogoTarget[] = [
  {
    name: "organization",
    insert: async () => {
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
      )
        .bind(id, `SVG Logo Org ${id}`, `svg logo org ${id}`)
        .run();
      return id;
    },
    put: putOrganizationLogo,
  },
  {
    name: "sponsorship",
    insert: async () => {
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO sponsorships
           (id, sponsor_type, non_member_name, tier, pipeline_stage, created_at, updated_at)
         VALUES (?, 'consortium', 'SVG Logo Sponsor', 'Gold', 'active', datetime('now'), datetime('now'))`,
      )
        .bind(id)
        .run();
      return id;
    },
    put: putSponsorLogo,
  },
];

async function storedSvg(response: Response): Promise<string> {
  const { r2Key } = (await response.json()) as { r2Key: string };
  const object = await env.ASSETS_BUCKET!.get(r2Key);
  expect(object).not.toBeNull();
  expect(object!.httpMetadata?.contentType).toBe("image/svg+xml");
  expect(r2Key.endsWith(".svg")).toBe(true);
  return await object!.text();
}

const HOSTILE_SVG =
  '<?xml version="1.0"?><!-- exported by Editor 9000 -->' +
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/ns" ' +
  'width="300" height="300" viewBox="0 0 300 300" onload="alert(1)">' +
  "<metadata>secret author data</metadata>" +
  "<script>fetch('https://evil.test')</script>" +
  '<inkscape:custom foo="bar"/>' +
  '<a href="javascript:alert(2)"><rect x="100" y="100" width="100" height="100" fill="#175" onclick="alert(3)"/></a>' +
  "</svg>";

const PADDED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300px" height="300px" viewBox="0 0 300 300">' +
  '<rect x="100" y="100" width="100" height="100" fill="#123456"/></svg>';

const BACKGROUND_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300">' +
  '<rect width="100%" height="100%" fill="#ffffff"/>' +
  '<circle cx="150" cy="150" r="50" fill="#175"/></svg>';

describe.each(TARGETS)("SVG logo uploads via the $name endpoint", (target) => {
  beforeEach(resetDb);

  it("strips scripts, handlers, metadata, comments, and editor cruft by reconstruction", async () => {
    const token = await setupAdmin();
    const id = await target.insert();
    const response = await target.put(token, id, HOSTILE_SVG, "image/svg+xml");
    expect(response.status).toBe(200);
    const stored = await storedSvg(response);
    for (const forbidden of ["script", "onload", "onclick", "javascript:", "metadata", "inkscape", "Editor 9000"]) {
      expect(stored.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("removes fixed dimensions and crops the viewBox to the rendered content", async () => {
    const token = await setupAdmin();
    const id = await target.insert();
    const response = await target.put(token, id, PADDED_SVG, "image/svg+xml");
    expect(response.status).toBe(200);
    const stored = await storedSvg(response);
    const root = /<svg\b[^>]*>/.exec(stored)![0];
    expect(root).not.toMatch(/\swidth\s*=/);
    expect(root).not.toMatch(/\sheight\s*=/);
    const viewBox = /viewBox\s*=\s*"([^"]+)"/
      .exec(root)![1]
      .split(/[\s,]+/)
      .map(Number);
    expect(viewBox[2]).toBeCloseTo(100, 0);
    expect(viewBox[3]).toBeCloseTo(100, 0);
  });

  it("drops a full-canvas background fill before cropping", async () => {
    const token = await setupAdmin();
    const id = await target.insert();
    const response = await target.put(token, id, BACKGROUND_SVG, "image/svg+xml");
    expect(response.status).toBe(200);
    const stored = await storedSvg(response);
    const viewBox = /viewBox\s*=\s*"([^"]+)"/
      .exec(stored)![1]
      .split(/[\s,]+/)
      .map(Number);
    expect(viewBox[2]).toBeCloseTo(100, 0);
    expect(viewBox[3]).toBeCloseTo(100, 0);
    expect(stored).not.toContain("#ffffff");
  });

  it("rejects raster uploads with the SVG-only policy", async () => {
    const token = await setupAdmin();
    const id = await target.insert();
    const response = await target.put(token, id, validJpegBytes(), "image/jpeg");
    expect(response.status).toBe(415);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Only SVG logos are accepted");
  });

  it("rejects embedded rasters, DOCTYPEs, malformed and empty SVGs", async () => {
    const token = await setupAdmin();
    const id = await target.insert();
    const withRaster =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/></svg>';
    expect((await target.put(token, id, withRaster, "image/svg+xml")).status).toBe(415);
    const xxe =
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="5" height="5"/></svg>';
    expect((await target.put(token, id, xxe, "image/svg+xml")).status).toBe(415);
    expect((await target.put(token, id, "<svg><unclosed", "image/svg+xml")).status).toBe(415);
    expect(
      (await target.put(token, id, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>', "image/svg+xml"))
        .status,
    ).toBe(415);
  });
});

describe("shared SVG logo pipeline", () => {
  beforeEach(resetDb);

  it("stores byte-identical sanitized output through both endpoints", async () => {
    const token = await setupAdmin();
    for (const fixture of [HOSTILE_SVG, PADDED_SVG, BACKGROUND_SVG]) {
      const outputs: string[] = [];
      for (const target of TARGETS) {
        const id = await target.insert();
        const response = await target.put(token, id, fixture, "image/svg+xml");
        expect(response.status).toBe(200);
        outputs.push(await storedSvg(response));
      }
      expect(outputs[0]).toBe(outputs[1]);
    }
  });

  it("keeps a content rectangle that is not paint-order-first", async () => {
    const contentRect =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<circle cx="20" cy="20" r="10" fill="#175"/>' +
      '<rect x="0" y="0" width="100" height="100" fill="none" stroke="#123456" stroke-width="2"/></svg>';
    const sanitized = await sanitizeSvgLogo(new TextEncoder().encode(contentRect).buffer as ArrayBuffer);
    expect(new TextDecoder().decode(sanitized.buffer)).toContain("#123456");
  });
});
