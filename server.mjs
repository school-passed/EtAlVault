import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const accounts = [
  { id: 'maya', name: 'Maya Chen', role: 'Researcher', title: 'PhD candidate · Experimental lead', initials: 'MC' },
  { id: 'elena', name: 'Dr. Elena Park', role: 'PI', title: 'Principal investigator', initials: 'EP' },
  { id: 'noah', name: 'Noah Williams', role: 'Co-author', title: 'Co-author · Data analysis', initials: 'NW' },
  { id: 'priya', name: 'Priya Raman', role: 'Co-author', title: 'Co-author · Biostatistics', initials: 'PR' },
  { id: 'lucas', name: 'Lucas Meyer', role: 'Co-author', title: 'Co-author · Lab operations', initials: 'LM' },
  { id: 'audit', name: 'Avery Brooks', role: 'Auditor', title: 'Independent auditor', initials: 'AB' },
  { id: 'admin', name: 'System Admin', role: 'System Admin', title: 'Platform operations', initials: 'SA' },
];
const approvalIds = ['noah', 'priya', 'lucas'];
const sessions = new Map();
const bytes = Buffer.from('sample_id,condition,reading,recorded_at\nS-014,control,0.482,2026-10-18T09:12:00Z\nS-015,treatment,0.617,2026-10-18T09:26:00Z\nS-016,control,0.491,2026-10-18T09:41:00Z\nS-017,treatment,0.632,2026-10-18T10:04:00Z\nS-018,treatment,0.609,2026-10-18T10:23:00Z\n');
const digest = createHash('sha256').update(bytes).digest('hex');
const data = {
  dataset: { id: 'ds-neuro-01', name: 'Neural response · Pilot cohort', project: 'Adaptive Neuroresponse Study', version: 3, createdAt: '2026-10-18T10:42:00Z', hash: digest, filename: 'pilot-cohort-v3.csv', size: bytes.length, rows: 1284, integrity: 'verified' },
  requests: [],
  events: [],
};
function audit(actor, action, resource, result, reason, metadata = {}) {
  data.events.unshift({ id: randomUUID(), actorId: actor?.id || 'system', actor: actor?.name || 'System', role: actor?.role || 'System', action, resource, result, reason, metadata, at: new Date().toISOString() });
}
audit(null, 'VERSION_SEALED', data.dataset.id, 'ALLOWED', 'Original dataset sealed as version 3', { version: 3, sha256: digest });

const permissions = {
  Researcher: ['project:read', 'dataset:read', 'export:request', 'amendment:request', 'audit:read'],
  PI: ['project:read', 'dataset:read', 'member:manage', 'policy:propose', 'export:request', 'audit:read'],
  'Co-author': ['project:read', 'dataset:read', 'export:approve'],
  Auditor: ['project:read', 'dataset:read', 'audit:read'],
  'System Admin': ['system:operate'],
};
function has(actor, permission) { return Boolean(actor && (permissions[actor.role] || []).includes(permission)); }
function respond(res, status, body, headers = {}) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(body)); }
async function body(req) { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw || '{}'); } catch { return {}; } }
function actorFrom(req) { const sid = (req.headers.cookie || '').match(/(?:^|;\s*)vault_session=([^;]+)/)?.[1]; return sid ? sessions.get(sid) : null; }
function deny(actor, permission, resource, res) { audit(actor, 'ACCESS_CHECK', resource, 'DENIED', `Missing permission: ${permission}`, { permission }); respond(res, 403, { error: 'Access denied', code: 'FORBIDDEN', reason: `This demo identity does not have ${permission}.` }); }
function snapshot(actor) { return { dataset: data.dataset, requests: data.requests, events: has(actor, 'audit:read') ? data.events : [], approvalsRequired: 3, approvalRoster: approvalIds.map(id => accounts.find(a => a.id === id)) }; }
function calcStatus(request) { if (request.status === 'DENIED' || request.status === 'CANCELLED' || request.status === 'EXPORTED') return request.status; if (Date.now() > new Date(request.expiresAt).getTime()) return 'EXPIRED'; if (Object.values(request.votes).some(v => v.decision === 'REJECT')) return 'DENIED'; if (approvalIds.every(id => request.votes[id]?.decision === 'APPROVE')) return 'APPROVED'; return 'PENDING_APPROVAL'; }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/session') return respond(res, 200, { user: actorFrom(req), accounts });
  if (req.method === 'POST' && url.pathname === '/api/sign-in') {
    const input = await body(req), selected = accounts.find(a => a.id === input.accountId);
    if (!selected) return respond(res, 400, { error: 'Choose a demo identity.' });
    const sid = randomUUID(); sessions.set(sid, selected); audit(selected, 'SIGN_IN', 'session', 'ALLOWED', 'Simulated TideCloak sign-in');
    return respond(res, 200, { user: selected }, { 'set-cookie': `vault_session=${sid}; HttpOnly; SameSite=Strict; Path=/` });
  }
  if (req.method === 'POST' && url.pathname === '/api/sign-out') { const actor = actorFrom(req); audit(actor, 'SIGN_OUT', 'session', 'ALLOWED', 'Session ended'); const sid = (req.headers.cookie || '').match(/vault_session=([^;]+)/)?.[1]; if (sid) sessions.delete(sid); return respond(res, 200, { ok: true }, { 'set-cookie': 'vault_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
  const actor = actorFrom(req);
  if (url.pathname.startsWith('/api/')) {
    if (!actor) { audit(null, 'ACCESS_CHECK', url.pathname, 'DENIED', 'No authenticated session'); return respond(res, 401, { error: 'Sign in to continue.', code: 'UNAUTHENTICATED' }); }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      if (!has(actor, 'project:read')) return deny(actor, 'project:read', 'workspace', res);
      audit(actor, 'ACCESS_CHECK', 'workspace', 'ALLOWED', 'Workspace read'); return respond(res, 200, snapshot(actor));
    }
    if (req.method === 'POST' && url.pathname === '/api/exports/requests') {
      if (!has(actor, 'export:request')) return deny(actor, 'export:request', data.dataset.id, res);
      const input = await body(req), reason = String(input.reason || '').trim(), purpose = String(input.purpose || '').trim();
      if (reason.length < 12 || !purpose) { audit(actor, 'EXPORT_REQUEST_VALIDATE', data.dataset.id, 'DENIED', 'Purpose or reason missing'); return respond(res, 422, { error: 'Add a purpose and a reason of at least 12 characters.', code: 'INVALID_REQUEST' }); }
      const request = { id: `EXP-${String(data.requests.length + 241).padStart(4, '0')}`, requesterId: actor.id, requester: actor.name, requesterRole: actor.role, purpose, reason, datasetId: data.dataset.id, version: data.dataset.version, versionHash: data.dataset.hash, roster: [...approvalIds], votes: {}, status: 'PENDING_APPROVAL', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() };
      data.requests.unshift(request); audit(actor, 'EXPORT_REQUEST_CREATED', request.id, 'ALLOWED', reason, { purpose, version: request.version, approvalRoster: request.roster }); return respond(res, 201, { request });
    }
    const voteMatch = url.pathname.match(/^\/api\/exports\/requests\/([^/]+)\/vote$/);
    if (req.method === 'POST' && voteMatch) {
      if (!has(actor, 'export:approve')) return deny(actor, 'export:approve', voteMatch[1], res);
      const request = data.requests.find(r => r.id === voteMatch[1]); if (!request) return respond(res, 404, { error: 'Request not found.' });
      if (!request.roster.includes(actor.id)) return deny(actor, 'approval:roster-member', request.id, res);
      if (request.requesterId === actor.id) { audit(actor, 'EXPORT_VOTE', request.id, 'DENIED', 'Requester cannot approve own request'); return respond(res, 403, { error: 'The requester cannot approve their own request.' }); }
      if (request.votes[actor.id] || calcStatus(request) !== 'PENDING_APPROVAL') return respond(res, 409, { error: 'This request is no longer awaiting your vote.' });
      const input = await body(req), decision = input.decision === 'REJECT' ? 'REJECT' : input.decision === 'APPROVE' ? 'APPROVE' : null;
      if (!decision) return respond(res, 422, { error: 'Choose approve or reject.' });
      const voteReason = String(input.reason || '').trim(); if (decision === 'REJECT' && voteReason.length < 4) return respond(res, 422, { error: 'Add a short reason when rejecting.' });
      request.votes[actor.id] = { decision, reason: voteReason, at: new Date().toISOString(), actor: actor.name }; request.status = calcStatus(request);
      audit(actor, `EXPORT_${decision}`, request.id, 'ALLOWED', voteReason || 'Approved by roster member', { status: request.status }); return respond(res, 200, { request });
    }
    const exportMatch = url.pathname.match(/^\/api\/exports\/requests\/([^/]+)\/download$/);
    if (req.method === 'GET' && exportMatch) {
      const request = data.requests.find(r => r.id === exportMatch[1]); if (!request) return respond(res, 404, { error: 'Request not found.' });
      if (!has(actor, 'export:request') || request.requesterId !== actor.id) return deny(actor, 'export:execute-own-request', request.id, res);
      request.status = calcStatus(request);
      const valid = request.status === 'APPROVED' && request.roster.length === 3 && request.roster.every(id => request.votes[id]?.decision === 'APPROVE') && request.datasetId === data.dataset.id && request.version === data.dataset.version && request.versionHash === data.dataset.hash && data.dataset.integrity === 'verified';
      if (!valid) { audit(actor, 'EXPORT_EXECUTE', request.id, 'DENIED', 'Final server-side validation failed', { status: request.status, versionMatch: request.version === data.dataset.version }); return respond(res, 409, { error: 'Export blocked. All 3/3 approvals, the approved version, current access and integrity must still be valid.', code: 'EXPORT_GUARD', request }); }
      request.status = 'EXPORTED'; audit(actor, 'EXPORT_EXECUTE', request.id, 'ALLOWED', '3/3 approvals and final integrity check passed', { version: request.version, sha256: request.versionHash }); res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${data.dataset.filename}"`, 'x-content-sha256': digest }); return res.end(bytes);
    }
    if (req.method === 'POST' && url.pathname === '/api/datasets/edit') { if (!has(actor, 'dataset:edit')) return deny(actor, 'dataset:edit', data.dataset.id, res); }
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      if (!has(actor, 'audit:read') && !has(actor, 'system:operate')) return deny(actor, 'audit:read', 'audit-log', res);
      audit(actor, 'AUDIT_LOG_READ', 'audit-log', 'ALLOWED', 'Audit history viewed'); return respond(res, 200, { events: data.events });
    }
    if (req.method === 'GET' && url.pathname === '/api/architecture') return respond(res, 200, { boundary: 'Simulated TideCloak identity and policy adapter', placement: ['Sign-in and session identity', 'Server-side role and resource policy checks', 'Versioned dataset access', 'Approval quorum for data export', 'Final export-time authorization and integrity re-check'], qea: 'The app approval quorum is a business workflow; it is not represented as TideCloak QEA.' });
    return respond(res, 404, { error: 'Unknown endpoint.' });
  }
  if (req.method === 'GET') {
    const file = url.pathname === '/' ? 'index.html' : path.basename(url.pathname);
    try { const content = await readFile(path.join(root, file)); const ext = path.extname(file); res.writeHead(200, { 'content-type': ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' || ext === '.mjs' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8' }); return res.end(content); } catch { return respond(res, 404, { error: 'Not found' }); }
  }
  respond(res, 404, { error: 'Not found' });
});
server.listen(PORT, '127.0.0.1', () => console.log(`The Et Al. Vault · http://127.0.0.1:${PORT}`));
