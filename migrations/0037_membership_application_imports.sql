-- Source snapshots are private evidence, separate from live application validation.
CREATE TABLE membership_application_import_runs (
  id TEXT NOT NULL PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_membership_application_import_runs_actor ON membership_application_import_runs(actor_user_id);
CREATE TABLE membership_application_sources (
  id TEXT NOT NULL PRIMARY KEY,
  repository TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_url TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES membership_application_import_runs(id),
  application_id TEXT UNIQUE REFERENCES member_applications(id),
  applicant_user_id TEXT REFERENCES users(id),
  organization_id TEXT REFERENCES organizations(id),
  applicant_name TEXT,
  applicant_email TEXT,
  organization_name TEXT,
  category_code TEXT REFERENCES membership_categories(code),
  outcome TEXT,
  source_created_at TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  closed_at TEXT,
  snapshot_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  activated_at TEXT,
  activated_by_user_id TEXT REFERENCES users(id),
  activation_note TEXT,
  UNIQUE(repository, issue_id),
  UNIQUE(repository, issue_number)
);
CREATE INDEX idx_membership_application_sources_run ON membership_application_sources(run_id);
CREATE INDEX idx_membership_application_sources_user ON membership_application_sources(applicant_user_id);
CREATE INDEX idx_membership_application_sources_organization ON membership_application_sources(organization_id);
CREATE INDEX idx_membership_application_sources_category ON membership_application_sources(category_code);
CREATE INDEX idx_membership_application_sources_actor ON membership_application_sources(activated_by_user_id);
CREATE INDEX idx_membership_application_sources_history ON membership_application_sources(outcome, source_created_at, id) WHERE application_id IS NULL;
ALTER TABLE membership_application_steps ADD COLUMN source_notice_opened_at TEXT;
ALTER TABLE membership_application_steps ADD COLUMN source_notice_deadline_at TEXT;
ALTER TABLE membership_application_steps ADD COLUMN source_evidence_json TEXT;
CREATE INDEX idx_membership_application_sources_closed ON membership_application_sources(outcome, closed_at, id) WHERE application_id IS NULL;
CREATE INDEX idx_member_applications_stage_entered ON member_applications(stage, stage_entered_at, id);
