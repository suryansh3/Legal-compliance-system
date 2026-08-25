// API routes: auth, cases, scans (upload → extraction → evaluation), reports,
// rule packs, dashboard, repository search, review queue.

import { Hono } from 'hono'
import type { Bindings, SessionUser } from './helpers'
import { uid, sha256Hex, hashPassword, audit, requireAuth } from './helpers'
import { evaluateRules } from '../engine/ruleEngine'
import type { Rule, ExtractedField, ScanContext } from '../engine/types'
import { extractFromImages } from '../engine/extraction'
import { LMPC_2011_RULEPACK } from '../rulepack/lmpc2011'

const api = new Hono<{ Bindings: Bindings; Variables: { user: SessionUser } }>()

// ─────────────────────────── Auth ───────────────────────────

api.post('/auth/login', async (c) => {
  const { username, password } = await c.req.json<{ username: string; password: string }>()
  if (!username || !password) return c.json({ error: 'username and password required' }, 400)
  const hash = await hashPassword(password)
  const user = await c.env.DB.prepare(
    'SELECT user_id, username, full_name, role, region_id FROM users WHERE username = ? AND password_hash = ?'
  ).bind(username.toLowerCase().trim(), hash).first<SessionUser>()
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)

  const token = uid('tok_')
  await c.env.DB.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+12 hours'))"
  ).bind(token, user.user_id).run()
  await audit(c.env.DB, user.user_id, 'login')
  return c.json({ token, user })
})

api.post('/auth/logout', requireAuth(), async (c) => {
  const auth = c.req.header('Authorization')!
  await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(auth.slice(7)).run()
  return c.json({ ok: true })
})

api.get('/auth/me', requireAuth(), (c) => c.json({ user: c.get('user') }))

// ─────────────────────────── Rule packs ───────────────────────────

async function ensureDefaultRulePack(db: D1Database): Promise<void> {
  const existing = await db.prepare('SELECT COUNT(*) AS n FROM rule_packs').first<{ n: number }>()
  if ((existing?.n ?? 0) > 0) return
  await db.prepare(
    'INSERT INTO rule_packs (rule_pack_id, version, title, effective_from, effective_to, rules, published_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    uid('rp_'), LMPC_2011_RULEPACK.version, LMPC_2011_RULEPACK.title,
    LMPC_2011_RULEPACK.effective_from, LMPC_2011_RULEPACK.effective_to,
    JSON.stringify(LMPC_2011_RULEPACK.rules), 'system'
  ).run()
}

async function resolveRulePack(db: D1Database, onDate: string) {
  await ensureDefaultRulePack(db)
  const row = await db.prepare(`
    SELECT rule_pack_id, version, title, effective_from, effective_to, rules
    FROM rule_packs
    WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
    ORDER BY effective_from DESC LIMIT 1
  `).bind(onDate, onDate).first<any>()
  if (row) return row
  // fall back to latest pack
  return db.prepare(
    'SELECT rule_pack_id, version, title, effective_from, effective_to, rules FROM rule_packs ORDER BY effective_from DESC LIMIT 1'
  ).first<any>()
}

api.get('/rulepacks', requireAuth(), async (c) => {
  await ensureDefaultRulePack(c.env.DB)
  const rows = await c.env.DB.prepare(
    'SELECT rule_pack_id, version, title, effective_from, effective_to, published_by, published_at FROM rule_packs ORDER BY effective_from DESC'
  ).all()
  return c.json({ rule_packs: rows.results })
})

api.get('/rulepacks/:id', requireAuth(), async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM rule_packs WHERE rule_pack_id = ?')
    .bind(c.req.param('id')).first<any>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  row.rules = JSON.parse(row.rules)
  return c.json(row)
})

api.post('/rulepacks', requireAuth(['admin', 'controller', 'director']), async (c) => {
  const body = await c.req.json<any>()
  if (!body.version || !body.effective_from || !Array.isArray(body.rules)) {
    return c.json({ error: 'version, effective_from and rules[] required' }, 400)
  }
  const id = uid('rp_')
  await c.env.DB.prepare(
    'INSERT INTO rule_packs (rule_pack_id, version, title, effective_from, effective_to, rules, published_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.version, body.title ?? body.version, body.effective_from,
    body.effective_to ?? null, JSON.stringify(body.rules), c.get('user').user_id).run()
  await audit(c.env.DB, c.get('user').user_id, 'rulepack.publish', 'rule_pack', id, body.version)
  return c.json({ rule_pack_id: id }, 201)
})

// ─────────────────────────── Cases ───────────────────────────

api.post('/cases', requireAuth(), async (c) => {
  const user = c.get('user')
  const body = await c.req.json<any>()
  const caseType = ['inspection', 'self_check', 'consumer_complaint'].includes(body.case_type)
    ? body.case_type
    : user.role === 'consumer' ? 'consumer_complaint' : user.role === 'ecommerce' ? 'self_check' : 'inspection'
  const id = uid('case_')
  await c.env.DB.prepare(
    'INSERT INTO cases (case_id, region_id, officer_id, case_type, title, location, premises, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.region_id || user.region_id, user.user_id, caseType,
    body.title ?? null, body.location ?? null, body.premises ?? null, body.notes ?? null).run()
  await audit(c.env.DB, user.user_id, 'case.create', 'case', id)
  const row = await c.env.DB.prepare('SELECT * FROM cases WHERE case_id = ?').bind(id).first()
  return c.json(row, 201)
})

api.get('/cases', requireAuth(), async (c) => {
  const user = c.get('user')
  const q = c.req.query()
  const conds: string[] = []
  const binds: any[] = []
  // RBAC scoping: consumers/e-commerce see only their own cases
  if (user.role === 'consumer' || user.role === 'ecommerce') {
    conds.push('officer_id = ?'); binds.push(user.user_id)
  } else if (user.role === 'officer' && user.region_id !== 'IN-ALL') {
    conds.push('region_id = ?'); binds.push(user.region_id)
  }
  if (q.status) { conds.push('status = ?'); binds.push(q.status) }
  if (q.case_type) { conds.push('case_type = ?'); binds.push(q.case_type) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = await c.env.DB.prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM scan_events s WHERE s.case_id = c.case_id) AS scan_count,
      (SELECT COUNT(*) FROM rule_evaluations e JOIN scan_events s2 ON s2.scan_id = e.scan_id
        WHERE s2.case_id = c.case_id AND e.overall_status = 'non_compliant') AS violation_count
    FROM cases c ${where} ORDER BY c.created_at DESC LIMIT 200
  `).bind(...binds).all()
  return c.json({ cases: rows.results })
})

api.get('/cases/:id', requireAuth(), async (c) => {
  const id = c.req.param('id')
  const caseRow = await c.env.DB.prepare('SELECT * FROM cases WHERE case_id = ?').bind(id).first()
  if (!caseRow) return c.json({ error: 'Case not found' }, 404)
  const scans = await c.env.DB.prepare(`
    SELECT s.*, e.evaluation_id, e.overall_status, e.summary AS eval_summary
    FROM scan_events s
    LEFT JOIN rule_evaluations e ON e.scan_id = s.scan_id
      AND e.created_at = (SELECT MAX(created_at) FROM rule_evaluations WHERE scan_id = s.scan_id)
    WHERE s.case_id = ? ORDER BY s.created_at DESC
  `).bind(id).all()
  return c.json({ case: caseRow, scans: scans.results })
})

api.patch('/cases/:id', requireAuth(['officer', 'controller', 'director', 'admin']), async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<any>()
  const allowed = ['open', 'under_review', 'closed', 'disputed']
  if (body.status && !allowed.includes(body.status)) return c.json({ error: 'invalid status' }, 400)
  // optimistic concurrency on version (design.md §4.5)
  const res = await c.env.DB.prepare(`
    UPDATE cases SET
      status = COALESCE(?, status), notes = COALESCE(?, notes),
      version = version + 1, updated_at = datetime('now')
    WHERE case_id = ? AND version = COALESCE(?, version)
  `).bind(body.status ?? null, body.notes ?? null, id, body.version ?? null).run()
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'Case not found or version conflict' }, 409)
  await audit(c.env.DB, c.get('user').user_id, 'case.update', 'case', id, JSON.stringify(body))
  return c.json(await c.env.DB.prepare('SELECT * FROM cases WHERE case_id = ?').bind(id).first())
})

// ─────────────────── Scan upload → extraction → evaluation ───────────────────

api.post('/cases/:id/scans', requireAuth(), async (c) => {
  const user = c.get('user')
  const caseId = c.req.param('id')
  const caseRow = await c.env.DB.prepare('SELECT * FROM cases WHERE case_id = ?').bind(caseId).first<any>()
  if (!caseRow) return c.json({ error: 'Case not found' }, 404)

  const form = await c.req.formData()
  const captureId = String(form.get('capture_id') || uid('cap_'))

  // idempotency on capture_id (implementation.md §5)
  const dupe = await c.env.DB.prepare('SELECT scan_id FROM scan_events WHERE capture_id = ?')
    .bind(captureId).first<any>()
  if (dupe) return c.json({ scan_id: dupe.scan_id, duplicate: true })

  const files = form.getAll('images').filter((f): f is File => f instanceof File)
  if (files.length === 0) return c.json({ error: 'At least one image required (field "images")' }, 400)
  if (files.length > 4) return c.json({ error: 'Maximum 4 images per scan' }, 400)

  const scanId = uid('scan_')
  const now = new Date()
  const keys: string[] = []
  const hashes: string[] = []
  for (let i = 0; i < files.length; i++) {
    const buf = await files[i].arrayBuffer()
    if (buf.byteLength > 8 * 1024 * 1024) return c.json({ error: `Image ${i + 1} exceeds 8 MB` }, 400)
    const hash = await sha256Hex(buf)
    // content-addressed evidence key (design.md §7)
    const key = `${caseRow.region_id}/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${scanId}/${i}-${hash.slice(0, 16)}`
    await c.env.EVIDENCE.put(key, buf, {
      httpMetadata: { contentType: files[i].type || 'image/jpeg' }
    })
    keys.push(key)
    hashes.push(hash)
  }

  const packageType = ['retail', 'wholesale', 'export'].includes(String(form.get('package_type')))
    ? String(form.get('package_type')) : 'retail'
  const pdpArea = parseFloat(String(form.get('pdp_area_cm2') || '')) || null
  const scaleRef = String(form.get('scale_reference')) === 'true' ? 1 : 0
  const containerType = String(form.get('container_type')) === 'blown_formed_moulded' ? 'blown_formed_moulded' : 'printed'
  const geoLat = parseFloat(String(form.get('geo_lat') || '')) || null
  const geoLon = parseFloat(String(form.get('geo_lon') || '')) || null

  await c.env.DB.prepare(`
    INSERT INTO scan_events
      (scan_id, case_id, capture_id, region_id, image_refs, image_hashes, device_class,
       package_type, declared_category, pdp_area_cm2, scale_reference, container_type,
       captured_offline, geo_lat, geo_lon, synced_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'uploaded')
  `).bind(
    scanId, caseId, captureId, caseRow.region_id, JSON.stringify(keys), JSON.stringify(hashes),
    String(form.get('device_class') || 'web'), packageType,
    String(form.get('declared_category') || '') || null, pdpArea, scaleRef, containerType,
    String(form.get('captured_offline')) === 'true' ? 1 : 0, geoLat, geoLon
  ).run()
  await audit(c.env.DB, user.user_id, 'scan.upload', 'scan', scanId, `${files.length} image(s)`)
  return c.json({ scan_id: scanId, image_refs: keys, image_hashes: hashes }, 201)
})

// Run OCR/VLM extraction + rule evaluation for a scan
api.post('/scans/:id/process', requireAuth(), async (c) => {
  const scanId = c.req.param('id')
  const db = c.env.DB
  const scan = await db.prepare('SELECT * FROM scan_events WHERE scan_id = ?').bind(scanId).first<any>()
  if (!scan) return c.json({ error: 'Scan not found' }, 404)

  await db.prepare("UPDATE scan_events SET status = 'extracting' WHERE scan_id = ?").bind(scanId).run()

  try {
    // Load evidence images from R2 → data URLs for the vision model
    const keys: string[] = JSON.parse(scan.image_refs)
    const dataUrls: string[] = []
    for (const key of keys) {
      const obj = await c.env.EVIDENCE.get(key)
      if (!obj) throw new Error(`Evidence object missing: ${key}`)
      const buf = await obj.arrayBuffer()
      const contentType = obj.httpMetadata?.contentType || 'image/jpeg'
      const bytes = new Uint8Array(buf)
      let binary = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      dataUrls.push(`data:${contentType};base64,${btoa(binary)}`)
    }

    const extraction = await extractFromImages(
      { OPENAI_API_KEY: c.env.OPENAI_API_KEY, OPENAI_BASE_URL: c.env.OPENAI_BASE_URL },
      dataUrls, scan.package_type
    )

    const extractionId = uid('ext_')
    await db.prepare(
      'INSERT INTO extraction_results (extraction_id, scan_id, model_name, model_version, fields, quality_flags, raw_response) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(extractionId, scanId, extraction.model_name, extraction.model_version,
      JSON.stringify(extraction.fields), JSON.stringify(extraction.quality_flags),
      extraction.raw ?? null).run()

    // Resolve rule pack effective on the scan's capture date (bitemporal, design.md §4.2)
    const inspectionDate = (scan.captured_at || new Date().toISOString()).slice(0, 10)
    const pack = await resolveRulePack(db, inspectionDate)
    const rules: Rule[] = JSON.parse(pack.rules)

    const ctx: ScanContext = {
      package_type: scan.package_type,
      declared_category: scan.declared_category,
      pdp_area_cm2: scan.pdp_area_cm2,
      scale_reference: Boolean(scan.scale_reference),
      container_type: scan.container_type,
      inspection_date: inspectionDate,
      quality_flags: extraction.quality_flags
    }
    const result = evaluateRules(rules, extraction.fields as ExtractedField[], ctx)

    const evaluationId = uid('eval_')
    await db.prepare(
      'INSERT INTO rule_evaluations (evaluation_id, extraction_id, scan_id, rule_pack_id, verdicts, overall_status, summary) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(evaluationId, extractionId, scanId, pack.rule_pack_id,
      JSON.stringify(result.verdicts), result.overall_status, JSON.stringify(result.summary)).run()

    // needs_review verdicts → human review queue (design.md §4.3)
    if (result.overall_status === 'needs_review' || result.summary.needs_review > 0) {
      await db.prepare(
        'INSERT INTO review_queue (review_id, evaluation_id, scan_id, region_id) VALUES (?, ?, ?, ?)'
      ).bind(uid('rev_'), evaluationId, scanId, scan.region_id).run()
    }

    // Product repository: fingerprint by brand+common name for compliance history
    const fm: Record<string, ExtractedField> = {}
    for (const f of extraction.fields) fm[f.field] = f
    const brand = fm['brand_name']?.value?.trim()
    const cname = fm['common_name']?.value?.trim()
    if (cname) {
      const fingerprint = `${(brand || 'unknown').toLowerCase()}::${cname.toLowerCase()}`.slice(0, 200)
      let product = await db.prepare('SELECT product_id FROM products WHERE fingerprint = ?').bind(fingerprint).first<any>()
      if (!product) {
        const pid = uid('prod_')
        await db.prepare('INSERT INTO products (product_id, brand, name, category, fingerprint) VALUES (?, ?, ?, ?, ?)')
          .bind(pid, brand ?? null, cname, scan.declared_category, fingerprint).run()
        product = { product_id: pid }
      }
      await db.prepare('INSERT OR IGNORE INTO product_scans (product_id, scan_id) VALUES (?, ?)')
        .bind(product.product_id, scanId).run()
    }

    await db.prepare("UPDATE scan_events SET status = 'evaluated' WHERE scan_id = ?").bind(scanId).run()
    await audit(db, c.get('user').user_id, 'scan.process', 'scan', scanId, result.overall_status)

    return c.json({
      scan_id: scanId,
      extraction_id: extractionId,
      evaluation_id: evaluationId,
      rule_pack: { id: pack.rule_pack_id, version: pack.version },
      extraction: { model: extraction.model_name, fields: extraction.fields, quality_flags: extraction.quality_flags },
      evaluation: result
    })
  } catch (err: any) {
    await db.prepare("UPDATE scan_events SET status = 'error' WHERE scan_id = ?").bind(scanId).run()
    return c.json({ error: `Processing failed: ${err.message}` }, 500)
  }
})

api.get('/scans/:id', requireAuth(), async (c) => {
  const scanId = c.req.param('id')
  const scan = await c.env.DB.prepare('SELECT * FROM scan_events WHERE scan_id = ?').bind(scanId).first<any>()
  if (!scan) return c.json({ error: 'Scan not found' }, 404)
  const extraction = await c.env.DB.prepare(
    'SELECT * FROM extraction_results WHERE scan_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(scanId).first<any>()
  const evaluation = await c.env.DB.prepare(
    'SELECT * FROM rule_evaluations WHERE scan_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(scanId).first<any>()
  if (extraction) {
    extraction.fields = JSON.parse(extraction.fields)
    extraction.quality_flags = extraction.quality_flags ? JSON.parse(extraction.quality_flags) : {}
    delete extraction.raw_response
  }
  if (evaluation) {
    evaluation.verdicts = JSON.parse(evaluation.verdicts)
    evaluation.summary = evaluation.summary ? JSON.parse(evaluation.summary) : null
  }
  scan.image_refs = JSON.parse(scan.image_refs)
  scan.image_hashes = scan.image_hashes ? JSON.parse(scan.image_hashes) : []
  return c.json({ scan, extraction, evaluation })
})

// Serve evidence image from R2
api.get('/evidence/:key{.+}', requireAuth(), async (c) => {
  const key = c.req.param('key')
  const obj = await c.env.EVIDENCE.get(key)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'private, max-age=3600'
    }
  })
})

// ─────────────────────────── Reports ───────────────────────────

api.post('/scans/:id/report', requireAuth(), async (c) => {
  const scanId = c.req.param('id')
  const db = c.env.DB
  const scan = await db.prepare('SELECT * FROM scan_events WHERE scan_id = ?').bind(scanId).first<any>()
  if (!scan) return c.json({ error: 'Scan not found' }, 404)
  const evaluation = await db.prepare(
    'SELECT * FROM rule_evaluations WHERE scan_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(scanId).first<any>()
  if (!evaluation) return c.json({ error: 'Scan has not been evaluated yet' }, 400)

  const existing = await db.prepare(
    'SELECT * FROM compliance_reports WHERE evaluation_id = ?'
  ).bind(evaluation.evaluation_id).first<any>()
  if (existing) return c.json(existing)

  const reportId = uid('rep_')
  const seq = await db.prepare('SELECT COUNT(*) AS n FROM compliance_reports').first<{ n: number }>()
  const reportNo = `LMPC/${new Date().getFullYear()}/${String((seq?.n ?? 0) + 1).padStart(5, '0')}`
  const payload = JSON.stringify({
    report_no: reportNo, scan_id: scanId, evaluation_id: evaluation.evaluation_id,
    rule_pack_id: evaluation.rule_pack_id, verdicts: evaluation.verdicts,
    overall: evaluation.overall_status, image_hashes: scan.image_hashes
  })
  const contentHash = await sha256Hex(payload)

  await db.prepare(
    'INSERT INTO compliance_reports (report_id, case_id, scan_id, evaluation_id, report_no, content_hash, generated_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(reportId, scan.case_id, scanId, evaluation.evaluation_id, reportNo, contentHash, c.get('user').user_id).run()
  await audit(db, c.get('user').user_id, 'report.generate', 'report', reportId, reportNo)

  return c.json(await db.prepare('SELECT * FROM compliance_reports WHERE report_id = ?').bind(reportId).first(), 201)
})

// Full report data bundle (used by frontend to render printable/exportable report)
api.get('/reports/:id/data', requireAuth(), async (c) => {
  const db = c.env.DB
  const report = await db.prepare('SELECT * FROM compliance_reports WHERE report_id = ?')
    .bind(c.req.param('id')).first<any>()
  if (!report) return c.json({ error: 'Report not found' }, 404)
  const [caseRow, scan, evaluation] = await Promise.all([
    db.prepare('SELECT * FROM cases WHERE case_id = ?').bind(report.case_id).first<any>(),
    db.prepare('SELECT * FROM scan_events WHERE scan_id = ?').bind(report.scan_id).first<any>(),
    db.prepare('SELECT * FROM rule_evaluations WHERE evaluation_id = ?').bind(report.evaluation_id).first<any>()
  ])
  const extraction = await db.prepare('SELECT * FROM extraction_results WHERE extraction_id = ?')
    .bind(evaluation.extraction_id).first<any>()
  const pack = await db.prepare('SELECT rule_pack_id, version, title FROM rule_packs WHERE rule_pack_id = ?')
    .bind(evaluation.rule_pack_id).first<any>()
  const officer = caseRow?.officer_id
    ? await db.prepare('SELECT full_name, role, region_id FROM users WHERE user_id = ?').bind(caseRow.officer_id).first<any>()
    : null

  evaluation.verdicts = JSON.parse(evaluation.verdicts)
  evaluation.summary = evaluation.summary ? JSON.parse(evaluation.summary) : null
  if (extraction) {
    extraction.fields = JSON.parse(extraction.fields)
    extraction.quality_flags = extraction.quality_flags ? JSON.parse(extraction.quality_flags) : {}
    delete extraction.raw_response
  }
  scan.image_refs = JSON.parse(scan.image_refs)
  scan.image_hashes = scan.image_hashes ? JSON.parse(scan.image_hashes) : []

  return c.json({ report, case: caseRow, scan, evaluation, extraction, rule_pack: pack, officer })
})

api.get('/reports', requireAuth(), async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT r.*, e.overall_status, c.title AS case_title, c.region_id
    FROM compliance_reports r
    JOIN rule_evaluations e ON e.evaluation_id = r.evaluation_id
    JOIN cases c ON c.case_id = r.case_id
    ORDER BY r.generated_at DESC LIMIT 200
  `).all()
  return c.json({ reports: rows.results })
})

// ─────────────────────────── Dashboard & repository ───────────────────────────

api.get('/dashboard/stats', requireAuth(), async (c) => {
  const db = c.env.DB
  const [cases, scans, evals, reviews, reports] = await Promise.all([
    db.prepare("SELECT status, COUNT(*) AS n FROM cases GROUP BY status").all(),
    db.prepare("SELECT COUNT(*) AS n FROM scan_events").first<any>(),
    db.prepare("SELECT overall_status, COUNT(*) AS n FROM rule_evaluations GROUP BY overall_status").all(),
    db.prepare("SELECT COUNT(*) AS n FROM review_queue WHERE status = 'pending'").first<any>(),
    db.prepare("SELECT COUNT(*) AS n FROM compliance_reports").first<any>()
  ])
  // top violated clauses
  const evalRows = await db.prepare('SELECT verdicts FROM rule_evaluations ORDER BY created_at DESC LIMIT 500').all()
  const clauseCounts: Record<string, { clause: string; title: string; count: number }> = {}
  for (const row of evalRows.results as any[]) {
    for (const v of JSON.parse(row.verdicts)) {
      if (v.status === 'non_compliant') {
        const k = v.clause
        clauseCounts[k] = clauseCounts[k] || { clause: v.clause, title: v.title, count: 0 }
        clauseCounts[k].count++
      }
    }
  }
  const topViolations = Object.values(clauseCounts).sort((a, b) => b.count - a.count).slice(0, 8)

  const byRegion = await db.prepare(`
    SELECT s.region_id, COUNT(DISTINCT s.scan_id) AS scans,
      SUM(CASE WHEN e.overall_status = 'non_compliant' THEN 1 ELSE 0 END) AS violations
    FROM scan_events s LEFT JOIN rule_evaluations e ON e.scan_id = s.scan_id
    GROUP BY s.region_id ORDER BY scans DESC LIMIT 10
  `).all()

  return c.json({
    cases_by_status: cases.results,
    total_scans: scans?.n ?? 0,
    evaluations_by_status: evals.results,
    pending_reviews: reviews?.n ?? 0,
    total_reports: reports?.n ?? 0,
    top_violations: topViolations,
    by_region: byRegion.results
  })
})

api.get('/repository/search', requireAuth(), async (c) => {
  const q = (c.req.query('q') || '').trim()
  const status = c.req.query('status')
  const conds: string[] = []
  const binds: any[] = []
  if (q) {
    conds.push('(p.name LIKE ? OR p.brand LIKE ?)')
    binds.push(`%${q}%`, `%${q}%`)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = await c.env.DB.prepare(`
    SELECT p.product_id, p.brand, p.name, p.category,
      COUNT(ps.scan_id) AS scan_count,
      MAX(s.captured_at) AS last_scanned,
      (SELECT e.overall_status FROM rule_evaluations e
        JOIN product_scans ps2 ON ps2.scan_id = e.scan_id
        WHERE ps2.product_id = p.product_id ORDER BY e.created_at DESC LIMIT 1) AS latest_status
    FROM products p
    LEFT JOIN product_scans ps ON ps.product_id = p.product_id
    LEFT JOIN scan_events s ON s.scan_id = ps.scan_id
    ${where}
    GROUP BY p.product_id ORDER BY last_scanned DESC LIMIT 100
  `).bind(...binds).all()
  let results = rows.results as any[]
  if (status) results = results.filter(r => r.latest_status === status)
  return c.json({ products: results })
})

api.get('/repository/products/:id', requireAuth(), async (c) => {
  const pid = c.req.param('id')
  const product = await c.env.DB.prepare('SELECT * FROM products WHERE product_id = ?').bind(pid).first<any>()
  if (!product) return c.json({ error: 'Not found' }, 404)
  const history = await c.env.DB.prepare(`
    SELECT s.scan_id, s.case_id, s.captured_at, s.region_id, e.overall_status, e.summary
    FROM product_scans ps
    JOIN scan_events s ON s.scan_id = ps.scan_id
    LEFT JOIN rule_evaluations e ON e.scan_id = s.scan_id
      AND e.created_at = (SELECT MAX(created_at) FROM rule_evaluations WHERE scan_id = s.scan_id)
    WHERE ps.product_id = ? ORDER BY s.captured_at DESC
  `).bind(pid).all()
  return c.json({ product, history: history.results })
})

// ─────────────────────────── Review queue ───────────────────────────

api.get('/reviews', requireAuth(['officer', 'controller', 'director', 'admin']), async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT rq.*, s.case_id, s.package_type, e.overall_status
    FROM review_queue rq
    JOIN scan_events s ON s.scan_id = rq.scan_id
    JOIN rule_evaluations e ON e.evaluation_id = rq.evaluation_id
    WHERE rq.status = 'pending' ORDER BY rq.created_at ASC LIMIT 100
  `).all()
  return c.json({ reviews: rows.results })
})

api.post('/reviews/:id/resolve', requireAuth(['officer', 'controller', 'director', 'admin']), async (c) => {
  const body = await c.req.json<any>()
  const res = await c.env.DB.prepare(`
    UPDATE review_queue SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = datetime('now')
    WHERE review_id = ? AND status = 'pending'
  `).bind(body.resolution || 'reviewed', c.get('user').user_id, c.req.param('id')).run()
  if ((res.meta.changes ?? 0) === 0) return c.json({ error: 'Review not found or already resolved' }, 404)
  await audit(c.env.DB, c.get('user').user_id, 'review.resolve', 'review', c.req.param('id'), body.resolution)
  return c.json({ ok: true })
})

// ─────────────────────────── Audit log ───────────────────────────

api.get('/audit', requireAuth(['controller', 'director', 'admin']), async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id
    ORDER BY a.audit_id DESC LIMIT 200
  `).all()
  return c.json({ audit: rows.results })
})

export default api
