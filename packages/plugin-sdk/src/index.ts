import {
  PLUGIN_UI_CAPABILITY,
  PLUGIN_UI_PROTOCOL,
  PLUGIN_UI_PROTOCOL_VERSION,
  parsePluginUiMessage,
  type PluginUiError,
  type PluginUiMessage,
} from '@agentry/plugin-protocol';

export interface AgentryPluginSize {
  width?: number;
  height?: number;
}

export interface AgentryPluginThemeSnapshot {
  theme?: string;
  cssUrl?: string;
}

export interface AgentryPluginRequestOptions {
  timeoutMs?: number;
}

export type AgentryToastType = 'success' | 'error' | 'info' | 'warning';

export interface AgentryToastShowInput {
  message: string;
  type?: AgentryToastType;
  duration?: number;
}

export interface AgentryToastShowResult {
  shown: boolean;
}

export type AgentryExternalOpenInput = string | { url: string };

export interface AgentryExternalOpenResult {
  opened: boolean;
}

export type AgentryClipboardWriteTextInput = string | { text: string };

export interface AgentryClipboardWriteTextResult {
  written: boolean;
}

export interface AgentryPluginSdkOptions {
  parentWindow?: Window;
  targetWindow?: Window;
  targetOrigin?: string;
  requestTimeoutMs?: number;
  idFactory?: () => string;
}

export interface AgentryPluginSdk {
  ready(payload?: unknown): void;
  ui: {
    resize(size: AgentryPluginSize): void;
  };
  theme: {
    getSnapshot(): AgentryPluginThemeSnapshot;
    subscribe(callback: (theme: AgentryPluginThemeSnapshot) => void): () => void;
  };
  host: {
    request<T = unknown>(
      type: string,
      payload?: unknown,
      options?: AgentryPluginRequestOptions,
    ): Promise<T>;
  };
  toast: {
    show(input: AgentryToastShowInput, options?: AgentryPluginRequestOptions): Promise<AgentryToastShowResult>;
  };
  external: {
    open(input: AgentryExternalOpenInput, options?: AgentryPluginRequestOptions): Promise<AgentryExternalOpenResult>;
  };
  clipboard: {
    writeText(
      input: AgentryClipboardWriteTextInput,
      options?: AgentryPluginRequestOptions,
    ): Promise<AgentryClipboardWriteTextResult>;
  };
}

export class AgentryPluginError extends Error {
  override name = 'AgentryPluginError';
  readonly code: string;
  readonly details?: unknown;

  constructor(error: PluginUiError) {
    super(error.message);
    this.code = error.code;
    this.details = error.details;
  }
}

let fallbackIdSeq = 0;

function defaultIdFactory(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackIdSeq += 1;
  return `hana-plugin-${Date.now()}-${fallbackIdSeq}`;
}

function getBrowserWindow(): Window {
  if (typeof window === 'undefined') {
    throw new Error('@agentry/plugin-sdk requires a browser iframe window.');
  }
  return window;
}

function safeOriginFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function resolveTargetOrigin(targetWindow: Window, explicit?: string): string {
  if (explicit) return explicit;

  const hostOrigin = new URLSearchParams(targetWindow.location.search).get('hana-host-origin');
  if (hostOrigin) return hostOrigin;

  return safeOriginFromUrl(targetWindow.document.referrer) ?? '*';
}

function readInitialTheme(targetWindow: Window): AgentryPluginThemeSnapshot {
  const params = new URLSearchParams(targetWindow.location.search);
  return {
    theme: params.get('hana-theme') ?? undefined,
    cssUrl: params.get('hana-css') ?? undefined,
  };
}

function isTrustedHostEvent(event: MessageEvent, parentWindow: Window, targetOrigin: string): boolean {
  if (event.source !== parentWindow) return false;
  if (targetOrigin !== '*' && event.origin !== targetOrigin) return false;
  return true;
}

function externalOpenPayload(input: AgentryExternalOpenInput): { url: string } {
  return typeof input === 'string' ? { url: input } : input;
}

function clipboardWriteTextPayload(input: AgentryClipboardWriteTextInput): { text: string } {
  return typeof input === 'string' ? { text: input } : input;
}

export function createHanaPluginSdk(options: AgentryPluginSdkOptions = {}): AgentryPluginSdk {
  const targetWindow = options.targetWindow ?? getBrowserWindow();
  const parentWindow = options.parentWindow ?? targetWindow.parent;
  const targetOrigin = resolveTargetOrigin(targetWindow, options.targetOrigin);
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const idFactory = options.idFactory ?? defaultIdFactory;
  let themeSnapshot = readInitialTheme(targetWindow);
  const themeSubscribers = new Set<(theme: AgentryPluginThemeSnapshot) => void>();

  function post(message: PluginUiMessage): void {
    parentWindow.postMessage(message, targetOrigin);
  }

  function postEvent(type: string, payload?: unknown): void {
    const message: PluginUiMessage = {
      protocol: PLUGIN_UI_PROTOCOL,
      version: PLUGIN_UI_PROTOCOL_VERSION,
      kind: 'event',
      type,
    };
    if (payload !== undefined) message.payload = payload;
    post(message);
  }

  function onThemeMessage(event: MessageEvent): void {
    if (!isTrustedHostEvent(event, parentWindow, targetOrigin)) return;
    const parsed = parsePluginUiMessage(event.data);
    if (!parsed.ok) return;

    const message = parsed.value;
    if (message.kind !== 'event' || message.type !== 'hana.theme.changed') return;
    if (typeof message.payload !== 'object' || message.payload === null) return;

    const payload = message.payload as Record<string, unknown>;
    themeSnapshot = {
      theme: typeof payload.theme === 'string' ? payload.theme : themeSnapshot.theme,
      cssUrl: typeof payload.cssUrl === 'string' ? payload.cssUrl : themeSnapshot.cssUrl,
    };
    for (const callback of themeSubscribers) callback(themeSnapshot);
  }

  function request<T = unknown>(
    type: string,
    payload?: unknown,
    requestOptions: AgentryPluginRequestOptions = {},
  ): Promise<T> {
    const id = idFactory();
    const timeoutMs = requestOptions.timeoutMs ?? requestTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      const cleanup = () => {
        targetWindow.removeEventListener('message', onMessage);
        targetWindow.clearTimeout(timeout);
      };

      const onMessage = (event: MessageEvent) => {
        if (!isTrustedHostEvent(event, parentWindow, targetOrigin)) return;
        const parsed = parsePluginUiMessage(event.data);
        if (!parsed.ok) return;

        const message = parsed.value;
        if (message.id !== id || message.type !== type) return;

        if (message.kind === 'response') {
          cleanup();
          resolve(message.payload as T);
        }
        if (message.kind === 'error' && message.error) {
          cleanup();
          reject(new AgentryPluginError(message.error));
        }
      };

      const timeout = targetWindow.setTimeout(() => {
        cleanup();
        reject(new AgentryPluginError({
          code: 'TIMEOUT',
          message: `Plugin host request timed out: ${type}.`,
        }));
      }, timeoutMs);

      targetWindow.addEventListener('message', onMessage);

      const message: PluginUiMessage = {
        protocol: PLUGIN_UI_PROTOCOL,
        version: PLUGIN_UI_PROTOCOL_VERSION,
        id,
        kind: 'request',
        type,
      };
      if (payload !== undefined) message.payload = payload;
      post(message);
    });
  }

  return {
    ready(payload?: unknown) {
      postEvent('hana.ready', payload);
    },
    ui: {
      resize(size: AgentryPluginSize) {
        postEvent(PLUGIN_UI_CAPABILITY.UI_RESIZE, size);
      },
    },
    theme: {
      getSnapshot() {
        return { ...themeSnapshot };
      },
      subscribe(callback: (theme: AgentryPluginThemeSnapshot) => void) {
        if (themeSubscribers.size === 0) {
          targetWindow.addEventListener('message', onThemeMessage);
        }
        themeSubscribers.add(callback);
        callback({ ...themeSnapshot });
        return () => {
          themeSubscribers.delete(callback);
          if (themeSubscribers.size === 0) {
            targetWindow.removeEventListener('message', onThemeMessage);
          }
        };
      },
    },
    host: {
      request,
    },
    toast: {
      show(input: AgentryToastShowInput, options?: AgentryPluginRequestOptions) {
        return request<AgentryToastShowResult>(PLUGIN_UI_CAPABILITY.TOAST_SHOW, input, options);
      },
    },
    external: {
      open(input: AgentryExternalOpenInput, options?: AgentryPluginRequestOptions) {
        return request<AgentryExternalOpenResult>(PLUGIN_UI_CAPABILITY.EXTERNAL_OPEN, externalOpenPayload(input), options);
      },
    },
    clipboard: {
      writeText(input: AgentryClipboardWriteTextInput, options?: AgentryPluginRequestOptions) {
        return request<AgentryClipboardWriteTextResult>(
          PLUGIN_UI_CAPABILITY.CLIPBOARD_WRITE_TEXT,
          clipboardWriteTextPayload(input),
          options,
        );
      },
    },
  };
}

let singleton: AgentryPluginSdk | null = null;

function getSingleton(): AgentryPluginSdk {
  singleton ??= createHanaPluginSdk();
  return singleton;
}

export const hana: AgentryPluginSdk = {
  ready(payload?: unknown) {
    return getSingleton().ready(payload);
  },
  ui: {
    resize(size: AgentryPluginSize) {
      return getSingleton().ui.resize(size);
    },
  },
  theme: {
    getSnapshot() {
      return getSingleton().theme.getSnapshot();
    },
    subscribe(callback: (theme: AgentryPluginThemeSnapshot) => void) {
      return getSingleton().theme.subscribe(callback);
    },
  },
  host: {
    request<T = unknown>(
      type: string,
      payload?: unknown,
      options?: AgentryPluginRequestOptions,
    ) {
      return getSingleton().host.request<T>(type, payload, options);
    },
  },
  toast: {
    show(input: AgentryToastShowInput, options?: AgentryPluginRequestOptions) {
      return getSingleton().toast.show(input, options);
    },
  },
  external: {
    open(input: AgentryExternalOpenInput, options?: AgentryPluginRequestOptions) {
      return getSingleton().external.open(input, options);
    },
  },
  clipboard: {
    writeText(input: AgentryClipboardWriteTextInput, options?: AgentryPluginRequestOptions) {
      return getSingleton().clipboard.writeText(input, options);
    },
  },
};
