/**
 * Webhook mode: what it accepts and what it refuses.
 *
 * The handler is driven directly with `Request` objects, so no port is opened. Each case is
 * paired with its near miss: the closest request that must get the other answer.
 *
 * @module
 */
import { assert, assertEquals } from '@std/assert';
import { createWebhookHandler, type WebhookEvent } from '../workbenches/webhook/mode-holon.ts';

const SECRET = 'It-is-a-secret-to-everybody';
const BODY = JSON.stringify({ ref: 'refs/heads/main', repository: { full_name: 'fathym/x' } });

/** `sha256=<hex>` over the body, the way GitHub signs a delivery. */
async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));

  return `sha256=${Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A handler with one signed hook, `github`, and a tool that records what it received. */
function setup(env: Record<string, string> = { GITHUB_WEBHOOK_SECRET: SECRET }) {
  const received: WebhookEvent[] = [];
  const handler = createWebhookHandler(
    { github: { Tool: 'GitHubEvents', SecretEnv: 'GITHUB_WEBHOOK_SECRET' } },
    {
      GitHubEvents: {
        Receive: (event: WebhookEvent) => {
          received.push(event);
          return Promise.resolve({ Seen: event.Event });
        },
      },
    },
    (name) => env[name],
  );

  return { handler, received };
}

function post(body: string, signature?: string, path = '/webhooks/github'): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-GitHub-Event': 'push',
    'X-GitHub-Delivery': 'delivery-1',
  };
  if (signature !== undefined) headers['X-Hub-Signature-256'] = signature;

  return new Request(`http://localhost${path}`, { method: 'POST', headers, body });
}

Deno.test('a correctly signed delivery reaches the tool; one changed byte is refused', async () => {
  const { handler, received } = setup();
  const signature = await sign(SECRET, BODY);

  const ok = await handler(post(BODY, signature));
  assertEquals(ok.status, 200);
  assertEquals(received, [{
    Hook: 'github',
    Event: 'push',
    Delivery: 'delivery-1',
    Payload: JSON.parse(BODY),
  }]);

  // Near miss: the same signature over a body with one character changed.
  const tampered = await handler(post(BODY.replace('main', 'mai_'), signature));
  assertEquals(tampered.status, 401);
  assertEquals(received.length, 1);
});

Deno.test('a delivery signed with another secret is refused; the right secret is not', async () => {
  const { handler, received } = setup();

  const bad = await handler(post(BODY, await sign('not-the-secret', BODY)));
  assertEquals(bad.status, 401);
  assert((await bad.text()).includes('does not match'));
  assertEquals(received.length, 0);

  // A header that is not `sha256=<64 hex>` is refused the same way.
  const sha1 = await handler(post(BODY, 'sha1=0123456789abcdef0123456789abcdef01234567'));
  assertEquals(sha1.status, 401);
  assertEquals(received.length, 0);

  // Near miss: the same request signed with the hook's secret.
  const good = await handler(post(BODY, await sign(SECRET, BODY)));
  assertEquals(good.status, 200);
  assertEquals(received.length, 1);
});

Deno.test('an unsigned delivery is refused; the same delivery signed is not', async () => {
  const { handler, received } = setup();

  const unsigned = await handler(post(BODY));
  assertEquals(unsigned.status, 401);
  assert((await unsigned.text()).includes('X-Hub-Signature-256 is missing'));
  assertEquals(received.length, 0);

  // Near miss: the same body with its signature.
  const signed = await handler(post(BODY, await sign(SECRET, BODY)));
  assertEquals(signed.status, 200);
  assertEquals(received.length, 1);
});

Deno.test('a hook whose secret is named but not set refuses every call, signed or not', async () => {
  const { handler, received } = setup({});

  const signed = await handler(post(BODY, await sign(SECRET, BODY)));
  assertEquals(signed.status, 500);
  assert((await signed.text()).includes('GITHUB_WEBHOOK_SECRET'));

  const unsigned = await handler(post(BODY));
  assertEquals(unsigned.status, 500);
  assertEquals(received.length, 0);
});

Deno.test('GET /health answers 200; near misses do not', async () => {
  const { handler } = setup();

  const health = await handler(new Request('http://localhost/health'));
  assertEquals(health.status, 200);
  assertEquals(await health.json(), { status: 'ok' });

  // Near misses: a trailing slash, and another method on the same path.
  assertEquals((await handler(new Request('http://localhost/health/'))).status, 404);
  assertEquals(
    (await handler(new Request('http://localhost/health', { method: 'POST' }))).status,
    404,
  );
});

Deno.test('an unknown hook is 404 and a GET on a known hook is 405', async () => {
  const { handler, received } = setup();
  const signature = await sign(SECRET, BODY);

  assertEquals((await handler(post(BODY, signature, '/webhooks/gitlab'))).status, 404);
  assertEquals(
    (await handler(new Request('http://localhost/webhooks/github'))).status,
    405,
  );
  assertEquals(received.length, 0);
});
