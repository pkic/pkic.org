/** Select only the native resources needed to publish approved public content. */
export function publicationBindingConfig(config, environment) {
  if (!["local", "preview", "production"].includes(environment)) throw new Error("Invalid publication environment");
  const accountId = config.account_id ?? process.env.CLOUDFLARE_ACCOUNT_ID;
  if (environment !== "local" && !accountId) throw new Error("Select CLOUDFLARE_ACCOUNT_ID for native publication");
  const database = config.d1_databases.find(({ binding }) => binding === "DB");
  const bucket = config.r2_buckets.find(({ binding }) => binding === "ASSETS_BUCKET");
  if (!database || !bucket) throw new Error("Publication requires the DB and ASSETS_BUCKET bindings");
  return {
    name: `pkic-publication-${environment}`,
    compatibility_date: config.compatibility_date,
    account_id: accountId,
    // Platform proxies prefer development preview IDs when they are present.
    // Publication must read the selected environment's deployment resources.
    d1_databases: [
      {
        binding: database.binding,
        database_name: database.database_name,
        database_id: database.database_id,
        remote: environment !== "local",
      },
    ],
    r2_buckets: config.r2_buckets
      .filter(({ binding }) => ["ASSETS_BUCKET", "SPEAKER_UPLOADS_BUCKET"].includes(binding))
      .map(({ binding, bucket_name, jurisdiction }) => ({
        binding,
        bucket_name,
        jurisdiction,
        remote: environment !== "local",
      })),
  };
}
