// Rule DSL types — implementation.md §4: small, auditable set of check types.

export type Severity = 'major' | 'minor' | 'info'
export type VerdictStatus = 'compliant' | 'non_compliant' | 'needs_review' | 'not_applicable' | 'exempt'
export type OverallStatus = 'compliant' | 'non_compliant' | 'needs_review' | 'exempt'

export interface ExtractedField {
  field: string
  value: string | null
  present: boolean
  confidence: number // 0..1
  bbox?: [number, number, number, number] | null
  script?: string | null
  notes?: string | null
}

export interface ScanContext {
  package_type: 'retail' | 'wholesale' | 'export' | 'unknown'
  declared_category?: string | null
  pdp_area_cm2?: number | null
  scale_reference: boolean
  container_type?: 'printed' | 'blown_formed_moulded'
  inspection_date: string // ISO date — rule pack resolved on this date
  quality_flags: Record<string, boolean>
  confidence_threshold?: number // default 0.75 (implementation.md §6.4)
}

export type Check =
  | { type: 'field_present'; field: string; description?: string }
  | { type: 'any_field_present'; fields: string[]; description?: string }
  | { type: 'regex_match'; field: string; pattern: string; description?: string }
  | { type: 'enum_membership'; field: string; any_of: string[]; description?: string }
  | { type: 'unit_check'; field: string; allowed_units: string[]; description?: string }
  | {
      type: 'lookup_table'
      input: string
      field: string
      require: '>=' | '<='
      table: { max_area: number | null; min_height_mm: number; min_height_mm_blown?: number }[]
      description?: string
    }
  | { type: 'cross_field'; expr: string; fields: string[]; description?: string }
  | { type: 'quality_flag_absent'; flag: string; description?: string }
  | {
      type: 'exemption'
      conditions: (
        | { kind: 'net_quantity_at_most'; grams: number; millilitres: number }
        | { kind: 'category_in'; categories: string[] }
      )[]
      description?: string
    }

export interface Rule {
  rule_id: string
  clause: string
  title: string
  applies_to: {
    package_type: string[]
    exclude_categories?: string[]
    only_if_category?: string[]
    only_if_field?: string // rule applies only when this extracted field is present/truthy
  }
  effective_from: string
  effective_to?: string | null
  amendment_history?: string[]
  requires_scale_reference?: boolean
  checks: Check[]
  on_fail: { severity: Severity; message: string }
  short_circuit?: 'exempt'
}

export interface Verdict {
  rule_id: string
  clause: string
  title: string
  status: VerdictStatus
  severity: Severity
  message: string
  failed_checks: string[]
  evidence?: { field: string; value: string | null; confidence: number }[]
}

export interface EvaluationResult {
  overall_status: OverallStatus
  verdicts: Verdict[]
  summary: {
    total: number
    compliant: number
    non_compliant: number
    needs_review: number
    not_applicable: number
    major_violations: number
    minor_violations: number
    exempt: boolean
  }
}
