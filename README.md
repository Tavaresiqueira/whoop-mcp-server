# WHOOP MCP Server

WHOOP MCP Server is a TypeScript Model Context Protocol (MCP) server that gives MCP-compatible assistants access to personal WHOOP recovery, sleep, strain, and workout data.

The server runs locally over stdio. It authenticates with WHOOP through OAuth 2.0, stores reusable tokens on disk, refreshes tokens when needed, and exposes structured tools that assistants can use for workload planning and recovery-aware context.

## Features

- Daily WHOOP recovery, sleep, cycle strain, and workout snapshots
- Sleep-stage and sleep-performance summaries
- Recovery score, HRV, resting heart rate, SpO2, and skin temperature summaries
- Short-window versus long-window trend analysis
- Historical baseline profiles
- Change alerts versus yesterday and personal baseline
- Workload guardrails based on recovery signals
- Local OAuth token cache with refresh-token support

## Requirements

- Node.js 20 or newer
- npm
- A WHOOP account
- A WHOOP Developer Dashboard app

Create the WHOOP app at:

```text
https://developer-dashboard.whoop.com
```

The app must have a redirect URI registered. The default used by this project is:

```text
whoop://mcp/callback
```

## Quick Start

Install dependencies:

```powershell
npm install
```

Run the setup wizard:

```powershell
npm run setup
```

The wizard asks for:

- WHOOP Client ID
- WHOOP Client Secret
- Redirect URI
- Token cache folder
- OAuth scopes

It then opens the WHOOP authorization page in your browser, exchanges the authorization code for tokens, writes the token cache, and offers to create a local `.env` file.

Build the MCP server:

```powershell
npm run build
```

## Authentication

WHOOP uses OAuth 2.0 Authorization Code flow for API access. This project does not collect or store your WHOOP username or password.

The setup wizard stores API tokens in:

```text
.whoop-tokens/tokens.json
```

By default it also offers to write local MCP settings to:

```text
.env
```

Both `.env` and `.whoop-tokens/` are ignored by git.

The default OAuth scopes are:

```text
read:profile read:body_measurement read:recovery read:cycles read:sleep read:workout offline
```

The `offline` scope is required for refresh-token support. Without it, the server may require a new browser login when the access token expires.

### Redirect URI Behavior

WHOOP supports redirect URLs such as `https://...` and custom schemes such as `whoop://...`.

With the default `whoop://mcp/callback` redirect, the setup wizard asks you to paste the final redirected URL from the browser after approving access. If your WHOOP app is configured with a loopback redirect such as `http://127.0.0.1:8787/callback`, the wizard can capture the callback automatically with a temporary local HTTP server.

## MCP Tools

| Tool | Description |
| --- | --- |
| `whoop_wellbeing_snapshot` | Returns recovery, sleep, cycle strain, workouts, and a workload recommendation for a date. |
| `whoop_sleep_summary` | Returns sleep-stage, sleep-performance, recovery, HRV, and resting-heart-rate context. |
| `whoop_training_load_trend` | Compares short-window and long-window trends for sleep, recovery, HRV, resting heart rate, and day strain. |
| `whoop_baseline_profile` | Computes baseline ranges over a historical window. |
| `whoop_change_alerts` | Highlights meaningful changes versus yesterday and baseline. |
| `whoop_workload_guard` | Evaluates a proposed workload against current recovery signals. |

## MCP Resource

| Resource | Description |
| --- | --- |
| `whoop://wellbeing/today` | Today's WHOOP wellbeing snapshot as JSON. |

## MCP Prompt

| Prompt | Description |
| --- | --- |
| `whoop_workload_guardrails` | Guidance for using WHOOP data during workload planning without treating it as medical advice. |

## Configuration

The setup wizard can create `.env` automatically. You can also create it manually:

```powershell
Copy-Item .env.example .env
```

Supported environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `WHOOP_CLIENT_ID` | Yes | OAuth Client ID from the WHOOP Developer Dashboard. |
| `WHOOP_CLIENT_SECRET` | Yes | OAuth Client Secret from the WHOOP Developer Dashboard. |
| `WHOOP_REDIRECT_URI` | Yes | Registered OAuth redirect URI. Defaults to `whoop://mcp/callback`. |
| `WHOOP_TOKEN_DIR` | Yes | Directory used to read and write WHOOP OAuth tokens. Defaults to `.whoop-tokens`. |
| `WHOOP_SCOPES` | No | Space- or comma-separated OAuth scopes. Defaults to the scopes listed above. |

Use an absolute `WHOOP_TOKEN_DIR` when configuring an MCP client. MCP clients often start servers from a different working directory, and an absolute path avoids token-cache lookup problems.

## Running Locally

Validate the project:

```powershell
npm run typecheck
npm run build
```

Start the MCP server:

```powershell
npm run start
```

The server communicates over stdio, so it will appear idle in a normal terminal until an MCP client connects.

## Codex Configuration

Example Codex MCP configuration:

```toml
[mcp_servers.whoop]
command = "node"
args = ["C:\\path\\to\\whoop-mcp-server\\dist\\index.js"]

[mcp_servers.whoop.env]
WHOOP_CLIENT_ID = "your-client-id"
WHOOP_CLIENT_SECRET = "your-client-secret"
WHOOP_REDIRECT_URI = "whoop://mcp/callback"
WHOOP_TOKEN_DIR = "C:\\path\\to\\whoop-mcp-server\\.whoop-tokens"
```

Restart Codex after updating the configuration.

## Claude Desktop Configuration

Example Claude Desktop MCP configuration:

```json
{
  "mcpServers": {
    "whoop": {
      "command": "node",
      "args": ["C:\\path\\to\\whoop-mcp-server\\dist\\index.js"],
      "env": {
        "WHOOP_CLIENT_ID": "your-client-id",
        "WHOOP_CLIENT_SECRET": "your-client-secret",
        "WHOOP_REDIRECT_URI": "whoop://mcp/callback",
        "WHOOP_TOKEN_DIR": "C:\\path\\to\\whoop-mcp-server\\.whoop-tokens"
      }
    }
  }
}
```

Restart Claude Desktop after updating the configuration.

## Troubleshooting

If setup fails:

- Confirm the Client ID and Client Secret are copied from the WHOOP Developer Dashboard.
- Confirm the redirect URI entered in the terminal exactly matches a redirect URI registered on the WHOOP app.
- Confirm the app has access to the requested scopes.
- Delete `.whoop-tokens/` and run `npm run setup` again if tokens are stale.

If the MCP client cannot fetch WHOOP data:

- Confirm `npm run build` completed successfully.
- Confirm `dist/index.js` exists.
- Use an absolute `WHOOP_TOKEN_DIR` in the MCP client configuration.
- Include `WHOOP_CLIENT_ID` and `WHOOP_CLIENT_SECRET` in the MCP client environment so token refresh can work.
- Restart the MCP client after changing configuration.

If token refresh fails:

- Confirm `WHOOP_SCOPES` includes `offline`.
- Run `npm run setup` again to create a fresh token cache.
- Avoid running multiple server instances against the same token cache at the same time. WHOOP refresh tokens can rotate, and concurrent refreshes may invalidate one instance's cached token.

## Security

- Do not commit `.env` or `.whoop-tokens/`.
- Treat WHOOP data as private health-related information.
- Keep the WHOOP Client Secret local to trusted machines.
- Revoke the WHOOP app or delete the token cache if a machine is lost or no longer trusted.

## Development

```powershell
npm run dev
npm run setup
npm run typecheck
npm run build
```
