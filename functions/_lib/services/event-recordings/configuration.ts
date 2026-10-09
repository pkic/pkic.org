import type { Env } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { realtimeKitRecordingDownloadOriginsSchema } from "../event-series/realtimekit-recording-download";
import { realtimeKitRecordingConfigurationSchema } from "../event-series/realtimekit-recording-contracts";

/** Missing or invalid private credentials keep provider discovery disabled. */
export function getRecordingConfiguration(
  env: Pick<Env, "REALTIMEKIT_ACCOUNT_ID" | "REALTIMEKIT_APP_ID" | "REALTIMEKIT_API_TOKEN">,
) {
  const configured = realtimeKitRecordingConfigurationSchema.safeParse({
    accountId: env.REALTIMEKIT_ACCOUNT_ID,
    appId: env.REALTIMEKIT_APP_ID,
    apiToken: env.REALTIMEKIT_API_TOKEN,
  });
  return configured.success ? configured.data : null;
}

/** Acquisition requires both private storage and an explicit download-origin allowlist. */
export function getRecordingAcquisitionConfiguration(env: Env) {
  const configuration = getRecordingConfiguration(env);
  const origins = realtimeKitRecordingDownloadOriginsSchema.safeParse(
    parseJsonSafe<unknown>(env.REALTIMEKIT_RECORDING_DOWNLOAD_ORIGINS, null),
  );
  if (!configuration || !origins.success || !env.SPEAKER_UPLOADS_BUCKET) return null;
  return { configuration, configuredOrigins: origins.data, bucket: env.SPEAKER_UPLOADS_BUCKET };
}
