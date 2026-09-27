// The simulated clock. Nothing else in the system calls Date.now() —
// every agent asks the clock, which is what lets the demo fast-forward.

const ANCHOR = Date.parse('2026-09-30T11:20:00+05:30') // Wednesday, late morning IST
const DEFAULT_SPEED = 10 // simulated seconds per real second

let state = { base: ANCHOR, realAt: Date.now(), speed: DEFAULT_SPEED, paused: false }

function now () {
  if (state.paused) return state.base
  return state.base + (Date.now() - state.realAt) * state.speed
}

function rebase () { state.base = now(); state.realAt = Date.now() }

module.exports = {
  ANCHOR,
  now,
  advance (mins) { rebase(); state.base += mins * 60000 },
  setSpeed (speed) { rebase(); state.speed = speed },
  pause (paused) { rebase(); state.paused = !!paused },
  reset () { state = { base: ANCHOR, realAt: Date.now(), speed: DEFAULT_SPEED, paused: false } },
  status: () => ({ now: new Date(now()).toISOString(), speed: state.speed, paused: state.paused })
}
