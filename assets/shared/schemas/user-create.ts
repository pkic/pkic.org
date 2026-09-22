import { z } from "zod";
import { successResponseSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { userUpdateSchema } from "./user-management";

export const userCreateSchema = z.strictObject({
  email: userUpdateSchema.shape.email.unwrap(),
  firstName: userUpdateSchema.shape.firstName,
  lastName: userUpdateSchema.shape.lastName,
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export const userCreateResponseSchema = successResponseSchema.extend({ userId: databaseIdSchema });
export const userCreateRouteSchema = {
  tags: ["Users"],
  summary: "Create a user record",
  request: { body: { required: true, content: { "application/json": { schema: userCreateSchema } } } },
  responses: {
    "201": {
      description: "User record created",
      content: { "application/json": { schema: userCreateResponseSchema } },
    },
    "403": { description: "User write permission required" },
    "409": { description: "Email is already associated with a user, or authorization changed" },
  },
};
