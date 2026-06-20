#!/usr/bin/env node

import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";
import { parseWhoopDate } from "./date.js";
import { getBaselineProfile, getChangeAlerts, getTrainingLoadTrend } from "./history.js";
import { getWellbeingSnapshot } from "./wellbeing.js";
import { WhoopClient } from "./whoop-client.js";

const config = loadConfig();
const whoop = new WhoopClient(config);

const server = new McpServer({
  name: "whoop-mcp-server",
  version: "0.1.0",
});

function jsonContent(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

server.registerTool(
  "whoop_training_load_trend",
  {
    title: "WHOOP training load trend",
    description:
      "Return short and long window trends for sleep, sleep performance, recovery, HRV, resting heart rate, and day strain.",
    inputSchema: {
      date: z.string().optional().describe("End date in YYYY-MM-DD format. Defaults to today."),
      shortWindowDays: z.number().int().min(3).max(14).optional().describe("Short trend window. Defaults to 7."),
      longWindowDays: z.number().int().min(7).max(56).optional().describe("Long trend window. Defaults to 28."),
    },
  },
  async ({ date, shortWindowDays, longWindowDays }) => {
    const trend = await getTrainingLoadTrend(
      whoop,
      parseWhoopDate(date),
      shortWindowDays ?? 7,
      longWindowDays ?? 28,
    );
    return jsonContent(trend);
  },
);

server.registerTool(
  "whoop_baseline_profile",
  {
    title: "WHOOP baseline profile",
    description:
      "Compute personal baseline ranges over a historical window for sleep, recovery, HRV, resting heart rate, and day strain.",
    inputSchema: {
      date: z.string().optional().describe("End date in YYYY-MM-DD format. Defaults to today."),
      windowDays: z.number().int().min(14).max(90).optional().describe("Historical baseline window. Defaults to 42."),
    },
  },
  async ({ date, windowDays }) => {
    const baseline = await getBaselineProfile(whoop, parseWhoopDate(date), windowDays ?? 42);
    return jsonContent(baseline);
  },
);

server.registerTool(
  "whoop_change_alerts",
  {
    title: "WHOOP change alerts",
    description:
      "Highlight meaningful changes versus yesterday and baseline, such as sleep drops, recovery dips, HRV dips, and resting heart rate spikes.",
    inputSchema: {
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
      baselineWindowDays: z
        .number()
        .int()
        .min(14)
        .max(56)
        .optional()
        .describe("Historical window used for baseline comparisons. Defaults to 28."),
    },
  },
  async ({ date, baselineWindowDays }) => {
    const alerts = await getChangeAlerts(whoop, parseWhoopDate(date), baselineWindowDays ?? 28);
    return jsonContent(alerts);
  },
);

server.registerTool(
  "whoop_wellbeing_snapshot",
  {
    title: "WHOOP wellbeing snapshot",
    description:
      "Fetch a concise WHOOP snapshot for a date: recovery, sleep, cycle strain, workouts, and a workload recommendation.",
    inputSchema: {
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
      includeRaw: z.boolean().optional().describe("Include raw WHOOP responses for debugging."),
    },
  },
  async ({ date, includeRaw }) => {
    const snapshot = await getWellbeingSnapshot(whoop, parseWhoopDate(date), includeRaw ?? false);
    return jsonContent(snapshot);
  },
);

server.registerTool(
  "whoop_workload_guard",
  {
    title: "WHOOP workload guard",
    description:
      "Check WHOOP recovery metrics before committing to a workload and suggest a safer daily scope when signals are weak.",
    inputSchema: {
      workload: z.string().describe("The work the user wants to take on."),
      ticketCount: z.number().int().positive().optional().describe("Number of tickets/tasks being considered."),
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
    },
  },
  async ({ workload, ticketCount, date }) => {
    const snapshot = await getWellbeingSnapshot(whoop, parseWhoopDate(date), false);
    const requestedCount = ticketCount ?? null;
    const overLimit = requestedCount !== null && requestedCount > snapshot.recommendation.ticketLimit;

    return jsonContent({
      workload,
      requestedTicketCount: requestedCount,
      date: snapshot.date,
      recommendation: snapshot.recommendation,
      pushbackRequired: overLimit || ["minimal", "recovery"].includes(snapshot.recommendation.load),
      suggestedResponse: overLimit
        ? `WHOOP says to cap today at ${snapshot.recommendation.ticketLimit} ticket(s). ${snapshot.recommendation.message}`
        : snapshot.recommendation.message,
      metrics: {
        recovery: snapshot.recovery,
        sleep: snapshot.sleep,
        cycle: snapshot.cycle,
        workouts: snapshot.workouts,
      },
    });
  },
);

server.registerTool(
  "whoop_sleep_summary",
  {
    title: "WHOOP sleep summary",
    description: "Fetch WHOOP sleep performance, sleep stages, recovery score, HRV, resting heart rate, and recommendation.",
    inputSchema: {
      date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today."),
    },
  },
  async ({ date }) => {
    const snapshot = await getWellbeingSnapshot(whoop, parseWhoopDate(date), false);
    return jsonContent({
      date: snapshot.date,
      sleep: snapshot.sleep,
      recovery: snapshot.recovery,
      recommendation: snapshot.recommendation,
    });
  },
);

server.registerResource(
  "whoop-today",
  "whoop://wellbeing/today",
  {
    title: "WHOOP wellbeing today",
    description: "Today's WHOOP wellbeing snapshot for agent context.",
    mimeType: "application/json",
  },
  async (uri) => {
    const snapshot = await getWellbeingSnapshot(whoop, parseWhoopDate(undefined), false);
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(snapshot, null, 2),
        },
      ],
    };
  },
);

server.registerPrompt(
  "whoop_workload_guardrails",
  {
    title: "WHOOP workload guardrails",
    description: "System-style instructions for using WHOOP recovery data before agreeing to heavy work.",
  },
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Use WHOOP context as part of planning, especially when the user proposes a heavy workload, late-day push, risky refactor, production change, or many tickets in one day.",
            "",
            "Before agreeing to heavy work, call whoop_workload_guard or whoop_wellbeing_snapshot.",
            "If recovery, sleep performance, HRV, resting heart rate, or strain signals are poor, push back concretely: reduce ticket count, split the work, defer risky items, and create a stopping point.",
            "Do not moralize or diagnose health. Treat the metrics as planning context, not medical advice.",
            "If WHOOP data is unavailable, say that plainly and fall back to normal workload planning.",
          ].join("\n"),
        },
      },
    ],
  }),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`WHOOP MCP server failed: ${message}`);
  process.exit(1);
});
