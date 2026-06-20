#!/usr/bin/env node

import "dotenv/config";

import { exec } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { loadConfig } from "./config.js";
import { exchangeToken, type TokenSet } from "./whoop-client.js";

const AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const WHOOP_ENV_KEYS = new Set([
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
  "WHOOP_REDIRECT_URI",
  "WHOOP_TOKEN_DIR",
  "WHOOP_SCOPES",
]);

async function promptVisible(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  rl.close();
  return answer.trim() || defaultValue || "";
}

async function promptPassword(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? " (already configured, press Enter to keep)" : "";
  output.write(`${question}${suffix}: `);
  input.setRawMode?.(true);
  input.resume();
  input.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      input.setRawMode?.(false);
      input.pause();
      input.removeListener("data", onData);
    };

    const onData = (char: string) => {
      if (char === "\u0003") {
        cleanup();
        output.write("\n");
        reject(new Error("Login cancelled."));
        return;
      }

      if (char === "\r" || char === "\n") {
        cleanup();
        output.write("\n");
        resolve(value || defaultValue || "");
        return;
      }

      if (char === "\u007f" || char === "\b") {
        value = value.slice(0, -1);
        return;
      }

      value += char;
    };

    input.on("data", onData);
  });
}

async function promptYesNo(question: string, defaultValue: boolean): Promise<boolean> {
  const defaultLabel = defaultValue ? "Y/n" : "y/N";
  const answer = (await promptVisible(`${question} (${defaultLabel})`)).toLowerCase();

  if (!answer) {
    return defaultValue;
  }

  return ["y", "yes", "true", "1"].includes(answer);
}

function openBrowser(url: string): void {
  const escaped = url.replace(/"/g, '\\"');

  if (process.platform === "win32") {
    exec(`start "" "${escaped}"`);
    return;
  }

  if (process.platform === "darwin") {
    exec(`open "${escaped}"`);
    return;
  }

  exec(`xdg-open "${escaped}"`);
}

function waitForCode(redirectUri: string, expectedState: string): Promise<string> {
  const redirect = new URL(redirectUri);
  const port = Number(redirect.port || (redirect.protocol === "https:" ? 443 : 80));
  const pathname = redirect.pathname || "/";

  return new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", redirectUri);

      if (requestUrl.pathname !== pathname) {
        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found");
        return;
      }

      const error = requestUrl.searchParams.get("error");
      if (error) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end(`WHOOP OAuth failed: ${error}`);
        server.close();
        reject(new Error(`WHOOP OAuth failed: ${error}`));
        return;
      }

      const state = requestUrl.searchParams.get("state");
      if (state !== expectedState) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("Invalid OAuth state.");
        server.close();
        reject(new Error("Invalid OAuth state returned by WHOOP."));
        return;
      }

      const code = requestUrl.searchParams.get("code");
      if (!code) {
        response.writeHead(400, { "Content-Type": "text/plain" });
        response.end("Missing OAuth code.");
        server.close();
        reject(new Error("WHOOP did not return an OAuth code."));
        return;
      }

      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("WHOOP login successful. You can close this tab and return to the terminal.");
      server.close();
      resolve(code);
    });

    server.once("error", reject);
    server.listen(port, redirect.hostname);
  });
}

async function promptRedirectedUrl(redirectUri: string, expectedState: string): Promise<string> {
  const redirected = await promptVisible("Paste the full redirected URL from the browser");
  const requestUrl = new URL(redirected);
  const expectedUrl = new URL(redirectUri);

  if (requestUrl.protocol !== expectedUrl.protocol || requestUrl.hostname !== expectedUrl.hostname) {
    throw new Error("The pasted redirect URL does not match the configured WHOOP redirect URI.");
  }

  const state = requestUrl.searchParams.get("state");
  if (state !== expectedState) {
    throw new Error("Invalid OAuth state returned by WHOOP.");
  }

  const error = requestUrl.searchParams.get("error");
  if (error) {
    throw new Error(`WHOOP OAuth failed: ${error}`);
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    throw new Error("WHOOP did not return an OAuth code.");
  }

  return code;
}

function buildAuthorizeUrl(clientId: string, redirectUri: string, scopes: string[], state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

function writeTokens(tokenDir: string, tokens: TokenSet): string {
  fs.mkdirSync(tokenDir, { recursive: true });
  const tokenPath = path.join(tokenDir, "tokens.json");
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  return tokenPath;
}

function envLine(key: string, value: string): string {
  return `${key}=${JSON.stringify(value)}`;
}

function writeLocalEnv(values: Record<string, string>): string {
  const envPath = path.resolve(".env");
  const existingLines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const preservedLines = existingLines.filter((line) => {
    const match = line.match(/^([A-Z0-9_]+)\s*=/);
    return !match || !WHOOP_ENV_KEYS.has(match[1]);
  });

  const nextLines = [
    ...preservedLines.filter((line) => line.trim().length > 0),
    "# WHOOP MCP local settings. This file is ignored by git.",
    ...Object.entries(values).map(([key, value]) => envLine(key, value)),
    "",
  ];

  fs.writeFileSync(envPath, nextLines.join("\n"));
  return envPath;
}

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("WHOOP MCP setup");
  console.log("WHOOP does not support password login for third-party apps.");
  console.log("This wizard uses WHOOP's browser OAuth flow and saves local settings for the MCP server.");
  console.log("");
  console.log("Before continuing, create an app at https://developer-dashboard.whoop.com");
  console.log("Copy the app's Client ID and Client Secret, and add this redirect URI to the app:");
  console.log(`  ${config.redirectUri}`);
  console.log("");

  const clientId = await promptVisible("WHOOP Client ID", config.clientId);
  const clientSecret = await promptPassword("WHOOP Client Secret", config.clientSecret);
  const redirectUri = await promptVisible("WHOOP Redirect URI", config.redirectUri);
  const tokenDir = await promptVisible("Token cache folder", config.tokenDir);
  const scopes = await promptVisible("OAuth scopes", config.scopes.join(" "));
  const parsedScopes = scopes.split(/[,\s]+/).map((scope) => scope.trim()).filter(Boolean);

  if (!clientId || !clientSecret || !redirectUri || !tokenDir || parsedScopes.length === 0) {
    throw new Error("WHOOP Client ID, Client Secret, Redirect URI, token folder, and scopes are required.");
  }

  const state = crypto.randomBytes(4).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(clientId, redirectUri, parsedScopes, state);

  console.log("");
  console.log("Opening WHOOP authorization page.");
  console.log("If the browser does not open, paste this URL manually:");
  console.log(authorizeUrl);
  console.log("");

  const redirect = new URL(redirectUri);
  const canCaptureLocally = redirect.protocol === "http:" && ["127.0.0.1", "localhost"].includes(redirect.hostname);
  const codePromise = canCaptureLocally
    ? waitForCode(redirectUri, state)
    : promptRedirectedUrl(redirectUri, state);

  if (!canCaptureLocally) {
    console.log("After approving access, copy the full redirected URL and paste it here.");
  }

  openBrowser(authorizeUrl);
  const code = await codePromise;

  const tokens = await exchangeToken({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });

  const tokenPath = writeTokens(path.resolve(tokenDir), tokens);
  const shouldWriteEnv = await promptYesNo("Save these settings to a local .env file for MCP token refresh?", true);
  const envPath = shouldWriteEnv
    ? writeLocalEnv({
        WHOOP_CLIENT_ID: clientId,
        WHOOP_CLIENT_SECRET: clientSecret,
        WHOOP_REDIRECT_URI: redirectUri,
        WHOOP_TOKEN_DIR: path.resolve(tokenDir),
        WHOOP_SCOPES: parsedScopes.join(" "),
      })
    : null;

  console.log("");
  console.log("WHOOP setup successful.");
  console.log(`Token cache written to ${tokenPath}.`);
  if (envPath) {
    console.log(`Local MCP settings written to ${envPath}.`);
  }
  console.log("You can now use the WHOOP MCP server without repeating OAuth in the browser.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`WHOOP login failed: ${message}`);
  process.exit(1);
});
