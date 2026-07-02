// API capability slot tests.
//
// Run: node src/test-api-capability-slots.js

import fs from 'fs'
import path from 'path'
import {
  KIMI_VISION_SLOT_ID,
  configureApiCapabilitySlot,
  deleteApiCapabilitySlot,
  listApiCapabilitySlots,
  listApiSlotCapabilities,
  saveKimiVisionDocs,
} from './capabilities/api-slots.js'
import { execManageApiCapability } from './capabilities/tools/api-capability.js'
import { execRunApiCapability } from './capabilities/tools/api-capability.js'
import { capabilityContextBlocks, capabilityToolsFor, findCapabilitiesByQuery } from './capabilities/capability-registry.js'
import { paths } from './paths.js'
import { tryAutoConfigureKey } from './key-auto-config.js'

let failed = 0
function assert(cond, label, detail = '') {
  if (!cond) {
    console.error(`FAIL: ${label}${detail ? `\n  ${detail}` : ''}`)
    failed++
    process.exitCode = 1
  } else {
    console.log(`PASS: ${label}`)
  }
}

const backupExists = fs.existsSync(paths.apiCapabilitySlotsFile)
const backup = backupExists ? fs.readFileSync(paths.apiCapabilitySlotsFile, 'utf-8') : ''
const runnerDir = path.join(paths.sandboxApiCapabilitiesDir, `test-runner-${Date.now().toString(36)}`)

function restore() {
  if (backupExists) fs.writeFileSync(paths.apiCapabilitySlotsFile, backup, 'utf-8')
  else fs.rmSync(paths.apiCapabilitySlotsFile, { force: true })
  fs.rmSync(runnerDir, { recursive: true, force: true })
}

function parseJson(value) {
  try { return JSON.parse(String(value || '')) } catch { return null }
}

try {
  fs.rmSync(paths.apiCapabilitySlotsFile, { force: true })
  fs.mkdirSync(runnerDir, { recursive: true })
  const runnerPath = path.join(runnerDir, 'run.mjs')
  fs.writeFileSync(runnerPath, `
let input = ''
process.stdin.on('data', d => { input += d })
process.stdin.on('end', () => {
  const payload = JSON.parse(input || '{}')
  console.log(JSON.stringify({
    ok: true,
    saw_api_key: Boolean(process.env.CAPABILITY_API_KEY),
    slot_id: payload.slot.id,
    provider: payload.slot.provider,
    args: payload.args,
    output: { type: 'video', url: 'https://example.test/generated.mp4' },
  }))
})
`, 'utf-8')
  const relProgramPath = path.relative(paths.sandboxApiCapabilitiesDir, runnerPath).replace(/\\/g, '/')

  const docs = `
Moonshot / Kimi vision API docs
Endpoint: POST https://api.moonshot.cn/v1/chat/completions
Model: moonshot-v1-32k-vision-preview
Use messages content array with {type:"text"} and {type:"image_url", image_url:{url:"data:image/png;base64,..."}}
Example key: sk-xxxxxxxxxxxxxxxxxxxxxxxx
`

  {
    const slot = saveKimiVisionDocs({ docsText: docs, docsUrl: 'https://platform.moonshot.cn/docs/vision' })
    assert(slot?.id === KIMI_VISION_SLOT_ID, 'docs are saved into the Kimi vision slot', JSON.stringify(slot))
    assert(slot.configured === false, 'docs alone do not configure the slot')
    assert(slot.docs.url === 'https://platform.moonshot.cn/docs/vision', 'docs URL is stored')
    assert(!JSON.stringify(slot).includes('sk-xxxxxxxx'), 'stored docs redact placeholder key')
  }

  {
    const auto = await tryAutoConfigureKey('kimi 识图 sk-liveKimiVisionKeyForChecks1234567890', docs)
    assert(auto === null, 'Kimi vision key is not configured by regex/key-auto-config')
  }

  {
    const videoSlotId = 'video.fakegen'
    const configuredResult = parseJson(execManageApiCapability({
      action: 'configure',
      slot_id: videoSlotId,
      provider: 'fakegen',
      kind: 'video_generation',
      label: 'FakeGen 视频生成',
      summary: 'Test video generator capability.',
      docs_url: 'https://docs.example.test/video-generation',
      docs_summary: 'Submit prompt and receive a generated video URL.',
      docs,
      api_key: 'sk-liveKimiVisionKeyForChecks1234567890',
      model: 'video-model-test',
      base_url: 'https://api.example.test/v1',
      execution_instructions: 'Call this when the user asks to generate a video. Pass { prompt }.',
      program_path: relProgramPath,
      program_runtime: 'node',
      input_schema: {
        type: 'object',
        properties: { prompt: { type: 'string' } },
        required: ['prompt'],
      },
      output_schema: {
        type: 'object',
        properties: { output: { type: 'object' } },
      },
      test_results: [{ name: 'runner smoke', ok: true, detail: 'stdout JSON returned ok=true' }],
      triggers: ['生成视频', 'video generation'],
    }))
    assert(configuredResult?.ok === true && configuredResult.slot?.id === videoSlotId,
      'explicit configure action registers a generic video capability by agent intent',
      JSON.stringify(configuredResult))
    const slots = listApiCapabilitySlots()
    const slot = slots.find(s => s.id === videoSlotId)
    assert(slot?.configured === true, 'public slot reports configured')
    assert(slot?.api?.apiKey === '[configured]', 'public slot redacts API key')
    assert(slot?.program?.path === relProgramPath, 'public slot records tested runner path')
    assert(!JSON.stringify(configuredResult).includes('sk-liveKimi'), 'configure result does not echo API key')

    const tools = capabilityToolsFor({ rawText: '帮我生成视频', text: '帮我生成视频' })
    assert(tools.includes('run_api_capability'), `video intent injects run_api_capability (got: ${tools.join(',')})`)
    const blocks = capabilityContextBlocks({ rawText: '生成视频', text: '生成视频' })
    const block = blocks.find(b => b.includes('video.fakegen')) || ''
    assert(block.includes('https://docs.example.test/video-generation'), 'capability card injects docs URL')
    assert(block.includes(relProgramPath), 'capability card injects runner path')
    assert(!block.includes('Example key:'), 'capability card does not inject full docs text')

    const run = parseJson(await execRunApiCapability({
      slot_id: videoSlotId,
      args: { prompt: 'a dragon over a city' },
    }))
    assert(run?.ok === true && run.result?.output?.type === 'video', 'run_api_capability executes the registered runner', JSON.stringify(run))
    assert(run.result?.saw_api_key === true, 'runner receives credential through environment')
  }

  {
    const tools = capabilityToolsFor({ rawText: '帮我看这张图里有什么', text: '帮我看这张图里有什么' })
    assert(!tools.includes('analyze_image') && !tools.includes('run_api_capability'), `unconfigured vision slot is not injected (got: ${tools.join(',')})`)
    const blocks = capabilityContextBlocks({ rawText: '这张图识别一下', text: '这张图识别一下' })
    assert(!blocks.some(b => b.includes('vision.kimi')), 'docs-only vision slot does not inject workflow block')
    assert(findCapabilitiesByQuery('生成视频').some(c => c.tools.includes('run_api_capability')), 'find_tool discovery can find dynamic generic capability')
  }

  {
    deleteApiCapabilitySlot(KIMI_VISION_SLOT_ID)
    const configured = configureApiCapabilitySlot({
      slotId: KIMI_VISION_SLOT_ID,
      provider: 'kimi',
      kind: 'vision',
      apiKey: 'sk-directConfigForChecks1234567890',
      model: 'moonshot-v1-32k-vision-preview',
      baseURL: 'https://api.moonshot.cn/v1',
      programPath: relProgramPath,
    })
    assert(configured.configured === true, 'direct configure helper enables the slot')
    const caps = listApiSlotCapabilities()
    assert(caps.some(c => c.id === `api-slot:${KIMI_VISION_SLOT_ID}`), 'configured slot appears as a dynamic capability')
  }
} finally {
  restore()
}

if (failed === 0) console.log('\nAll api capability slot checks complete.')
else console.log(`\n${failed} check(s) failed.`)
