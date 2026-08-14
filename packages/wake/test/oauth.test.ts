import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hub, createSpace } from '../src/core/spaces.js';
import { buildHttpApp } from '../src/http/server.js';

const OWNER = 'owner-token';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const opened: Hub[] = [];

afterEach(() => {
  for (const h of opened.splice(0)) h.closeAll();
});

function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-oauth-'));
  createSpace(home, 'Work');
  createSpace(home, 'Secret');
  const hub = Hub.open(home);
  opened.push(hub);
  hub.workspace('secret').create({ type: 'project', title: 'Hidden Thing' });
  hub.workspace('work').create({ type: 'project', title: 'Ledger' });
  return { home, hub, app: buildHttpApp(hub, { token: OWNER }) };
}

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

async function register(app: ReturnType<typeof buildHttpApp>) {
  const res = await app.request('/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { client_id: string; client_secret: string };
}

/** Drive the browser half of the flow and return the authorization code. */
async function authorize(
  app: ReturnType<typeof buildHttpApp>,
  client: { client_id: string },
  challenge: string,
  grant: string,
  ownerToken = OWNER,
) {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: CALLBACK,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'xyz',
  });
  const page = await app.request(`/oauth/authorize?${query}`);
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('wants to connect');

  const form = new FormData();
  for (const [k, v] of query) form.set(k, v);
  form.set('owner_token', ownerToken);
  form.set('grant', grant);
  return app.request('/oauth/authorize', { method: 'POST', body: form });
}

/** The authorization code out of the consent redirect. */
function codeFrom(redirect: Response): string {
  expect(redirect.status).toBe(302);
  const code = new URL(redirect.headers.get('location')!).searchParams.get('code');
  expect(code).toBeTruthy();
  return code!;
}

async function exchange(
  app: ReturnType<typeof buildHttpApp>,
  client: { client_id: string; client_secret: string },
  code: string,
  verifier: string,
) {
  const form = new FormData();
  form.set('grant_type', 'authorization_code');
  form.set('code', code);
  form.set('client_id', client.client_id);
  form.set('client_secret', client.client_secret);
  form.set('redirect_uri', CALLBACK);
  form.set('code_verifier', verifier);
  return app.request('/oauth/token', { method: 'POST', body: form });
}

describe('oauth', () => {
  it('advertises the metadata the MCP spec requires', async () => {
    const { app } = setup();
    const prm = await app.request('/.well-known/oauth-protected-resource', {
      headers: { host: 'wake.example.com', 'x-forwarded-proto': 'https' },
    }).then((r) => r.json());
    expect(prm.resource).toBe('https://wake.example.com/mcp');
    expect(prm.authorization_servers).toEqual(['https://wake.example.com']);

    const asm = await app.request('/.well-known/oauth-authorization-server', {
      headers: { host: 'wake.example.com', 'x-forwarded-proto': 'https' },
    }).then((r) => r.json());
    expect(asm.issuer).toBe('https://wake.example.com');
    expect(asm.code_challenge_methods_supported).toEqual(['S256']);
    expect(asm.registration_endpoint).toBe('https://wake.example.com/oauth/register');
    // also served at the /mcp-suffixed paths some clients probe
    expect((await app.request('/.well-known/oauth-protected-resource/mcp')).status).toBe(200);
  });

  it('registers a public client without a secret when one asks to be public', async () => {
    // An MCP connector redirects through a browser and has nowhere to keep a
    // secret, so it registers with token_endpoint_auth_method "none". Issuing
    // it a secret anyway means a client that never asked for one cannot
    // authenticate at the token endpoint — an interop break with nothing
    // gained, since PKCE already binds the code to the client.
    const { app } = setup();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Claude',
        redirect_uris: [CALLBACK],
        token_endpoint_auth_method: 'none',
      }),
    });
    expect(res.status).toBe(201);
    const client = (await res.json()) as { client_id: string; client_secret?: string; token_endpoint_auth_method: string };
    expect(client.client_secret).toBeUndefined();
    expect(client.token_endpoint_auth_method).toBe('none');

    // and the whole flow completes with no secret anywhere
    const { verifier, challenge } = pkce();
    const code = codeFrom(await authorize(app, client, challenge, '*'));
    const token = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CALLBACK,
        client_id: client.client_id,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);
    expect(((await token.json()) as { access_token?: string }).access_token).toBeTruthy();
  });

  it('still issues a secret to a client that does not ask to be public', async () => {
    const { app } = setup();
    const client = await register(app);
    expect(client.client_secret).toBeTruthy();
    // a confidential client that omits its secret is refused
    const { verifier, challenge } = pkce();
    const code = codeFrom(await authorize(app, client, challenge, '*'));
    const res = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: CALLBACK,
        client_id: client.client_id,
        code_verifier: verifier,
      }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client');
  });

  it('points an unauthorized MCP request at the metadata (RFC 9728)', async () => {
    const { app } = setup();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'wake.example.com', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer resource_metadata="https://wake.example.com/.well-known/oauth-protected-resource"',
    );
  });

  it('runs the whole flow: register, consent, PKCE exchange, authenticated call', async () => {
    const { app } = setup();
    const client = await register(app);
    const { verifier, challenge } = pkce();

    const redirect = await authorize(app, client, challenge, '*');
    expect(redirect.status).toBe(302);
    const location = new URL(redirect.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(CALLBACK);
    expect(location.searchParams.get('state')).toBe('xyz');
    const code = location.searchParams.get('code')!;
    expect(code).toBeTruthy();

    const tokens = (await exchange(app, client, code, verifier).then((r) => r.json())) as {
      access_token: string;
      refresh_token: string;
      token_type: string;
    };
    expect(tokens.token_type).toBe('Bearer');

    // the issued token works on the API and on MCP
    const home = await app.request('/api/s/work/home', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    expect(home.status).toBe(200);

    // and refreshes, rotating the refresh token
    const refreshForm = new FormData();
    refreshForm.set('grant_type', 'refresh_token');
    refreshForm.set('refresh_token', tokens.refresh_token);
    refreshForm.set('client_id', client.client_id);
    refreshForm.set('client_secret', client.client_secret);
    const refreshed = (await app
      .request('/oauth/token', { method: 'POST', body: refreshForm })
      .then((r) => r.json())) as { access_token: string };
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    const reuse = await app.request('/oauth/token', { method: 'POST', body: refreshForm });
    expect(reuse.status).toBe(400); // spent refresh tokens do not work twice
  });

  it('carries the consented space through as the grant', async () => {
    const { app } = setup();
    const client = await register(app);
    const { verifier, challenge } = pkce();
    const redirect = await authorize(app, client, challenge, 'work');
    const code = new URL(redirect.headers.get('location')!).searchParams.get('code')!;
    const tokens = (await exchange(app, client, code, verifier).then((r) => r.json())) as { access_token: string };
    const auth = { Authorization: `Bearer ${tokens.access_token}` };

    expect((await app.request('/api/s/work/home', { headers: auth })).status).toBe(200);
    expect((await app.request('/api/s/secret/home', { headers: auth })).status).toBe(404);
    const spaces = await app.request('/api/spaces', { headers: auth }).then((r) => r.json());
    expect(spaces.spaces.map((s: { slug: string }) => s.slug)).toEqual(['work']);
  });

  it('refuses the wrong owner token, a bad verifier, a reused code and a stray redirect_uri', async () => {
    const { app } = setup();
    const client = await register(app);
    const { verifier, challenge } = pkce();

    const wrongOwner = await authorize(app, client, challenge, '*', 'not-the-token');
    expect(wrongOwner.status).toBe(401);
    expect(await wrongOwner.text()).toContain('does not match');

    const redirect = await authorize(app, client, challenge, '*');
    const code = new URL(redirect.headers.get('location')!).searchParams.get('code')!;

    const badVerifier = await exchange(app, client, code, 'wrong-verifier');
    expect(badVerifier.status).toBe(400);
    expect((await badVerifier.json()).error).toBe('invalid_grant');
    // that attempt spent the code, so the correct verifier cannot replay it
    expect((await exchange(app, client, code, verifier)).status).toBe(400);

    const strayQuery = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: 'https://evil.example.com/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const stray = await app.request(`/oauth/authorize?${strayQuery}`);
    expect(stray.status).toBe(400);
    expect(await stray.text()).toContain('redirect_uri');
  });

  it('requires PKCE and rejects unregistered clients', async () => {
    const { app } = setup();
    const client = await register(app);
    const noPkce = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: CALLBACK,
    });
    expect((await app.request(`/oauth/authorize?${noPkce}`)).status).toBe(400);

    const unknown = new URLSearchParams({
      response_type: 'code',
      client_id: 'made-up',
      redirect_uri: CALLBACK,
      code_challenge: 'x',
      code_challenge_method: 'S256',
    });
    expect((await app.request(`/oauth/authorize?${unknown}`)).status).toBe(400);
  });

  it('rejects registration of a non-https redirect', async () => {
    const { app } = setup();
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_name: 'x', redirect_uris: ['http://evil.example.com/cb'] }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_client_metadata');
  });

  // RFC 8252 §7.1: an editor's MCP client catches the redirect on a private-use
  // scheme, not an https URL. Registering one used to 400, so the whole flow was
  // unreachable from Cursor and anything else shaped like it.
  it('registers a native client on a private-use scheme and authorizes it', async () => {
    const { app } = setup();
    const native = 'cursor://anysphere.cursor-mcp/oauth/callback';
    const res = await app.request('/oauth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Cursor',
        redirect_uris: [native],
        token_endpoint_auth_method: 'none',
      }),
    });
    expect(res.status).toBe(201);
    const client = (await res.json()) as { client_id: string };

    const { verifier, challenge } = pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: native,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const form = new FormData();
    for (const [k, v] of query) form.set(k, v);
    form.set('owner_token', OWNER);
    form.set('grant', '*');
    const redirect = await app.request('/oauth/authorize', { method: 'POST', body: form });

    // the consent redirect goes back out on the app's own scheme
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get('location')).toMatch(/^cursor:\/\//);

    // and the code it carries redeems for a working token
    const token = new FormData();
    token.set('grant_type', 'authorization_code');
    token.set('code', codeFrom(redirect));
    token.set('client_id', client.client_id);
    token.set('redirect_uri', native);
    token.set('code_verifier', verifier);
    const granted = await app.request('/oauth/token', { method: 'POST', body: token });
    expect(granted.status).toBe(200);
    expect((await granted.json()).access_token).toBeTruthy();
  });

  it('still refuses redirects a browser would execute', async () => {
    const { app } = setup();
    for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      const res = await app.request('/oauth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ client_name: 'x', redirect_uris: [uri] }),
      });
      expect(res.status, uri).toBe(400);
    }
  });

  it('stores tokens hashed, so the store leaks nothing usable', async () => {
    const { app, home } = setup();
    const client = await register(app);
    const { verifier, challenge } = pkce();
    const redirect = await authorize(app, client, challenge, '*');
    const code = new URL(redirect.headers.get('location')!).searchParams.get('code')!;
    const tokens = (await exchange(app, client, code, verifier).then((r) => r.json())) as {
      access_token: string;
      refresh_token: string;
    };
    const raw = fs.readFileSync(path.join(home, '.auth', 'oauth.json'), 'utf8');
    expect(raw).not.toContain(tokens.access_token);
    expect(raw).not.toContain(tokens.refresh_token);
    expect(raw).not.toContain(client.client_secret);
  });
});
