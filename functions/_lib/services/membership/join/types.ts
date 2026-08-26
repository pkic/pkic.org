import type { z } from "zod";
import { memberJoinVerifyResponseSchema } from "../../../../../assets/shared/schemas/member-join";

export type MemberJoinVerifyResponse = z.infer<typeof memberJoinVerifyResponseSchema>;
