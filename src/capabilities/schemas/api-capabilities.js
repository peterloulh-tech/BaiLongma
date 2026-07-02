export const apiCapabilitySchemas = {
  run_api_capability: {
    type: 'function',
    function: {
      name: 'run_api_capability',
      description: 'Run a configured API capability slot through its tested local runner program. Use this when a dynamic capability card says to call run_api_capability. The slot contains the docs URL, usage instructions, input/output schemas, and program_path; pass args matching that input schema. Do not re-derive the API call from docs unless the runner fails.',
      parameters: {
        type: 'object',
        properties: {
          slot_id: { type: 'string', description: 'Capability slot id, such as vision.kimi or video.seedance_custom.' },
          kind: { type: 'string', description: 'Optional capability kind fallback if slot_id is omitted.' },
          args: { type: 'object', description: 'Arguments for the capability runner, matching the slot input schema.' },
        },
        required: [],
      },
    },
  },

  analyze_image: {
    type: 'function',
    function: {
      name: 'analyze_image',
      description: 'Analyze, OCR, describe, or answer questions about an image using a configured vision API capability slot such as Kimi/Moonshot vision. Use when the user asks you to inspect a picture, screenshot, photo, chart, UI, document image, or any visual content. If the current user message contains a markdown image, the tool can infer it, but pass image_path or image_url explicitly when possible.',
      parameters: {
        type: 'object',
        properties: {
          image_path: { type: 'string', description: 'Local image file path, file:// URL, or /media/chat/<filename>. Optional if the current message contains a markdown image.' },
          image_url: { type: 'string', description: 'http(s) image URL or data:image base64 URL. Optional if image_path is provided.' },
          prompt: { type: 'string', description: 'Question or instruction for the image analysis. Use Chinese by default for Chinese users.' },
          detail: { type: 'string', enum: ['auto', 'low', 'high'], description: 'Optional image detail level for OpenAI-compatible vision APIs. Default auto.' },
          slot_id: { type: 'string', description: 'Optional API capability slot id. Omit to use the first configured vision slot.' },
        },
        required: [],
      },
    },
  },

  manage_api_capability: {
    type: 'function',
    function: {
      name: 'manage_api_capability',
      description: 'Manage API capability slots by explicit agent intent. Use this when the user asks to configure an API-backed capability, provides an API docs URL/docs text plus a key, or asks you to find a suitable API and wire it into a capability slot. The complete workflow is: read/find docs, write a local runner program under sandbox/api-capabilities, test it, then call action="configure" with docs_url/docs_summary, usage instructions, program_path, schemas, test_results, and the user-provided api_key. Do not rely on automatic key/provider detection. Any kind can be registered if it has a tested runner. The system redacts sensitive fields from audit logs.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'get', 'save_doc', 'configure', 'enable', 'disable', 'delete'], description: 'Management action. configure stores docs/endpoint/model/key in one explicit intent-driven step.' },
          slot_id: { type: 'string', description: 'Slot id, such as vision.kimi. Required for get/enable/disable/delete unless using the default Kimi vision slot.' },
          provider: { type: 'string', description: 'Provider inferred from the user intent/docs, e.g. kimi, moonshot, openai-compatible vendor name.' },
          kind: { type: 'string', description: 'Capability kind. Managed v1 supports vision execution.' },
          docs_url: { type: 'string', description: 'Provider API documentation URL supplied by the user or found by the agent.' },
          docs: { type: 'string', description: 'Relevant API configuration documentation or pasted provider docs. Secrets will be redacted before storage.' },
          docs_summary: { type: 'string', description: 'Short docs summary to inject in future capability cards. Prefer this over storing/injecting long docs text.' },
          api_key: { type: 'string', description: 'API key explicitly provided by the user for this capability. Required for action=configure. The tool result and audit log redact it.' },
          execution_instructions: { type: 'string', description: 'Short instructions for future agent use: when to call this capability and how to interpret the runner output.' },
          model: { type: 'string', description: 'Optional model id from the docs, e.g. moonshot-v1-32k-vision-preview.' },
          base_url: { type: 'string', description: 'OpenAI-compatible base URL, e.g. https://api.moonshot.cn/v1.' },
          endpoint: { type: 'string', description: 'Optional endpoint path, default /chat/completions.' },
          protocol: { type: 'string', description: 'Protocol id, default openai-chat-completions.' },
          program_path: { type: 'string', description: 'Path to the tested local runner program, relative to sandbox/api-capabilities or absolute inside that directory. The runner reads stdin JSON and writes stdout JSON.' },
          program_runtime: { type: 'string', enum: ['node', 'python'], description: 'Runner runtime. Default inferred from program_path extension.' },
          program_timeout_ms: { type: 'number', description: 'Runner timeout in milliseconds, default 60000, max 600000.' },
          input_schema: { type: 'object', description: 'JSON schema for args accepted by run_api_capability.' },
          output_schema: { type: 'object', description: 'JSON schema for the runner stdout JSON result.' },
          permissions: { type: 'object', description: 'Declared runner permissions, e.g. { network: true, filesystem: false }.' },
          test_results: { type: 'array', items: { type: 'object' }, description: 'Evidence that the agent wrote and tested the runner before registration.' },
          triggers: { type: 'array', items: { type: 'string' }, description: 'Optional additional trigger phrases for this capability slot.' },
        },
        required: ['action'],
      },
    },
  },
}
