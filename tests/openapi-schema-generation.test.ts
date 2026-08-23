import { z } from "zod";
import { describe, expect, it } from "vitest";
import { registrationConfirmResponseSchema } from "../assets/shared/schemas/registration";
import { AUTH_EXTENSION, decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/router";

describe("OpenAPI schema generation", () => {
  it("generates the full API document", () => {
    expect(() => openapi.schema).not.toThrow();
  });

  it("documents public registration and speaker capability workflows through shared contracts", () => {
    const spec = decorateOpenApiSpec(openapi.schema);

    expect(spec.paths["/api/v1/events/{eventSlug}/registrations"].post).toBeDefined();
    expect(spec.paths["/api/v1/events/{eventSlug}/registrations/confirm-info"].get).toBeDefined();
    expect(spec.paths["/api/v1/registrations/manage/{token}"].get).toBeDefined();
    expect(spec.paths["/api/v1/registrations/manage/{token}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speaker/{token}"].get).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speaker/{token}"].post).toBeDefined();
    expect(spec.paths["/api/v1/proposals/speaker/{token}"].patch).toBeDefined();
  });

  it("mounts admin mutation contracts through their owning routers", () => {
    const spec = decorateOpenApiSpec(openapi.schema);

    expect(spec.paths["/api/v1/admin/events"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/forms"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/forms"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/days"].get).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/days"].put).toBeDefined();
    expect(spec.paths["/api/v1/admin/users/{userId}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/admin/users/{userId}/gravatar"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/permissions"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/invites/attendees/bulk"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/invites/speakers/bulk"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/waitlist/promote"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}"].patch).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}/badge-role"].get).toBeDefined();
    expect(
      spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}/badge-role"].patch,
    ).toBeDefined();
    expect(
      spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}/day-attendance"].patch,
    ).toBeDefined();
    expect(
      spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}/open-manage"].post,
    ).toBeDefined();
    expect(spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}/admit"].post).toBeDefined();
    expect(
      spec.paths["/api/v1/admin/events/{eventSlug}/registrations/{registrationId}/resend-confirmation"].post,
    ).toBeDefined();
  });

  it("documents the geo response through its shared response schema", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const geoGet = spec.paths["/api/v1/geo"].get;

    expect(geoGet).toBeDefined();
    expect(geoGet.responses["200"].content["application/json"].schema).toMatchObject({
      type: "object",
      required: ["country"],
      properties: { country: { type: ["string", "null"] } },
    });
  });

  it("includes required scopes on decorated admin operations", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const operation = spec.paths["/api/v1/admin/proposals/{proposalId}/reviews"].post;

    expect(operation.security).toEqual([{ BearerAuth: ["proposals:score"] }]);
    expect(operation[AUTH_EXTENSION]).toEqual({
      required: true,
      scheme: "BearerAuth",
      scopes: ["proposals:score"],
    });
    expect(operation["x-pkic-required-scopes"]).toEqual(["proposals:score"]);
    expect(operation.description).toContain("Required scopes: `proposals:score`.");
  });

  it("documents role ids as plain strings, not uuid()-formatted, so built-in system roles are valid per the spec (Phase 3 §3.1)", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const rolesGet = spec.paths["/api/v1/admin/roles"].get;
    const roleIdSchema =
      rolesGet.responses["200"].content["application/json"].schema.properties.roles.items.properties.id;

    expect(roleIdSchema.type).toBe("string");
    expect(roleIdSchema.format).toBeUndefined();
  });

  it("uses structured schemas for registration confirmation day arrays", () => {
    const dayAttendanceSchema = registrationConfirmResponseSchema.shape.dayAttendance;
    const dayWaitlistSchema = registrationConfirmResponseSchema.shape.dayWaitlist;

    expect(z.toJSONSchema(dayAttendanceSchema)).toMatchObject({
      type: "array",
      items: {
        type: "object",
        required: ["dayDate", "attendanceType", "label"],
      },
    });
    expect(z.toJSONSchema(dayWaitlistSchema)).toMatchObject({
      type: "array",
      items: {
        type: "object",
        required: ["dayDate", "status", "priorityLane", "offerExpiresAt"],
      },
    });
  });

  it("publishes schema-owned list defaults in OpenAPI", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const publicVotesGet = spec.paths["/api/v1/votes"].get;
    const limit = publicVotesGet.parameters.find(
      (parameter: { in?: string; name?: string }) => parameter.in === "query" && parameter.name === "limit",
    );
    const offset = publicVotesGet.parameters.find(
      (parameter: { in?: string; name?: string }) => parameter.in === "query" && parameter.name === "offset",
    );

    expect(limit).toMatchObject({ required: false, schema: { default: 20, maximum: 200, minimum: 1 } });
    expect(offset).toMatchObject({ required: false, schema: { default: 0, minimum: 0 } });
  });
});
