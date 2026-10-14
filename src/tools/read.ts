import { z } from "zod";
import type { ToolDef } from "./types.js";
import { imageResult, jsonResult, textResult } from "./types.js";

export const readTools: ToolDef[] = [
  {
    name: "list_devices",
    capability: "read",
    config: { title: "List devices", description: "List connected adb devices and their state.", inputSchema: {} },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "list_devices", capability: "read" });
      return jsonResult(await client.listDevices());
    },
  },
  {
    name: "device_info",
    capability: "read",
    config: { title: "Device info", description: "Model, manufacturer, Android version, and screen size.", inputSchema: {} },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "device_info", capability: "read" });
      return jsonResult(await client.deviceInfo());
    },
  },
  {
    name: "screenshot",
    capability: "read",
    config: {
      title: "Screenshot",
      description: "Capture the current screen as a PNG image so you can see what's on the phone before acting.",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "screenshot", capability: "read" });
      return imageResult(await client.screenshot(), "Current screen:");
    },
  },
  {
    name: "ui_dump",
    capability: "read",
    config: {
      title: "UI hierarchy",
      description:
        "Dump the current screen's UI hierarchy (uiautomator XML) with element text and bounds — use it to find exact tap coordinates.",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "ui_dump", capability: "read" });
      const xml = await client.uiDump();
      return textResult(xml.length > 40000 ? xml.slice(0, 40000) + "\n… (truncated)" : xml);
    },
  },
  {
    name: "current_app",
    capability: "read",
    config: { title: "Current app", description: "The package/activity currently in the foreground.", inputSchema: {} },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "current_app", capability: "read" });
      return textResult(await client.currentApp());
    },
  },
  {
    name: "list_apps",
    capability: "read",
    config: {
      title: "List apps",
      description: "List installed packages. Third-party only by default.",
      inputSchema: { includeSystem: z.boolean().optional().describe("Include system packages") },
    },
    handler: async (a, { client, policy }) => {
      policy.guard({ tool: "list_apps", capability: "read" });
      return jsonResult(await client.listPackages(!(a.includeSystem as boolean | undefined)));
    },
  },
  {
    name: "get_notifications",
    capability: "read",
    config: {
      title: "Get notifications",
      description: "Read current notifications (package + title/text), best-effort. Useful for clearing the pile-up.",
      inputSchema: {},
    },
    handler: async (_a, { client, policy }) => {
      policy.guard({ tool: "get_notifications", capability: "read" });
      return textResult(await client.notifications());
    },
  },
];
