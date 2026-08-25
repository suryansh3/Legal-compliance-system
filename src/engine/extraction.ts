// ExtractionProvider (design.md §6): pluggable vision extraction behind one interface.
// This deployment uses an OpenAI-compatible vision LLM endpoint; in the reference
// architecture GLM-OCR (primary) + Qwen3-VL (fallback) fill the same contract.

import type { ExtractedField } from './types'

export interface ExtractionOutput {
  model_name: string
  model_version: string
  fields: ExtractedField[]
  quality_flags: Record<string, boolean>
  raw?: string
}

const DECLARATION_FIELDS = [
  'manufacturer_name', 'manufacturer_address', 'is_imported', 'country_of_origin',
  'common_name', 'net_quantity', 'mfg_date', 'best_before', 'mrp', 'dimensions',
  'consumer_care', 'retail_package_count', 'declaration_scripts',
  'measured_numeral_height_mm', 'measured_letter_width_mm', 'brand_name'
] as const

const EXTRACTION_PROMPT = `You are a Legal Metrology label-extraction system for Indian packaged commodities (Legal Metrology (Packaged Commodities) Rules, 2011).

Read the product label image(s) and extract these declaration fields. For each field return:
- "value": exact text as printed (null if absent),
- "present": true/false,
- "confidence": 0.0-1.0 how sure you are of the read,
- "notes": optional short note.

Fields:
1. manufacturer_name — name of manufacturer/packer/importer (Rule 6(1)(a))
2. manufacturer_address — their complete address
3. is_imported — "yes" only if the label indicates an imported product, else null
4. country_of_origin — country of origin/manufacture/assembly if stated
5. common_name — common/generic name of the commodity (Rule 6(1)(b))
6. net_quantity — net quantity declaration verbatim, e.g. "Net Wt. 500 g" (Rule 6(1)(c))
7. mfg_date — month & year of manufacture/packing/import verbatim (Rule 6(1)(d))
8. best_before — best-before/use-by/expiry declaration verbatim if present
9. mrp — the FULL retail price declaration verbatim including any "MRP"/"Maximum Retail Price" label and "inclusive of all taxes" wording, e.g. "MRP ₹99.00 (Inclusive of all taxes)" (Rule 6(1)(e))
10. dimensions — product dimensions if declared
11. consumer_care — consumer care/complaints contact block verbatim (name, address, phone, email) (Rule 6(2))
12. retail_package_count — for wholesale packages, number of retail packages contained
13. declaration_scripts — comma-separated scripts/languages the declarations appear in, from: english, hindi, devanagari, tamil, telugu, bengali, other
14. measured_numeral_height_mm — null (only measurable with a scale reference)
15. measured_letter_width_mm — null (only measurable with a scale reference)
16. brand_name — brand name if visible

Also return "quality_flags" — booleans, set true only if clearly observed:
- declarations_illegible: text too blurry/small/low-contrast to read reliably
- declarations_not_on_pdp: mandatory declarations scattered off the main display panel
- mrp_altered_by_sticker: a sticker covers/alters the printed MRP
- mrp_overwritten: MRP manually struck through/overwritten
- image_quality_poor: severe blur/glare/crop cutting off declarations

Respond with ONLY a JSON object:
{"fields": [{"field": "...", "value": "...", "present": true, "confidence": 0.9, "notes": null}, ...], "quality_flags": {...}}`

interface Env {
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
}

export async function extractFromImages(
  env: Env,
  imageDataUrls: string[],
  packageType: string
): Promise<ExtractionOutput> {
  const model = 'gpt-5-mini'
  const content: any[] = [
    { type: 'text', text: EXTRACTION_PROMPT + `\n\nDeclared package type: ${packageType}` }
  ]
  for (const url of imageDataUrls) {
    content.push({ type: 'image_url', image_url: { url } })
  }

  const resp = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      max_completion_tokens: 4000
    })
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Vision extraction failed (${resp.status}): ${body.slice(0, 300)}`)
  }

  const data: any = await resp.json()
  const text: string = data.choices?.[0]?.message?.content || ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Extraction model returned no JSON payload')

  let parsed: any
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch (e) {
    throw new Error('Extraction model returned malformed JSON')
  }

  const byName: Record<string, any> = {}
  for (const f of parsed.fields || []) byName[f.field] = f

  const fields: ExtractedField[] = DECLARATION_FIELDS.map(name => {
    const f = byName[name]
    return {
      field: name,
      value: f?.value != null ? String(f.value) : null,
      present: Boolean(f?.present && f?.value != null && String(f.value).trim() !== ''),
      confidence: typeof f?.confidence === 'number' ? Math.max(0, Math.min(1, f.confidence)) : 0,
      bbox: null,
      script: null,
      notes: f?.notes != null ? String(f.notes) : null
    }
  })

  const quality_flags: Record<string, boolean> = {}
  for (const [k, v] of Object.entries(parsed.quality_flags || {})) {
    quality_flags[k] = Boolean(v)
  }

  return {
    model_name: model,
    model_version: 'vision-extraction-v1',
    fields,
    quality_flags,
    raw: text
  }
}
