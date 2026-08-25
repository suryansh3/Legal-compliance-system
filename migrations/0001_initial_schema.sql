-- Legal Metrology Compliance Checker — initial schema
-- Mirrors design.md §5 core data model, adapted for Cloudflare D1 (SQLite)

-- Users & RBAC (design.md §7)
CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('director','controller','officer','consumer','ecommerce','admin')),
  region_id     TEXT NOT NULL DEFAULT 'IN-ALL',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(user_id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

-- Case aggregate (inspection / self-check / consumer complaint)
CREATE TABLE IF NOT EXISTS cases (
  case_id     TEXT PRIMARY KEY,
  region_id   TEXT NOT NULL,
  officer_id  TEXT REFERENCES users(user_id),
  case_type   TEXT NOT NULL CHECK (case_type IN ('inspection','self_check','consumer_complaint')),
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','closed','disputed')),
  title       TEXT,
  location    TEXT,
  premises    TEXT,
  notes       TEXT,
  version     INTEGER NOT NULL DEFAULT 1,        -- optimistic concurrency (design.md §4.5)
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cases_region ON cases(region_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cases_officer ON cases(officer_id);

-- Immutable capture events (idempotent on capture_id)
CREATE TABLE IF NOT EXISTS scan_events (
  scan_id          TEXT PRIMARY KEY,
  case_id          TEXT NOT NULL REFERENCES cases(case_id),
  capture_id       TEXT UNIQUE NOT NULL,
  region_id        TEXT NOT NULL,
  image_refs       TEXT NOT NULL,              -- JSON array of R2 object keys
  image_hashes     TEXT,                       -- JSON array of SHA-256 (evidence integrity)
  device_class     TEXT,
  package_type     TEXT NOT NULL DEFAULT 'retail' CHECK (package_type IN ('retail','wholesale','export','unknown')),
  declared_category TEXT,
  pdp_area_cm2     REAL,                       -- principal display panel area, if measured
  scale_reference  INTEGER NOT NULL DEFAULT 0, -- 1 = ruler/reference card present
  container_type   TEXT DEFAULT 'printed' CHECK (container_type IN ('printed','blown_formed_moulded')),
  captured_offline INTEGER NOT NULL DEFAULT 0,
  captured_at      TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at        TEXT,
  geo_lat          REAL,
  geo_lon          REAL,
  status           TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','quality_failed','extracting','extracted','evaluated','error')),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scans_case ON scan_events(case_id);
CREATE INDEX IF NOT EXISTS idx_scans_region ON scan_events(region_id, captured_at);

-- Versioned extraction results (a re-run creates a new row, never overwrites)
CREATE TABLE IF NOT EXISTS extraction_results (
  extraction_id TEXT PRIMARY KEY,
  scan_id       TEXT NOT NULL REFERENCES scan_events(scan_id),
  model_name    TEXT NOT NULL,
  model_version TEXT NOT NULL,
  fields        TEXT NOT NULL,   -- JSON: [{field, value, present, confidence, bbox, script, notes}]
  quality_flags TEXT,            -- JSON: {"font_height_indeterminate": true, ...}
  raw_response  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_extraction_scan ON extraction_results(scan_id);

-- Versioned, effective-dated rule packs (rules as data, design.md §4.2)
CREATE TABLE IF NOT EXISTS rule_packs (
  rule_pack_id   TEXT PRIMARY KEY,
  version        TEXT NOT NULL,
  title          TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  effective_to   TEXT,
  rules          TEXT NOT NULL,  -- JSON array of rule DSL objects
  published_by   TEXT,
  published_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Rule evaluations (immutable once report issued)
CREATE TABLE IF NOT EXISTS rule_evaluations (
  evaluation_id  TEXT PRIMARY KEY,
  extraction_id  TEXT NOT NULL REFERENCES extraction_results(extraction_id),
  scan_id        TEXT NOT NULL REFERENCES scan_events(scan_id),
  rule_pack_id   TEXT NOT NULL REFERENCES rule_packs(rule_pack_id),
  verdicts       TEXT NOT NULL,  -- JSON: [{rule_id, clause, title, status, severity, message, evidence}]
  overall_status TEXT NOT NULL CHECK (overall_status IN ('compliant','non_compliant','needs_review','exempt')),
  summary        TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eval_scan ON rule_evaluations(scan_id);

-- Compliance reports
CREATE TABLE IF NOT EXISTS compliance_reports (
  report_id     TEXT PRIMARY KEY,
  case_id       TEXT NOT NULL REFERENCES cases(case_id),
  scan_id       TEXT NOT NULL REFERENCES scan_events(scan_id),
  evaluation_id TEXT NOT NULL REFERENCES rule_evaluations(evaluation_id),
  report_no     TEXT UNIQUE NOT NULL,
  content_hash  TEXT NOT NULL,   -- tamper-evidence: SHA-256 of report payload
  generated_by  TEXT REFERENCES users(user_id),
  generated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Optional product dedupe entity (compliance history per SKU)
CREATE TABLE IF NOT EXISTS products (
  product_id  TEXT PRIMARY KEY,
  brand       TEXT,
  name        TEXT NOT NULL,
  category    TEXT,
  fingerprint TEXT UNIQUE,       -- normalized brand+name key
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
-- link scans to products
CREATE TABLE IF NOT EXISTS product_scans (
  product_id TEXT NOT NULL REFERENCES products(product_id),
  scan_id    TEXT NOT NULL REFERENCES scan_events(scan_id),
  PRIMARY KEY (product_id, scan_id)
);

-- Append-only audit log (design.md §7)
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Human review queue for needs_review verdicts (design.md §4.3)
CREATE TABLE IF NOT EXISTS review_queue (
  review_id     TEXT PRIMARY KEY,
  evaluation_id TEXT NOT NULL REFERENCES rule_evaluations(evaluation_id),
  scan_id       TEXT NOT NULL REFERENCES scan_events(scan_id),
  region_id     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
  resolution    TEXT,
  resolved_by   TEXT REFERENCES users(user_id),
  resolved_at   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_review_status ON review_queue(status, region_id);
