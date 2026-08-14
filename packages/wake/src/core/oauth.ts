import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * OAuth 2.1 for a single-owner server. wake is both the resource server and
 * its own authorization server: "logging in" means proving you hold the
 * owner token, and consent is where you choose which spaces a client gets.
 *
 * Access tokens are opaque and stored hashed, so they can be revoked and a
 * leaked store yields nothing usable.
 */

export const ACCESS_TTL_S = 60 * 60; // 1 hour
export const REFRESH_TTL_S = 60 * 60 * 24 * 60; // 60 days
const CODE_TTL_MS = 60_000;

/** '*' = every space; otherwise the single space slug this grant covers. */
export type Grant = '*' | string;

export interface ClientRecord {
  client_id: string;
  client_secret_hash?: string;
  client_name: string;
  redirect_uris: string[];
  created: string;
}

interface TokenRecord {
  client_id: string;
  grant: Grant;
  expires: number;
}

interface Store {
  clients: Record<string, ClientRecord>;
  tokens: Record<string, TokenRecord>;
  refresh: Record<string, TokenRecord>;
}

interface PendingCode {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  grant: Grant;
  expires: number;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function token(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Constant-time compare that tolerates length differences. */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** Schemes a browser would execute rather than merely navigate to. */
const UNSAFE_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']);
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/**
 * RFC 8252 gives a native app two ways to catch the redirect: a loopback
 * address (§7.3) and a private-use URI scheme it registers with the OS (§7.1 —
 * `cursor://…`, `com.example.app:/cb`). An editor embedding an MCP client uses
 * the second, so accepting only https and loopback turns a conforming client
 * away at registration.
 *
 * What actually protects a private-use scheme is PKCE, not the scheme check:
 * another app on the same machine can claim the same scheme and race for the
 * redirect, which is why /authorize requires S256 unconditionally. So this only
 * has to keep out URLs that would execute in the browser instead of navigating.
 */
export function assertUsableRedirect(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`invalid redirect_uri: ${uri}`);
  }
  if (UNSAFE_SCHEMES.has(parsed.protocol)) {
    throw new Error(`redirect_uri may not use ${parsed.protocol} ${uri}`);
  }
  if (parsed.protocol === 'https:') return;
  // plaintext http is for native loopback only, never a remote host
  if (parsed.protocol === 'http:') {
    if (LOOPBACK_HOSTS.includes(parsed.hostname)) return;
    throw new Error(`redirect_uri must use https or loopback: ${uri}`);
  }
  // anything else is a private-use scheme; require it to be a well-formed one
  if (!/^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol)) {
    throw new Error(`invalid redirect_uri scheme: ${uri}`);
  }
}

export class OAuthProvider {
  private store: Store = { clients: {}, tokens: {}, refresh: {} };
  /** Authorization codes live in memory: 60s TTL, single use. */
  private codes = new Map<string, PendingCode>();
  private file: string;

  constructor(homeDir: string) {
    this.file = path.join(homeDir, '.auth', 'oauth.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<Store>;
      this.store = {
        clients: raw.clients ?? {},
        tokens: raw.tokens ?? {},
        refresh: raw.refresh ?? {},
      };
    } catch {
      // no store yet
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.store, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  private sweep(): void {
    const now = Date.now();
    let dirty = false;
    for (const [key, rec] of Object.entries(this.store.tokens)) {
      if (rec.expires < now) {
        delete this.store.tokens[key];
        dirty = true;
      }
    }
    for (const [key, rec] of Object.entries(this.store.refresh)) {
      if (rec.expires < now) {
        delete this.store.refresh[key];
        dirty = true;
      }
    }
    for (const [code, rec] of this.codes) if (rec.expires < now) this.codes.delete(code);
    if (dirty) this.save();
  }

  // ---------- clients (RFC 7591) ----------

  /**
   * RFC 7591 dynamic registration.
   *
   * A client that asks for `token_endpoint_auth_method: "none"` is a public
   * client — the shape an MCP connector takes, since it redirects through a
   * browser and has nowhere to keep a secret. Honour that rather than issuing
   * a secret anyway: PKCE already binds the code to the client, and a client
   * hard-coded as public will not send a secret it never asked for, so forcing
   * one is an interop failure with nothing gained.
   */
  registerClient(input: {
    client_name?: string;
    redirect_uris: unknown;
    token_endpoint_auth_method?: unknown;
  }): ClientRecord & { client_secret?: string } {
    const uris = Array.isArray(input.redirect_uris)
      ? input.redirect_uris.filter((u): u is string => typeof u === 'string')
      : [];
    if (!uris.length) throw new Error('redirect_uris is required');
    for (const uri of uris) assertUsableRedirect(uri);
    const isPublic = input.token_endpoint_auth_method === 'none';
    const secret = isPublic ? undefined : token(24);
    const record: ClientRecord = {
      client_id: token(16),
      client_secret_hash: secret ? sha256(secret) : undefined,
      client_name: typeof input.client_name === 'string' ? input.client_name.slice(0, 120) : 'unnamed client',
      redirect_uris: uris,
      created: new Date().toISOString(),
    };
    this.store.clients[record.client_id] = record;
    this.save();
    return { ...record, client_secret: secret };
  }

  getClient(clientId: string): ClientRecord | undefined {
    return this.store.clients[clientId];
  }

  listClients(): ClientRecord[] {
    return Object.values(this.store.clients);
  }

  private checkClientSecret(client: ClientRecord, presented: string | undefined): boolean {
    if (!client.client_secret_hash) return true; // public client
    if (!presented) return false;
    return safeEqual(client.client_secret_hash, sha256(presented));
  }

  // ---------- authorization code + PKCE ----------

  issueCode(input: { client_id: string; redirect_uri: string; code_challenge: string; grant: Grant }): string {
    const code = token(24);
    this.codes.set(code, { ...input, expires: Date.now() + CODE_TTL_MS });
    return code;
  }

  /** Redeem a code: single use, PKCE-verified, redirect_uri must match. */
  redeemCode(input: {
    code: string;
    client_id: string;
    client_secret?: string;
    redirect_uri: string;
    code_verifier: string;
  }): { access_token: string; refresh_token: string; expires_in: number } {
    this.sweep();
    const pending = this.codes.get(input.code);
    if (!pending) throw new Error('invalid_grant: unknown or expired code');
    this.codes.delete(input.code); // single use, even on failure below
    if (pending.expires < Date.now()) throw new Error('invalid_grant: code expired');
    if (pending.client_id !== input.client_id) throw new Error('invalid_grant: client mismatch');
    if (pending.redirect_uri !== input.redirect_uri) throw new Error('invalid_grant: redirect_uri mismatch');

    const client = this.getClient(input.client_id);
    if (!client) throw new Error('invalid_client: unknown client');
    if (!this.checkClientSecret(client, input.client_secret)) throw new Error('invalid_client: bad secret');

    const challenge = crypto.createHash('sha256').update(input.code_verifier).digest('base64url');
    if (challenge !== pending.code_challenge) throw new Error('invalid_grant: PKCE verification failed');

    return this.mintTokens(input.client_id, pending.grant);
  }

  private mintTokens(clientId: string, grant: Grant): { access_token: string; refresh_token: string; expires_in: number } {
    const access = token();
    const refresh = token();
    this.store.tokens[sha256(access)] = {
      client_id: clientId,
      grant,
      expires: Date.now() + ACCESS_TTL_S * 1000,
    };
    this.store.refresh[sha256(refresh)] = {
      client_id: clientId,
      grant,
      expires: Date.now() + REFRESH_TTL_S * 1000,
    };
    this.save();
    return { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_S };
  }

  refreshTokens(input: { refresh_token: string; client_id: string; client_secret?: string }) {
    this.sweep();
    const key = sha256(input.refresh_token);
    const record = this.store.refresh[key];
    if (!record) throw new Error('invalid_grant: unknown refresh token');
    if (record.client_id !== input.client_id) throw new Error('invalid_grant: client mismatch');
    const client = this.getClient(input.client_id);
    if (!client) throw new Error('invalid_client: unknown client');
    if (!this.checkClientSecret(client, input.client_secret)) throw new Error('invalid_client: bad secret');
    // rotate: a refresh token is spent when used
    delete this.store.refresh[key];
    return this.mintTokens(record.client_id, record.grant);
  }

  /** What an access token may reach, or null if it is unknown or expired. */
  validate(accessToken: string): Grant | null {
    const record = this.store.tokens[sha256(accessToken)];
    if (!record) return null;
    if (record.expires < Date.now()) {
      delete this.store.tokens[sha256(accessToken)];
      this.save();
      return null;
    }
    return record.grant;
  }

  /** Drop every token for a client — the revoke path for a connector you removed. */
  revokeClient(clientId: string): number {
    let removed = 0;
    for (const [key, rec] of Object.entries(this.store.tokens)) {
      if (rec.client_id === clientId) {
        delete this.store.tokens[key];
        removed++;
      }
    }
    for (const [key, rec] of Object.entries(this.store.refresh)) {
      if (rec.client_id === clientId) {
        delete this.store.refresh[key];
        removed++;
      }
    }
    delete this.store.clients[clientId];
    this.save();
    return removed;
  }
}
