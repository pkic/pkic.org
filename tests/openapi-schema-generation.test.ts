import { z } from "zod";
import { describe, expect, it } from "vitest";
import { registrationConfirmResponseSchema } from "../assets/shared/schemas/api";
import { AUTH_EXTENSION, decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/router";

describe("OpenAPI schema generation", () => {
  it("generates the full API document", () => {
    expect(() => openapi.schema).not.toThrow();
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
        required: ["dayDate", "attendanceType"],
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
});
