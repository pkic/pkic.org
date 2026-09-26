export const proposalReadAuth = { required: true, scopes: ["proposals:read"] } as const;
export const proposalScoreAuth = { required: true, scopes: ["proposals:score"] } as const;
export const proposalManageAuth = { required: true, scopes: ["proposals:manage"] } as const;
export const proposalCancelAuth = { required: true, scopes: ["proposals:cancel_accepted"] } as const;
