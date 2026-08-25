# Legal Metrology Compliance Checker

Automated compliance verification of packaged-commodity label declarations against
the **Legal Metrology (Packaged Commodities) Rules, 2011** — built per the uploaded
`design (1).md` (system design) and `implementation.md` (implementation plan).

## Project Overview
- **Name**: webapp (Legal Metrology Compliance Checker)
- **Goal**: scan/upload packaged commodity label images, auto-extract mandatory
  declarations (Rule 6(1) etc.), evaluate them against a versioned Rule DSL,
  and produce tamper-evident compliance reports for enforcement workflows.
- **Clients**: installable **PWA** (web, phone home-screen) + **Flutter mobile app**
  source scaffold (`mobile/lmpc_mobile/`) sharing the same gateway API.

## URLs
- **Sandbox dev**: https://3000-i89su7n2b1tppzefmnhr3-ecea8f22.sandbox.novita.ai
- **Health**: `/api/health`
- **Production**: not yet deployed (one-click deploy available — Hono/Pages stack)

## Demo Accounts
| Username | Password | Role |
|---|---|---|
| admin | admin123 | Admin (rulepack publish, audit) |
| controller | controller123 | Controller (all regions) |
| officer | officer123 | LM Officer (IN-MH scoped) |
| consumer | consumer123 | Consumer self-check |

## Currently Completed Features
- **Image capture — two modes on the New Scan page**:
  - **📷 Camera (GPay-style)**: live `getUserMedia` viewfinder, corner-bracket scan
    frame + animated scanline, shutter with flash/vibration feedback, flip camera,
    up to 4 shots with retake tray
  - **📁 File upload**: classic multi-file picker (kept as requested)
- **PWA**: web manifest, service worker (offline app shell, network-only API),
  installable on iOS/Android home screens, themed icons
- Vision-LLM extraction (16 declaration fields + quality flags) via OpenAI-compatible proxy
- Rule DSL interpreter + **17-rule LMPC-2011 rulepack** (`LMPC-2011-v1.2-GSR629E`):
  Rule 26 exemptions (short-circuit), 6(1)(a)–(f), 6(1)(aa), 6(1)(da), 6(2),
  9(1)/(4), Rule 7 Table I font-height lookup (needs_review without scale reference —
  never auto-fail), letter-width cross-field, 6(3)/18(2) sticker, 24(a)–(c) wholesale
- Bitemporal rulepack resolution by scan capture date
- Cases (RBAC + region scoping, optimistic concurrency), idempotent scan upload
  (client `capture_id`), SHA-256 content-addressed evidence in R2
- Compliance reports: `LMPC/YYYY/NNNNN` numbering, content-hash tamper evidence,
  print-to-PDF + DOC export
- Enforcement dashboard (verdict mix, top violated clauses, region breakdown),
  product repository w/ inspection history, review queue, append-only audit log
- **Flutter mobile scaffold** (`mobile/lmpc_mobile/`): camera capture screen with the
  same GPay-style overlay, offline-first drift/SQLite queue keyed on `capture_id`,
  connectivity-triggered sync engine with bounded retry, verdict caching, secure
  token storage — build instructions in its README

## Functional Entry URIs
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/auth/login` | `{username,password}` → `{token,user}` |
| POST | `/api/v1/auth/logout` · GET `/auth/me` | session mgmt |
| GET/POST | `/api/v1/cases` · GET/PATCH `/cases/:id` | case CRUD (RBAC) |
| POST | `/api/v1/cases/:id/scans` | multipart upload, idempotent on `capture_id`; fields: images[] (≤4×8MB), package_type, declared_category, container_type, pdp_area_cm2, scale_reference, device_class, geo_lat, geo_lon, captured_offline |
| POST | `/api/v1/scans/:id/process` | extraction + rule evaluation |
| GET | `/api/v1/scans/:id` | scan + extraction + evaluation |
| GET | `/api/v1/evidence/:key` | authed evidence image |
| POST | `/api/v1/scans/:id/report` · GET `/reports`, `/reports/:id/data` | report generation/fetch |
| GET | `/api/v1/dashboard/stats` | aggregates |
| GET | `/api/v1/repository/products` · `/products/:id` | scanned-product repository |
| GET/POST | `/api/v1/reviews` · `/reviews/:id/resolve` | review queue |
| GET/POST | `/api/v1/rulepacks` (+ `?effective_on=`) | versioned rulepacks |
| GET | `/api/v1/audit` | audit log (admin/controller) |
| GET | `/manifest.webmanifest`, `/sw.js` | PWA assets |

## Data Architecture
- **Storage**: Cloudflare **D1** (12 tables: users, sessions, cases, scan_events,
  extraction_results, rule_packs, rule_evaluations, compliance_reports, products,
  product_scans, audit_log, review_queue) + **R2** bucket `EVIDENCE`
  (content-addressed: `region/year/month/scanId/idx-hash16`)
- **Rules as data**: JSON rulepacks in D1, resolved bitemporally; interpreter check
  types: field_present, any_field_present, regex_match, enum_membership, unit_check,
  lookup_table, cross_field, quality_flag_absent, exemption
- **Flow**: capture (camera/upload/mobile queue) → idempotent upload → R2 + D1 →
  vision-LLM extraction → rule evaluation → verdicts/review queue → report

## User Guide
1. Sign in (see demo accounts). 2. Create a Case under **Cases**. 3. Open
**New Scan** → choose **Camera** tab → Start Camera → align label in frame →
shutter (up to 4 shots) — or use the **Upload File** tab. 4. Set package
metadata and submit — extraction + rule check runs (~30–60 s). 5. Review
verdicts per clause; generate a numbered report (print-to-PDF / DOC export).
6. Dashboard/repository/review-queue for enforcement workflows.

**Install as app (PWA)**: open the site on your phone → browser menu →
"Add to Home Screen" / "Install app". Camera capture requires HTTPS (sandbox URL is HTTPS).

**Flutter app**: see `mobile/lmpc_mobile/README.md` — run `flutter create .`,
merge permission snippets, `dart run build_runner build`, then
`flutter build apk --dart-define=LMPC_API=<gateway-url>`.

## Features Not Yet Implemented
- Production deploy (D1/R2 provisioning + `wrangler pages deploy`)
- Kafka-style async pipeline (design doc scale-out; single-request pipeline here)
- OpenSearch analytics, Keycloak SSO (Cloudflare-adapted equivalents in place)
- Physical net-quantity verification (explicit non-goal, implementation.md §10)

## Recommended Next Steps
1. Deploy to Cloudflare Pages (create real D1 + R2, apply migrations, set secrets)
2. Build the Flutter APK against the deployed URL and field-test offline sync
3. Golden-path CI fixtures per clause (implementation.md §7)

## Deployment
- **Platform**: Cloudflare Pages (Hono + Vite), local dev via PM2/wrangler on :3000
- **Status**: ✅ Sandbox dev active · ❌ Production not deployed
- **Tech Stack**: Hono + TypeScript + TailwindCSS (CDN) + D1 + R2 + PWA; Flutter (mobile)
- **Last Updated**: 2026-08-25
