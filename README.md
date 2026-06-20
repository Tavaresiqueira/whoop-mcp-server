# WHOOP MCP Server

WHOOP MCP Server exposes WHOOP recovery, sleep, strain, and workout metrics to MCP-compatible AI assistants. It mirrors the local Garmin MCP server workflow: run a one-time login, cache tokens locally, build the TypeScript server, and connect it to an MCP client over stdio.

## Capabilities

- Fetch daily WHOOP wellbeing snapshots
- Summarize recovery score, HRV, resting heart rate, SpO2, skin temperature, sleep performance, sleep stages, day strain, and workouts
- Analyze short-term versus long-term recovery trends
- Compute personal baseline ranges over historical windows
- Highlight meaningful changes versus yesterday and baseline
- Recommend an appropriate workload level from current recovery signals
- Cache and refresh WHOOP OAuth tokens locally

## MCP Tools

| Tool | Description |
| --- | --- |
| `whoop_training_load_trend` | Returns 7-day versus 28-day trends for sleep, sleep performance, recovery, HRV, resting heart rate, and day strain. |
| `whoop_baseline_profile` | Computes personal baseline ranges for WHOOP recovery metrics over a historical window. |
| `whoop_change_alerts` | Highlights meaningful daily changes such as sleep drops, recovery dips, HRV dips, and resting heart rate spikes. |
| `whoop_wellbeing_snapshot` | Returns a concise daily snapshot with recovery metrics and workload recommendation. |
| `whoop_workload_guard` | Evaluates a proposed workload against current WHOOP recovery signals. |
| `whoop_sleep_summary` | Returns focused sleep and recovery context for a given date. |

## Installation

```powershell
npm install
```

## Authentication

WHOOP uses OAuth 2.0 Authorization Code flow. It cannot log in with a WHOOP email and password from the terminal the way Garmin can. For WHOOP, you first create a small app in the WHOOP Developer Dashboard, then this project opens the browser login and stores reusable local tokens.

For a non-programmer setup, use the terminal wizard:

```powershell
npm run setup
```

`npm run login` does the same thing.

Before running it, create an app at:

```text
https://developer-dashboard.whoop.com
```

In that WHOOP app:

1. Copy the Client ID.
2. Copy the Client Secret.
3. Add this redirect URI:

```text
whoop://mcp/callback
```

Then run `npm run setup` and paste what the wizard asks for.

WHOOP's public docs describe redirect URLs in the form `https://...` or `whoop://...`. For custom-scheme redirects like the default above, the login command asks you to paste the final redirected URL from the browser after approval. If your WHOOP app accepts a loopback URI such as `http://127.0.0.1:8787/callback`, the login command can capture the code automatically with its temporary local callback server.

The setup command:

1. Prompts for your WHOOP Client ID.
2. Prompts for your WHOOP Client Secret without echoing it to the terminal.
3. Prompts for redirect URI, token cache folder, and OAuth scopes with sensible defaults.
4. Opens the WHOOP authorization page.
5. Exchanges the authorization code for access and refresh tokens.
6. Writes reusable tokens to `.whoop-tokens/tokens.json` by default.
7. Offers to save the MCP refresh settings into local `.env`.

The local `.env` file is ignored by git. Saving it is recommended for local use because the MCP server needs `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` when refreshing tokens.

After setup, build the server:

```powershell
npm run build
```

## Environment Variables

The setup wizard can create `.env` for you. Create or edit it manually only if you want to customize settings:

```powershell
Copy-Item .env.example .env
```

Supported variables:

| Variable | Purpose |
| --- | --- |
| `WHOOP_CLIENT_ID` | OAuth Client ID from the WHOOP Developer Dashboard. Required for login and token refresh. |
| `WHOOP_CLIENT_SECRET` | OAuth Client Secret from the WHOOP Developer Dashboard. Required for login and token refresh. |
| `WHOOP_REDIRECT_URI` | Registered OAuth redirect URI. Defaults to `whoop://mcp/callback`. |
| `WHOOP_TOKEN_DIR` | Directory used to read/write WHOOP OAuth tokens. Defaults to `.whoop-tokens`. |
| `WHOOP_SCOPES` | Space- or comma-separated OAuth scopes. Defaults to profile, body measurement, recovery, cycles, sleep, workout, and offline. |

Default scopes:

```text
read:profile read:body_measurement read:recovery read:cycles read:sleep read:workout offline
```

The `offline` scope is important because WHOOP only returns a refresh token when that scope is requested.

## Verify Locally

After logging in and building, run:

```powershell
npm run typecheck
npm run build
npm run start
```

`npm run start` launches the MCP server over stdio. It will wait for an MCP client to speak the protocol, so it may appear idle in a normal terminal.

## Codex Configuration Example

```toml
[mcp_servers.whoop]
command = "node"
args = ["C:\\path\\to\\whoop-mcp-server\\dist\\index.js"]

[mcp_servers.whoop.env]
WHOOP_CLIENT_ID = "your-client-id"
WHOOP_CLIENT_SECRET = "your-client-secret"
WHOOP_TOKEN_DIR = "C:\\path\\to\\whoop-mcp-server\\.whoop-tokens"
```

Restart Codex after updating the config. Once loaded, the WHOOP tools should be available as MCP tools.

## Troubleshooting

If login fails:

- Confirm the Client ID and Client Secret are copied from the WHOOP Developer Dashboard.
- Confirm the redirect URI in your terminal exactly matches a redirect URI registered on the WHOOP app.
- Confirm the requested scopes are enabled on the app.
- Delete `.whoop-tokens` and run `npm run login` again if tokens become stale.

If the MCP client cannot fetch WHOOP data:

- Confirm `npm run build` has been run and `dist\\index.js` exists.
- Use an absolute `WHOOP_TOKEN_DIR` in the MCP client config.
- Include `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` in the MCP client env so refreshes work.
- Restart the MCP client after config changes.

## Security

- Do not commit `.env` or `.whoop-tokens`.
- Treat WHOOP data as private health-related context.
- WHOOP refresh tokens rotate. If two server instances refresh at the same time, one may invalidate the other's token cache.
