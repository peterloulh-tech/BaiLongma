import { emitEvent } from './events.js'

const MAX_CHUNKS = 800
const MAX_TOTAL_CHARS = 120_000
const DEFAULT_TITLE = 'Bailongma Terminal Stream'
const sessions = new Map()

function nowIso() {
  return new Date().toISOString()
}

function normalizeStreamId(value = '') {
  const id = String(value || 'default').trim()
  return id.replace(/[^a-zA-Z0-9_.:-]+/g, '_').slice(0, 80) || 'default'
}

function normalizeLevel(value = '') {
  const level = String(value || 'info').trim().toLowerCase()
  return ['info', 'success', 'warning', 'error', 'muted'].includes(level) ? level : 'info'
}

function getSession(streamId = 'default') {
  const id = normalizeStreamId(streamId)
  if (!sessions.has(id)) {
    sessions.set(id, {
      stream_id: id,
      title: DEFAULT_TITLE,
      chunks: [],
      closed: false,
      updated_at: nowIso(),
    })
  }
  return sessions.get(id)
}

function trimSession(session) {
  while (session.chunks.length > MAX_CHUNKS) session.chunks.shift()

  let total = session.chunks.reduce((sum, chunk) => sum + String(chunk.text || '').length + 1, 0)
  while (total > MAX_TOTAL_CHARS && session.chunks.length > 1) {
    const removed = session.chunks.shift()
    total -= String(removed?.text || '').length + 1
  }
}

export function getTerminalStreamSnapshot(streamId = 'default') {
  const session = getSession(streamId)
  return {
    stream_id: session.stream_id,
    title: session.title,
    closed: session.closed,
    updated_at: session.updated_at,
    chunks: session.chunks.map(chunk => ({ ...chunk })),
  }
}

export function recordTerminalStreamEvent({
  action = 'write',
  stream_id = 'default',
  title = '',
  text = '',
  newline = true,
  level = 'info',
} = {}) {
  const normalizedAction = String(action || 'write').trim().toLowerCase()
  const session = getSession(stream_id)
  const ts = nowIso()

  if (title !== undefined && String(title || '').trim()) {
    session.title = String(title).trim().slice(0, 120)
  }

  if (normalizedAction === 'clear') {
    session.chunks = []
    session.closed = false
  } else if (normalizedAction === 'write') {
    const body = String(text ?? '')
    if (body) {
      session.chunks.push({
        text: body,
        newline: newline !== false,
        level: normalizeLevel(level),
        ts,
      })
    }
    session.closed = false
  } else if (normalizedAction === 'open') {
    session.closed = false
  } else if (normalizedAction === 'close') {
    session.closed = true
  }

  session.updated_at = ts
  trimSession(session)

  const data = {
    action: normalizedAction,
    stream_id: session.stream_id,
    title: session.title,
    text: normalizedAction === 'write' ? String(text ?? '') : '',
    newline: newline !== false,
    level: normalizeLevel(level),
    closed: session.closed,
  }

  emitEvent('terminal_stream', data)
  return getTerminalStreamSnapshot(session.stream_id)
}
