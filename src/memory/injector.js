import {
  getActiveConstraints,
  getRecentActionLogs,
  getValidPrefetchCache,
  getConfig,
} from '../db.js'
import { extractKeywords } from './keywords.js'
import { computeSelfPerception, computeSelfSnapshot } from './self-perception.js'
import { selectActivePolicies } from './active-policies.js'
import {
  parseMessageInput,
  consumeInjectorStateHints,
  stripThinkHint,
  buildMemoryFocusInput,
} from './injector/message-input.js'
import {
  getParticipantMemoryContext,
  retrieveRelevantMemorySet,
  retrieveTaskKnowledge,
  retrieveTemporalRecall,
  retrieveRecallMemories,
  selectInjectorMemories,
} from './injector/memory-retrieval.js'
import { consumeInjectorUISignals } from './injector/ui-signals.js'
import { selectInjectorTools } from './injector/tool-selection.js'
import { writeInjectorRecallAudit } from './injector/audit.js'

// —— 对外门面：保持 injector.js 作为统一入口，原有 import 路径不变 ——
// 旧 import 路径兼容：focus.js / 其他模块也能从 injector 拿到 extractKeywords
export { extractKeywords }
export { selectContextMemories, searchAdditionalMemories } from './injector-retrieval.js'
export {
  formatTemporalRecall,
  formatMemoriesForPrompt,
  formatPrefetchedItems,
  formatActiveUICards,
  formatAIVideoPanel,
  formatTaskKnowledge,
} from './injector-format.js'
export { formatActivePoliciesForPrompt } from './active-policies.js'

// hint：一层思考器的输出文本，用于扩展 L2 的记忆检索范围
export async function runInjector({ message, state, hint = '' }) {
  const injectorStartedAt = Date.now()
  const {
    lastToolResult,
    confidenceHint,
    hasTask,
    hasRecall,
  } = consumeInjectorStateHints(state)
  const { isTick: isTickMessage, senderId, messageBody } = parseMessageInput(message)

  const constraints = getActiveConstraints()
  const {
    personMemory,
    userProfile,
    conversationWindow,
    senderMemories,
  } = getParticipantMemoryContext({ senderId, isTickMessage })
  const temporalRecall = retrieveTemporalRecall({ isTickMessage, messageBody })
  const hintText = stripThinkHint(hint)
  const {
    conversationText,
    focusText,
    hasHistory,
  } = buildMemoryFocusInput({
    messageBody,
    temporalRecall,
    hasTask,
    task: state?.task || '',
    hintText,
    conversationWindow,
  })
  const relevantMemories = await retrieveRelevantMemorySet({
    focusText,
    conversationText,
    hasHistory,
    hasHint: !!hint,
    confidenceHint,
  })
  const taskKnowledge = retrieveTaskKnowledge(hasTask)
  const { recallMemories, directions } = retrieveRecallMemories(state?.prev_recall)
  const memories = selectInjectorMemories({ relevantMemories, senderMemories, hasHistory })
  const actionLog = getRecentActionLogs(10)
  const activePolicies = focusText
    ? selectActivePolicies({
        focusText,
        messageBody,
        contextText: conversationText,
        actionLog,
        baseMemories: memories,
      })
    : []

  // —— 按需注入工具（动态上下文记忆池第 4 步）——
  // 之前把 ~35 个工具全量注入，每轮 6-9K token 大头在这。改成按意图分组：
  // tool-router.js 看消息正文 + 上下文标志 + ActionLog 保活 + Fallback 安全网。
  const prefetchedItems = getValidPrefetchCache()
  const { uiSignalSummary, activeUICards } = consumeInjectorUISignals(60_000)
  const tools = await selectInjectorTools({
    messageBody,
    isTick: isTickMessage,
    senderId,
    hasTask,
    hasRecall,
    actionLog,
    startupSelfCheckActive: !!state?.startupSelfCheck?.active,
  })

  // 自我感知层：对当前 user 消息与近期 jarvis 输出做镜像/风格/循环检测。
  // 只在非 TICK、有 senderId 且有对话历史时跑——TICK 心跳本身就不是用户输入，不会触发镜像。
  // 返回 null 时下游 buildContextBlock 不会渲染 <self-perception> 段。
  const selfPerception = (!isTickMessage && senderId && messageBody)
    ? computeSelfPerception({
        conversationWindow,
        currentMsg: { content: messageBody, fromId: senderId },
      })
    : null

  // 自我快照：常驻的"你刚才是怎样的你"。不分 L1/L2 / 不分 TICK，只要有 jarvis 历史就出。
  // 注入器拿 agent_name 用作身份锚的开头（"你是 小白龙。..."）。
  const agentName = getConfig('agent_name') || '小白龙'
  const selfSnapshot = computeSelfSnapshot({ conversationWindow, actionLog, agentName })

  writeInjectorRecallAudit({
    injectorStartedAt,
    isTickMessage,
    senderId,
    messageBody,
    memories,
    recallMemories,
    activePolicies,
  })

  return {
    memories,
    activePolicies,
    recallMemories,
    conversationWindow,
    personMemory,
    userProfile,
    directions,
    constraints,
    thought: null,
    taskKnowledge,
    tools: [...new Set(tools)],
    lastToolResult,
    actionLog,
    prefetchedItems,
    uiSignalSummary,
    activeUICards,
    temporalRecall,
    selfPerception,
    selfSnapshot,
  }
}
