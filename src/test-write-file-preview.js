import assert from 'assert'
import { getTerminalStreamSnapshot, recordTerminalStreamEvent } from './terminal-stream.js'
import {
  extractFileWriteArgs,
  extractPartialJsonStringValue,
  streamXmlFileWriteArgumentPreview,
  streamToolFileWriteExecutionPreview,
  streamWriteFileArgumentPreview,
  streamWriteFileExecutionPreview,
} from './write-file-preview.js'

function contentOf(source) {
  return extractPartialJsonStringValue(source, ['content'])
}

{
  const partial = contentOf('{"path":"demo.md","content":"Hello\\nWor')
  assert.strictEqual(partial.value, 'Hello\nWor')
  assert.strictEqual(partial.closed, false)

  const complete = contentOf('{"path":"demo.md","content":"Hello\\nWorld"}')
  assert.strictEqual(complete.value, 'Hello\nWorld')
  assert.strictEqual(complete.closed, true)
}

{
  const incompleteEscape = contentOf('{"content":"A\\')
  assert.strictEqual(incompleteEscape.value, 'A')
  assert.strictEqual(incompleteEscape.closed, false)

  const completeEscape = contentOf('{"content":"A\\tB"}')
  assert.strictEqual(completeEscape.value, 'A\tB')
  assert.strictEqual(completeEscape.closed, true)
}

{
  const splitSurrogate = contentOf('{"content":"A\\ud83d')
  assert.strictEqual(splitSurrogate.value, 'A')
  assert.strictEqual(splitSurrogate.closed, false)

  const completeSurrogate = contentOf('{"content":"A\\ud83d\\ude00B"}')
  assert.strictEqual(completeSurrogate.value, 'A😀B')
}

{
  let state = {}
  state = streamWriteFileArgumentPreview({
    name: 'write_file',
    arguments: '{"path":"demo.md","content":"One',
  }, state)
  state = streamWriteFileArgumentPreview({
    name: 'write_file',
    arguments: '{"path":"demo.md","content":"One\\nTwo"}',
  }, state)
  const text = getTerminalStreamSnapshot('write_file').chunks.map(chunk => chunk.text).join('')
  assert.strictEqual(text, '$ write_file demo.md\n\nOne\nTwo')
}

{
  recordTerminalStreamEvent({ action: 'clear', stream_id: 'write_file', title: 'fallback' })
  streamWriteFileExecutionPreview({ path: 'fallback.md', content: 'abc' })
  streamWriteFileExecutionPreview({ path: 'fallback.md', content: 'abc', bytes: 3, verified: true })
  const text = getTerminalStreamSnapshot('write_file').chunks.map(chunk => chunk.text).join('')
  assert.strictEqual(text, '$ write_file fallback.md\n\nabc\n\n[write_file done, 3 bytes]\n')
}

{
  let state = {}
  state = streamWriteFileArgumentPreview({
    name: 'save_markdown_file',
    arguments: '{"output_path":"note.md","markdown":"Alpha',
  }, state)
  state = streamWriteFileArgumentPreview({
    name: 'save_markdown_file',
    arguments: '{"output_path":"note.md","markdown":"Alpha\\nBeta"}',
  }, state)
  const text = getTerminalStreamSnapshot('write_file').chunks.map(chunk => chunk.text).join('')
  assert.strictEqual(text, '$ save_markdown_file note.md\n\nAlpha\nBeta')
}

{
  recordTerminalStreamEvent({ action: 'clear', stream_id: 'write_file', title: 'guard' })
  streamWriteFileArgumentPreview({
    name: 'send_message',
    arguments: '{"target_id":"ID:1","content":"do not show"}',
  }, {})
  const text = getTerminalStreamSnapshot('write_file').chunks.map(chunk => chunk.text).join('')
  assert.strictEqual(text, '')
}

{
  const extracted = extractFileWriteArgs('create_article_file', {
    output_path: 'article.md',
    article: 'Body',
  })
  assert.deepStrictEqual(extracted, {
    toolName: 'create_article_file',
    path: 'article.md',
    content: 'Body',
  })

  recordTerminalStreamEvent({ action: 'clear', stream_id: 'write_file', title: 'installed' })
  streamToolFileWriteExecutionPreview('create_article_file', { output_path: 'article.md', article: 'Body' })
  streamToolFileWriteExecutionPreview('create_article_file', { output_path: 'article.md', article: 'Body' }, { bytes: 4, verified: true })
  const text = getTerminalStreamSnapshot('write_file').chunks.map(chunk => chunk.text).join('')
  assert.strictEqual(text, '$ create_article_file article.md\n\nBody\n\n[create_article_file done, 4 bytes]\n')
}

{
  recordTerminalStreamEvent({ action: 'clear', stream_id: 'write_file', title: 'xml' })
  const session = { cleared: false }
  let state = { session }
  state = streamXmlFileWriteArgumentPreview('<invoke name="save_markdown_file"><parameter name="output_path">xml.md</parameter><parameter name="markdown">A&amp;', state)
  state = streamXmlFileWriteArgumentPreview('<invoke name="save_markdown_file"><parameter name="output_path">xml.md</parameter><parameter name="markdown">A&amp;B&lt;C</parameter>', state)
  const text = getTerminalStreamSnapshot('write_file').chunks.map(chunk => chunk.text).join('')
  assert.strictEqual(text, '$ save_markdown_file xml.md\n\nA&B<C')
}

console.log('test-write-file-preview passed')
