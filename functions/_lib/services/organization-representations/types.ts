export interface RepresentativeManagerActor {
  userId: string;
  databaseUserId?: string | null;
  actorType: "admin" | "member" | "system";
  staffAuthorized: boolean;
}
