// Plain fetch against the CAP OData service.
const BASE = '/odata/v4/cockpit/'

async function unwrap (res) {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error?.message || `HTTP ${res.status}`)
  return typeof body.value === 'string' ? JSON.parse(body.value) : body.value
}

export const get = fn => fetch(BASE + fn).then(unwrap)
export const post = (action, data = {}) => fetch(BASE + action, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data)
}).then(unwrap)

export const api = {
  overview: () => get('overview()'),
  detail: id => get(`detail(escalation=${id})`),
  targets: kind => get(`injectTargets(kind='${kind}')`),
  approve: (option, actor, note) => post('approve', { option, actor, note }),
  dismiss: (escalation, actor, reason) => post('dismiss', { escalation, actor, reason }),
  inject: (kind, ref) => post('inject', { kind, ref: ref || null }),
  clock: (op, value = 0) => post('clock', { op, value }),
  setGate: on => post('setGate', { on }),
  reset: () => post('reset')
}
