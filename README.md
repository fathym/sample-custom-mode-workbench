# @fathym/sample-custom-mode-workbench

Track 6 Phase 11 sample workbench demonstrating a **custom mode type** authored with `DefineModeHolon`. Published to JSR as [`@fathym/sample-custom-mode-workbench`](https://jsr.io/@fathym/sample-custom-mode-workbench).

Sibling to [`sample-api-workbench`](https://github.com/fathym/sample-api-workbench) (Phase 9 API-mode sample), [`sample-ui-workbench`](https://github.com/fathym/sample-ui-workbench) (Phase 10 WebMode + Consumes sample), and [`hello-workbench`](https://github.com/fathym-deno/hello-workbench) (v1 MCP-mode reference).

## What it demonstrates

Phase 11 opens the door for community-defined mode types beyond OpenX's built-in MCP / API / Web. This sample walks the full path:

1. **`DefineModeHolon` primitive** (Phase 11 D.11.3) — [`workbenches/cron/mode-holon.ts`](./workbenches/cron/mode-holon.ts) defines a `Cron` mode. One `DefineModeHolon` call yields two outputs: a `ModeBuilder` factory (runtime behavior) and a `ModeHolonBinding` (workspace registration data).

2. **`eac.ModeHolons` registration** (Phase 11 D.11.1 + D.11.2) — a workspace admin writes `CronModeHolon.Binding` to `eac.ModeHolons['Cron']` once. That entry unlocks the mode Kind for every workbench in that workspace.

3. **SOP validation with clear failure** (Phase 11 D.11.4) — attempting to deploy this workbench BEFORE the registration step fails with `HostingStatus: Failed` and a message pointing to `eac.ModeHolons['Cron']`. Built-in MCP/API/Web modes bypass this check.

## The Cron mode itself

Kept **intentionally minimal** — this is a primitive demonstration, not a production Cron mode. The mode's `.Execute()`:

- Reads an `EveryMs` interval from mode-config.
- Starts a `setInterval` that logs a heartbeat every N ms. Visible in the Container App's stdout.
- Serves `GET /health` on `HealthPort` so the SOP readiness probe passes.
- Blocks on the HTTP server until the container is stopped.

A real Cron mode would parse cron expressions (or use `Deno.cron`), support multiple jobs, propagate handler errors, etc. Out of scope for a primitive demonstration.

## Deploy via OpenX

**One-time workspace admin step: register the mode holon.** Commit `CronModeHolon.Binding` (from [`mode-holon.ts`](./workbenches/cron/mode-holon.ts)) to the workspace's `eac.ModeHolons['Cron']` through the workspace commit endpoint, using a workspace JWT:

```
curl -sS -X POST '{workspace-origin}/api/workspaces/commit' \
  -H "Authorization: Bearer $OI_JWT" \
  -H 'Content-Type: application/json' \
  -d '{
    "deletes": {},
    "eac": {
      "EnterpriseLookup": "<workspace lookup>",
      "ModeHolons": {
        "Cron": {
          "Kind": "Cron",
          "ContractVersion": "1.0.0",
          "Entrypoint": "fai run <Entry> --mode Cron --config /fathym-ox/mode-config.json",
          "HealthEndpoint": "/health",
          "BuiltIn": false,
          "HolonRef": "https://github.com/fathym/sample-custom-mode-workbench/blob/main/workbenches/cron/mode-holon.ts",
          "Discovery": { "RenderCategory": "workbench-cron" }
        }
      }
    }
  }'
```

Reload the workspace afterwards — `Cron` then appears in the inspector's **Modes → Add mode** list. Until it is registered, only the built-in modes (API, Web, MCP) are offered.

**Then deploy the workbench:**

1. Drop a **SurfaceWorkbench** onto a surface. In the inspector:
   - **Source** tab: Repo `https://github.com/fathym/sample-custom-mode-workbench`, Ref `main`, Entry `workbenches/cron/local.ts`
   - **Hosting** tab: APISlug `cron-sample`
   - **Modes** tab: **Add mode** → `Cron`
2. Deploy. Once `HostingStatus` is `Running`, tail the Container App logs:
   ```
   [cron] starting, everyMs=60000, healthPort=4970
   [cron] tick @ 2026-08-21T00:15:00.000Z
   [cron] tick @ 2026-08-21T00:16:00.000Z
   ...
   ```

**Deploying WITHOUT the registration step** — the SOP short-circuits with:

```
Mode 'Cron' is not registered in this workspace. Built-in modes are MCP, API, Web.
Register a custom mode holon under eac.ModeHolons['Cron'] (Phase 11 D.11.1 primitive;
DefineModeHolon helper in '@fathym/fai/workbenches' emits the binding data) to enable
a workbench to declare it.
```

That's Phase 11 D.11.4 in action.

## Local run

Straight from JSR, no clone needed:

```
fai run jsr:@fathym/sample-custom-mode-workbench --mode Cron
```

Or from a clone:

```
deno task cron
```

Runs the Cron mode against a local `Deno.serve` on port 4970. `Ctrl+C` to stop.

## Related

- **Track 6 v2 execution tracker**: [`o-industrial/oi-core-pack#61`](https://github.com/o-industrial/oi-core-pack/issues/61)
- **Phase 11 spec** (on `fathym-dev-space`): [`.workbench/.workstreams/2026-04-06-NewNodeCapabilities/track-6-workbench-node/phase-11-custom-mode-types.md`](https://github.com/fathym-deno/fathym-dev-space/blob/feature/track-6-phases-9-10-11/.workbench/.workstreams/2026-04-06-NewNodeCapabilities/track-6-workbench-node/phase-11-custom-mode-types.md)
- **Phase 9 API-mode sample**: [`fathym/sample-api-workbench`](https://github.com/fathym/sample-api-workbench)
- **Phase 10 WebMode sample**: [`fathym/sample-ui-workbench`](https://github.com/fathym/sample-ui-workbench)
- **v1 MCP-mode reference sample**: [`fathym-deno/hello-workbench`](https://github.com/fathym-deno/hello-workbench)

## License

MIT
