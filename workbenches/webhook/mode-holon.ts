// deno-lint-ignore-file no-explicit-any
/**
 * WebhookModeHolon — a **custom** mode, defined outside OpenX's built-ins (MCP, API, Web).
 *
 * A mode is a way a workbench is served. This one serves a workbench as a webhook receiver:
 * something outside (GitHub, a payment provider, a device gateway) POSTs an event to it, the
 * mode checks the event was signed with a shared secret, and hands it to one of the
 * workbench's tools.
 *
 * ## What Webhook mode does
 *
 * When a workbench offers `Modes({ Webhook: ... })` and OpenX deploys it, the container runs
 * `fai run <entry> --mode Webhook --config <mode-config.json>`, which calls `.Execute()`:
 *
 * 1. Reads `Hooks` from the mode config: each hook is a name, the tool that receives its
 *    events, and the environment variable that holds its secret.
 * 2. Serves, on the port the workbench declared with `.Ports()`:
 *    - `POST /webhooks/<hook>`: checks `X-Hub-Signature-256` (HMAC-SHA256 of the raw body,
 *      the way GitHub signs), then calls `<Tool>.Receive(event)`.
 *    - `GET /health`: `200`, for OpenX's readiness check.
 * 3. Refuses a call it cannot trust, with a status that says why:
 *    - `401` when the signature is missing or does not match the body.
 *    - `500` when the hook names a secret that is not set: it fails closed, never open.
 *    - `404` for a hook it does not have, `405` for anything but POST, `400` for a body that
 *      is not JSON.
 *
 * This is a teaching example, kept small on purpose. A production receiver would also
 * de-duplicate redeliveries by `X-GitHub-Delivery`, answer fast and queue slow work, and
 * rotate secrets without a restart.
 *
 * @module
 */
import { z } from 'zod';
import { DefineModeHolon, ModeBuilder } from '@fathym/fai/workbenches';
import type { Bench, ModePort } from '@fathym/fai/workbenches';

/** One hook: where its events go, and where its secret is. */
export const WebhookHookSchema = z.object({
  Tool: z.string().describe(
    "The workbench tool (its key in `.Tools({...})`) whose `Receive(event)` gets this hook's events.",
  ),
  SecretEnv: z.string().optional().describe(
    'The environment variable holding the shared secret. When named, every call must carry a ' +
      'matching X-Hub-Signature-256; when left out, the hook accepts unsigned calls.',
  ),
});

export type WebhookHook = z.infer<typeof WebhookHookSchema>;

const DEFAULT_HOOKS: Record<string, WebhookHook> = {
  github: { Tool: 'GitHubEvents', SecretEnv: 'GITHUB_WEBHOOK_SECRET' },
};

/**
 * Webhook mode input — read from the mode config (`--config`, which OpenX fills from the
 * workbench's `Details.Modes.Webhook.Config`); the values reach `.Execute()` as `ctx.Input`.
 */
export const WebhookModeInputSchema = z.object({
  Hooks: z.record(z.string(), WebhookHookSchema).default(DEFAULT_HOOKS).describe(
    'The hooks this mode receives, by name: `POST /webhooks/<name>`.',
  ),
}).default({ Hooks: DEFAULT_HOOKS });

export type WebhookModeInput = z.infer<typeof WebhookModeInputSchema>;

/** What a tool's `Receive` is handed for each verified call. */
export type WebhookEvent = {
  /** The hook's name, from the path. */
  Hook: string;
  /** `X-GitHub-Event`, when the sender sets it (for example `push`). */
  Event?: string;
  /** `X-GitHub-Delivery`, the sender's id for this delivery. */
  Delivery?: string;
  /** The JSON body. */
  Payload: unknown;
};

/** A tool that can receive webhook events. */
type WebhookReceiver = { Receive?: (event: WebhookEvent) => Promise<unknown> };

/**
 * Whether `header` is `sha256=<hex>` of HMAC-SHA256(secret, body).
 *
 * `crypto.subtle.verify` compares the MACs, so there is no hand-written byte-by-byte comparison
 * here that could leak, through its timing, how much of a forged signature was right.
 */
export async function verifySignature(
  secret: string,
  body: Uint8Array<ArrayBuffer>,
  header: string,
): Promise<boolean> {
  const hex = /^sha256=([0-9a-f]{64})$/i.exec(header)?.[1];
  if (!hex) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signature = Uint8Array.from(hex.match(/../g)!, (pair) => parseInt(pair, 16));

  return await crypto.subtle.verify('HMAC', key, signature, body);
}

function answer(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The mode's request handler. Separate from `.Execute()` so it can be tested with plain
 * `Request`s, no port opened.
 *
 * @param hooks - The hooks, by name.
 * @param tools - The workbench's activated tools (`ctx.Tools`).
 * @param readEnv - Reads a secret's environment variable.
 */
export function createWebhookHandler(
  hooks: Record<string, WebhookHook>,
  tools: Record<string, unknown>,
  readEnv: (name: string) => string | undefined = (name) => Deno.env.get(name),
): (req: Request) => Promise<Response> {
  return async (req) => {
    const { pathname } = new URL(req.url);

    // OpenX's readiness check (any answer below 500 counts; this one is a plain 200).
    if (req.method === 'GET' && pathname === '/health') {
      return answer(200, { status: 'ok' });
    }

    const name = /^\/webhooks\/([^/]+)$/.exec(pathname)?.[1];
    const hook = name ? hooks[name] : undefined;
    if (!name || !hook) {
      return answer(404, { error: `There is no webhook at ${pathname}.` });
    }
    if (req.method !== 'POST') {
      return answer(405, { error: 'A webhook is received with POST.' });
    }

    // The signature is over the raw bytes, so read them before parsing anything.
    const body = new Uint8Array(await req.arrayBuffer());

    if (hook.SecretEnv) {
      const secret = readEnv(hook.SecretEnv);
      if (!secret) {
        return answer(500, {
          error: `Webhook '${name}' needs its secret in ${hook.SecretEnv}, which is not set.`,
        });
      }

      const signature = req.headers.get('X-Hub-Signature-256');
      if (!signature) {
        return answer(401, { error: 'Unsigned: X-Hub-Signature-256 is missing.' });
      }
      if (!(await verifySignature(secret, body, signature))) {
        return answer(401, {
          error: 'Bad signature: X-Hub-Signature-256 does not match the body.',
        });
      }
    }

    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return answer(400, { error: 'The body is not JSON.' });
    }

    const tool = tools[hook.Tool] as WebhookReceiver | undefined;
    if (typeof tool?.Receive !== 'function') {
      return answer(500, { error: `Tool '${hook.Tool}' has no Receive(event) method.` });
    }

    const event: WebhookEvent = {
      Hook: name,
      Event: req.headers.get('X-GitHub-Event') ?? undefined,
      Delivery: req.headers.get('X-GitHub-Delivery') ?? undefined,
      Payload: payload,
    };
    console.log(
      `[webhook] ${name} ${event.Event ?? 'event'} delivery=${
        event.Delivery ?? '-'
      } -> ${hook.Tool}.Receive`,
    );

    return answer(200, { received: true, result: await tool.Receive(event) });
  };
}

/**
 * The custom mode holon. A workbench passes `WebhookModeHolon.Mode()` to
 * `.Modes({ Webhook: ... })`; `Mode` is a factory, so each workbench gets its own builder.
 *
 * The first argument is the descriptor this fai version's `DefineModeHolon` still asks for.
 * OpenX no longer reads it: a mode is a name the package declares, and there is nothing to
 * register in a workspace before deploying.
 */
export const WebhookModeHolon = DefineModeHolon(
  {
    Kind: 'Webhook',
    ContractVersion: '1.0.0',
    Entrypoint: 'fai run <Entry> --mode Webhook --config /tmp/mode-config.json',
    HealthEndpoint: '/health',
    BuiltIn: false,
    HolonRef:
      'https://github.com/fathym/sample-custom-mode-workbench/blob/main/workbenches/webhook/mode-holon.ts',
  },
  () =>
    new ModeBuilder<WebhookModeInput, Bench>(
      'Webhook',
      'Receives signed webhooks at POST /webhooks/<hook> and hands each event to a tool.',
    )
      .Input(WebhookModeInputSchema)
      .Execute(async (ctx: any) => {
        const { Hooks } = ctx.Input as WebhookModeInput;

        // The port the workbench declared with `.Ports()`. OpenX sets that port's env var
        // (`PORT` unless the declaration names another) to the same number.
        const declared = Array.isArray(ctx.Ports)
          ? (ctx.Ports as ModePort[]).find((p) => p.Primary)
          : undefined;
        const port = Number(Deno.env.get(declared?.Env ?? 'PORT') ?? declared?.Port ?? 4970);

        for (const [name, hook] of Object.entries(Hooks)) {
          console.log(
            `[webhook] POST /webhooks/${name} -> ${hook.Tool}.Receive (${
              hook.SecretEnv ? `signed, secret in ${hook.SecretEnv}` : 'UNSIGNED calls accepted'
            })`,
          );
        }

        const server = Deno.serve(
          { port, onListen: () => console.log(`[webhook] listening on port ${port}`) },
          createWebhookHandler(Hooks, ctx.Tools ?? {}),
        );

        await server.finished;

        return {
          Vaults: {},
          Close: async () => {
            await server.shutdown();
          },
        } as Bench;
      }),
);
