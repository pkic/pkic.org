import { httpOrSameOriginUrlSchema, normalizeHttpOrSameOriginUrl } from "../../../assets/shared/schemas/urls";

export interface HeroImageSource {
  url: string;
  assetPath: string | null;
}

function configuredHosts(value: string | undefined): Set<string> {
  const hosts = new Set<string>();
  for (const rawHost of (value ?? "").split(",")) {
    const host = rawHost.trim().toLowerCase().replace(/\.$/, "");
    if (!host || !host.includes(".") || host.includes(":")) continue;
    try {
      const parsed = new URL(`https://${host}`);
      if (parsed.hostname === host && !parsed.port && !/^\d+(?:\.\d+){3}$/.test(host)) hosts.add(host);
    } catch {
      // Invalid configuration entries are ignored so remote images fail closed.
    }
  }
  return hosts;
}

/** Resolves a hero image without allowing arbitrary external destinations. */
export function resolveHeroImageSource(
  raw: string,
  origin: string,
  allowedExternalHosts?: string,
): HeroImageSource | null {
  const parsed = httpOrSameOriginUrlSchema.safeParse(raw);
  if (!parsed.success) return null;
  const normalized = normalizeHttpOrSameOriginUrl(parsed.data, origin);
  if (normalized.startsWith("/")) {
    return { url: new URL(normalized, origin).toString(), assetPath: normalized };
  }

  const url = new URL(normalized);
  if (url.protocol !== "https:" || !configuredHosts(allowedExternalHosts).has(url.hostname.toLowerCase())) return null;
  return { url: url.toString(), assetPath: null };
}
