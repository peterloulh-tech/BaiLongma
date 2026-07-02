import fs from 'fs'
import { paths } from '../paths.js'

export const KIMI_VISION_SLOT_ID = 'vision.kimi'

const SLOT_FILE_VERSION = 1
const DEFAULT_KIMI_VISION_MODEL = 'moonshot-v1-32k-vision-preview'
const DEFAULT_KIMI_BASE_URL = 'https://api.moonshot.cn/v1'
const DEFAULT_CHAT_COMPLETIONS_ENDPOINT = '/chat/completions'
const GENERIC_API_CAPABILITY_TOOLS = ['run_api_capability']
const LEGACY_TOOL_BY_KIND = {
  vision: ['analyze_image'],
}

const DEFAULT_VISION_TRIGGERS = [
  '识图', '看图', '读图', '图片识别', '图像识别', '图片理解', '图里', '图上',
  '这张图', '这幅图', '这张照片', '照片里', '截图里', 'ocr', '视觉',
  'vision', 'image recognition', 'analyze image', 'describe image', 'read image',
]

const SECRET_TOKEN_RE = /\b(?:sk|ak|rk|pk)-[A-Za-z0-9_\-.]{12,180}\b/g

function nowIso() {
  return new Date().toISOString()
}

function readSlotFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.apiCapabilitySlotsFile, 'utf-8'))
    if (Array.isArray(parsed)) return { version: SLOT_FILE_VERSION, slots: parsed }
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.slots)) return parsed
  } catch {}
  return { version: SLOT_FILE_VERSION, slots: [] }
}

function writeSlotFile(slots) {
  const tmp = `${paths.apiCapabilitySlotsFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ version: SLOT_FILE_VERSION, slots }, null, 2), 'utf-8')
  fs.renameSync(tmp, paths.apiCapabilitySlotsFile)
}

function normalizeId(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '')
}

function defaultSlotId(kind = 'vision', provider = 'kimi') {
  return normalizeId(`${kind}.${provider}`)
}

function isKimiVisionSlot({ id = '', kind = '', provider = '' } = {}) {
  return normalizeId(id) === KIMI_VISION_SLOT_ID
    || (String(kind || '').trim().toLowerCase() === 'vision'
      && /^(kimi|moonshot|月之暗面)$/i.test(String(provider || '').trim()))
}

function uniqueStrings(values = []) {
  const out = []
  const seen = new Set()
  for (const value of values) {
    const text = String(value || '').trim()
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

function redactSecrets(text = '') {
  return String(text || '').replace(SECRET_TOKEN_RE, '[redacted-api-key]')
}

function normalizeSlot(slot = {}) {
  const kind = String(slot.kind || 'vision').trim().toLowerCase()
  const provider = String(slot.provider || 'kimi').trim().toLowerCase()
  const id = normalizeId(slot.id) || defaultSlotId(kind, provider)
  const kimiVision = isKimiVisionSlot({ id, kind, provider })
  const api = slot.api && typeof slot.api === 'object' ? slot.api : {}
  const docs = slot.docs && typeof slot.docs === 'object' ? slot.docs : {}
  return {
    id,
    kind,
    provider,
    label: String(slot.label || (id === KIMI_VISION_SLOT_ID ? 'Kimi 视觉识图' : id)).trim(),
    summary: String(slot.summary || '通过已配置的外部 API 服务执行能力槽。').trim(),
    enabled: slot.enabled !== false,
    triggers: uniqueStrings([...(slot.triggers || []), ...(kind === 'vision' ? DEFAULT_VISION_TRIGGERS : [])]),
    api: {
      protocol: String(api.protocol || 'openai-chat-completions').trim(),
      baseURL: String(api.baseURL || api.baseUrl || (kimiVision ? DEFAULT_KIMI_BASE_URL : '')).trim(),
      endpoint: String(api.endpoint || DEFAULT_CHAT_COMPLETIONS_ENDPOINT).trim(),
      model: String(api.model || (kimiVision ? DEFAULT_KIMI_VISION_MODEL : '')).trim(),
      apiKey: String(api.apiKey || '').trim(),
    },
    docs: {
      text: redactSecrets(docs.text || slot.docsText || ''),
      url: String(docs.url || slot.docsUrl || '').trim(),
      summary: String(docs.summary || slot.docsSummary || '').trim(),
      source: String(docs.source || slot.docsSource || 'user').trim(),
      updatedAt: docs.updatedAt || slot.docsUpdatedAt || null,
    },
    executionInstructions: String(slot.executionInstructions || '').trim(),
    program: normalizeProgram(slot.program || {}),
    inputSchema: normalizeJsonSchema(slot.inputSchema || slot.input_schema),
    outputSchema: normalizeJsonSchema(slot.outputSchema || slot.output_schema),
    permissions: normalizePermissions(slot.permissions || {}),
    testResults: normalizeTestResults(slot.testResults || slot.test_results),
    createdAt: slot.createdAt || nowIso(),
    updatedAt: slot.updatedAt || nowIso(),
  }
}

function normalizeProgram(program = {}) {
  return {
    path: String(program.path || program.programPath || '').trim(),
    runtime: String(program.runtime || '').trim() || inferProgramRuntime(program.path || program.programPath || ''),
    timeoutMs: Math.min(Math.max(Number(program.timeoutMs || program.timeout_ms || 60_000) || 60_000, 1_000), 10 * 60_000),
    contract: String(program.contract || 'stdin-json/stdout-json').trim(),
  }
}

function inferProgramRuntime(programPath = '') {
  const text = String(programPath || '').trim().toLowerCase()
  if (text.endsWith('.py')) return 'python'
  return 'node'
}

function normalizeJsonSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { type: 'object', properties: {}, required: [] }
  }
  return schema
}

function normalizePermissions(permissions = {}) {
  return {
    network: permissions.network !== false,
    filesystem: permissions.filesystem === true,
    exec: false,
  }
}

function normalizeTestResults(results = []) {
  if (!Array.isArray(results)) return []
  return results.slice(0, 20).map((item, index) => ({
    name: String(item?.name || `test_${index + 1}`).slice(0, 80),
    ok: item?.ok === true,
    detail: String(item?.detail || item?.message || '').slice(0, 1000),
    testedAt: item?.testedAt || item?.tested_at || nowIso(),
  }))
}

function publicSlot(slot) {
  const normalized = normalizeSlot(slot)
  return {
    ...normalized,
    configured: !!normalized.api.apiKey,
    api: {
      ...normalized.api,
      apiKey: normalized.api.apiKey ? '[configured]' : '',
    },
  }
}

function upsertSlot(slot) {
  const normalized = normalizeSlot(slot)
  const file = readSlotFile()
  const existing = file.slots.find(s => normalizeId(s?.id) === normalized.id)
  const next = {
    ...(existing || {}),
    ...normalized,
    api: { ...(existing?.api || {}), ...normalized.api },
    docs: { ...(existing?.docs || {}), ...normalized.docs },
    triggers: uniqueStrings([...(existing?.triggers || []), ...normalized.triggers]),
    createdAt: existing?.createdAt || normalized.createdAt,
    updatedAt: nowIso(),
  }
  const slots = file.slots.filter(s => normalizeId(s?.id) !== normalized.id)
  slots.push(next)
  writeSlotFile(slots)
  return next
}

export function listApiCapabilitySlots({ includeSecrets = false } = {}) {
  const slots = readSlotFile().slots.map(normalizeSlot)
  return includeSecrets ? slots : slots.map(publicSlot)
}

export function getApiCapabilitySlot(id = KIMI_VISION_SLOT_ID, { includeSecrets = true } = {}) {
  const normalizedId = normalizeId(id)
  const slot = readSlotFile().slots.map(normalizeSlot).find(s => s.id === normalizedId)
  if (!slot) return null
  return includeSecrets ? slot : publicSlot(slot)
}

export function deleteApiCapabilitySlot(id) {
  const normalizedId = normalizeId(id)
  if (!normalizedId) return false
  const file = readSlotFile()
  const next = file.slots.filter(s => normalizeId(s?.id) !== normalizedId)
  if (next.length === file.slots.length) return false
  writeSlotFile(next)
  return true
}

export function setApiCapabilitySlotEnabled(id, enabled) {
  const slot = getApiCapabilitySlot(id)
  if (!slot) throw new Error(`API capability slot not found: ${id}`)
  return publicSlot(upsertSlot({ ...slot, enabled: !!enabled }))
}

export function configureApiCapabilitySlot({
  slotId = '',
  provider = 'kimi',
  kind = 'vision',
  label = '',
  summary = '',
  apiKey = '',
  model = '',
  baseURL = '',
  endpoint = '',
  protocol = 'openai-chat-completions',
  docsText = '',
  docsUrl = '',
  docsSummary = '',
  docsSource = 'user',
  executionInstructions = '',
  programPath = '',
  programRuntime = '',
  programTimeoutMs = undefined,
  inputSchema = null,
  outputSchema = null,
  permissions = {},
  testResults = [],
  triggers = [],
  enabled = true,
} = {}) {
  const id = normalizeId(slotId) || defaultSlotId(kind, provider)
  const existing = getApiCapabilitySlot(id) || {}
  const existingApi = existing.api || {}
  const existingDocs = existing.docs || {}
  const nextDocs = {
    ...existingDocs,
    ...(docsText ? { text: redactSecrets(docsText).slice(0, 20_000) } : {}),
    ...(docsUrl ? { url: String(docsUrl).trim() } : {}),
    ...(docsSummary ? { summary: String(docsSummary).trim().slice(0, 2000) } : {}),
    source: docsSource || existingDocs.source || 'user',
    updatedAt: (docsText || docsUrl || docsSummary) ? nowIso() : existingDocs.updatedAt,
  }
  const existingProgram = existing.program || {}
  const nextProgram = normalizeProgram({
    ...existingProgram,
    ...(programPath ? { path: programPath } : {}),
    ...(programRuntime ? { runtime: programRuntime } : {}),
    ...(programTimeoutMs !== undefined ? { timeoutMs: programTimeoutMs } : {}),
  })
  return publicSlot(upsertSlot({
    ...existing,
    id,
    kind,
    provider,
    label: label || existing.label || (id === KIMI_VISION_SLOT_ID ? 'Kimi 视觉识图' : `${provider} ${kind}`),
    summary: summary || existing.summary || '通过已配置的外部 API 服务执行能力槽。',
    enabled,
    triggers,
    api: {
      ...existingApi,
      protocol: protocol || existingApi.protocol || 'openai-chat-completions',
      baseURL: baseURL || existingApi.baseURL || '',
      endpoint: endpoint || existingApi.endpoint || DEFAULT_CHAT_COMPLETIONS_ENDPOINT,
      model: model || existingApi.model || '',
      apiKey: apiKey || existingApi.apiKey || '',
    },
    docs: nextDocs,
    executionInstructions: executionInstructions || existing.executionInstructions || defaultExecutionInstructions(kind),
    program: nextProgram,
    inputSchema: inputSchema || existing.inputSchema,
    outputSchema: outputSchema || existing.outputSchema,
    permissions: { ...(existing.permissions || {}), ...(permissions || {}) },
    testResults: Array.isArray(testResults) && testResults.length ? testResults : existing.testResults,
  }))
}

export function saveKimiVisionDocs({
  docsText = '',
  docsUrl = '',
  docsSummary = '',
  executionInstructions = '',
  model = '',
  baseURL = '',
  triggers = [],
} = {}) {
  return configureApiCapabilitySlot({
    slotId: KIMI_VISION_SLOT_ID,
    kind: 'vision',
    provider: 'kimi',
    label: 'Kimi 视觉识图',
    summary: '调用 Moonshot/Kimi 的视觉模型识别、描述、OCR 或分析用户提供的图片。',
    docsText,
    docsUrl,
    docsSummary,
    executionInstructions,
    triggers,
    baseURL: baseURL || DEFAULT_KIMI_BASE_URL,
    model: model || DEFAULT_KIMI_VISION_MODEL,
  })
}

export function configureKimiVisionSlot({
  apiKey,
  docsText = '',
  executionInstructions = '',
  model = '',
  baseURL = '',
  triggers = [],
} = {}) {
  const key = String(apiKey || '').trim()
  if (!key) throw new Error('apiKey required')
  return configureApiCapabilitySlot({
    slotId: KIMI_VISION_SLOT_ID,
    provider: 'kimi',
    kind: 'vision',
    label: 'Kimi 视觉识图',
    summary: '调用 Moonshot/Kimi 的视觉模型识别、描述、OCR 或分析用户提供的图片。',
    apiKey: key,
    docsText,
    executionInstructions,
    model: model || DEFAULT_KIMI_VISION_MODEL,
    baseURL: baseURL || DEFAULT_KIMI_BASE_URL,
    triggers,
  })
}

export function listApiSlotCapabilities() {
  return listApiCapabilitySlots({ includeSecrets: true })
    .filter(slot => slot.enabled && slot.program?.path)
    .map(slot => ({
      id: `api-slot:${slot.id}`,
      label: slot.label,
      summary: slot.summary,
      triggers: slot.triggers,
      tools: toolsForSlot(slot),
      detect: ctx => matchesApiSlotIntent(slot, ctx),
      toolWhen: ctx => matchesApiSlotIntent(slot, ctx),
      context: buildApiSlotContext(slot),
    }))
    .filter(cap => cap.tools.length > 0)
}

function toolsForSlot(slot = {}) {
  if (slot.program?.path) return [...GENERIC_API_CAPABILITY_TOOLS]
  return [...(LEGACY_TOOL_BY_KIND[slot.kind] || [])]
}

export function findConfiguredApiSlotByKind(kind = 'vision', preferredId = '') {
  const slots = listApiCapabilitySlots({ includeSecrets: true })
    .filter(slot => slot.enabled && slot.api?.apiKey && slot.kind === kind)
  if (!slots.length) return null
  const id = normalizeId(preferredId)
  if (id) return slots.find(slot => slot.id === id) || null
  return slots[0]
}

export function hasApiCapabilityKind(kind = 'vision') {
  return !!findConfiguredApiSlotByKind(kind)
}

export function buildApiSlotContext(slot = {}) {
  const s = normalizeSlot(slot)
  const toolNames = toolsForSlot(s)
  const docsSummary = s.docs?.summary ? `\n- Docs summary: ${s.docs.summary}` : ''
  const docsUrl = s.docs?.url ? `\n- Config docs URL: ${s.docs.url}` : ''
  const instructions = s.executionInstructions || defaultExecutionInstructions(s.kind)
  const inputSchema = JSON.stringify(s.inputSchema || { type: 'object', properties: {}, required: [] })
  const outputSchema = JSON.stringify(s.outputSchema || { type: 'object' })
  return `### API Capability Slot: ${s.label}
- Slot id: ${s.id}
- Provider: ${s.provider}; kind: ${s.kind}; model: ${s.api.model}
- Use tool(s): ${toolNames.join(', ')}
- Program path: ${s.program.path || '(not configured)'} (${s.program.runtime || 'node'}, ${s.program.contract})
- Input schema: ${inputSchema}
- Output schema: ${outputSchema}
- Call run_api_capability with slot_id="${s.id}" and args matching the input schema. Do not re-read the full docs unless the call fails or the user asks to change the capability.
- Do not expose or repeat API keys. If the call fails, use the docs URL to debug before changing code.
- Execution instructions: ${instructions}${docsUrl}${docsSummary}`
}

function defaultExecutionInstructions(kind = 'vision') {
  if (kind !== 'vision') return 'Call the configured API according to the saved execution instructions.'
  return 'Use an OpenAI-compatible chat completions request with a user content array containing text plus image_url. Return choices[0].message.content as the image analysis result.'
}

function matchesApiSlotIntent(slot, ctx = {}) {
  const raw = `${ctx.rawText || ''}\n${ctx.text || ''}`.toLowerCase()
  if (!raw.trim()) return false
  if ((slot.triggers || []).some(t => raw.includes(String(t).toLowerCase()))) return true
  if (slot.kind === 'vision') {
    return /!\[[^\]]*]\(|\/media\/chat\/|data:image\/|https?:\/\/\S+\.(?:png|jpe?g|webp|gif)|\.(?:png|jpe?g|webp|gif)\b|截图|照片|图片|这张图|图里|ocr|vision|image/i.test(raw)
  }
  return false
}

export const __internal = {
  redactSecrets,
  normalizeSlot,
  defaultSlotId,
}
