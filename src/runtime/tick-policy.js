// Tick policy deliberately separates semantic judgment from runtime authority.
//
// The model decides whether a heartbeat is worth acting on. Runtime code still
// owns permissions, target allowlists, sandboxing, budgets, interruption, and
// tool validation; those are execution invariants rather than behavioral
// choices.

export function buildAutonomousTickDirections({
  startupSelfCheckActive = false,
  awakeningTicks = 0,
  delegationDiscovery = '',
  tickerStatus = null,
} = {}) {
  const parts = [
    `This is an autonomous L2 heartbeat with no new user message. The heartbeat itself creates no obligation to act, speak, or remain passive.`,
    `Read the current runtime context and make your own situational judgment. Valid outcomes include silence, an internal state update, using tools, advancing or reconsidering a task, changing your heartbeat cadence, or contacting a visible target. None is the default merely because a TICK occurred.`,
    `Heartbeat output contract: ordinary assistant text from this turn is private working text and is not delivered to anyone. If you decide that someone should receive a message, express that decision by calling send_message with the recipient and content you chose. If you decide no external communication is warranted, simply conclude the turn; do not narrate or justify silence. This contract does not decide whether you should communicate — that remains your judgment.`,
    `If you act, choose the goal, scope, tools, recipient, channel, and stopping point yourself from expected value, timing, continuity, and actual evidence. If a useful capability is not loaded, use find_tool instead of assuming it is unavailable.`,
    `Runtime guardrails still validate permissions, sandbox boundaries, recipients, budgets, and tool arguments. A rejected action is evidence to reconsider the plan, not permission to work around the boundary.`,
  ]

  if (tickerStatus?.active) {
    const reason = tickerStatus.reason ? ` Reason: ${tickerStatus.reason}.` : ''
    parts.push(`Custom heartbeat cadence is active: ${tickerStatus.seconds}s interval, ${tickerStatus.ttl} heartbeat(s) remaining.${reason} Treat this as scheduling context, not an instruction to speak or to confirm the setting. Call set_tick_interval only when you independently decide to change the effective cadence; calling it again with the current setting has no effect.`)
  }

  if (startupSelfCheckActive) {
    parts.push(
      `A one-time startup diagnostic is open. Treat it as a diagnostic goal, not a mandatory checklist: decide which checks, if any, are useful in the present environment and choose their order yourself. Base every recorded result on real tool evidence; skipped or unnecessary checks are valid. When you judge the diagnostic sufficiently understood, call complete_startup_self_check with an honest summary and results so the startup phase can close. Whether anything should be communicated to the user remains part of your normal heartbeat judgment.`
    )
  } else if (Number(awakeningTicks) > 0) {
    parts.push(
      `You are still in the early awakening period (${awakeningTicks} heartbeat(s) remain). This is context, not a prescribed exploration sequence. Decide for yourself whether exploration, reflection, task work, communication, or silence best fits this moment.`
    )
  }

  if (delegationDiscovery) parts.push(String(delegationDiscovery))

  return parts.join('\n')
}
