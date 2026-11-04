/**
 * Webhook Workbench — launcher / Entry point.
 *
 * fai's workbench runner picks up the `export default` and instantiates the workbench. OpenX
 * Deploy passes `--mode Webhook`, which runs the Webhook mode declared below.
 *
 * ## What this sample demonstrates
 *
 * A custom mode: a way of serving a workbench that OpenX does not ship (it ships MCP, API and
 * Web). [./mode-holon.ts](./mode-holon.ts) defines it with `DefineModeHolon`; this file is a
 * workbench that offers it, with one tool that receives the events:
 *
 * - `POST /webhooks/github` — a signed GitHub delivery, handed to `GitHubEvents.Receive`.
 * - `GET  /health`          — OpenX's readiness check.
 *
 * @module
 */
import { Workbench, type WorkbenchBuilder } from '@fathym/fai/workbenches';
import { Tool } from '@fathym/fai/tools';
import { z } from 'zod';
import { type WebhookEvent, WebhookModeHolon } from './mode-holon.ts';

/** The tool the `github` hook hands its events to. It logs one line per event. */
const GitHubEventsTool = Tool(
  'github-events',
  'Receives verified GitHub webhook deliveries.',
)
  .Handle(z.object({
    Receive: z.function({
      input: z.tuple([z.custom<WebhookEvent>()]),
      output: z.promise(z.object({ Seen: z.string() })),
    }).describe('Handle one verified webhook event.'),
  }))
  .Execute((_ctx) =>
    Promise.resolve({
      Receive: (event: WebhookEvent) => {
        const payload = (event.Payload ?? {}) as {
          repository?: { full_name?: string };
          sender?: { login?: string };
        };
        const seen = `${event.Event ?? 'event'} on ${
          payload.repository?.full_name ?? 'unknown repo'
        } by ${payload.sender?.login ?? 'unknown sender'}`;
        console.log(`[github-events] ${seen}`);

        return Promise.resolve({ Seen: seen });
      },
    })
  );

// Hooks come from mode config (Details.Modes.Webhook.Config); by default one hook, `github`,
// signed with the secret in GITHUB_WEBHOOK_SECRET.
const workbench: WorkbenchBuilder = Workbench(
  'webhook-sample',
  'Sample workbench demonstrating a custom Webhook mode via DefineModeHolon.',
)
  .Tools({ GitHubEvents: GitHubEventsTool })
  .Modes({
    // Webhook serves `/webhooks/<hook>` and `/health` on 4970: the port OpenX routes to.
    Webhook: WebhookModeHolon.Mode().Ports(4970),
  });

export default workbench;
