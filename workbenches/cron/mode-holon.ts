// deno-lint-ignore-file no-explicit-any
/**
 * CronModeHolon — a **custom** mode type defined outside OpenX's built-ins.
 *
 * Demonstrates Track 6 Phase 11 D.11.3: the `DefineModeHolon` primitive
 * pairs a `ModeBuilder` factory (the runtime behavior) with a
 * `ModeHolonBinding` (the workspace-facing registration data that
 * satisfies Phase 11 D.11.1's `EaCModeHolon` shape). One declaration,
 * two outputs.
 *
 * ## What Cron mode does
 *
 * When OpenX deploys a workbench with `Modes({ Cron: ... })`, the
 * container runs `fai run <entry> --mode Cron`, which resolves this
 * mode's `.Execute()`. Execute:
 *
 * 1. Reads `EveryMs` from the mode's Input (populated from the
 *    workbench's `Details.Modes.Cron.Config`).
 * 2. Starts a `setInterval` loop that logs a heartbeat every N ms.
 *    Visible in the Container App's stdout.
 * 3. Serves `GET /health` on `HealthPort` so the SOP readiness probe
 *    passes (contract with Track 6 Phase 4).
 * 4. Blocks on the HTTP server until the container is stopped.
 *
 * This is a **primitive demonstration** — a real Cron mode would parse
 * cron expressions (or use `Deno.cron`), support multiple jobs per
 * workbench, propagate errors, etc.
 *
 * ## How to register in a workspace
 *
 * ```typescript
 * import { CronModeHolon } from 'https://raw.githubusercontent.com/fathym/sample-custom-mode-workbench/main/workbenches/cron/mode-holon.ts';
 *
 * eac.ModeHolons ??= {};
 * eac.ModeHolons['Cron'] = CronModeHolon.Binding;
 * ```
 *
 * Once registered, any workbench in that workspace can declare
 * `Modes({ Cron: CronModeHolon.Mode() })`.
 *
 * ## What happens without registration
 *
 * The SOP's `validateModeIsRegistered` (Phase 11 D.11.4) rejects the
 * deploy: `HostingStatus: Failed` with `Mode 'Cron' is not registered
 * in this workspace. Built-in modes are MCP, API, Web. Register a
 * custom mode holon under eac.ModeHolons['Cron']...`. Built-in
 * MCP/API/Web modes are exempt from this check.
 *
 * @module
 */
import { z } from 'zod';
import { DefineModeHolon, ModeBuilder } from '@fathym/fai/workbenches';
import type { Bench } from '@fathym/fai/workbenches';

/**
 * Cron mode input — read from the mode config (`--config` /
 * `Details.Modes.Cron.Config`); the values reach `.Execute()` via `ctx.Input`.
 */
export const CronModeInputSchema = z.object({
  EveryMs: z.number().int().positive().default(60_000).describe(
    'Interval between heartbeat ticks, in milliseconds.',
  ),
  HealthPort: z.number().int().positive().default(4970).describe(
    'HTTP port to serve `/health` on for the SOP readiness probe.',
  ),
}).default({ EveryMs: 60_000, HealthPort: 4970 });

export type CronModeInput = z.infer<typeof CronModeInputSchema>;

/**
 * The custom mode holon. One `DefineModeHolon` call, two outputs:
 *
 * - `CronModeHolon.Binding` — the `ModeHolonBinding` an admin writes to
 *   `eac.ModeHolons['Cron']`. Frozen; safe to share.
 * - `CronModeHolon.Mode` — the `ModeBuilder` factory a workbench passes
 *   to `.Modes({ Cron: CronModeHolon.Mode() })`.
 *   Called per-workbench so each gets its own builder.
 */
export const CronModeHolon = DefineModeHolon(
  {
    Kind: 'Cron',
    ContractVersion: '1.0.0',
    Entrypoint: 'fai run <Entry> --mode Cron --config /fathym-ox/mode-config.json',
    HealthEndpoint: '/health',
    BuiltIn: false,
    HolonRef:
      'https://github.com/fathym/sample-custom-mode-workbench/blob/main/workbenches/cron/mode-holon.ts',
    Discovery: {
      RenderCategory: 'workbench-cron',
    },
  },
  () =>
    new ModeBuilder<CronModeInput, Bench>(
      'Cron',
      'Runs a heartbeat at a fixed interval; serves /health for readiness.',
    )
      .Input(CronModeInputSchema)
      .Execute(async (ctx: any) => {
        const { EveryMs, HealthPort } = ctx.Input;
        console.log(`[cron] starting, everyMs=${EveryMs}, healthPort=${HealthPort}`);

        const timer = setInterval(() => {
          console.log(`[cron] tick @ ${new Date().toISOString()}`);
        }, EveryMs);

        const server = Deno.serve(
          { port: HealthPort, onListen: () => {} },
          (req) => {
            const url = new URL(req.url);
            if (url.pathname === '/health') {
              return new Response('OK', { status: 200 });
            }
            return new Response('Not Found', { status: 404 });
          },
        );

        await server.finished;
        clearInterval(timer);

        return {
          Vaults: {},
          Close: async () => {
            clearInterval(timer);
            await server.shutdown();
          },
        } as Bench;
      }),
);
