import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import YAML from "yaml";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "scripts", "seed-event.yaml");
const DEFAULT_BUCKET = process.env.ASSETS_BUCKET_NAME ?? "pkic-assets";
const DEFAULT_LAYOUT_KEY = process.env.EMAIL_LAYOUT_R2_KEY ?? "layouts/email/default.html";
const DEFAULT_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@pkic.org";

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toSqlNullableText(value) {
  if (value === null || value === undefined || String(value).trim().length === 0) {
    return "NULL";
  }
  return sqlString(value);
}

function toSqlInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return String(fallback);
  }
  return String(parsed);
}

function parseArgs(argv) {
  const parsed = {
    mode: "local",
    database: process.env.D1_DATABASE_NAME ?? "pkic-db",
    wranglerEnv: null,
    configPath: DEFAULT_CONFIG_PATH,
    bucket: DEFAULT_BUCKET,
    adminEmail: DEFAULT_ADMIN_EMAIL,
    layoutKey: DEFAULT_LAYOUT_KEY,
    skipEmailTemplates: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--remote") {
      parsed.mode = "remote";
      continue;
    }

    if (arg === "--local") {
      parsed.mode = "local";
      continue;
    }

    if (arg === "--db" && next) {
      parsed.database = next;
      index += 1;
      continue;
    }

    if ((arg === "--config" || arg === "--file") && next) {
      parsed.configPath = path.isAbsolute(next) ? next : path.join(process.cwd(), next);
      index += 1;
      continue;
    }

    if (arg === "--bucket" && next) {
      parsed.bucket = next;
      index += 1;
      continue;
    }

    if (arg === "--admin-email" && next) {
      parsed.adminEmail = next;
      index += 1;
      continue;
    }

    if (arg === "--layout-key" && next) {
      parsed.layoutKey = next;
      index += 1;
      continue;
    }

    if (arg === "--env" && next) {
      parsed.wranglerEnv = next;
      index += 1;
      continue;
    }

    if (arg === "--skip-email-templates") {
      parsed.skipEmailTemplates = true;
    }
  }

  return parsed;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const raw = fs.readFileSync(configPath, "utf8");
  const config = YAML.parse(raw);

  if (!config?.event?.slug || !config?.event?.name || !config?.event?.year || !config?.event?.timezone) {
    throw new Error("Config must include event.slug, event.name, event.year, and event.timezone");
  }

  return config;
}

function frontendRoutes(config) {
  if (config.event.frontendRoutes) {
    return config.event.frontendRoutes;
  }

  const base = `/events/${config.event.year}/${config.event.slug}`;
  return {
    registration: `${base}/register/`,
    registrationConfirm: `${base}/register/confirm/`,
    proposal: `${base}/propose/`,
    registrationManage: `${base}/register/manage/`,
    proposalManage: `${base}/propose/manage/`,
  };
}

function buildEventSql(config) {
  const eventId = randomUUID();
  const settings = { frontend: { routes: frontendRoutes(config) } };
  if (config.event.venue) {
    settings.venue = String(config.event.venue).trim();
  }
  if (Array.isArray(config.event.sessionTypes) && config.event.sessionTypes.length > 0) {
    settings.proposal = { sessionTypes: config.event.sessionTypes.map(String) };
  }
  if (config.event.virtualUrl) {
    settings.virtualUrl = String(config.event.virtualUrl).trim();
  }
  if (config.event.location) {
    settings.location = String(config.event.location).trim();
  }
  if (config.event.heroImageUrl) {
    settings.heroImageUrl = String(config.event.heroImageUrl).trim();
  }
  const settingsJson = JSON.stringify(settings);

  return `
INSERT INTO events (
  id, slug, name, timezone, starts_at, ends_at, source_path, base_path, capacity_in_person,
  registration_mode, invite_limit_attendee, settings_json, created_at, updated_at
) VALUES (
  ${sqlString(eventId)},
  ${sqlString(config.event.slug)},
  ${sqlString(config.event.name)},
  ${sqlString(config.event.timezone)},
  ${toSqlNullableText(config.event.startsAt)},
  ${toSqlNullableText(config.event.endsAt)},
  NULL,
  NULL,
  NULL,
  ${sqlString(config.event.registrationMode ?? "invite_or_open")},
  ${toSqlInt(config.event.inviteLimitAttendee ?? 5, 5)},
  ${sqlString(settingsJson)},
  datetime('now'),
  datetime('now')
)
ON CONFLICT(slug) DO UPDATE SET
  name = excluded.name,
  timezone = excluded.timezone,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  capacity_in_person = NULL,
  registration_mode = excluded.registration_mode,
  invite_limit_attendee = excluded.invite_limit_attendee,
  settings_json = excluded.settings_json,
  updated_at = datetime('now');
`;
}

function buildTermsSql(config) {
  const statements = [];

  const termGroups = [
    ["attendee", config.terms?.attendee ?? []],
    ["speaker", config.terms?.speaker ?? []],
  ];

  for (const [audience, terms] of termGroups) {
    for (const term of terms) {
      const version = term.version ?? "v1";
      statements.push(`
INSERT INTO event_terms (id, event_id, audience_type, term_key, version, required, content_ref, display_text, help_text, active, created_at)
VALUES (
  ${sqlString(randomUUID())},
  (SELECT id FROM events WHERE slug = ${sqlString(config.event.slug)}),
  ${sqlString(audience)},
  ${sqlString(term.termKey)},
  ${sqlString(version)},
  ${(term.required ?? true) ? 1 : 0},
  ${toSqlNullableText(term.contentRef)},
  ${toSqlNullableText(term.displayText)},
  ${toSqlNullableText(term.helpText)},
  1,
  datetime('now')
)
ON CONFLICT(event_id, audience_type, term_key, version)
DO UPDATE SET required = excluded.required, content_ref = excluded.content_ref, display_text = excluded.display_text, help_text = excluded.help_text, active = 1;
`);
    }
  }

  return statements.join("\n");
}

function buildOrganizersSql(config) {
  const organizers = Array.isArray(config.organizers) ? config.organizers : [];
  if (organizers.length === 0) {
    return "";
  }

  const statements = [];
  for (const organizer of organizers) {
    const email = String(organizer.email ?? "").trim().toLowerCase();
    if (!email) {
      continue;
    }

    statements.push(`
INSERT INTO users (
  id, email, normalized_email, first_name, last_name, organization_name, job_title,
  role, active, created_at, updated_at
) VALUES (
  ${sqlString(randomUUID())},
  ${sqlString(email)},
  ${sqlString(email)},
  ${toSqlNullableText(organizer.firstName)},
  ${toSqlNullableText(organizer.lastName)},
  ${toSqlNullableText(organizer.organizationName)},
  ${toSqlNullableText(organizer.jobTitle)},
  'user',
  1,
  datetime('now'),
  datetime('now')
)
ON CONFLICT(email) DO UPDATE SET
  first_name = COALESCE(excluded.first_name, users.first_name),
  last_name = COALESCE(excluded.last_name, users.last_name),
  organization_name = COALESCE(excluded.organization_name, users.organization_name),
  job_title = COALESCE(excluded.job_title, users.job_title),
  active = 1,
  updated_at = datetime('now');

INSERT INTO event_participants (
  id, event_id, user_id, role, subrole, status, source_type, source_ref, created_at, updated_at
)
SELECT
  ${sqlString(randomUUID())},
  (SELECT id FROM events WHERE slug = ${sqlString(config.event.slug)}),
  (SELECT id FROM users WHERE email = ${sqlString(email)}),
  'organizer',
  NULL,
  'active',
  'seed',
  'scripts/seed-event.yaml',
  datetime('now'),
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM event_participants ep
  WHERE ep.event_id = (SELECT id FROM events WHERE slug = ${sqlString(config.event.slug)})
    AND ep.user_id = (SELECT id FROM users WHERE email = ${sqlString(email)})
    AND ep.role = 'organizer'
    AND ep.subrole IS NULL
);
`);
  }

  return statements.join("\n");
}

function buildEventDaysSql(config) {
  const days = Array.isArray(config.event?.days) ? config.event.days : [];
  if (days.length === 0) {
    return "";
  }

  const statements = [
    `DELETE FROM event_days WHERE event_id = (SELECT id FROM events WHERE slug = ${sqlString(config.event.slug)});`,
  ];

  for (const [index, day] of days.entries()) {
    if (!day?.date) {
      continue;
    }

    statements.push(`
INSERT INTO event_days (
  id, event_id, day_date, label, starts_at, ends_at, in_person_capacity, sort_order, attendance_options_json, created_at, updated_at
) VALUES (
  ${sqlString(randomUUID())},
  (SELECT id FROM events WHERE slug = ${sqlString(config.event.slug)}),
  ${sqlString(day.date)},
  ${toSqlNullableText(day.label)},
  ${toSqlNullableText(day.startsAt)},
  ${toSqlNullableText(day.endsAt)},
  ${day.inPersonCapacity == null ? "NULL" : toSqlInt(day.inPersonCapacity, 0)},
  ${toSqlInt(day.sortOrder ?? index * 10, index * 10)},
  ${day.attendanceOptions == null ? "NULL" : sqlString(JSON.stringify(day.attendanceOptions))},
  datetime('now'),
  datetime('now')
);
`);
  }

  return statements.join("\n");
}

function buildFormsSql(config) {
  const forms = Array.isArray(config.forms) ? config.forms : [];
  if (forms.length === 0) {
    return "";
  }

  const statements = [];
  for (const form of forms) {
    if (!form?.key || !form?.purpose || !form?.title) {
      continue;
    }

    statements.push(`
INSERT INTO forms (
  id, key, scope_type, scope_ref, purpose, status, title, description, created_at, updated_at
) VALUES (
  ${sqlString(randomUUID())},
  ${sqlString(form.key)},
  ${sqlString(form.scopeType ?? "event")},
  ${(form.scopeType ?? "event") === "event" ? `(SELECT id FROM events WHERE slug = ${sqlString(config.event.slug)})` : toSqlNullableText(form.scopeRef)},
  ${sqlString(form.purpose)},
  ${sqlString(form.status ?? "active")},
  ${sqlString(form.title)},
  ${toSqlNullableText(form.description)},
  datetime('now'),
  datetime('now')
)
ON CONFLICT(key) DO UPDATE SET
  scope_type = excluded.scope_type,
  scope_ref = excluded.scope_ref,
  purpose = excluded.purpose,
  status = excluded.status,
  title = excluded.title,
  description = excluded.description,
  updated_at = datetime('now');

DELETE FROM form_fields WHERE form_id = (SELECT id FROM forms WHERE key = ${sqlString(form.key)});
`);

    const fields = Array.isArray(form.fields) ? form.fields : [];
    for (const field of fields) {
      if (!field?.key || !field?.label || !field?.type) {
        continue;
      }

      statements.push(`
INSERT INTO form_fields (
  id, form_id, key, label, field_type, required, options_json, validation_json, sort_order, created_at
) VALUES (
  ${sqlString(randomUUID())},
  (SELECT id FROM forms WHERE key = ${sqlString(form.key)}),
  ${sqlString(field.key)},
  ${sqlString(field.label)},
  ${sqlString(field.type)},
  ${(field.required ?? false) ? 1 : 0},
  ${field.options ? sqlString(JSON.stringify(field.options)) : "NULL"},
  ${field.validation ? sqlString(JSON.stringify(field.validation)) : "NULL"},
  ${toSqlInt(field.sortOrder ?? 0, 0)},
  datetime('now')
);
`);
    }
  }

  return statements.join("\n");
}

function buildSql(config) {
  return [
    "PRAGMA foreign_keys = ON;",
    buildEventSql(config),
    buildEventDaysSql(config),
    buildTermsSql(config),
    buildOrganizersSql(config),
    buildFormsSql(config),
  ].join("\n");
}

function runWranglerSql(args, sql) {
  const tmpPath = path.join(os.tmpdir(), `pkic-seed-event-${Date.now()}.sql`);
  fs.writeFileSync(tmpPath, sql, "utf8");

  try {
    execFileSync("npx", args.concat(["--file", tmpPath]), {
      cwd: process.cwd(),
      stdio: "inherit",
    });
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

function runEmailTemplateSeed(cli) {
  const args = [
    path.join("scripts", "seed-email-templates.mjs"),
    cli.mode === "remote" ? "--remote" : "--local",
    "--db",
    cli.database,
    ...(cli.wranglerEnv ? ["--env", cli.wranglerEnv] : []),
    "--config",
    cli.configPath,
    "--bucket",
    cli.bucket,
    "--admin-email",
    cli.adminEmail,
    "--layout-key",
    cli.layoutKey,
  ];

  execFileSync("node", args, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const config = loadConfig(cli.configPath);
  const sql = buildSql(config);

  const args = [
    "wrangler",
    "d1",
    "execute",
    cli.database,
    ...(cli.wranglerEnv ? ["--env", cli.wranglerEnv] : []),
    cli.mode === "remote" ? "--remote" : "--local",
  ];

  runWranglerSql(args, sql);

  if (!cli.skipEmailTemplates) {
    runEmailTemplateSeed(cli);
  }

  console.log(`Seeded event '${config.event.slug}' in ${cli.mode} mode using ${cli.configPath}`);
}

main();
