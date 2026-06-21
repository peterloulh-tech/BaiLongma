// Unit tests for conservative macOS software installation planning.
//
// Run: node src/test-install-software.js

import assert from 'node:assert/strict'
import { __setInstalledSoftwareForTest } from './installed-software-scanner.js'
import { execInstallSoftware, __softwareInstallInternal } from './capabilities/tools/software-install.js'

function parse(raw) {
  return JSON.parse(raw)
}

async function run() {
  __setInstalledSoftwareForTest([])

  const chromePlan = parse(await execInstallSoftware({ action: 'plan', software: 'Chrome' }))
  assert.equal(chromePlan.tool, 'install_software')
  if (process.platform === 'darwin') {
    assert.equal(chromePlan.resolved.method, 'brew_cask')
    assert.equal(chromePlan.resolved.brew_name, 'google-chrome')
    assert.equal(chromePlan.risk.requires_confirmation, !chromePlan.already_installed)
    assert.match(chromePlan.actions[0].display, /brew install --cask google-chrome/)
  } else {
    assert.equal(chromePlan.ok, false)
    assert.match(chromePlan.error, /macOS/)
  }

  const noConfirm = parse(await execInstallSoftware({ action: 'execute', software: 'Chrome' }))
  if (process.platform === 'darwin') {
    if (noConfirm.status === 'already_installed') {
      assert.equal(noConfirm.ok, true)
    } else {
      assert.equal(noConfirm.ok, false)
      assert.equal(noConfirm.error, 'confirmation_required')
    }
    assert.equal((noConfirm.plan?.resolved || noConfirm.resolved).brew_name, 'google-chrome')
  } else {
    assert.equal(noConfirm.ok, false)
    assert.match(noConfirm.error, /macOS/)
  }

  __setInstalledSoftwareForTest([{ name: 'Google Chrome', path: '/Applications/Google Chrome.app' }])
  const installed = parse(await execInstallSoftware({ action: 'plan', software: 'Chrome' }))
  if (process.platform === 'darwin') {
    assert.equal(installed.already_installed, true)
    assert.equal(installed.risk.requires_confirmation, false)
    assert.equal(installed.confirmation_prompt, 'Chrome 看起来已经安装了，不需要重复安装。')
  }

  assert.equal(__softwareInstallInternal.isSafeHttpsUrl('https://example.com/app.dmg'), true)
  assert.equal(__softwareInstallInternal.isSafeHttpsUrl('http://example.com/app.dmg'), false)
  assert.equal(__softwareInstallInternal.safeBasenameFromUrl('https://example.com/download/Test%20App.dmg'), 'Test App.dmg')

  console.log('\nAll install-software tests passed.')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
