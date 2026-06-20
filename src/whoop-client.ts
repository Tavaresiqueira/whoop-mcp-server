import fs from "node:fs";
import path from "node:path";

import type { WhoopServerConfig } from "./config.js";

type JsonObject = Record<string, unknown>;

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  expires_at?: number;
}

export interface PaginatedResponse<T extends JsonObject = JsonObject> {
  records?: T[];
  next_token?: string;
}

const API_BASE = "https://api.prod.whoop.com/developer";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const EXPIRY_SKEW_MS = 60_000;

export class WhoopClient {
  private tokens?: TokenSet;
  private refreshInFlight?: Promise<TokenSet>;

  constructor(private readonly config: WhoopServerConfig) {}

  async getProfile(): Promise<JsonObject> {
    return this.get<JsonObject>("/v2/user/profile/basic");
  }

  async getBodyMeasurements(): Promise<JsonObject> {
    return this.get<JsonObject>("/v2/user/measurement/body");
  }

  async getCycles(params: CollectionParams = {}): Promise<PaginatedResponse> {
    return this.get<PaginatedResponse>("/v2/cycle", paramsToQuery(params));
  }

  async getRecoveries(params: CollectionParams = {}): Promise<PaginatedResponse> {
    return this.get<PaginatedResponse>("/v2/recovery", paramsToQuery(params));
  }

  async getRecoveryForCycle(cycleId: number | string): Promise<JsonObject> {
    return this.get<JsonObject>(`/v2/cycle/${encodeURIComponent(String(cycleId))}/recovery`);
  }

  async getSleeps(params: CollectionParams = {}): Promise<PaginatedResponse> {
    return this.get<PaginatedResponse>("/v2/activity/sleep", paramsToQuery(params));
  }

  async getSleepById(sleepId: string): Promise<JsonObject> {
    return this.get<JsonObject>(`/v2/activity/sleep/${encodeURIComponent(sleepId)}`);
  }

  async getSleepForCycle(cycleId: number | string): Promise<JsonObject> {
    return this.get<JsonObject>(`/v2/cycle/${encodeURIComponent(String(cycleId))}/sleep`);
  }

  async getWorkouts(params: CollectionParams = {}): Promise<PaginatedResponse> {
    return this.get<PaginatedResponse>("/v2/activity/workout", paramsToQuery(params));
  }

  async getWorkoutById(workoutId: string): Promise<JsonObject> {
    return this.get<JsonObject>(`/v2/activity/workout/${encodeURIComponent(workoutId)}`);
  }

  async getAllRecords<T extends JsonObject>(
    fetchPage: (params: CollectionParams) => Promise<PaginatedResponse<T>>,
    params: CollectionParams = {},
    maxPages = 10,
  ): Promise<T[]> {
    const records: T[] = [];
    let nextToken = params.nextToken;

    for (let page = 0; page < maxPages; page += 1) {
      const response = await fetchPage({ ...params, nextToken });
      records.push(...(response.records ?? []));
      nextToken = response.next_token;
      if (!nextToken) {
        break;
      }
    }

    return records;
  }

  private async get<T>(pathName: string, params?: Record<string, string>): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(`${API_BASE}${pathName}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }

    let response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (response.status === 401) {
      await this.refreshTokens();
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${(await this.loadTokens()).access_token}`,
          Accept: "application/json",
        },
      });
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WHOOP API request failed (${response.status} ${response.statusText}): ${body}`);
    }

    return (await response.json()) as T;
  }

  private async getAccessToken(): Promise<string> {
    const tokens = await this.loadTokens();
    if (!tokens.access_token) {
      throw new Error("WHOOP token cache is missing an access token. Run `npm run login` first.");
    }

    if (tokens.expires_at && Date.now() >= tokens.expires_at - EXPIRY_SKEW_MS) {
      return (await this.refreshTokens()).access_token;
    }

    return tokens.access_token;
  }

  private async loadTokens(): Promise<TokenSet> {
    if (this.tokens) {
      return this.tokens;
    }

    const tokenPath = this.tokenPath();
    if (!fs.existsSync(tokenPath)) {
      throw new Error(
        `WHOOP token cache was not found at ${tokenPath}. Run \`npm run login\` from the server directory first.`,
      );
    }

    this.tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as TokenSet;
    return this.tokens;
  }

  private async refreshTokens(): Promise<TokenSet> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.refreshTokensNow().finally(() => {
      this.refreshInFlight = undefined;
    });

    return this.refreshInFlight;
  }

  private async refreshTokensNow(): Promise<TokenSet> {
    const current = await this.loadTokens();
    if (!current.refresh_token) {
      throw new Error("WHOOP token cache does not include a refresh token. Re-run login with the `offline` scope.");
    }

    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are required to refresh OAuth tokens.");
    }

    const refreshed = await exchangeToken({
      grant_type: "refresh_token",
      refresh_token: current.refresh_token,
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: this.config.scopes.join(" "),
    });

    this.saveTokens(refreshed);
    return refreshed;
  }

  private saveTokens(tokens: TokenSet): void {
    const withExpiry = addExpiry(tokens);
    fs.mkdirSync(this.config.tokenDir, { recursive: true });
    fs.writeFileSync(this.tokenPath(), JSON.stringify(withExpiry, null, 2));
    this.tokens = withExpiry;
  }

  private tokenPath(): string {
    return path.join(this.config.tokenDir, "tokens.json");
  }
}

export interface CollectionParams {
  start?: string;
  end?: string;
  limit?: number;
  nextToken?: string;
}

function paramsToQuery(params: CollectionParams): Record<string, string> {
  const query: Record<string, string> = {};
  if (params.start) query.start = params.start;
  if (params.end) query.end = params.end;
  if (params.limit) query.limit = String(params.limit);
  if (params.nextToken) query.nextToken = params.nextToken;
  return query;
}

export function addExpiry(tokens: TokenSet): TokenSet {
  return {
    ...tokens,
    expires_at: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : tokens.expires_at,
  };
}

export async function exchangeToken(payload: Record<string, string>): Promise<TokenSet> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`WHOOP token exchange failed (${response.status} ${response.statusText}): ${body}`);
  }

  return addExpiry((await response.json()) as TokenSet);
}
