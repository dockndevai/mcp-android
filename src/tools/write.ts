import { z } from "zod";
import type { ToolDef } from "./types.js";
import { jsonResult, textResult } from "./types.js";

const KEYCODES = [
  "HOME", "BACK", "MENU", "APP_SWITCH", "ENTER", "DEL", "TAB", "SEARCH",
  "VOLUME_UP", "VOLUME_DOWN", "POWER", "CAMERA", "MEDIA_PLAY_PAUSE", "MEDIA_NEXT", "MEDIA_PREVIOUS",
] as const;

export const writeTools: ToolDef[] = [
  {
    name: "tap",
    capability: "write",
    config: {
      title: "Tap",
      description: "Tap at screen coordinates (x, y). Get coordinates from screenshot + ui_dump first.",
      inputSchema: { x: z.number().int(), y: z.number().int() },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "tap", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would tap (${a.x}, ${a.y}).`);
      await client.tap(a.x as number, a.y as number);
      return jsonResult({ tapped: [a.x, a.y] });
    },
  },
  {
    name: "swipe",
    capability: "write",
    config: {
      title: "Swipe",
      description: "Swipe/scroll from (x1,y1) to (x2,y2) over a duration.",
      inputSchema: {
        x1: z.number().int(), y1: z.number().int(), x2: z.number().int(), y2: z.number().int(),
        durationMs: z.number().int().min(50).max(5000).optional(),
      },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "swipe", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would swipe (${a.x1},${a.y1})→(${a.x2},${a.y2}).`);
      await client.swipe(a.x1 as number, a.y1 as number, a.x2 as number, a.y2 as number, (a.durationMs as number) ?? 300);
      return jsonResult({ swiped: true });
    },
  },
  {
    name: "input_text",
    capability: "write",
    config: {
      title: "Type text",
      description: "Type text into the currently focused field.",
      inputSchema: { text: z.string() },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "input_text", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would type: ${a.text}`);
      await client.inputText(a.text as string);
      return jsonResult({ typed: true });
    },
  },
  {
    name: "press_key",
    capability: "write",
    config: {
      title: "Press key",
      description: "Press a hardware/navigation key (HOME, BACK, APP_SWITCH, ENTER, volume, media, …).",
      inputSchema: { key: z.enum(KEYCODES) },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "press_key", capability: "write" });
      if (dryRun) return textResult(`[dry-run] Would press ${a.key}.`);
      await client.key(`KEYCODE_${a.key}`);
      return jsonResult({ pressed: a.key });
    },
  },
  {
    name: "launch_app",
    capability: "write",
    config: {
      title: "Launch app",
      description: "Open an app by package name (e.g. com.android.deskclock).",
      inputSchema: { package: z.string().describe("Package name") },
    },
    handler: async (a, { client, policy }) => {
      const pkg = a.package as string;
      const { dryRun } = policy.guard({ tool: "launch_app", capability: "write", pkg });
      if (dryRun) return textResult(`[dry-run] Would launch ${pkg}.`);
      await client.launchApp(pkg);
      return jsonResult({ launched: pkg });
    },
  },
  {
    name: "open_url",
    capability: "write",
    config: {
      title: "Open URL",
      description: "Open a URL / deep link in the default handler. Only http, https, tel, mailto, geo and market URLs by default (ANDROID_EXTRA_URL_SCHEMES adds more); other schemes are refused.",
      inputSchema: { url: z.string() },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "open_url", capability: "write" });
      client.checkUrl(a.url as string); // refuse before the dry-run branch so a dry run reports the same refusal
      if (dryRun) return textResult(`[dry-run] Would open ${a.url}.`);
      await client.openUrl(a.url as string);
      return jsonResult({ opened: a.url });
    },
  },
  {
    name: "set_alarm",
    capability: "write",
    config: {
      title: "Set alarm",
      description: "Set a native alarm at a given hour (0-23) and minute via the system Clock.",
      inputSchema: {
        hour: z.number().int().min(0).max(23),
        minute: z.number().int().min(0).max(59),
        message: z.string().optional(),
      },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "set_alarm", capability: "write" });
      const msg = (a.message as string | undefined) ?? "Alarm";
      if (dryRun) return textResult(`[dry-run] Would set alarm ${a.hour}:${String(a.minute).padStart(2, "0")} (${msg}).`);
      await client.setAlarm(a.hour as number, a.minute as number, msg);
      return jsonResult({ alarmSet: `${a.hour}:${String(a.minute).padStart(2, "0")}`, message: msg });
    },
  },
  {
    name: "set_timer",
    capability: "write",
    config: {
      title: "Set timer",
      description: "Start a countdown timer for N seconds via the system Clock.",
      inputSchema: { seconds: z.number().int().min(1).max(86400), message: z.string().optional() },
    },
    handler: async (a, { client, policy }) => {
      const { dryRun } = policy.guard({ tool: "set_timer", capability: "write" });
      const msg = (a.message as string | undefined) ?? "Timer";
      if (dryRun) return textResult(`[dry-run] Would start a ${a.seconds}s timer (${msg}).`);
      await client.setTimer(a.seconds as number, msg);
      return jsonResult({ timerSet: `${a.seconds}s`, message: msg });
    },
  },
];
