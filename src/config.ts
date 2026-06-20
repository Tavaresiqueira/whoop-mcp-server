import path from "node:path";

export interface WhoopServerConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  tokenDir: string;
}

const DEFAULT_SCOPES = [
  "read:profile",
  "read:body_measurement",
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "offline",
];

export function loadConfig(): WhoopServerConfig {
  const scopes = (process.env.WHOOP_SCOPES ?? DEFAULT_SCOPES.join(" "))
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    clientId: process.env.WHOOP_CLIENT_ID,
    clientSecret: process.env.WHOOP_CLIENT_SECRET,
    redirectUri: process.env.WHOOP_REDIRECT_URI ?? "whoop://mcp/callback",
    scopes,
    tokenDir: path.resolve(process.env.WHOOP_TOKEN_DIR ?? ".whoop-tokens"),
  };
}
