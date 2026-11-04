# @fathym/sample-custom-mode-workbench

Sample workbench demonstrating a **custom mode** authored with `DefineModeHolon`: a **Webhook** mode that receives signed webhooks and hands each event to a workbench tool. Published to JSR as [`@fathym/sample-custom-mode-workbench`](https://jsr.io/@fathym/sample-custom-mode-workbench).

Sibling to [`sample-api-workbench`](https://github.com/fathym/sample-api-workbench) (API mode), [`sample-ui-workbench`](https://github.com/fathym/sample-ui-workbench) (Web mode + Consumes), and [`hello-workbench`](https://github.com/fathym-deno/hello-workbench) (MCP mode).

## What a mode is

A mode is a way a workbench is **served**. OpenX ships three: MCP (tools for an AI client), API (tools as REST routes) and Web (a UI). A custom mode is one more way, written by you: it decides what the workbench listens for and what it does with each call.

This sample's mode listens for webhooks: GitHub (or anything that signs the same way) POSTs an event, the mode checks the signature, and a tool handles the event.

### Why not a scheduled job?

An earlier version of this sample had a scheduled mode that logged a tick every minute and answered `/health`. It was a misleading example: a schedule is something a workbench **does**, not a way it is **served**. Nothing called it, so it had no endpoint to speak of. A webhook receiver is a real way to serve a workbench: it has an address, callers, and a contract for who may call it.

## What it demonstrates

1. **`DefineModeHolon`** — [`workbenches/webhook/mode-holon.ts`](./workbenches/webhook/mode-holon.ts) defines the `Webhook` mode once; `WebhookModeHolon.Mode()` hands any workbench a fresh `ModeBuilder` for it.
2. **A workbench offering it** — [`workbenches/webhook/local.ts`](./workbenches/webhook/local.ts) declares `.Modes({ Webhook: WebhookModeHolon.Mode().Ports(4970) })` and one tool, `GitHubEvents`, that receives the events.
3. **Signature checks** — every call to a hook that names a secret must carry `X-Hub-Signature-256`, the HMAC-SHA256 of the raw body, as GitHub sends it.

There is nothing to register in the workspace first. A mode is a name the package declares: OpenX reads the package's modes when you load it, and deploys any mode it declares.

## The Webhook mode

| Route                   | What it does                                                                |
| ----------------------- | --------------------------------------------------------------------------- |
| `POST /webhooks/<hook>` | Checks the signature, then calls `<Tool>.Receive(event)` and answers `200`. |
| `GET  /health`          | `200 {"status":"ok"}` for OpenX's readiness check.                          |

What it refuses, and how:

| Call                                                 | Answer                  |
| ---------------------------------------------------- | ----------------------- |
| No `X-Hub-Signature-256`                             | `401`                   |
| A signature that does not match the body             | `401`                   |
| A hook that names a secret whose variable is not set | `500` (it fails closed) |
| A hook it does not have                              | `404`                   |
| Anything but `POST` on a hook                        | `405`                   |
| A body that is not JSON                              | `400`                   |

The tool gets `{ Hook, Event, Delivery, Payload }`: the hook's name, `X-GitHub-Event`, `X-GitHub-Delivery`, and the parsed body.

### Mode config

Hooks come from the mode config (`Details.Modes.Webhook.Config` on the workbench). The default is one hook:

```json
{
  "Hooks": {
    "github": { "Tool": "GitHubEvents", "SecretEnv": "GITHUB_WEBHOOK_SECRET" }
  }
}
```

`SecretEnv` names the environment variable that holds the secret, never the secret itself. Leave it out and that hook accepts unsigned calls (useful only on your own machine).

It is kept small on purpose. A production receiver would also de-duplicate redeliveries by `X-GitHub-Delivery`, answer fast and queue slow work, and rotate secrets without a restart.

## Run it locally

Pick a secret and start the mode, straight from JSR:

```
export GITHUB_WEBHOOK_SECRET=It-is-a-secret-to-everybody
fai run jsr:@fathym/sample-custom-mode-workbench --mode Webhook
```

or from a clone:

```
export GITHUB_WEBHOOK_SECRET=It-is-a-secret-to-everybody
deno task webhook
```

It listens on `http://localhost:4970` (or `$PORT` when set). You should see:

```
[webhook] POST /webhooks/github -> GitHubEvents.Receive (signed, secret in GITHUB_WEBHOOK_SECRET)
[webhook] listening on port 4970
```

### Send a test webhook

Sign a body the way GitHub does, and post it:

```
BODY='{"repository":{"full_name":"fathym/sample-custom-mode-workbench"},"sender":{"login":"you"}}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$GITHUB_WEBHOOK_SECRET" | sed 's/^.* //')"

curl -i -X POST http://localhost:4970/webhooks/github \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: push' \
  -H 'X-GitHub-Delivery: test-1' \
  -H "X-Hub-Signature-256: $SIG" \
  -d "$BODY"
# → 200 {"received":true,"result":{"Seen":"push on fathym/sample-custom-mode-workbench by you"}}
```

The mode logs:

```
[webhook] github push delivery=test-1 -> GitHubEvents.Receive
[github-events] push on fathym/sample-custom-mode-workbench by you
```

Now try the refusals:

```
# No signature → 401 Unsigned: X-Hub-Signature-256 is missing.
curl -i -X POST http://localhost:4970/webhooks/github -H 'Content-Type: application/json' -d "$BODY"

# Wrong signature → 401 Bad signature: X-Hub-Signature-256 does not match the body.
curl -i -X POST http://localhost:4970/webhooks/github -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: sha256=$(printf '0%.0s' {1..64})" -d "$BODY"

# Readiness → 200 {"status":"ok"}
curl -i http://localhost:4970/health
```

## Deploy via OpenX

1. Drop a **SurfaceWorkbench** onto a surface. In the inspector:
   - **Source** tab: Repo `https://github.com/fathym/sample-custom-mode-workbench`, Ref `main`, Entry `workbenches/webhook/local.ts` (or the JSR package `@fathym/sample-custom-mode-workbench`).
   - **Modes** tab: once the package's modes load, `Webhook` is listed. Enable it.
   - **Hosting** tab: APISlug `webhook-sample`.
   - **Environment** tab: add `GITHUB_WEBHOOK_SECRET` with your secret. Every environment value is injected into the container as a secret.
2. Save, then Deploy. Once `HostingStatus` is `Running`, the Hosting tab shows the mode's address:

   ```
   Webhook: {workspace-origin}/ox-api/w/{workspace}/workbenches/webhook-sample/Webhook
   ```

   The container's logs show the two `[webhook]` start lines above.
3. Point the sender at `{that address}/webhooks/github`. In GitHub: the repo's **Settings → Webhooks → Add webhook**, Payload URL as above, Content type `application/json`, Secret the same value as `GITHUB_WEBHOOK_SECRET`.

**Who can reach it.** The workspace's door signs callers in with OpenX before it forwards them, and a webhook sender has no OpenX sign-in. For GitHub to reach the mode, the workspace owner detaches this endpoint from the workspace's sign-in (the workspace API settings' endpoint identity: this workbench, mode `Webhook`, `detached`). A detached endpoint signs its own callers in, which is what the signature check does. While the endpoint is still linked, you can send the test webhook above to the address with your own OpenX bearer token added: the door checks the token, removes it, and the mode still checks the signature.

## Related

- **API-mode sample**: [`fathym/sample-api-workbench`](https://github.com/fathym/sample-api-workbench)
- **Web-mode sample**: [`fathym/sample-ui-workbench`](https://github.com/fathym/sample-ui-workbench)
- **MCP-mode sample**: [`fathym-deno/hello-workbench`](https://github.com/fathym-deno/hello-workbench)
- **GitHub: validating webhook deliveries**: [docs.github.com](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

## License

MIT
