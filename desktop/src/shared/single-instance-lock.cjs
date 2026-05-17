/**
 * Electron client single-instance guard.
 *
 * Electron's requestSingleInstanceLock() is scoped by userData, so Agentry sets
 * userData from AGENTRY_HOME before requesting the lock. Production and dev homes
 * get different namespaces, while duplicate launches within the same home are
 * redirected to the first client.
 */
const path = require("path");

function normalizeForCompare(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function getUserDataAppName(agentryHome, defaultHome) {
  if (normalizeForCompare(agentryHome) === normalizeForCompare(defaultHome)) {
    return null;
  }
  const suffix = path.basename(agentryHome).replace(/^\./, "");
  if (!suffix) return "Agentry";
  return suffix.charAt(0).toUpperCase() + suffix.slice(1);
}

function exitDuplicateClient(app) {
  if (typeof app.exit === "function") {
    app.exit(0);
    return;
  }
  app.quit();
}

function focusExistingWindow(win) {
  if (!win || win.isDestroyed?.()) return false;
  if (win.isMinimized?.()) win.restore?.();
  win.show?.();
  win.focus?.();
  return true;
}

function configureClientSingleInstance(app, opts) {
  const { agentryHome, defaultHome, onSecondInstance } = opts;
  const appName = getUserDataAppName(agentryHome, defaultHome);
  if (appName) {
    app.setPath("userData", path.join(app.getPath("appData"), appName));
  }

  const gotLock = app.requestSingleInstanceLock({ agentryHome });
  if (!gotLock) {
    exitDuplicateClient(app);
    return false;
  }

  app.on("second-instance", () => {
    onSecondInstance?.();
  });
  return true;
}

module.exports = {
  configureClientSingleInstance,
  focusExistingWindow,
  getUserDataAppName,
};
