// Declarative rule-pack interpreter (implementation.md §4).
// Deliberately NOT a general scripting language — each check type is a small,
// unit-testable function so rule packs stay auditable by non-engineers.

import type {
  Rule, Check, Verdict, VerdictStatus, EvaluationResult, ExtractedField, ScanContext
} from './types'

const DEFAULT_CONFIDENCE = 0.75

type FieldMap = Record<string, ExtractedField>

function toFieldMap(fields: ExtractedField[]): FieldMap {
  const m: FieldMap = {}
  for (const f of fields) m[f.field] = f
  return m
}

function ruleApplies(rule: Rule, ctx: ScanContext, fm: FieldMap): boolean {
  if (!rule.applies_to.package_type.includes(ctx.package_type)) return false
  const cat = (ctx.declared_category || '').toLowerCase()
  if (rule.applies_to.exclude_categories?.some(c => c.toLowerCase() === cat)) return false
  if (rule.applies_to.only_if_category &&
      !rule.applies_to.only_if_category.some(c => c.toLowerCase() === cat)) return false
  if (rule.applies_to.only_if_field) {
    const f = fm[rule.applies_to.only_if_field]
    const truthy = f && f.present && f.value && !/^(no|false|n\/a|none)$/i.test(f.value.trim())
    if (!truthy) return false
  }
  // effective-dated: rule pack loaded for inspection date; still guard per-rule windows
  const d = ctx.inspection_date
  if (rule.effective_from && d < rule.effective_from) return false
  if (rule.effective_to && d > rule.effective_to) return false
  return true
}

// Parse "500 g", "1.5 L", "12 N", "2 x 250ml" style quantities
export function parseQuantity(value: string): { amount: number; unit: string } | null {
  const m = value.replace(/,/g, '').match(/([\d.]+)\s*(kg|g|mg|ltr|litre?s?|l|ml|cm|mm|m|n|u|pcs?|pieces?|pairs?|sets?|sheets?)\b/i)
  if (!m) return null
  const amount = parseFloat(m[1])
  if (!isFinite(amount)) return null
  let unit = m[2].toLowerCase()
  if (/^litre|^ltr/.test(unit)) unit = 'l'
  if (/^pieces?$|^pcs?$/.test(unit)) unit = 'pcs'
  return { amount, unit }
}

function quantityInGramsOrMl(value: string): { grams?: number; ml?: number } | null {
  const q = parseQuantity(value)
  if (!q) return null
  switch (q.unit) {
    case 'kg': return { grams: q.amount * 1000 }
    case 'g': return { grams: q.amount }
    case 'mg': return { grams: q.amount / 1000 }
    case 'l': return { ml: q.amount * 1000 }
    case 'ml': return { ml: q.amount }
    default: return null
  }
}

interface CheckOutcome { status: 'pass' | 'fail' | 'review'; detail: string }

function runCheck(check: Check, fm: FieldMap, ctx: ScanContext, threshold: number): CheckOutcome {
  switch (check.type) {
    case 'field_present': {
      const f = fm[check.field]
      if (!f || !f.present || !f.value || !f.value.trim()) {
        return { status: 'fail', detail: `field "${check.field}" not found on label` }
      }
      if (f.confidence < threshold) {
        return { status: 'review', detail: `field "${check.field}" read with low confidence (${f.confidence.toFixed(2)})` }
      }
      return { status: 'pass', detail: `"${check.field}" present` }
    }

    case 'any_field_present': {
      const found = check.fields.filter(name => {
        const f = fm[name]
        return f && f.present && f.value && f.value.trim()
      })
      if (found.length === 0) return { status: 'fail', detail: `none of [${check.fields.join(', ')}] found` }
      const low = found.every(name => fm[name].confidence < threshold)
      if (low) return { status: 'review', detail: `only low-confidence reads for [${found.join(', ')}]` }
      return { status: 'pass', detail: `found: ${found.join(', ')}` }
    }

    case 'regex_match': {
      const f = fm[check.field]
      if (!f || !f.present || !f.value) {
        return { status: 'fail', detail: `field "${check.field}" absent, cannot match ${check.description || 'pattern'}` }
      }
      let re: RegExp
      try {
        // support inline (?i) flag from YAML-style patterns
        const src = check.pattern.replace(/^\(\?i\)/, '')
        re = new RegExp(src, check.pattern.startsWith('(?i)') ? 'i' : '')
      } catch {
        return { status: 'review', detail: `invalid pattern in rule pack for "${check.field}"` }
      }
      if (!re.test(f.value)) {
        return { status: 'fail', detail: `"${check.field}" fails: ${check.description || check.pattern}` }
      }
      if (f.confidence < threshold) {
        return { status: 'review', detail: `"${check.field}" matches but OCR confidence low (${f.confidence.toFixed(2)})` }
      }
      return { status: 'pass', detail: `"${check.field}" satisfies ${check.description || 'pattern'}` }
    }

    case 'enum_membership': {
      const f = fm[check.field]
      if (!f || !f.value) return { status: 'review', detail: `"${check.field}" not determined by extraction` }
      const values = f.value.toLowerCase().split(/[,;/\s]+/).filter(Boolean)
      const ok = values.some(v => check.any_of.map(a => a.toLowerCase()).includes(v))
      return ok
        ? { status: 'pass', detail: `${check.field}=[${values.join(',')}] includes an allowed value` }
        : { status: 'fail', detail: `${check.field}=[${values.join(',')}] contains none of [${check.any_of.join(', ')}]` }
    }

    case 'unit_check': {
      const f = fm[check.field]
      if (!f || !f.value) return { status: 'fail', detail: `field "${check.field}" absent` }
      const q = parseQuantity(f.value)
      if (!q) return { status: 'review', detail: `could not parse a quantity+unit from "${f.value}"` }
      const ok = check.allowed_units.map(u => u.toLowerCase()).includes(q.unit)
      // Rule 13(5): <1kg must be g, ≥1kg must be kg (same for l/ml)
      if (ok) {
        if (q.unit === 'g' && q.amount >= 1000) return { status: 'fail', detail: `${q.amount} g should be expressed in kilograms (Rule 13)` }
        if (q.unit === 'ml' && q.amount >= 1000) return { status: 'fail', detail: `${q.amount} ml should be expressed in litres (Rule 13)` }
        if (q.unit === 'kg' && q.amount < 1) return { status: 'fail', detail: `${q.amount} kg should be expressed in grams (Rule 13)` }
        if (q.unit === 'l' && q.amount < 1) return { status: 'fail', detail: `${q.amount} L should be expressed in millilitres (Rule 13)` }
        return { status: 'pass', detail: `unit "${q.unit}" is a standard unit correctly scaled` }
      }
      return { status: 'fail', detail: `unit "${q.unit}" is not a permitted standard unit` }
    }

    case 'lookup_table': {
      const area = ctx.pdp_area_cm2
      const f = fm[check.field]
      if (area == null || area <= 0) {
        return { status: 'review', detail: 'principal display panel area not provided — cannot resolve Table I row' }
      }
      if (!f || !f.value) {
        return { status: 'review', detail: `measured value "${check.field}" unavailable — manual verification required` }
      }
      const measured = parseFloat(f.value)
      if (!isFinite(measured)) return { status: 'review', detail: `"${f.value}" is not a numeric measurement` }
      const blown = ctx.container_type === 'blown_formed_moulded'
      let required: number | null = null
      for (const row of check.table) {
        if (row.max_area === null || area <= row.max_area) {
          required = blown && row.min_height_mm_blown != null ? row.min_height_mm_blown : row.min_height_mm
          break
        }
      }
      if (required == null) return { status: 'review', detail: 'no Table I row matched' }
      const ok = check.require === '>=' ? measured >= required : measured <= required
      return ok
        ? { status: 'pass', detail: `measured ${measured} mm ${check.require} required ${required} mm (PDP ${area} cm²${blown ? ', blown/formed container' : ''})` }
        : { status: 'fail', detail: `measured ${measured} mm below required ${required} mm for PDP area ${area} cm²${blown ? ' (blown/formed container)' : ''}` }
    }

    case 'cross_field': {
      const vals: Record<string, number> = {}
      for (const name of check.fields) {
        const f = fm[name]
        const v = f?.value != null ? parseFloat(f.value) : NaN
        if (!isFinite(v)) return { status: 'review', detail: `"${name}" unavailable for cross-field check` }
        vals[name] = v
      }
      // supported expression form: "<a> >= <b> / <k>" — evaluated safely without eval()
      const m = check.expr.match(/^\s*(\w+)\s*>=\s*(\w+)\s*\/\s*([\d.]+)\s*$/)
      if (!m) return { status: 'review', detail: `unsupported cross_field expression: ${check.expr}` }
      const ok = vals[m[1]] >= vals[m[2]] / parseFloat(m[3])
      return ok
        ? { status: 'pass', detail: `${check.expr} holds (${vals[m[1]]} vs ${(vals[m[2]] / parseFloat(m[3])).toFixed(2)})` }
        : { status: 'fail', detail: `${check.expr} violated (${vals[m[1]]} < ${(vals[m[2]] / parseFloat(m[3])).toFixed(2)})` }
    }

    case 'quality_flag_absent': {
      if (ctx.quality_flags?.[check.flag]) {
        return { status: 'fail', detail: `quality flag "${check.flag}" raised by extraction` }
      }
      return { status: 'pass', detail: `no "${check.flag}" flag` }
    }

    case 'exemption': {
      for (const cond of check.conditions) {
        if (cond.kind === 'net_quantity_at_most') {
          const f = fm['net_quantity']
          if (f?.value) {
            const q = quantityInGramsOrMl(f.value)
            if (q && ((q.grams != null && q.grams <= cond.grams) || (q.ml != null && q.ml <= cond.millilitres))) {
              return { status: 'fail', detail: `net quantity ${f.value} ≤ ${cond.grams} g / ${cond.millilitres} ml — package exempt under Rule 26(a)` }
            }
          }
        } else if (cond.kind === 'category_in') {
          const cat = (ctx.declared_category || '').toLowerCase()
          if (cond.categories.map(c => c.toLowerCase()).includes(cat)) {
            return { status: 'fail', detail: `category "${cat}" exempt under Rule 26` }
          }
        }
      }
      return { status: 'pass', detail: 'no exemption condition met' }
    }
  }
}

export function evaluateRules(
  rules: Rule[],
  fields: ExtractedField[],
  ctx: ScanContext
): EvaluationResult {
  const fm = toFieldMap(fields)
  const threshold = ctx.confidence_threshold ?? DEFAULT_CONFIDENCE
  const verdicts: Verdict[] = []
  let exempt = false

  for (const rule of rules) {
    if (!ruleApplies(rule, ctx, fm)) {
      verdicts.push({
        rule_id: rule.rule_id, clause: rule.clause, title: rule.title,
        status: 'not_applicable', severity: rule.on_fail.severity,
        message: 'Not applicable to this package/category.', failed_checks: []
      })
      continue
    }

    // font-height style rules: without a scale reference, route to review, never auto-fail
    if (rule.requires_scale_reference && !ctx.scale_reference) {
      verdicts.push({
        rule_id: rule.rule_id, clause: rule.clause, title: rule.title,
        status: 'needs_review', severity: rule.on_fail.severity,
        message: 'No scale reference (ruler card / calibrated capture) in frame — font-height indeterminate, manual verification required.',
        failed_checks: []
      })
      continue
    }

    const failures: string[] = []
    const reviews: string[] = []
    const passes: string[] = []
    for (const check of rule.checks) {
      const out = runCheck(check, fm, ctx, threshold)
      if (out.status === 'fail') failures.push(out.detail)
      else if (out.status === 'review') reviews.push(out.detail)
      else passes.push(out.detail)
    }

    // exemption short-circuit: a "fail" on the exemption check means the package IS exempt
    if (rule.short_circuit === 'exempt') {
      if (failures.length > 0) {
        exempt = true
        verdicts.push({
          rule_id: rule.rule_id, clause: rule.clause, title: rule.title,
          status: 'exempt', severity: 'info',
          message: `Package exempt from Chapter II declarations: ${failures[0]}`, failed_checks: []
        })
        break // stop evaluating further rules
      }
      verdicts.push({
        rule_id: rule.rule_id, clause: rule.clause, title: rule.title,
        status: 'compliant', severity: 'info',
        message: 'Not an exempted package; full declaration checks apply.', failed_checks: []
      })
      continue
    }

    let status: VerdictStatus
    let message: string
    if (failures.length > 0) {
      status = 'non_compliant'
      message = `${rule.on_fail.message} [${failures.join('; ')}]`
    } else if (reviews.length > 0) {
      status = 'needs_review'
      message = `Requires officer review: ${reviews.join('; ')}`
    } else {
      status = 'compliant'
      message = passes.join('; ') || 'All checks passed.'
    }

    const evidenceFields = new Set<string>()
    for (const c of rule.checks) {
      if ('field' in c && typeof (c as any).field === 'string') evidenceFields.add((c as any).field)
      if ('fields' in c && Array.isArray((c as any).fields)) (c as any).fields.forEach((x: string) => evidenceFields.add(x))
    }
    const evidence = [...evidenceFields]
      .filter(name => fm[name])
      .map(name => ({ field: name, value: fm[name].value, confidence: fm[name].confidence }))

    verdicts.push({
      rule_id: rule.rule_id, clause: rule.clause, title: rule.title,
      status, severity: rule.on_fail.severity, message,
      failed_checks: failures, evidence
    })
  }

  const counts = {
    total: verdicts.length,
    compliant: verdicts.filter(v => v.status === 'compliant').length,
    non_compliant: verdicts.filter(v => v.status === 'non_compliant').length,
    needs_review: verdicts.filter(v => v.status === 'needs_review').length,
    not_applicable: verdicts.filter(v => v.status === 'not_applicable').length,
    major_violations: verdicts.filter(v => v.status === 'non_compliant' && v.severity === 'major').length,
    minor_violations: verdicts.filter(v => v.status === 'non_compliant' && v.severity === 'minor').length,
    exempt
  }

  const overall_status = exempt
    ? 'exempt'
    : counts.non_compliant > 0
      ? 'non_compliant'
      : counts.needs_review > 0
        ? 'needs_review'
        : 'compliant'

  return { overall_status, verdicts, summary: counts }
}
