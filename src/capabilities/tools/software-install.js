import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn, spawnSync } from 'child_process'
import { paths } from '../../paths.js'
import { emitEvent } from '../../events.js'
import { findInstalledSoftware } from '../../installed-software-scanner.js'
import { throwIfAborted } from '../abort-utils.js'

const IS_MAC = process.platform === 'darwin'
const DOWNLOAD_DIR = path.join(paths.sandboxDir, 'software-installers')
const APPLICATIONS_DIR = '/Applications'
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000
const PROCESS_TIMEOUT_MS = 20 * 60 * 1000

const KNOWN_SOFTWARE = [
  { aliases: ['chrome', 'google chrome', '谷歌浏览器'], method: 'brew_cask', brew_name: 'google-chrome', app_name: 'Google Chrome' },
  { aliases: ['vs code', 'vscode', 'visual studio code', 'code', 'vscodium'], method: 'brew_cask', brew_name: 'visual-studio-code', app_name: 'Visual Studio Code', command_name: 'code' },
  { aliases: ['firefox', '火狐'], method: 'brew_cask', brew_name: 'firefox', app_name: 'Firefox' },
  { aliases: ['brave', 'brave browser'], method: 'brew_cask', brew_name: 'brave-browser', app_name: 'Brave Browser' },
  { aliases: ['edge', 'microsoft edge'], method: 'brew_cask', brew_name: 'microsoft-edge', app_name: 'Microsoft Edge' },
  { aliases: ['vlc'], method: 'brew_cask', brew_name: 'vlc', app_name: 'VLC' },
  { aliases: ['iterm', 'iterm2', 'iTerm'], method: 'brew_cask', brew_name: 'iterm2', app_name: 'iTerm' },
  { aliases: ['docker', 'docker desktop'], method: 'brew_cask', brew_name: 'docker', app_name: 'Docker' },
  { aliases: ['slack'], method: 'brew_cask', brew_name: 'slack', app_name: 'Slack' },
  { aliases: ['discord'], method: 'brew_cask', brew_name: 'discord', app_name: 'Discord' },
  { aliases: ['spotify'], method: 'brew_cask', brew_name: 'spotify', app_name: 'Spotify' },
  { aliases: ['notion'], method: 'brew_cask', brew_name: 'notion', app_name: 'Notion' },
  { aliases: ['obsidian'], method: 'brew_cask', brew_name: 'obsidian', app_name: 'Obsidian' },
  { aliases: ['postman'], method: 'brew_cask', brew_name: 'postman', app_name: 'Postman' },
  { aliases: ['cursor'], method: 'brew_cask', brew_name: 'cursor', app_name: 'Cursor' },
  { aliases: ['zoom', 'zoom.us'], method: 'brew_cask', brew_name: 'zoom', app_name: 'zoom.us' },
  { aliases: ['wechat', '微信'], method: 'brew_cask', brew_name: 'wechat', app_name: 'WeChat' },
  { aliases: ['ffmpeg'], method: 'brew_formula', brew_name: 'ffmpeg', command_name: 'ffmpeg' },
  { aliases: ['node', 'nodejs', 'node.js'], method: 'brew_formula', brew_name: 'node', command_name: 'node' },
  { aliases: ['python', 'python3'], method: 'brew_formula', brew_name: 'python', command_name: 'python3' },
  { aliases: ['git'], method: 'brew_formula', brew_name: 'git', command_name: 'git' },
  { aliases: ['wget'], method: 'brew_formula', brew_name: 'wget', command_name: 'wget' },
  { aliases: ['ripgrep', 'rg'], method: 'brew_formula', brew_name: 'ripgrep', command_name: 'rg' },
  { aliases: ['uv'], method: 'brew_formula', brew_name: 'uv', command_name: 'uv' },
]

function toolJson(payload) {
  return JSON.stringify(payload, null, 2)
}

function normalizeToken(value = '') {
  return String(value || '')
    .replace(/\.app$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase()
}

function safeBasenameFromUrl(url) {
  try {
    const u = new URL(url)
    return decodeURIComponent(path.basename(u.pathname)) || 'installer'
  } catch {
    return 'installer'
  }
}

function isSafeHttpsUrl(url) {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)
  } catch {
    return false
  }
}

function appBundleName(value = '') {
  const s = String(value || '').trim()
  if (!s) return ''
  return s.endsWith('.app') ? s : `${s}.app`
}

function appPathFor(appName = '') {
  const bundle = appBundleName(appName)
  return bundle ? path.join(APPLICATIONS_DIR, bundle) : ''
}

function localAppExists(appName = '') {
  const appPath = appPathFor(appName)
  return appPath && fs.existsSync(appPath) ? appPath : ''
}

function findKnownSoftware(software = '') {
  const needle = normalizeToken(software)
  if (!needle) return null
  return KNOWN_SOFTWARE.find(entry => entry.aliases.some(alias => {
    const token = normalizeToken(alias)
    return token === needle || token.includes(needle) || needle.includes(token)
  })) || null
}

function getBrewPath() {
  for (const candidate of ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
    if (fs.existsSync(candidate)) return candidate
  }
  const found = spawnSync('/usr/bin/which', ['brew'], { encoding: 'utf8', timeout: 3000 })
  const text = String(found.stdout || '').trim()
  return found.status === 0 && text ? text : ''
}

function commandExists(commandName = '') {
  const name = String(commandName || '').trim()
  if (!/^[a-zA-Z0-9._+-]+$/.test(name)) return ''
  const found = spawnSync('/usr/bin/which', [name], { encoding: 'utf8', timeout: 3000 })
  return found.status === 0 ? String(found.stdout || '').trim() : ''
}

function runProcess(file, args = [], { timeoutMs = PROCESS_TIMEOUT_MS, signal, cwd } = {}) {
  return new Promise((resolve) => {
    throwIfAborted(signal)
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGTERM') } catch {}
      resolve({ ok: false, exit_code: null, stdout, stderr, timed_out: true, error: `timed out after ${Math.round(timeoutMs / 1000)}s` })
    }, timeoutMs)
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const onAbort = () => {
      try { child.kill('SIGTERM') } catch {}
      finish({ ok: false, exit_code: null, stdout, stderr, aborted: true, error: 'aborted' })
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
    child.stdout?.on('data', d => { stdout += d.toString() })
    child.stderr?.on('data', d => { stderr += d.toString() })
    child.on('close', code => finish({ ok: code === 0, exit_code: code, stdout, stderr, error: code === 0 ? null : `process exited with code ${code}` }))
    child.on('error', err => finish({ ok: false, exit_code: null, stdout, stderr, error: err.message }))
  })
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  const data = fs.readFileSync(filePath)
  hash.update(data)
  return hash.digest('hex')
}

function verifyInstalled(plan) {
  const checks = []
  let ok = false

  if (plan.app_name) {
    const existing = localAppExists(plan.app_name)
    checks.push({ type: 'application_bundle', app_name: appBundleName(plan.app_name), path: existing || appPathFor(plan.app_name), ok: Boolean(existing) })
    ok = ok || Boolean(existing)
  }

  if (plan.command_name) {
    const commandPath = commandExists(plan.command_name)
    checks.push({ type: 'command', command: plan.command_name, path: commandPath, ok: Boolean(commandPath) })
    ok = ok || Boolean(commandPath)
  }

  const brew = getBrewPath()
  if (brew && plan.brew_name && (plan.method === 'brew_cask' || plan.method === 'brew_formula')) {
    const args = plan.method === 'brew_cask' ? ['list', '--cask', plan.brew_name] : ['list', plan.brew_name]
    const listed = spawnSync(brew, args, { encoding: 'utf8', timeout: 10000 })
    checks.push({ type: plan.method, brew_name: plan.brew_name, ok: listed.status === 0 })
    ok = ok || listed.status === 0
  }

  const snapshotHit = findInstalledSoftware(plan.app_name || plan.software)
  if (snapshotHit) {
    checks.push({ type: 'installed_software_snapshot', name: snapshotHit.name, path: snapshotHit.path || '', ok: true })
    ok = true
  }

  return { ok, checks }
}

function makePlan(args = {}) {
  const software = String(args.software || '').trim()
  const known = findKnownSoftware(software)
  const urlLooksLikeSoftware = /^https?:\/\//i.test(software)
  const methodArg = args.method || 'auto'
  let method = methodArg === 'auto' ? (known?.method || (args.url || urlLooksLikeSoftware ? 'download_url' : 'brew_cask')) : methodArg
  let url = args.url || (urlLooksLikeSoftware ? software : '')
  const brewName = args.brew_name || known?.brew_name || ''
  const appName = args.app_name || known?.app_name || ''
  const commandName = args.command_name || known?.command_name || ''
  const localPath = args.local_path || ''

  if (method === 'auto') method = known?.method || 'brew_cask'
  if (method === 'open_url' && url && !safeBasenameFromUrl(url).match(/\.(dmg|pkg|zip)$/i)) {
    // Keep open_url as-is for official download pages.
  }

  const installed = verifyInstalled({ software, method, brew_name: brewName, app_name: appName, command_name: commandName })
  const brewPath = getBrewPath()
  const actions = []
  if (method === 'brew_cask' || method === 'brew_formula') {
    actions.push({
      kind: 'homebrew',
      executable: brewPath || 'brew',
      args: method === 'brew_cask' ? ['install', '--cask', brewName || '<cask>'] : ['install', brewName || '<formula>'],
      display: method === 'brew_cask' ? `brew install --cask ${brewName || '<cask>'}` : `brew install ${brewName || '<formula>'}`,
    })
  } else if (method === 'download_url') {
    actions.push({
      kind: 'download',
      url,
      filename: safeBasenameFromUrl(url),
      expected_sha256: args.expected_sha256 || '',
      note: 'Download lands in Bailongma sandbox/software-installers. dmg/zip app bundles may be copied to /Applications after confirmation; pkg files are opened with macOS Installer UI.',
    })
  } else if (method === 'local_app') {
    actions.push({
      kind: 'copy_app',
      source: localPath || '<local .app path>',
      destination: APPLICATIONS_DIR,
    })
  } else if (method === 'open_url') {
    actions.push({ kind: 'open_url', url })
  }

  const risk = {
    requires_confirmation: !installed.ok && ['brew_cask', 'brew_formula', 'download_url', 'local_app', 'open_url'].includes(method),
    mutates_system: ['brew_cask', 'brew_formula', 'download_url', 'local_app'].includes(method),
    may_modify_applications: ['brew_cask', 'download_url', 'local_app'].includes(method),
    no_sudo: true,
    no_external_script: true,
    no_gatekeeper_bypass: true,
  }

  const missing = []
  if (!software) missing.push('software')
  if ((method === 'brew_cask' || method === 'brew_formula') && !brewName) missing.push('brew_name')
  if ((method === 'brew_cask' || method === 'brew_formula') && !brewPath) missing.push('homebrew')
  if ((method === 'download_url' || method === 'open_url') && !url) missing.push('url')
  if ((method === 'download_url' || method === 'open_url') && url && !isSafeHttpsUrl(url)) missing.push('safe_https_url')
  if (method === 'local_app' && !localPath) missing.push('local_path')

  return {
    tool: 'install_software',
    action: 'plan',
    platform: process.platform,
    ok: missing.length === 0 || installed.ok,
    software,
    resolved: {
      method,
      brew_name: brewName,
      app_name: appName,
      command_name: commandName,
      url,
      local_path: localPath,
      known_mapping: known ? known.aliases[0] : '',
    },
    homebrew: {
      available: Boolean(brewPath),
      path: brewPath,
    },
    already_installed: installed.ok,
    verification: installed,
    actions,
    risk,
    missing,
    confirmation_prompt: installed.ok
      ? `${software} 看起来已经安装了，不需要重复安装。`
      : `请向用户明确展示 method/source/command/path 后再继续。只有用户确认后，才能用 action="execute" 且 confirmed=true 调用。`,
  }
}

async function downloadInstaller(plan, expectedSha256, signal) {
  const url = plan.resolved.url
  if (!isSafeHttpsUrl(url)) throw new Error('download_url must be https (localhost allowed only for tests)')
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true })
  const fileName = safeBasenameFromUrl(url)
  const suffix = crypto.randomBytes(3).toString('hex')
  const targetPath = path.join(DOWNLOAD_DIR, `${Date.now()}-${suffix}-${fileName}`)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  signal?.addEventListener?.('abort', () => controller.abort(), { once: true })
  const res = await fetch(url, { signal: controller.signal, redirect: 'follow' })
  clearTimeout(timer)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  const arrayBuffer = await res.arrayBuffer()
  fs.writeFileSync(targetPath, Buffer.from(arrayBuffer))
  const sha256 = sha256File(targetPath)
  if (expectedSha256 && sha256.toLowerCase() !== String(expectedSha256).toLowerCase()) {
    throw new Error(`sha256 mismatch: expected ${expectedSha256}, got ${sha256}`)
  }
  return {
    path: targetPath,
    filename: fileName,
    size: fs.statSync(targetPath).size,
    sha256,
    final_url: res.url || url,
  }
}

function findFirstAppBundle(root) {
  if (!root || !fs.existsSync(root)) return ''
  const entries = fs.readdirSync(root, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory() && entry.name.endsWith('.app')) return full
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith('.')) {
      const found = findFirstAppBundle(full)
      if (found) return found
    }
  }
  return ''
}

async function copyAppBundle(sourceAppPath, signal) {
  if (!sourceAppPath.endsWith('.app')) throw new Error('local_app source must be a .app bundle')
  const stat = fs.statSync(sourceAppPath)
  if (!stat.isDirectory()) throw new Error('local_app source is not an app bundle directory')
  const dest = path.join(APPLICATIONS_DIR, path.basename(sourceAppPath))
  if (fs.existsSync(dest)) {
    return { ok: true, skipped: true, source: sourceAppPath, destination: dest, note: 'destination already exists' }
  }
  const result = await runProcess('/usr/bin/ditto', [sourceAppPath, dest], { signal })
  if (!result.ok) throw new Error(`copy to /Applications failed: ${result.stderr || result.error}`)
  return { ok: true, source: sourceAppPath, destination: dest }
}

async function installDownloadedPackage(downloaded, signal) {
  const ext = path.extname(downloaded.path).toLowerCase()
  if (ext === '.zip') {
    const extractDir = path.join(DOWNLOAD_DIR, `${path.basename(downloaded.path)}.contents`)
    fs.mkdirSync(extractDir, { recursive: true })
    const unzip = await runProcess('/usr/bin/ditto', ['-x', '-k', downloaded.path, extractDir], { signal })
    if (!unzip.ok) throw new Error(`zip extraction failed: ${unzip.stderr || unzip.error}`)
    const app = findFirstAppBundle(extractDir)
    if (!app) return { status: 'downloaded', note: 'zip extracted, but no .app bundle was found', extracted_to: extractDir }
    return { status: 'installed_app_bundle', copy: await copyAppBundle(app, signal), extracted_to: extractDir }
  }

  if (ext === '.dmg') {
    const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'bailongma-dmg-'))
    const attach = await runProcess('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, downloaded.path], { signal })
    if (!attach.ok) {
      await runProcess('/usr/bin/open', [downloaded.path], { signal })
      return { status: 'opened_in_finder', note: 'DMG could not be mounted automatically; opened it for the user instead.', mount_error: attach.stderr || attach.error }
    }
    try {
      const app = findFirstAppBundle(mountPoint)
      if (app) return { status: 'installed_app_bundle', copy: await copyAppBundle(app, signal) }
      await runProcess('/usr/bin/open', [downloaded.path], { signal })
      return { status: 'opened_in_finder', note: 'DMG mounted but no .app bundle was found; opened it for manual installation.' }
    } finally {
      await runProcess('/usr/bin/hdiutil', ['detach', mountPoint], { timeoutMs: 60000 })
    }
  }

  if (ext === '.pkg' || ext === '.mpkg') {
    const opened = await runProcess('/usr/bin/open', [downloaded.path], { signal })
    if (!opened.ok) throw new Error(`failed to open package installer: ${opened.stderr || opened.error}`)
    return { status: 'opened_installer_ui', note: 'pkg installer opened. The user must complete the macOS installer UI; Bailongma did not run sudo or install it silently.' }
  }

  return { status: 'downloaded', note: 'Unsupported installer extension for automatic install; file was downloaded only.' }
}

async function executeBrewInstall(plan, signal) {
  const brew = plan.homebrew.path || getBrewPath()
  if (!brew) throw new Error('Homebrew is not installed or not on PATH')
  const method = plan.resolved.method
  const name = plan.resolved.brew_name
  const args = method === 'brew_cask' ? ['install', '--cask', name] : ['install', name]
  const result = await runProcess(brew, args, { signal })
  return {
    ok: result.ok,
    command: [brew, ...args],
    exit_code: result.exit_code,
    stdout: String(result.stdout || '').slice(-6000),
    stderr: String(result.stderr || '').slice(-6000),
    error: result.error,
  }
}

export async function execInstallSoftware(args = {}, context = {}) {
  throwIfAborted(context.signal)
  if (!IS_MAC) {
    return toolJson({ ok: false, tool: 'install_software', error: 'install_software currently supports macOS only', platform: process.platform })
  }

  const action = args.action || 'plan'
  const plan = makePlan(args)

  if (action === 'plan') {
    return toolJson(plan)
  }

  if (action === 'verify') {
    return toolJson({
      ok: plan.verification.ok,
      tool: 'install_software',
      action: 'verify',
      software: plan.software,
      resolved: plan.resolved,
      verification: plan.verification,
    })
  }

  if (action === 'open_url') {
    const url = plan.resolved.url
    if (!url || !isSafeHttpsUrl(url)) return toolJson({ ok: false, tool: 'install_software', action, error: 'open_url requires an https URL' })
    const opened = await runProcess('/usr/bin/open', [url], { signal: context.signal, timeoutMs: 30000 })
    return toolJson({ ok: opened.ok, tool: 'install_software', action, url, error: opened.ok ? null : opened.stderr || opened.error })
  }

  if (action !== 'execute') {
    return toolJson({ ok: false, tool: 'install_software', error: `unknown action "${action}"` })
  }

  if (plan.already_installed) {
    return toolJson({
      ok: true,
      tool: 'install_software',
      action: 'execute',
      status: 'already_installed',
      software: plan.software,
      resolved: plan.resolved,
      verification: plan.verification,
    })
  }

  if (args.confirmed !== true) {
    return toolJson({
      ok: false,
      tool: 'install_software',
      action: 'execute',
      error: 'confirmation_required',
      plan,
    })
  }

  if (plan.missing.length) {
    return toolJson({ ok: false, tool: 'install_software', action: 'execute', error: `missing required install inputs: ${plan.missing.join(', ')}`, plan })
  }

  emitEvent('action', { tool: 'install_software', summary: `安装软件：${plan.software}`, detail: plan.resolved.method })

  try {
    let install = null
    if (plan.resolved.method === 'brew_cask' || plan.resolved.method === 'brew_formula') {
      install = await executeBrewInstall(plan, context.signal)
      if (!install.ok) {
        return toolJson({ ok: false, tool: 'install_software', action: 'execute', software: plan.software, resolved: plan.resolved, install, verification: verifyInstalled(plan.resolved) })
      }
    } else if (plan.resolved.method === 'download_url') {
      const downloaded = await downloadInstaller(plan, args.expected_sha256 || '', context.signal)
      install = { downloaded, installer: await installDownloadedPackage(downloaded, context.signal) }
    } else if (plan.resolved.method === 'local_app') {
      install = { copy: await copyAppBundle(plan.resolved.local_path, context.signal) }
    } else if (plan.resolved.method === 'open_url') {
      const opened = await runProcess('/usr/bin/open', [plan.resolved.url], { signal: context.signal, timeoutMs: 30000 })
      install = { opened: opened.ok, note: 'Opened URL for the user; no installer command was run.', error: opened.ok ? null : opened.stderr || opened.error }
    } else {
      return toolJson({ ok: false, tool: 'install_software', action: 'execute', error: `unsupported method "${plan.resolved.method}"`, plan })
    }

    const verification = verifyInstalled(plan.resolved)
    return toolJson({
      ok: verification.ok || plan.resolved.method === 'open_url' || install?.installer?.status?.startsWith('opened'),
      tool: 'install_software',
      action: 'execute',
      software: plan.software,
      resolved: plan.resolved,
      install,
      verification,
      note: verification.ok ? 'Installation verified.' : 'Installation action completed, but automatic verification did not prove the app/command is installed yet.',
    })
  } catch (err) {
    return toolJson({
      ok: false,
      tool: 'install_software',
      action: 'execute',
      software: plan.software,
      resolved: plan.resolved,
      error: err.message,
      verification: verifyInstalled(plan.resolved),
    })
  }
}

export const __softwareInstallInternal = {
  makePlan,
  findKnownSoftware,
  isSafeHttpsUrl,
  safeBasenameFromUrl,
}
