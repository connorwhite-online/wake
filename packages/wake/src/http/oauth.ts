import { Hono } from 'hono';
import type { Hub } from '../core/spaces.js';
import { OAuthProvider, ACCESS_TTL_S, safeEqual, type ClientRecord, type Grant } from '../core/oauth.js';

/** Callbacks Claude uses; anything else must arrive via client registration. */
const KNOWN_CALLBACKS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
];

/** Our public origin, honouring the proxy headers Fly/Railway set. */
export function publicOrigin(req: Request): string {
  if (process.env.WAKE_PUBLIC_URL) return process.env.WAKE_PUBLIC_URL.replace(/\/+$/, '');
  const url = new URL(req.url);
  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return `${proto}://${forwardedHost ?? url.host}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function consentPage(opts: {
  clientName: string;
  spaces: { slug: string; name: string }[];
  params: Record<string, string>;
  error?: string;
}): string {
  const hidden = Object.entries(opts.params)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join('');
  const spaceOptions = opts.spaces
    .map(
      (s) => `<label class="row">
        <input type="radio" name="grant" value="${escapeHtml(s.slug)}">
        <span><strong>${escapeHtml(s.name)}</strong><em>only this space</em></span>
      </label>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>wake — authorize</title>
<style>
  :root{--bg:oklch(.972 .005 95);--card:oklch(.998 .001 95);--ink:oklch(.24 .015 60);
    --soft:oklch(.5 .02 60);--faint:oklch(.66 .015 60);--rule:oklch(.915 .008 85);
    --accent:oklch(.58 .1 230);--accent-soft:oklch(.945 .025 230);--bad:oklch(.58 .14 25);}
  @media (prefers-color-scheme:dark){:root{--bg:oklch(.215 .012 265);--card:oklch(.265 .014 265);
    --ink:oklch(.93 .006 90);--soft:oklch(.72 .012 90);--faint:oklch(.55 .012 90);
    --rule:oklch(.34 .015 265);--accent:oklch(.75 .09 230);--accent-soft:oklch(.32 .04 230);}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:1.5rem;background:var(--bg);
    background-image:radial-gradient(60rem 30rem at 50% -12rem,oklch(.945 .02 75/.55),transparent 70%);
    color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;}
  .card{width:min(26rem,100%);background:var(--card);border-radius:24px;padding:1.5rem;
    box-shadow:0 2px 4px oklch(.2 .02 60/.06),0 12px 32px -8px oklch(.2 .02 60/.13);}
  .mark{display:flex;align-items:center;gap:.5rem;font-weight:700;font-size:1.2rem;margin-bottom:.35rem}
  .mark::before{content:"";width:21px;height:21px;border-radius:50%;
    background:radial-gradient(circle at 30% 25%,oklch(1 0 0/.65) 0%,transparent 32%),
      radial-gradient(circle at 32% 28%,oklch(.89 .1 230),oklch(.69 .17 208));}
  p{color:var(--soft);margin:.35rem 0 1rem}
  .who{font-weight:650;color:var(--ink)}
  fieldset{border:0;padding:0;margin:0 0 1rem}
  legend{font-size:.7rem;font-weight:650;letter-spacing:.13em;text-transform:uppercase;color:var(--faint);
    padding:0;margin-bottom:.5rem}
  .row{display:flex;align-items:center;gap:.6rem;padding:.6rem .7rem;border-radius:13px;cursor:pointer;
    transition:background .15s}
  .row:hover{background:var(--accent-soft)}
  .row span{display:flex;flex-direction:column}
  .row em{font-style:normal;font-size:.75rem;color:var(--faint)}
  input[type=radio]{accent-color:var(--accent);width:17px;height:17px}
  label.pw{display:block;font-size:.8rem;color:var(--faint);margin-bottom:.35rem}
  input[type=password]{width:100%;padding:.6rem .8rem;font:inherit;color:var(--ink);background:var(--bg);
    border:1px solid var(--rule);border-radius:999px;outline:none}
  input[type=password]:focus{border-color:var(--accent)}
  button{width:100%;margin-top:1rem;padding:.7rem;font:inherit;font-weight:650;cursor:pointer;
    color:oklch(.99 0 0);background:var(--accent);border:0;border-radius:999px;
    transition:transform .12s cubic-bezier(.34,1.56,.64,1)}
  button:active{transform:scale(.97)}
  .err{background:oklch(.96 .03 25);color:var(--bad);padding:.55rem .8rem;border-radius:13px;
    font-size:.85rem;margin-bottom:.9rem}
  @media (prefers-color-scheme:dark){.err{background:oklch(.3 .04 25);color:oklch(.85 .1 25)}}
  .foot{margin-top:1rem;font-size:.72rem;color:var(--faint);text-align:center}
</style></head>
<body><div class="card">
  <div class="mark">wake</div>
  <p><span class="who">${escapeHtml(opts.clientName)}</span> wants to connect to your workspace.</p>
  ${opts.error ? `<div class="err">${escapeHtml(opts.error)}</div>` : ''}
  <form method="post">
    ${hidden}
    <fieldset>
      <legend>what it may reach</legend>
      <label class="row">
        <input type="radio" name="grant" value="*" checked>
        <span><strong>All spaces</strong><em>everything you can see, including new spaces</em></span>
      </label>
      ${spaceOptions}
    </fieldset>
    <label class="pw" for="owner">confirm with your wake token</label>
    <input id="owner" type="password" name="owner_token" autocomplete="current-password" autofocus required>
    <button type="submit">Authorize</button>
  </form>
  <div class="foot">you can revoke this later with <code>wake clients revoke</code></div>
</div></body></html>`;
}

/**
 * OAuth 2.1 endpoints, so wake can be added as a custom Connector in the
 * Claude apps (that flow has no static-token path). wake is its own
 * authorization server; the owner token is the login, and consent is where
 * you choose which spaces the client gets.
 */
export function buildOAuth(hub: Hub, ownerToken: string | undefined): { app: Hono; provider: OAuthProvider } {
  const provider = new OAuthProvider(hub.home);
  const app = new Hono();

  const metadata = (c: { req: { raw: Request } }) => {
    const issuer = publicOrigin(c.req.raw);
    return {
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      registration_endpoint: `${issuer}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
      scopes_supported: ['wake'],
service_documentation: 'https://github.com/connorwhite-online/wake',
    };
  };

  // RFC 8414 — authorization server metadata
  app.get('/.well-known/oauth-authorization-server', (c) => c.json(metadata(c)));
  app.get('/.well-known/oauth-authorization-server/mcp', (c) => c.json(metadata(c)));
  app.get('/.well-known/openid-configuration', (c) => c.json(metadata(c)));

  // RFC 9728 — protected resource metadata (MUST for MCP servers)
  const resourceMetadata = (c: { req: { raw: Request } }) => {
    const issuer = publicOrigin(c.req.raw);
    return {
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['wake'],
    };
  };
  app.get('/.well-known/oauth-protected-resource', (c) => c.json(resourceMetadata(c)));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => c.json(resourceMetadata(c)));

  // RFC 7591 — dynamic client registration
  app.post('/oauth/register', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { redirect_uris?: unknown; client_name?: string } | null;
    if (!body) return c.json({ error: 'invalid_client_metadata', error_description: 'body must be JSON' }, 400);
    try {
      const client = provider.registerClient({
        client_name: body.client_name,
        redirect_uris: body.redirect_uris,
      });
      return c.json(
        {
          client_id: client.client_id,
          client_secret: client.client_secret,
          client_name: client.client_name,
          redirect_uris: client.redirect_uris,
          token_endpoint_auth_method: 'client_secret_post',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        },
        201,
      );
    } catch (err) {
      return c.json({ error: 'invalid_client_metadata', error_description: (err as Error).message }, 400);
    }
  });

  type AuthzCheck =
    | { ok: false; error: string }
    | { ok: true; client: ClientRecord; redirectUri: string };

  /** Shared validation for both the consent page and its submission. */
  const readAuthzParams = (params: Record<string, string>): AuthzCheck => {
    const client = provider.getClient(params.client_id ?? '');
    if (!client) return { ok: false, error: 'unknown client_id — register first' };
    const redirectUri = params.redirect_uri ?? '';
    const allowed = [...client.redirect_uris, ...KNOWN_CALLBACKS];
    if (!allowed.includes(redirectUri)) return { ok: false, error: 'redirect_uri does not match this client' };
    if (params.response_type !== 'code') return { ok: false, error: 'only response_type=code is supported' };
    if (params.code_challenge_method !== 'S256' || !params.code_challenge) {
      return { ok: false, error: 'PKCE with code_challenge_method=S256 is required' };
    }
    return { ok: true, client, redirectUri };
  };

  app.get('/oauth/authorize', (c) => {
    const params = c.req.query();
    const checked = readAuthzParams(params);
    if (!checked.ok) return c.text(checked.error, 400);
    if (!ownerToken) {
      return c.text('This wake has no WAKE_TOKEN set, so there is no owner to authorize as. Set one and restart.', 503);
    }
    return c.html(
      consentPage({
        clientName: checked.client.client_name,
        spaces: hub.spaces().map((s) => ({ slug: s.slug, name: s.name })),
        params,
      }),
    );
  });

  app.post('/oauth/authorize', async (c) => {
    const form = Object.fromEntries((await c.req.formData()).entries()) as Record<string, string>;
    const checked = readAuthzParams(form);
    if (!checked.ok) return c.text(checked.error, 400);

    const spaces = hub.spaces().map((s) => ({ slug: s.slug, name: s.name }));
    const rerender = (error: string) =>
      c.html(
        consentPage({
          clientName: checked.client.client_name,
          spaces,
          params: Object.fromEntries(Object.entries(form).filter(([k]) => k !== 'owner_token' && k !== 'grant')),
          error,
        }),
        401,
      );

    if (!ownerToken || !form.owner_token || !safeEqual(ownerToken, form.owner_token)) {
      return rerender('That token does not match. Try again.');
    }
    const requested = form.grant ?? '*';
    const grant: Grant = requested === '*' ? '*' : requested;
    if (grant !== '*' && !hub.info(grant)) return rerender('That space no longer exists.');

    const code = provider.issueCode({
      client_id: form.client_id,
      redirect_uri: checked.redirectUri,
      code_challenge: form.code_challenge,
      grant,
    });
    const location = new URL(checked.redirectUri);
    location.searchParams.set('code', code);
    if (form.state) location.searchParams.set('state', form.state);
    return c.redirect(location.toString(), 302);
  });

  app.post('/oauth/token', async (c) => {
    let form: Record<string, string>;
    try {
      form = Object.fromEntries((await c.req.formData()).entries()) as Record<string, string>;
    } catch {
      form = {};
    }
    // client_secret_basic, for clients that prefer the header
    const basic = c.req.header('authorization');
    if (basic?.startsWith('Basic ')) {
      const [id, secret] = Buffer.from(basic.slice(6), 'base64').toString('utf8').split(':');
      form.client_id ??= id;
      form.client_secret ??= secret;
    }
    try {
      const issued =
        form.grant_type === 'refresh_token'
          ? provider.refreshTokens({
              refresh_token: form.refresh_token ?? '',
              client_id: form.client_id ?? '',
              client_secret: form.client_secret,
            })
          : provider.redeemCode({
              code: form.code ?? '',
              client_id: form.client_id ?? '',
              client_secret: form.client_secret,
              redirect_uri: form.redirect_uri ?? '',
              code_verifier: form.code_verifier ?? '',
            });
      return c.json({ token_type: 'Bearer', scope: 'wake', ...issued, expires_in: ACCESS_TTL_S }, 200, {
        'Cache-Control': 'no-store',
      });
    } catch (err) {
      const message = (err as Error).message;
      const [code, ...rest] = message.split(': ');
      return c.json({ error: code || 'invalid_request', error_description: rest.join(': ') || message }, 400);
    }
  });

  return { app, provider };
}
