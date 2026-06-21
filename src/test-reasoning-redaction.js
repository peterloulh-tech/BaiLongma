import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'blm-reasoning-redaction-'))
process.env.BAILONGMA_USER_DIR = tmp
process.env.BAILONGMA_RESOURCES_DIR = process.cwd()

let closeDBForTest = null

try {
  const { sanitizeUserVisibleText } = await import('./runtime/markers.js')
  const { callLLM } = await import('./llm.js')
  ;({ closeDBForTest } = await import('./db.js'))

  assert.equal(
    sanitizeUserVisibleText('<think>secret plan</think>\nFinal answer: hello'),
    'hello',
    'closed think block is removed before delivery'
  )
  assert.equal(
    sanitizeUserVisibleText('visible\n<thinking>unfinished private plan'),
    'visible',
    'unclosed thinking block is removed before delivery'
  )
  assert.equal(
    sanitizeUserVisibleText('思考：我应该先推理。\n回答：可以用了。'),
    '可以用了。',
    'private reasoning heading is removed before delivery'
  )

  const fallbackToolCalls = []
  const fallback = await callLLM({
    systemPrompt: 'system',
    message: 'hello',
    tools: ['send_message'],
    mustReply: true,
    localReply: true,
    toolContext: { currentTargetId: 'ID:REDAC-FALLBACK' },
    _streamOnceForTest: async () => ({
      content: '<think>do not show this</think>\nFinal answer: fallback visible',
      reasoningContent: 'private reasoning field',
      aborted: false,
      toolCalls: [],
    }),
    onToolCall: (name, args) => fallbackToolCalls.push({ name, args }),
  })

  assert.equal(fallback.content, 'fallback visible', 'callLLM return content is sanitized')
  assert.equal(fallbackToolCalls.at(-1)?.name, 'send_message', 'fallback sends through send_message')
  assert.equal(fallbackToolCalls.at(-1)?.args?.content, 'fallback visible', 'fallback send_message content is sanitized')

  const explicitToolCalls = []
  await callLLM({
    systemPrompt: 'system',
    message: 'hello',
    tools: ['send_message'],
    mustReply: false,
    toolContext: {
      currentTargetId: 'ID:REDAC-EXPLICIT',
      strictEvaluation: { active: true, forbiddenTools: ['send_message'] },
    },
    _streamOnceForTest: async ({ round }) => round === 0
      ? {
          content: '',
          reasoningContent: '',
          aborted: false,
          toolCalls: [{
            id: 'call_send',
            name: 'send_message',
            arguments: JSON.stringify({
              target_id: 'ID:REDAC-EXPLICIT',
              content: '<think>private tool arg</think>\n回答：explicit visible',
            }),
          }],
        }
      : { content: '', reasoningContent: '', aborted: false, toolCalls: [] },
    onToolCall: (name, args) => explicitToolCalls.push({ name, args }),
  })

  assert.equal(explicitToolCalls[0]?.args?.content, 'explicit visible', 'explicit send_message args are sanitized')

  const xmlToolCalls = []
  const xmlResult = await callLLM({
    systemPrompt: 'system',
    message: 'hello',
    tools: ['send_message'],
    mustReply: true,
    localReply: true,
    toolContext: { currentTargetId: 'ID:REDAC-XML' },
    _streamOnceForTest: async () => ({
      content: '<think><invoke name="send_message"><parameter name="target_id">ID:REDAC-XML</parameter><parameter name="content">leaked</parameter></invoke></think>\nxml visible',
      reasoningContent: '',
      aborted: false,
      toolCalls: [],
    }),
    onToolCall: (name, args) => xmlToolCalls.push({ name, args }),
  })

  assert.equal(xmlResult.content, 'xml visible', 'XML inside think is stripped from returned content')
  assert.equal(xmlToolCalls.length, 1, 'XML tool call inside think is not executed as a model tool')
  assert.equal(xmlToolCalls[0]?.args?.content, 'xml visible', 'fallback delivers only visible XML test content')

  console.log('PASS reasoning content is redacted from user-visible delivery')
} finally {
  closeDBForTest?.()
  fs.rmSync(tmp, { recursive: true, force: true })
}
