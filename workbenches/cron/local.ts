/**
 * Cron Workbench — launcher / Entry point.
 *
 * fai's workbench runner picks up the `export default` and instantiates
 * the workbench. OpenX Deploy passes `--mode Cron`, which resolves the
 * Cron mode registered below.
 *
 * ## What this sample demonstrates
 *
 * Track 6 Phase 11 delivers custom mode types — anyone can define a new
 * mode outside OpenX's built-ins (MCP / API / Web) and workbenches can
 * declare it just like the built-ins. This sample:
 *
 * 1. **`DefineModeHolon` primitive** (D.11.3) — see
 *    [./mode-holon.ts](./mode-holon.ts) for the Cron mode's definition.
 *
 * 2. **`eac.ModeHolons` registration** (D.11.1 + D.11.2) — the workspace
 *    admin writes `eac.ModeHolons['Cron'] = CronModeHolon.Binding`
 *    (once), then any workbench in that workspace can declare
 *    `Modes({ Cron: ... })`.
 *
 * 3. **SOP registry validation** (D.11.4) — attempting to deploy this
 *    workbench BEFORE registering `CronModeHolon.Binding` fails with
 *    `HostingStatus: Failed` and a clear "register your holon" error.
 *
 * @module
 */
import { Workbench, type WorkbenchBuilder } from '@fathym/fai/workbenches';
import { CronModeHolon } from './mode-holon.ts';

// EveryMs / HealthPort come from mode config (Details.Modes.Cron.Config), defaulting to 60s / 4970.
const workbench: WorkbenchBuilder = Workbench(
  'cron-sample',
  'Track 6 Phase 11 sample workbench demonstrating a custom Cron mode via DefineModeHolon.',
)
  .Modes({
    Cron: CronModeHolon.Mode(),
  });

export default workbench;
