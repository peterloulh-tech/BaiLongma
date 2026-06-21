// Software installation tools.
export const softwareSchemas = {
  install_software: {
    type: 'function',
    function: {
      name: 'install_software',
      description: 'Plan, execute, or verify macOS software installation with explicit safety boundaries. Use when the user asks to install an app/package/command-line tool (Chrome, VS Code, ffmpeg, a dmg/pkg/zip URL, Homebrew Cask/Formula, or copying a local .app to /Applications). Default to action="plan" first unless the user has explicitly confirmed the exact plan in this conversation. Never use curl|sh, never bypass Gatekeeper, and never run sudo silently. Mutating actions require confirmed=true.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['plan', 'execute', 'verify', 'open_url'],
            description: 'plan returns a transparent install plan; execute performs the confirmed plan; verify checks installation; open_url opens a safe download page or package URL in the browser/Finder without installing.'
          },
          software: {
            type: 'string',
            description: 'User-facing software name, e.g. "Chrome", "Visual Studio Code", "ffmpeg", or the URL basename.'
          },
          method: {
            type: 'string',
            enum: ['auto', 'brew_cask', 'brew_formula', 'download_url', 'open_url', 'local_app'],
            description: 'Installation method. auto prefers known Homebrew Cask/Formula mappings on macOS.'
          },
          brew_name: {
            type: 'string',
            description: 'Homebrew cask or formula token, e.g. "google-chrome", "visual-studio-code", "ffmpeg".'
          },
          url: {
            type: 'string',
            description: 'Official download page or direct dmg/pkg/zip URL. Must be https unless it is localhost for testing.'
          },
          expected_sha256: {
            type: 'string',
            description: 'Optional expected sha256 for a downloaded installer. If provided, execute fails on mismatch.'
          },
          app_name: {
            type: 'string',
            description: 'Expected macOS .app name without or with .app, e.g. "Google Chrome" or "Visual Studio Code.app".'
          },
          command_name: {
            type: 'string',
            description: 'Expected command to verify for formula installs, e.g. "ffmpeg" or "code".'
          },
          local_path: {
            type: 'string',
            description: 'Local .app/.dmg/.pkg/.zip path for local_app or verification. Mutating install only copies .app bundles to /Applications.'
          },
          confirmed: {
            type: 'boolean',
            description: 'Set true only after the user explicitly approved the exact source/method/command/path shown by a previous plan.'
          }
        },
        required: ['action', 'software']
      }
    }
  },
}
