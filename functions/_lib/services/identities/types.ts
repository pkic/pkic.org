import type { UserBackedAuthAdmin } from "../../types";

export interface IdentityManagerActor {
  userId: string;
  databaseUserId?: string | null;
  sessionId?: string;
  sessionExpiresAt?: string;
  actorType: "admin" | "member" | "system";
  staffAuthorized: boolean;
  immediateActivationAuthorized: boolean;
  permissionActor?: UserBackedAuthAdmin;
}
