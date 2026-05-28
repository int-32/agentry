#!/usr/bin/env node
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

function parseFlags(argv) {
  const args = [...argv];
  const flags = new Set();
  const options = new Map();
  const positional = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--raw" || arg === "--compact") {
      flags.add(arg);
    } else if (arg === "--socket") {
      options.set(arg, args[index + 1] || "");
      index += 1;
    } else {
      positional.push(arg);
    }
  }
  return { flags, options, positional };
}

function parsePayload(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON arguments: ${err.message}`);
  }
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function emitTool(structuredContent, content = []) {
  emit({ structuredContent, content, isError: false });
}

function runJxa(source, payload = {}) {
  const stdout = execFileSync("osascript", ["-l", "JavaScript", "-e", source, JSON.stringify(payload)], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 15000,
  }).trim();
  return stdout ? JSON.parse(stdout) : null;
}

const LIST_APPS_JXA = String.raw`
function safe(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}
function boundsOf(item) {
  const position = safe(() => item.position(), [0, 0]);
  const size = safe(() => item.size(), [0, 0]);
  return { x: Number(position[0]) || 0, y: Number(position[1]) || 0, width: Number(size[0]) || 0, height: Number(size[1]) || 0 };
}
function windowsOf(process) {
  const windows = safe(() => process.windows(), []);
  return windows.map((win, index) => ({
    window_id: index + 1,
    title: safe(() => win.name(), "") || safe(() => win.title(), ""),
    bounds: boundsOf(win),
    is_on_screen: true,
    on_current_space: true,
    z_index: index
  })).filter((win) => win.bounds.width > 0 && win.bounds.height > 0);
}
function run(argv) {
  const se = Application("System Events");
  const processes = safe(() => se.processes.whose({ backgroundOnly: false })(), []);
  const apps = processes.map((process) => {
    const pid = Number(safe(() => process.unixId(), 0)) || null;
    const bundleId = safe(() => process.bundleIdentifier(), null);
    return {
      name: safe(() => process.name(), "") || bundleId || (pid ? "pid:" + pid : "unknown"),
      bundle_id: bundleId,
      pid,
      active: safe(() => process.frontmost(), false),
      windows: windowsOf(process)
    };
  }).filter((app) => app.pid && app.windows.length > 0);
  return JSON.stringify({ apps });
}
`;

const LIST_WINDOWS_JXA = String.raw`
function safe(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}
function boundsOf(item) {
  const position = safe(() => item.position(), [0, 0]);
  const size = safe(() => item.size(), [0, 0]);
  return { x: Number(position[0]) || 0, y: Number(position[1]) || 0, width: Number(size[0]) || 0, height: Number(size[1]) || 0 };
}
function processByPid(se, pid) {
  const matches = safe(() => se.processes.whose({ unixId: Number(pid) })(), []);
  return matches[0] || null;
}
function run(argv) {
  const input = JSON.parse(argv[0] || "{}");
  const se = Application("System Events");
  const process = processByPid(se, input.pid);
  if (!process) return JSON.stringify({ windows: [] });
  const windows = safe(() => process.windows(), []).map((win, index) => ({
    window_id: index + 1,
    title: safe(() => win.name(), "") || safe(() => win.title(), ""),
    bounds: boundsOf(win),
    is_on_screen: true,
    on_current_space: true,
    z_index: index
  })).filter((win) => win.bounds.width > 0 && win.bounds.height > 0);
  return JSON.stringify({ windows });
}
`;

const WINDOW_STATE_JXA = String.raw`
function safe(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}
function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}
function boundsOf(item) {
  const position = safe(() => item.position(), null);
  const size = safe(() => item.size(), null);
  if (!position || !size) return null;
  const width = Number(size[0]) || 0;
  const height = Number(size[1]) || 0;
  if (width <= 0 || height <= 0) return null;
  return { x: Number(position[0]) || 0, y: Number(position[1]) || 0, width, height };
}
function actionNames(item) {
  return safe(() => item.actions().map((action) => action.name()), []);
}
function childrenOf(item) {
  return safe(() => item.uiElements(), []);
}
function processByPid(se, pid) {
  const matches = safe(() => se.processes.whose({ unixId: Number(pid) })(), []);
  return matches[0] || null;
}
function labelFor(item) {
  return textValue(safe(() => item.name(), "")) ||
    textValue(safe(() => item.description(), "")) ||
    textValue(safe(() => item.title(), "")) ||
    textValue(safe(() => item.value(), ""));
}
function elementRecord(item, index) {
  const value = textValue(safe(() => item.value(), ""));
  const description = textValue(safe(() => item.description(), ""));
  return {
    element_index: index,
    role: textValue(safe(() => item.role(), "")) || "AXElement",
    label: labelFor(item),
    value,
    description,
    actions: actionNames(item),
    bounds: boundsOf(item),
    enabled: safe(() => item.enabled(), true) !== false
  };
}
function run(argv) {
  const input = JSON.parse(argv[0] || "{}");
  const se = Application("System Events");
  const process = processByPid(se, input.pid);
  if (!process) return JSON.stringify({ elements: [], tree_markdown: "", screenshot_width: 1, screenshot_height: 1 });
  const windows = safe(() => process.windows(), []);
  const window = windows[Math.max(0, Number(input.window_id || 1) - 1)] || windows[0] || process;
  const elements = [];
  const lines = [];
  let nextIndex = 0;
  function walk(item, depth) {
    if (nextIndex >= 96 || depth > 7) return;
    const index = nextIndex++;
    const record = elementRecord(item, index);
    elements.push(record);
    const label = record.label ? " \"" + record.label.replace(/"/g, "'") + "\"" : "";
    const actions = record.actions.length ? " actions=[" + record.actions.join(",") + "]" : "";
    lines.push("  ".repeat(depth) + "- [" + index + "] " + record.role + label + actions);
    const children = childrenOf(item);
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      walk(children[childIndex], depth + 1);
      if (nextIndex >= 96) break;
    }
  }
  walk(window, 0);
  const winBounds = boundsOf(window) || { x: 0, y: 0, width: 1, height: 1 };
  return JSON.stringify({
    elements,
    tree_markdown: lines.join("\n"),
    display: winBounds,
    screenshot_width: winBounds.width,
    screenshot_height: winBounds.height,
    screenshot_scale_factor: 1
  });
}
`;

const ELEMENT_ACTION_JXA = String.raw`
function safe(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}
function childrenOf(item) {
  return safe(() => item.uiElements(), []);
}
function processByPid(se, pid) {
  const matches = safe(() => se.processes.whose({ unixId: Number(pid) })(), []);
  return matches[0] || null;
}
function findElement(root, targetIndex) {
  let nextIndex = 0;
  let found = null;
  function walk(item, depth) {
    if (found || nextIndex > targetIndex || depth > 7) return;
    const index = nextIndex++;
    if (index === targetIndex) {
      found = item;
      return;
    }
    const children = childrenOf(item);
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      walk(children[childIndex], depth + 1);
      if (found) return;
    }
  }
  walk(root, 0);
  return found;
}
function performAction(item, name) {
  const actions = safe(() => item.actions(), []);
  for (let index = 0; index < actions.length; index += 1) {
    if (safe(() => actions[index].name(), "") === name) {
      actions[index].perform();
      return true;
    }
  }
  return false;
}
function run(argv) {
  const input = JSON.parse(argv[0] || "{}");
  const se = Application("System Events");
  const process = processByPid(se, input.pid);
  if (!process) throw new Error("Process not found: " + input.pid);
  const windows = safe(() => process.windows(), []);
  const window = windows[Math.max(0, Number(input.window_id || 1) - 1)] || windows[0] || process;
  const element = Number.isFinite(Number(input.element_index)) ? findElement(window, Number(input.element_index)) : window;
  if (!element) throw new Error("Element not found: " + input.element_index);
  const requested = input.action === "show_default_ui" ? "AXShowDefaultUI" :
    input.action === "show_menu" ? "AXShowMenu" :
    input.action === "open" ? "AXOpen" :
    "AXPress";
  if (!performAction(element, requested) && requested !== "AXPress") {
    throw new Error("AX action not supported: " + requested);
  }
  if (requested === "AXPress" && !performAction(element, "AXPress")) {
    safe(() => element.click(), null);
  }
  return JSON.stringify({ ok: true, action: requested });
}
`;

const TYPE_TEXT_JXA = String.raw`
function safe(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}
function childrenOf(item) {
  return safe(() => item.uiElements(), []);
}
function processByPid(se, pid) {
  const matches = safe(() => se.processes.whose({ unixId: Number(pid) })(), []);
  return matches[0] || null;
}
function findElement(root, targetIndex) {
  let nextIndex = 0;
  let found = null;
  function walk(item, depth) {
    if (found || nextIndex > targetIndex || depth > 7) return;
    const index = nextIndex++;
    if (index === targetIndex) {
      found = item;
      return;
    }
    const children = childrenOf(item);
    for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
      walk(children[childIndex], depth + 1);
      if (found) return;
    }
  }
  walk(root, 0);
  return found;
}
function performPress(item) {
  const actions = safe(() => item.actions(), []);
  for (let index = 0; index < actions.length; index += 1) {
    if (safe(() => actions[index].name(), "") === "AXPress") {
      actions[index].perform();
      return;
    }
  }
  safe(() => item.click(), null);
}
function run(argv) {
  const input = JSON.parse(argv[0] || "{}");
  const se = Application("System Events");
  const process = processByPid(se, input.pid);
  if (!process) throw new Error("Process not found: " + input.pid);
  if (Number.isFinite(Number(input.element_index))) {
    const windows = safe(() => process.windows(), []);
    const window = windows[Math.max(0, Number(input.window_id || 1) - 1)] || windows[0] || process;
    const element = findElement(window, Number(input.element_index));
    if (element) performPress(element);
    delay(0.05);
  }
  se.keystroke(String(input.text || ""));
  return JSON.stringify({ ok: true });
}
`;

const PRESS_KEY_JXA = String.raw`
function run(argv) {
  const input = JSON.parse(argv[0] || "{}");
  const se = Application("System Events");
  const key = String(input.key || "").toLowerCase();
  const keyCodes = {
    "return": 36, "enter": 36, "tab": 48, "escape": 53, "esc": 53,
    "backspace": 51, "delete": 51, "up": 126, "down": 125, "left": 123, "right": 124,
    "space": 49, "pagedown": 121, "page_down": 121, "pageup": 116, "page_up": 116
  };
  if (Object.prototype.hasOwnProperty.call(keyCodes, key)) se.keyCode(keyCodes[key]);
  else if (key.length === 1) se.keystroke(key);
  else se.keystroke(String(input.key || ""));
  return JSON.stringify({ ok: true });
}
`;

const SCROLL_JXA = String.raw`
function run(argv) {
  const input = JSON.parse(argv[0] || "{}");
  const se = Application("System Events");
  const direction = String(input.direction || "down").toLowerCase();
  const amount = Math.max(1, Math.min(10, Number(input.amount || 3)));
  const key = direction === "up" || direction === "left" ? 116 : 121;
  for (let index = 0; index < amount; index += 1) se.keyCode(key);
  return JSON.stringify({ ok: true });
}
`;

function screenshot() {
  const target = path.join(os.tmpdir(), `hana-computer-use-${process.pid}-${Date.now()}.png`);
  try {
    execFileSync("screencapture", ["-x", "-t", "png", target], { timeout: 8000, stdio: "ignore" });
    const buffer = fs.readFileSync(target);
    const width = buffer.length >= 24 ? buffer.readUInt32BE(16) : 1;
    const height = buffer.length >= 24 ? buffer.readUInt32BE(20) : 1;
    return {
      data: buffer.toString("base64"),
      width,
      height,
    };
  } catch {
    return { data: ONE_PIXEL_PNG_BASE64, width: 1, height: 1 };
  } finally {
    fs.rmSync(target, { force: true });
  }
}

function launchApp(payload) {
  if (payload.bundle_id) {
    execFileSync("open", ["-b", String(payload.bundle_id)], { stdio: "ignore", timeout: 10000 });
  } else if (payload.name) {
    execFileSync("open", ["-a", String(payload.name)], { stdio: "ignore", timeout: 10000 });
  }
}

function findLaunchedApp(payload) {
  const apps = runJxa(LIST_APPS_JXA).apps || [];
  const bundleId = String(payload.bundle_id || "").toLowerCase();
  const name = String(payload.name || "").toLowerCase();
  return apps.find((app) =>
    (bundleId && String(app.bundle_id || "").toLowerCase() === bundleId)
    || (name && String(app.name || "").toLowerCase() === name)
  ) || null;
}

async function main() {
  const { positional } = parseFlags(process.argv.slice(2));
  const command = positional[0] || "help";
  const payload = parsePayload(positional[1]);

  switch (command) {
    case "status":
      process.stdout.write("hana-computer-use-helper fallback running\n");
      break;
    case "serve":
      setInterval(() => {}, 60 * 60 * 1000);
      break;
    case "stop":
      process.stdout.write("hana-computer-use-helper fallback stopped\n");
      break;
    case "version":
    case "--version":
      process.stdout.write("fallback-jxa\n");
      break;
    case "list-tools":
      emitTool({ tools: [
        "check_permissions",
        "list_apps",
        "list_windows",
        "launch_app",
        "get_window_state",
        "click",
        "right_click",
        "type_text",
        "press_key",
        "scroll",
        "set_agent_cursor_style",
        "set_agent_cursor_motion",
        "set_agent_cursor_enabled",
      ] });
      break;
    case "check_permissions":
      emitTool({ permissions: [
        { name: "accessibility", granted: true },
        { name: "screen-recording", granted: true },
      ] });
      break;
    case "list_apps":
      emitTool(runJxa(LIST_APPS_JXA));
      break;
    case "list_windows":
      emitTool(runJxa(LIST_WINDOWS_JXA, payload));
      break;
    case "launch_app": {
      launchApp(payload);
      await new Promise((resolve) => setTimeout(resolve, 450));
      const app = findLaunchedApp(payload);
      emitTool(app || {});
      break;
    }
    case "get_window_state": {
      const state = runJxa(WINDOW_STATE_JXA, payload);
      const shot = screenshot();
      const display = state.display || {};
      emitTool({
        ...state,
        screenshot_width: display.width || shot.width,
        screenshot_height: display.height || shot.height,
        screenshot_original_width: shot.width,
        screenshot_original_height: shot.height,
      }, [
        { type: "text", text: state.tree_markdown || "" },
        { type: "image", mimeType: "image/png", data: shot.data },
      ]);
      break;
    }
    case "click":
      emitTool(runJxa(ELEMENT_ACTION_JXA, { ...payload, action: payload.action || "press" }));
      break;
    case "right_click":
      emitTool(runJxa(ELEMENT_ACTION_JXA, { ...payload, action: "show_menu" }));
      break;
    case "type_text":
      emitTool(runJxa(TYPE_TEXT_JXA, payload));
      break;
    case "press_key":
      emitTool(runJxa(PRESS_KEY_JXA, payload));
      break;
    case "scroll":
      emitTool(runJxa(SCROLL_JXA, payload));
      break;
    case "set_agent_cursor_style":
    case "set_agent_cursor_motion":
    case "set_agent_cursor_enabled":
      emitTool({ ok: true, ignored: true });
      break;
    default:
      process.stderr.write(`Unknown tool: ${command}\n`);
      process.exitCode = 64;
      break;
  }
}

main().catch((err) => {
  process.stderr.write(`hana-computer-use-helper fallback failed: ${err.message || err}\n`);
  process.exitCode = 70;
});
