#!/usr/bin/env node
/**
 * Cross-platform dev launcher
 * 解决 POSIX `VAR=val cmd` 语法和 `~` 在 Windows 上不工作的问题
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.HANA_HOME = join(homedir(), ".hanako-dev");
// 本地 Electron 再拉起 server 时，显式把当前 Node runtime 传下去。
// 这样开发模式的 server/source 进程就不会误用 Electron 自带 Node，避免 native addon ABI 漂移。
process.env.HANA_DEV_NODE_BIN = process.execPath;

const mode = process.argv[2];
const extra = process.argv.slice(3);

const APP_NAME = "Agentry";
const APP_ID = "com.agentry.dev";

function replacePlistString(plist, key, value) {
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
  return plist.replace(pattern, `$1${value}$2`);
}

function brandElectronApp(electronBin) {
  if (process.platform !== "darwin") return electronBin;

  const electronApp = dirname(dirname(dirname(electronBin)));
  if (!electronApp.endsWith(".app") || !fs.existsSync(electronApp)) return electronBin;

  const targetApp = join(dirname(electronApp), `${APP_NAME}.app`);
  if (!fs.lstatSync(electronApp).isSymbolicLink()) {
    fs.rmSync(targetApp, { recursive: true, force: true });
    fs.renameSync(electronApp, targetApp);
    fs.symlinkSync(`${APP_NAME}.app`, electronApp, "dir");
  }

  const sourceExecutable = join(targetApp, "Contents", "MacOS", "Electron");

  const targetPlist = join(targetApp, "Contents", "Info.plist");
  const targetExecutable = join(targetApp, "Contents", "MacOS", APP_NAME);
  const sourceIcon = join(process.cwd(), "desktop", "src", "icon.icns");
  const targetIcon = join(targetApp, "Contents", "Resources", "agentry.icns");

  if (fs.existsSync(targetPlist)) {
    let plist = fs.readFileSync(targetPlist, "utf8");
    plist = replacePlistString(plist, "CFBundleDisplayName", APP_NAME);
    plist = replacePlistString(plist, "CFBundleExecutable", APP_NAME);
    plist = replacePlistString(plist, "CFBundleName", APP_NAME);
    plist = replacePlistString(plist, "CFBundleIdentifier", APP_ID);
    plist = replacePlistString(plist, "CFBundleIconFile", "agentry.icns");
    fs.writeFileSync(targetPlist, plist);
  }

  if (!fs.existsSync(targetExecutable) || fs.statSync(targetExecutable).size !== fs.statSync(sourceExecutable).size) {
    fs.copyFileSync(sourceExecutable, targetExecutable);
    fs.chmodSync(targetExecutable, 0o755);
  }

  if (fs.existsSync(sourceIcon)) {
    fs.copyFileSync(sourceIcon, targetIcon);
  }

  const now = new Date();
  try {
    fs.utimesSync(targetApp, now, now);
  } catch {}

  return targetExecutable;
}

let bin, args;
switch (mode) {
  case "electron":
    bin = brandElectronApp(require("electron"));
    args = [".", ...extra];
    break;
  case "electron-dev":
    bin = brandElectronApp(require("electron"));
    args = [".", "--dev", ...extra];
    break;
  case "electron-vite":
    process.env.VITE_DEV_URL = "http://localhost:5173";
    bin = brandElectronApp(require("electron"));
    args = [".", "--dev", ...extra];
    break;
  case "cli":
    bin = process.execPath;
    args = ["index.js", ...extra];
    break;
  case "server":
    bin = process.execPath;
    args = ["server/index.js", ...extra];
    break;
  default:
    console.error("Usage: node scripts/launch.js <electron|electron-dev|electron-vite|cli|server>");
    process.exit(1);
}

// Electron 以子进程运行时（如 VS Code / Claude Code 终端），
// 父进程可能设了 ELECTRON_RUN_AS_NODE=1，会让 Electron 以纯 Node 模式启动，
// 导致 require('electron') 拿不到内置 API。spawn 前清掉。
delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(bin, args, { stdio: "inherit", env: process.env });
child.on("exit", (code) => process.exit(code ?? 1));
