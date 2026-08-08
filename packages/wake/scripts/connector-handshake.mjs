/**
 * Drive the full connector handshake against a wake instance, the way an MCP
 * client does it: RFC 9728 discovery from a 401 challenge, RFC 8414 server
 * metadata, RFC 7591 dynamic registration, PKCE S256 auth code, token
 * exchange, then an authenticated tools/call. No wake code imported — this is
 * an outside client speaking HTTP.
 */
import crypto from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:8799';
const OWNER = process.argv[3] ?? 'secret';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. Unauthenticated MCP call must 401 and point at the resource metadata.
const probe = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
const challenge = probe.headers.get('www-authenticate') ?? '';
check('401 on unauthenticated /mcp', probe.status === 401, `got ${probe.status}`);
check('WWW-Authenticate names resource_metadata', challenge.includes('resource_metadata'), challenge.slice(0, 90));

const metaUrl = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
check('challenge carries a usable URL', Boolean(metaUrl), metaUrl ?? 'none');

// 2. RFC 9728 protected resource metadata.
const rm = await (await fetch(metaUrl)).json();
check('resource metadata lists an authorization server', Array.isArray(rm.authorization_servers) && rm.authorization_servers.length > 0);

// 3. RFC 8414 authorization server metadata.
const asUrl = `${rm.authorization_servers[0].replace(/\/$/, '')}/.well-known/oauth-authorization-server`;
const as = await (await fetch(asUrl)).json();
check('AS metadata has the three endpoints', Boolean(as.authorization_endpoint && as.token_endpoint && as.registration_endpoint));
check('AS advertises PKCE S256', (as.code_challenge_methods_supported ?? []).includes('S256'), JSON.stringify(as.code_challenge_methods_supported));

// 4. RFC 7591 dynamic client registration.
const reg = await fetch(as.registration_endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    client_name: 'Claude',
    redirect_uris: [REDIRECT],
    // a browser-redirect connector is a public client; it has nowhere to keep a secret
    ...(process.env.PUBLIC_CLIENT === '1' ? { token_endpoint_auth_method: 'none' } : {}),
  }),
});
const client = await reg.json();
check(`registered as ${client.client_secret ? 'confidential' : 'public'} client`, true);
check('registration reports the method it actually granted',
  client.token_endpoint_auth_method === (client.client_secret ? 'client_secret_post' : 'none'),
  String(client.token_endpoint_auth_method));
check('dynamic registration returns a client_id', reg.status < 300 && Boolean(client.client_id), `${reg.status} ${JSON.stringify(client).slice(0, 80)}`);

// 5. Authorization with PKCE.
const verifier = crypto.randomBytes(32).toString('base64url');
const challengeS256 = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(8).toString('hex');
const authParams = new URLSearchParams({
  response_type: 'code',
  client_id: client.client_id,
  redirect_uri: REDIRECT,
  code_challenge: challengeS256,
  code_challenge_method: 'S256',
  state,
});

const consent = await fetch(`${as.authorization_endpoint}?${authParams}`);
const consentHtml = await consent.text();
check('consent screen renders', consent.status === 200 && consentHtml.includes('<form'), `status ${consent.status}`);
check('consent offers scope choice', consentHtml.includes('name="grant"'));

// 6. Approve as the owner would, and capture the redirect.
const approve = await fetch(as.authorization_endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ ...Object.fromEntries(authParams), grant: '*', owner_token: OWNER }),
  redirect: 'manual',
});
const location = approve.headers.get('location') ?? '';
check('approval redirects to the callback', location.startsWith(REDIRECT), location.slice(0, 70) || `status ${approve.status}`);
const returned = new URL(location);
check('state is echoed back', returned.searchParams.get('state') === state);
const code = returned.searchParams.get('code');
check('an authorization code was issued', Boolean(code));

// 7. A wrong verifier must be rejected — on its OWN code, because wake burns a
// code on any redemption attempt including a failed one (deliberate: see
// "single use, even on failure" in oauth.ts). Reusing this flow's code here
// would spend it and make the happy path below fail for the wrong reason.
{
  const v2 = crypto.randomBytes(32).toString('base64url');
  const c2 = crypto.createHash('sha256').update(v2).digest('base64url');
  const p2 = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: REDIRECT,
    code_challenge: c2,
    code_challenge_method: 'S256',
    state: 'throwaway',
  });
  const approved = await fetch(as.authorization_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...Object.fromEntries(p2), grant: '*', owner_token: OWNER }),
    redirect: 'manual',
  });
  const spare = new URL(approved.headers.get('location')).searchParams.get('code');
  const bad = await fetch(as.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: spare,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: crypto.randomBytes(32).toString('base64url'),
    }),
  });
  check('mismatched PKCE verifier is refused', bad.status >= 400, `status ${bad.status}`);

  const after = await fetch(as.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: spare,
      redirect_uri: REDIRECT,
      client_id: client.client_id,
      code_verifier: v2,
    }),
  });
  check('a failed attempt burns the code (deliberate)', after.status >= 400, `status ${after.status}`);
}

// 8. Real token exchange.
const exchange = await fetch(as.token_endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: client.client_id,
    code_verifier: verifier,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
  }),
});
const token = await exchange.json();
check('token exchange succeeds', exchange.status === 200 && Boolean(token.access_token), `${exchange.status} ${JSON.stringify(token).slice(0, 80)}`);

// 9. Replaying a spent code must fail.
const replay = await fetch(as.token_endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT,
    client_id: client.client_id,
    code_verifier: verifier,
  }),
});
check('code replay is refused', replay.status >= 400, `status ${replay.status}`);

// 10. The token actually works against MCP.
const call = await fetch(`${BASE}/mcp`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token.access_token}`,
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } },
  }),
});
const body = await call.text();
check('MCP initialize accepts the minted token', call.status === 200, `status ${call.status} ${body.slice(0, 80)}`);
check('server announces itself as wake', body.includes('"wake"'), body.slice(0, 120).replace(/\n/g, ' '));
check('instructions are sent at connect time', body.includes('unlogged hour') || body.toLowerCase().includes('instructions'));

// 11. Refresh rotation.
if (token.refresh_token) {
  const refreshed = await fetch(as.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    }),
  });
  const next = await refreshed.json();
  check('refresh returns a new access token', refreshed.status === 200 && Boolean(next.access_token));
  check('refresh token rotates', next.refresh_token && next.refresh_token !== token.refresh_token);
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
