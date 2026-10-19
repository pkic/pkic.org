import {
  sitePublicationProviderAttestationConfigSchema,
  sitePublicationCiIdentitySchema,
  sitePublicationProviderInspectionSchema,
  sitePublicationProviderVersionSchema,
  sitePublicationProviderVersionBuildsSchema,
  sitePublicationAttestationPhaseSchema,
  type SitePublicationProviderAttestationConfig,
  type SitePublicationCiIdentity,
  type SitePublicationProviderErrorCode,
  sitePublicationProviderDeploymentReceiptSchema,
  sitePublicationProviderConfigSchema,
  sitePublicationProviderTokenSchema,
  sitePublicationProviderBuildSchema,
  sitePublicationProviderDeploymentsSchema,
  type SitePublicationProviderConfig,
} from "../../../assets/shared/schemas/site-publication-provider";

export class PublicationProviderError extends Error {
  constructor(readonly code: SitePublicationProviderErrorCode) {
    super(code);
  }
}
type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;
const maximumResponseBytes = 64 * 1024;
async function readJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new PublicationProviderError("PROVIDER_RESPONSE_INVALID");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximumResponseBytes) throw new PublicationProviderError("PROVIDER_RESPONSE_INVALID");
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function request(
  config: SitePublicationProviderConfig,
  token: string,
  path: string,
  method: "GET" | "POST",
  fetcher: ProviderFetch,
  body?: unknown,
) {
  sitePublicationProviderConfigSchema.parse(config);
  sitePublicationProviderTokenSchema.parse(token);
  let response: Response;
  try {
    response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new PublicationProviderError(method === "POST" ? "PROVIDER_WRITE_UNCERTAIN" : "PROVIDER_UNAVAILABLE");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    const rejected =
      response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
    throw new PublicationProviderError(
      rejected ? "PROVIDER_REJECTED" : method === "POST" ? "PROVIDER_WRITE_UNCERTAIN" : "PROVIDER_UNAVAILABLE",
    );
  }
  try {
    return await readJson(response);
  } catch {
    throw new PublicationProviderError(method === "POST" ? "PROVIDER_WRITE_UNCERTAIN" : "PROVIDER_RESPONSE_INVALID");
  }
}
/** Caller must persist dispatch intent first. An uncertain POST must be reconciled before retrying. */
export async function startSitePublicationBuild(
  config: SitePublicationProviderConfig,
  token: string,
  fetcher: ProviderFetch = fetch,
) {
  const response = await request(config, token, `builds/triggers/${config.triggerId}/builds`, "POST", fetcher, {
    branch: config.branch,
    commit_hash: config.commitHash,
  });
  const parsed = sitePublicationProviderBuildSchema.safeParse(response);
  if (!parsed.success) throw new PublicationProviderError("PROVIDER_WRITE_UNCERTAIN");
  return { buildId: parsed.data.result.build_uuid };
}
/** Provider reads are evidence only; this function never changes delivery state or activates a version. */
export async function readSitePublicationDeployments(
  config: SitePublicationProviderConfig,
  token: string,
  fetcher: ProviderFetch = fetch,
) {
  const response = await request(
    config,
    token,
    `workers/scripts/${encodeURIComponent(config.scriptName)}/deployments`,
    "GET",
    fetcher,
  );
  const parsed = sitePublicationProviderDeploymentsSchema.safeParse(response);
  if (!parsed.success) throw new PublicationProviderError("PROVIDER_RESPONSE_INVALID");
  return parsed.data.result.deployments;
}

function verifyBuildIdentity(
  config: SitePublicationProviderAttestationConfig,
  identity: SitePublicationCiIdentity,
  record: ReturnType<typeof sitePublicationProviderInspectionSchema.parse>["result"],
) {
  const repo = record.trigger.repo_connection;
  if (
    record.build_uuid !== identity.WORKERS_CI_BUILD_UUID ||
    record.trigger.trigger_uuid !== config.triggerId ||
    record.trigger.external_script_id !== config.workerTag ||
    repo.repo_connection_uuid !== config.repoConnectionId ||
    repo.repo_id !== config.repositoryId ||
    repo.provider_account_id !== config.providerAccountId ||
    record.trigger.deleted_on ||
    repo.deleted_on ||
    record.build_trigger_metadata.branch !== config.branch ||
    record.build_trigger_metadata.commit_hash.toLowerCase() !== config.commitHash.toLowerCase()
  ) {
    throw new PublicationProviderError("PROVIDER_ATTESTATION_MISMATCH");
  }
}
function verifyBuild(
  config: SitePublicationProviderAttestationConfig,
  identity: SitePublicationCiIdentity,
  record: ReturnType<typeof sitePublicationProviderInspectionSchema.parse>["result"],
  phase: "building" | "completed",
) {
  verifyBuildIdentity(config, identity, record);
  if (record.build_outcome && record.build_outcome !== "success") {
    throw new PublicationProviderError("PROVIDER_BUILD_FAILED");
  }
  if (
    phase === "completed"
      ? record.status !== "stopped" || record.build_outcome !== "success"
      : record.status !== "running" || record.build_outcome != null
  ) {
    throw new PublicationProviderError("PROVIDER_BUILD_NOT_READY");
  }
  return {
    buildId: record.build_uuid,
    triggerId: config.triggerId,
    branch: config.branch,
    commitHash: config.commitHash,
    phase,
  };
}
function verifiedIdentity(config: SitePublicationProviderAttestationConfig, identity: SitePublicationCiIdentity) {
  sitePublicationProviderAttestationConfigSchema.parse(config);
  sitePublicationCiIdentitySchema.parse(identity);
  if (
    identity.WORKERS_CI_BRANCH !== config.branch ||
    identity.WORKERS_CI_COMMIT_SHA.toLowerCase() !== config.commitHash.toLowerCase()
  ) {
    throw new PublicationProviderError("PROVIDER_ATTESTATION_MISMATCH");
  }
}
/** Environment identity is a claim: independently inspect provider records before accepting it. */
export async function attestSitePublicationBuild(
  config: SitePublicationProviderAttestationConfig,
  token: string,
  identity: SitePublicationCiIdentity,
  phase: "building" | "completed",
  fetcher: ProviderFetch = fetch,
) {
  verifiedIdentity(config, identity);
  sitePublicationAttestationPhaseSchema.parse(phase);
  const response = await request(config, token, `builds/builds/${identity.WORKERS_CI_BUILD_UUID}`, "GET", fetcher);
  const parsed = sitePublicationProviderInspectionSchema.safeParse(response);
  if (!parsed.success) throw new PublicationProviderError("PROVIDER_RESPONSE_INVALID");
  return verifyBuild(config, identity, parsed.data.result, phase);
}
/** A version/build association is not evidence that this version is active. No delivery state is changed. */
export async function attestSitePublicationVersion(
  config: SitePublicationProviderAttestationConfig,
  token: string,
  identity: SitePublicationCiIdentity,
  versionId: string,
  fetcher: ProviderFetch = fetch,
) {
  verifiedIdentity(config, identity);
  // Validate before constructing a provider path or query.
  const expected = sitePublicationProviderVersionSchema.shape.result.shape.id.parse(versionId);
  const version = sitePublicationProviderVersionSchema.safeParse(
    await request(
      config,
      token,
      `workers/scripts/${encodeURIComponent(config.scriptName)}/versions/${expected}`,
      "GET",
      fetcher,
    ),
  );
  if (!version.success) throw new PublicationProviderError("PROVIDER_RESPONSE_INVALID");
  if (version.data.result.id !== expected) throw new PublicationProviderError("PROVIDER_ATTESTATION_MISMATCH");
  const builds = sitePublicationProviderVersionBuildsSchema.safeParse(
    await request(config, token, `builds/builds?version_ids=${expected}`, "GET", fetcher),
  );
  if (!builds.success) throw new PublicationProviderError("PROVIDER_RESPONSE_INVALID");
  const record = builds.data.result.builds[expected];
  if (!record) throw new PublicationProviderError("PROVIDER_ATTESTATION_MISMATCH");
  return { ...verifyBuild(config, identity, record, "completed"), versionId: expected };
}

/** Called only after durable activation intent. A lost response must never be retried blindly. */
export async function activateSitePublicationVersion(
  config: SitePublicationProviderConfig,
  token: string,
  versionId: string,
  fetcher: ProviderFetch = fetch,
) {
  const version = sitePublicationProviderVersionSchema.shape.result.shape.id.parse(versionId);
  const response = await request(
    config,
    token,
    `workers/scripts/${encodeURIComponent(config.scriptName)}/deployments`,
    "POST",
    fetcher,
    { strategy: "percentage", versions: [{ version_id: version, percentage: 100 }] },
  );
  const parsed = sitePublicationProviderDeploymentReceiptSchema.safeParse(response);
  if (
    !parsed.success ||
    parsed.data.result.versions.length !== 1 ||
    parsed.data.result.versions[0]?.version_id !== version ||
    parsed.data.result.versions[0]?.percentage !== 100
  )
    throw new PublicationProviderError("PROVIDER_WRITE_UNCERTAIN");
  return { deploymentId: parsed.data.result.id, createdAt: parsed.data.result.created_on };
}

/** Fresh known-build inspection; terminal outcome alone is insufficient without exact immutable target identity. */
export async function inspectSitePublicationBuild(
  config: SitePublicationProviderAttestationConfig,
  token: string,
  identity: SitePublicationCiIdentity,
  fetcher: ProviderFetch = fetch,
) {
  verifiedIdentity(config, identity);
  const parsed = sitePublicationProviderInspectionSchema.safeParse(
    await request(config, token, `builds/builds/${identity.WORKERS_CI_BUILD_UUID}`, "GET", fetcher),
  );
  if (!parsed.success) throw new PublicationProviderError("PROVIDER_RESPONSE_INVALID");
  verifyBuildIdentity(config, identity, parsed.data.result);
  return {
    buildId: parsed.data.result.build_uuid,
    status: parsed.data.result.status,
    outcome: parsed.data.result.build_outcome ?? null,
  };
}
