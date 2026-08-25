// Default RulePack: Legal Metrology (Packaged Commodities) Rules, 2011
// Rules encoded as data (design.md §4.2) — evaluated by src/engine/ruleEngine.ts
// Source: The_Legal_Metrology_Packaged_Commodities_Rules_2011.pdf (G.S.R. 202(E), 7 March 2011, as amended)

import type { Rule } from '../engine/types'

export const LMPC_2011_RULEPACK_VERSION = 'LMPC-2011-v1.2-GSR629E'

export const LMPC_2011_RULES: Rule[] = [
  // ─── Rule 26: exemption short-circuit (evaluated first) ───
  {
    rule_id: 'LM-PC-2011-r26-exemption',
    clause: '26',
    title: 'Exempted packages (net quantity ≤ 10 g / 10 ml, fast food, scheduled formulations)',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [
      {
        type: 'exemption',
        conditions: [
          { kind: 'net_quantity_at_most', grams: 10, millilitres: 10 },
          { kind: 'category_in', categories: ['fast_food_restaurant', 'scheduled_drug_formulation', 'agricultural_farm_produce_above_50kg'] }
        ]
      }
    ],
    on_fail: { severity: 'info', message: '' },
    short_circuit: 'exempt'
  },

  // ─── Rule 6(1)(a): manufacturer / packer / importer name & address ───
  {
    rule_id: 'LM-PC-2011-r6-1-a',
    clause: '6(1)(a)',
    title: 'Name and address of manufacturer / packer / importer',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [
      { type: 'field_present', field: 'manufacturer_name' },
      { type: 'field_present', field: 'manufacturer_address' }
    ],
    on_fail: {
      severity: 'major',
      message: 'Name and complete address of the manufacturer (or manufacturer & packer, or importer) is missing — Rule 6(1)(a).'
    }
  },

  // ─── Rule 6(1)(aa): country of origin for imports ───
  {
    rule_id: 'LM-PC-2011-r6-1-aa',
    clause: '6(1)(aa)',
    title: 'Country of origin / manufacture / assembly (imported packages)',
    applies_to: { package_type: ['retail'], only_if_field: 'is_imported' },
    effective_from: '2011-04-01',
    checks: [{ type: 'field_present', field: 'country_of_origin' }],
    on_fail: {
      severity: 'major',
      message: 'Imported package must declare the name of the country of origin or manufacture or assembly — Rule 6(1)(aa).'
    }
  },

  // ─── Rule 6(1)(b): common / generic name ───
  {
    rule_id: 'LM-PC-2011-r6-1-b',
    clause: '6(1)(b)',
    title: 'Common or generic name of the commodity',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [{ type: 'field_present', field: 'common_name' }],
    on_fail: {
      severity: 'major',
      message: 'Common or generic name of the commodity contained in the package is missing — Rule 6(1)(b).'
    }
  },

  // ─── Rule 6(1)(c): net quantity ───
  {
    rule_id: 'LM-PC-2011-r6-1-c',
    clause: '6(1)(c)',
    title: 'Net quantity in standard units of weight or measure (or number)',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [{ type: 'field_present', field: 'net_quantity' }],
    on_fail: {
      severity: 'major',
      message: 'Net quantity in terms of standard unit of weight or measure (or number) is missing — Rule 6(1)(c).'
    }
  },

  // ─── Rule 13(2)/(5): net quantity uses correct standard unit ───
  {
    rule_id: 'LM-PC-2011-r13-units',
    clause: '13(2), 13(5)',
    title: 'Net quantity expressed in the correct standard unit',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [
      {
        type: 'unit_check',
        field: 'net_quantity',
        // <1kg ⇒ g, ≥1kg ⇒ kg; <1L ⇒ ml, ≥1L ⇒ L; length cm/m; count N/U pieces
        allowed_units: ['g', 'kg', 'mg', 'ml', 'l', 'cm', 'm', 'mm', 'n', 'u', 'pcs', 'pieces', 'pairs', 'sets', 'sheets', 'sq. cm', 'sq. m']
      }
    ],
    on_fail: {
      severity: 'minor',
      message: 'Net quantity is not expressed in a recognised standard unit (g/kg, ml/L, cm/m, or number) — Rule 13(2) & 13(5).'
    }
  },

  // ─── Rule 6(1)(d): month & year of manufacture / pre-packing / import ───
  {
    rule_id: 'LM-PC-2011-r6-1-d',
    clause: '6(1)(d)',
    title: 'Month and year of manufacture / pre-packing / import',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [
      { type: 'field_present', field: 'mfg_date' },
      {
        type: 'regex_match',
        field: 'mfg_date',
        pattern: '(0?[1-9]|1[0-2])[\\/\\-\\. ]?(20\\d{2}|\\d{2})|([A-Za-z]{3,9})[\\s,\\.\\-\\/]*(20\\d{2}|\\d{2})',
        description: 'month/year discernible (e.g. 05/2026 or May 2026)'
      }
    ],
    on_fail: {
      severity: 'major',
      message: 'Month and year of manufacture / pre-packing / import missing or not in a discernible month-year form — Rule 6(1)(d).'
    }
  },

  // ─── Rule 6(1)(da): best before / use by, where applicable ───
  {
    rule_id: 'LM-PC-2011-r6-1-da',
    clause: '6(1)(da)',
    title: '"Best before" / "Use by" date for perishable commodities',
    applies_to: { package_type: ['retail'], only_if_category: ['food', 'cosmetics', 'pharma', 'beverages'] },
    effective_from: '2011-04-01',
    checks: [{ type: 'field_present', field: 'best_before' }],
    on_fail: {
      severity: 'minor',
      message: 'Commodity that may become unfit for use over time must bear "best before" or "use by" date — Rule 6(1)(da).'
    }
  },

  // ─── Rule 6(1)(e): MRP inclusive of all taxes (post-GSR629E-2017 wording) ───
  {
    rule_id: 'LM-PC-2011-r6-1-e',
    clause: '6(1)(e)',
    title: 'Retail sale price (MRP) declaration, inclusive of all taxes',
    applies_to: {
      package_type: ['retail'],
      exclude_categories: ['bidi', 'lpg_administered_price', 'alcoholic_beverage_state_excise']
    },
    effective_from: '2011-04-01',
    amendment_history: ['GSR385E-2015-05-14', 'GSR629E-2017-06-23'],
    checks: [
      { type: 'field_present', field: 'mrp' },
      {
        type: 'regex_match',
        field: 'mrp',
        pattern: '(?i)(M\\.?\\s?R\\.?\\s?P|maximum\\s+retail\\s+price|retail\\s+sale\\s+price)',
        description: 'labelled as MRP / maximum retail price'
      },
      {
        type: 'regex_match',
        field: 'mrp',
        pattern: '(?i)incl(usive)?\\.?\\s*(of)?\\s*all\\s*taxes',
        description: 'marked "inclusive of all taxes"'
      },
      {
        type: 'regex_match',
        field: 'mrp',
        pattern: '(₹|Rs\\.?|INR)\\s*\\d+(\\.\\d{1,2})?',
        description: 'a rupee amount is stated'
      }
    ],
    on_fail: {
      severity: 'major',
      message: 'Retail sale price must be declared as "Maximum retail price ₹… inclusive of all taxes" — Rule 6(1)(e) read with Rule 2(m).'
    }
  },

  // ─── Rule 6(1)(f): dimensions where relevant ───
  {
    rule_id: 'LM-PC-2011-r6-1-f',
    clause: '6(1)(f)',
    title: 'Dimensions of the commodity, where size is relevant',
    applies_to: { package_type: ['retail'], only_if_category: ['textile', 'footwear', 'furniture', 'electronics_display'] },
    effective_from: '2011-04-01',
    checks: [{ type: 'field_present', field: 'dimensions' }],
    on_fail: {
      severity: 'minor',
      message: 'Where sizes are relevant, dimensions of the commodity must be declared — Rule 6(1)(f).'
    }
  },

  // ─── Rule 6(2): consumer care name, address, telephone, e-mail ───
  {
    rule_id: 'LM-PC-2011-r6-2',
    clause: '6(2)',
    title: 'Consumer care name, address, telephone number and e-mail',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [
      { type: 'field_present', field: 'consumer_care' },
      {
        type: 'regex_match',
        field: 'consumer_care',
        pattern: '(\\+?91[\\-\\s]?)?[0-9][0-9\\-\\s]{7,}|@|1800',
        description: 'contains a telephone number or e-mail'
      }
    ],
    on_fail: {
      severity: 'major',
      message: 'Name, address, telephone number and e-mail of the person/office to be contacted for consumer complaints is missing — Rule 6(2).'
    }
  },

  // ─── Rule 9(1): declarations legible & prominent, on the PDP ───
  {
    rule_id: 'LM-PC-2011-r9-1',
    clause: '9(1), 9(1A)',
    title: 'Declarations legible, prominent and on the principal display panel',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [
      { type: 'quality_flag_absent', flag: 'declarations_illegible' },
      { type: 'quality_flag_absent', flag: 'declarations_not_on_pdp' }
    ],
    on_fail: {
      severity: 'major',
      message: 'Declarations must be legible, prominent, and grouped on the principal display panel — Rule 9(1)/(1A).'
    }
  },

  // ─── Rule 9(4): language — Hindi (Devanagari) or English ───
  {
    rule_id: 'LM-PC-2011-r9-4',
    clause: '9(4)',
    title: 'Declarations in Hindi (Devanagari) or English',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [
      {
        type: 'enum_membership',
        field: 'declaration_scripts',
        any_of: ['english', 'latin', 'hindi', 'devanagari'],
        description: 'at least one declaration script is Hindi-Devanagari or English'
      }
    ],
    on_fail: {
      severity: 'major',
      message: 'Particulars of declarations must be in Hindi (Devanagari script) or English (additional languages permitted) — Rule 9(4).'
    }
  },

  // ─── Rule 7(2)-(3) Table I: minimum numeral height by PDP area ───
  {
    rule_id: 'LM-PC-2011-r7-fontheight',
    clause: '7(2)-(3), Table I',
    title: 'Minimum height of numerals by principal display panel area',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    requires_scale_reference: true, // absent ⇒ needs_review, never auto-fail (design.md §4.6)
    checks: [
      {
        type: 'lookup_table',
        input: 'pdp_area_cm2',
        field: 'measured_numeral_height_mm',
        require: '>=',
        table: [
          { max_area: 100, min_height_mm: 1.0, min_height_mm_blown: 2.0 },
          { max_area: 500, min_height_mm: 2.0, min_height_mm_blown: 4.0 },
          { max_area: 2500, min_height_mm: 4.0, min_height_mm_blown: 6.0 },
          { max_area: null, min_height_mm: 6.0, min_height_mm_blown: 6.0 }
        ]
      }
    ],
    on_fail: {
      severity: 'major',
      message: 'Height of numerals in the declaration is below the Table I minimum for the principal display panel area — Rule 7(2)/(3).'
    }
  },

  // ─── Rule 7: letter width ≥ 1/3 height ───
  {
    rule_id: 'LM-PC-2011-r7-letterwidth',
    clause: '7 (proviso)',
    title: 'Width of letters/numerals not less than one-third of height',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    requires_scale_reference: true,
    checks: [
      {
        type: 'cross_field',
        expr: 'measured_letter_width_mm >= measured_numeral_height_mm / 3',
        fields: ['measured_letter_width_mm', 'measured_numeral_height_mm'],
        description: 'width ≥ height/3 (except numeral 1 and letters i, I, l)'
      }
    ],
    on_fail: {
      severity: 'minor',
      message: 'Width of letters/numerals must not be less than one-third of their height (exceptions: "1", "i", "I", "l") — Rule 7.'
    }
  },

  // ─── Rule 6(3)/18(2): no sticker altering MRP upward ───
  {
    rule_id: 'LM-PC-2011-r6-3-sticker',
    clause: '6(3) proviso, 18(2)',
    title: 'No sticker altering / obscuring the declared MRP',
    applies_to: { package_type: ['retail'] },
    effective_from: '2011-04-01',
    checks: [
      { type: 'quality_flag_absent', flag: 'mrp_altered_by_sticker' },
      { type: 'quality_flag_absent', flag: 'mrp_overwritten' }
    ],
    on_fail: {
      severity: 'major',
      message: 'MRP appears altered or obscured by a sticker; a sticker may only declare a REDUCED price without covering the original — Rule 6(3) proviso / Rule 18(2).'
    }
  },

  // ─── Wholesale packages: Rule 24 ───
  {
    rule_id: 'LM-PC-2011-r24-a',
    clause: '24(a)',
    title: 'Wholesale: name & address of manufacturer / packer / importer',
    applies_to: { package_type: ['wholesale'] },
    effective_from: '2011-04-01',
    checks: [
      { type: 'field_present', field: 'manufacturer_name' },
      { type: 'field_present', field: 'manufacturer_address' }
    ],
    on_fail: { severity: 'major', message: 'Wholesale package must bear name and address of manufacturer / packer / importer — Rule 24(a).' }
  },
  {
    rule_id: 'LM-PC-2011-r24-b',
    clause: '24(b)',
    title: 'Wholesale: identity of the commodity',
    applies_to: { package_type: ['wholesale'] },
    effective_from: '2011-04-01',
    checks: [{ type: 'field_present', field: 'common_name' }],
    on_fail: { severity: 'major', message: 'Wholesale package must bear the identity of the commodity contained — Rule 24(b).' }
  },
  {
    rule_id: 'LM-PC-2011-r24-c',
    clause: '24(c)',
    title: 'Wholesale: number of retail packages or net quantity',
    applies_to: { package_type: ['wholesale'] },
    effective_from: '2011-04-01',
    checks: [
      {
        type: 'any_field_present',
        fields: ['retail_package_count', 'net_quantity'],
        description: 'total number of retail packages OR net quantity declared'
      }
    ],
    on_fail: { severity: 'major', message: 'Wholesale package must declare total number of retail packages contained or the net quantity — Rule 24(c).' }
  }
]

export const LMPC_2011_RULEPACK = {
  version: LMPC_2011_RULEPACK_VERSION,
  title: 'Legal Metrology (Packaged Commodities) Rules, 2011 — consolidated with amendments up to GSR 629(E) 2017',
  effective_from: '2017-06-23',
  effective_to: null as string | null,
  rules: LMPC_2011_RULES
}
