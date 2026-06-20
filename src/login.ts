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

async function promptVisible(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = await rl.question(`${question}${suffix}: `);
  rl.close();
  return answer.trim() || defaultValue || "";
}

async function promptPassword(question: string, defaultValue?: string): Promise<string> {
  if (defaultValue) {
    return defaultValue;
  }

  output.write(`${question}: `);
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
        resolve(value);
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

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("WHOOP MCP login");
  console.log("This starts a local OAuth callback server and creates a reusable token cache.");
  console.log("");

  const clientId = await promptVisible("WHOOP Client ID", config.clientId);
  const clientSecret = await promptPassword("WHOOP Client Secret", config.clientSecret);
  const redirectUri = await promptVisible("WHOOP Redirect URI", config.redirectUri);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("WHOOP Client ID, Client Secret, and Redirect URI are required.");
  }

  const state = crypto.randomBytes(4).toString("hex");
  const authorizeUrl = buildAuthorizeUrl(clientId, redirectUri, config.scopes, state);

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

  const tokenPath = writeTokens(config.tokenDir, tokens);

  console.log("");
  console.log("Login successful.");
  console.log(`Token cache written to ${tokenPath}.`);
  console.log("You can now use the WHOOP MCP server without repeating OAuth in the browser.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`WHOOP login failed: ${message}`);
  process.exit(1);
});
