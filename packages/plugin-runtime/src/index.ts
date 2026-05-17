export type MaybePromise<T> = T | Promise<T>;

export type JsonSchema = Record<string, unknown>;

export const HANA_BUS_SKIP = Symbol.for('hana.event-bus.skip');

export interface AgentryToolResult {
  content?: Array<Record<string, unknown>>;
  details?: Record<string, unknown>;
}

export interface AgentrySessionFile {
  id?: string | null;
  fileId?: string | null;
  sessionPath?: string | null;
  filePath?: string;
  realPath?: string;
  displayName?: string;
  filename?: string;
  label?: string;
  ext?: string | null;
  mime?: string;
  size?: number;
  kind?: string;
  isDirectory?: boolean;
  origin?: string;
  operations?: unknown[];
  createdAt?: number | string;
  storageKind?: string;
  status?: string;
  missingAt?: number | string | null;
  [key: string]: unknown;
}

export interface AgentrySessionFileMediaItem {
  type: 'session_file';
  fileId: string;
  sessionPath?: string | null;
  filePath?: string;
  label?: string;
  mime?: string;
  size?: number;
  kind?: string;
  [key: string]: unknown;
}

export interface AgentryStagedSessionFile {
  file?: AgentrySessionFile | null;
  sessionFile?: AgentrySessionFile | null;
  mediaItem: AgentrySessionFileMediaItem;
}

export interface AgentryMediaDetails {
  media: {
    items: AgentrySessionFileMediaItem[];
  };
}

export interface AgentryToolContext {
  pluginId: string;
  pluginDir: string;
  dataDir: string;
  sessionPath?: string | null;
  bus: AgentryEventBus;
  config: AgentryPluginConfigStore;
  log: AgentryPluginLogger;
  registerSessionFile?: (input: Record<string, unknown>) => AgentrySessionFile;
  stageFile?: (input: Record<string, unknown>) => AgentryStagedSessionFile;
  [key: string]: unknown;
}

export interface AgentryToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  parameters?: JsonSchema;
  promptSnippet?: string;
  promptGuidelines?: string;
  execute(input: Input, ctx: AgentryToolContext): MaybePromise<Output>;
}

export type AgentrySlashPermission = 'anyone' | 'owner' | 'admin';
export type AgentrySlashScope = 'session' | 'global';

export interface AgentryCommandContext {
  [key: string]: unknown;
}

export interface AgentryCommandResult {
  reply?: string;
  silent?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface AgentryCommandDefinition<Context = AgentryCommandContext> {
  name: string;
  aliases?: string[];
  description?: string;
  scope?: AgentrySlashScope;
  permission?: AgentrySlashPermission;
  usage?: string;
  handler?: (ctx: Context) => MaybePromise<AgentryCommandResult | void>;
  execute?: (ctx: Context) => MaybePromise<unknown>;
}

export type AgentryProviderRuntimeKind = 'http' | 'oauth-http' | 'local-cli' | 'browser-cli' | 'plugin';
export type AgentryMediaCapabilityName = 'imageGeneration' | 'videoGeneration' | 'speechGeneration' | string;
export type AgentryMediaOutputKind = 'file_glob' | 'json_stdout' | 'url_stdout';
export type AgentryCliBindingSource = 'prompt' | 'modelId' | 'inputFile' | 'outputDir' | 'size' | 'duration';

export type AgentryCliArgBinding =
  | { literal: string }
  | { option: string; from: AgentryCliBindingSource };

export interface AgentryCliOutputContract {
  kind: AgentryMediaOutputKind;
  directory?: AgentryCliBindingSource | string;
  pattern?: string;
  [key: string]: unknown;
}

export interface AgentryCliCommandSpec {
  executable: string;
  args: AgentryCliArgBinding[];
  timeoutMs: number;
  output: AgentryCliOutputContract;
}

export interface AgentryProviderRuntime {
  kind: AgentryProviderRuntimeKind;
  protocolId?: string;
  command?: AgentryCliCommandSpec;
  [key: string]: unknown;
}

export interface AgentryProviderChatCapability {
  projection?: 'models-json' | 'sdk-auth-alias' | 'none' | string;
  runtimeProviderId?: string;
  displayProviderId?: string;
  allowListSource?: string;
  [key: string]: unknown;
}

export interface AgentryProviderMediaModel {
  id: string;
  displayName?: string;
  protocolId: string;
  inputs?: string[];
  outputs?: string[];
  supportsEdit?: boolean;
  aliases?: string[];
  credentialLaneId?: string;
  [key: string]: unknown;
}

export interface AgentryProviderCredentialLane {
  id: string;
  kind?: string;
  label?: string;
  [key: string]: unknown;
}

export interface AgentryProviderMediaCapability {
  defaultModelId?: string;
  models: AgentryProviderMediaModel[];
  credentialLanes?: AgentryProviderCredentialLane[];
  [key: string]: unknown;
}

export interface AgentryProviderCapabilities {
  chat?: AgentryProviderChatCapability;
  media?: Partial<Record<AgentryMediaCapabilityName, AgentryProviderMediaCapability>>;
  [key: string]: unknown;
}

export interface AgentryProviderSource {
  kind: 'builtin' | 'plugin' | 'user' | string;
  pluginId?: string;
  [key: string]: unknown;
}

export interface AgentryProviderDefinition {
  id: string;
  displayName?: string;
  name?: string;
  authType?: 'api-key' | 'oauth' | 'none' | string;
  authJsonKey?: string;
  defaultBaseUrl?: string;
  defaultApi?: string;
  api?: string;
  models?: unknown[];
  runtime?: AgentryProviderRuntime;
  capabilities?: AgentryProviderCapabilities;
  source?: AgentryProviderSource;
  [key: string]: unknown;
}

export type AgentryExtensionFactory<Pi = unknown> = (pi: Pi) => MaybePromise<void>;

export interface AgentryPluginConfigStore {
  get<T = unknown>(key: string, options?: AgentryPluginConfigScopeOptions): MaybePromise<T | undefined>;
  getAll?(options?: AgentryPluginConfigScopeOptions & { redacted?: boolean }): MaybePromise<Record<string, unknown>>;
  set<T = unknown>(key: string, value: T, options?: AgentryPluginConfigScopeOptions): MaybePromise<void>;
  setMany?(values: Record<string, unknown>, options?: AgentryPluginConfigScopeOptions): MaybePromise<Record<string, unknown>>;
  getSchema?(): JsonSchema;
}

export interface AgentryPluginConfigScopeOptions {
  scope?: 'global' | 'per-agent' | 'per-session';
  agentId?: string;
  sessionPath?: string;
}

export interface AgentryEventBus {
  emit(type: string, payload?: unknown): unknown;
  subscribe(type: string, handler: (payload: unknown) => void): () => void;
  request<T = unknown>(type: string, payload?: unknown, options?: Record<string, unknown>): Promise<T>;
  hasHandler?(type: string): boolean;
  handle?(type: string, handler: (payload: unknown) => MaybePromise<unknown>): () => void;
  listCapabilities?(): AgentryEventBusCapability[];
  getCapability?(type: string): AgentryEventBusCapability | null;
}

export interface AgentryEventBusCapability {
  type: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  permission: string;
  errors: string[];
  stability: string;
  owner: string;
  since?: string;
  available?: boolean;
}

export interface AgentryPluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface AgentryBusHandlerContext {
  pluginId: string;
  bus: AgentryEventBus;
  config?: AgentryPluginConfigStore;
  log?: AgentryPluginLogger;
  [key: string]: unknown;
}

export interface AgentryBusHandlerDefinition<
  Payload = unknown,
  Result = unknown,
  Context extends AgentryBusHandlerContext = AgentryBusHandlerContext,
> {
  type: string;
  handle(payload: Payload, ctx: Context): MaybePromise<Result>;
}

export interface AgentryPluginContext {
  pluginId: string;
  pluginDir: string;
  dataDir: string;
  bus: AgentryEventBus;
  config: AgentryPluginConfigStore;
  log: AgentryPluginLogger;
  registerTool?: (tool: AgentryToolDefinition) => () => void;
  registerSessionFile?: (input: Record<string, unknown>) => AgentrySessionFile;
  stageFile?: (input: Record<string, unknown>) => AgentryStagedSessionFile;
  [key: string]: unknown;
}

export type AgentryPluginDisposable = () => void;

export interface AgentryPluginLifecycleHelpers {
  register(disposable: AgentryPluginDisposable): void;
}

export interface AgentryPluginLifecycle {
  onload?(ctx: AgentryPluginContext, helpers: AgentryPluginLifecycleHelpers): MaybePromise<void>;
  onunload?(ctx: AgentryPluginContext): MaybePromise<void>;
}

export interface AgentryPluginInstance {
  ctx: AgentryPluginContext;
  register: (disposable: AgentryPluginDisposable) => void;
  onload?(): MaybePromise<void>;
  onunload?(): MaybePromise<void>;
}

export type AgentryTaskStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'blocked'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'aborted';

export interface AgentryTaskProgress {
  current?: number;
  total?: number;
  percent?: number;
  message?: string;
}

export interface AgentryTaskRecord {
  taskId: string;
  type: string;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
  meta?: Record<string, unknown>;
  progress?: AgentryTaskProgress | null;
  status: AgentryTaskStatus;
  aborted?: boolean;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}

export interface AgentryTaskSchedule {
  scheduleId: string;
  type: string;
  pluginId?: string | null;
  agentId?: string | null;
  parentSessionPath?: string | null;
  payload?: unknown;
  meta?: Record<string, unknown>;
  intervalMs?: number | null;
  runAt?: number | string | null;
  enabled?: boolean;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastResult?: unknown;
  lastError?: string | null;
  runCount?: number;
}

export interface AgentryTaskRegisterInput {
  taskId: string;
  type: string;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
  meta?: Record<string, unknown>;
  persist?: boolean;
}

export interface AgentryTaskUpdateInput {
  taskId: string;
  status?: AgentryTaskStatus;
  progress?: AgentryTaskProgress | null;
  meta?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
  parentSessionPath?: string | null;
  pluginId?: string | null;
  agentId?: string | null;
}

export interface AgentryTaskScheduleInput {
  scheduleId: string;
  type: string;
  pluginId?: string | null;
  agentId?: string | null;
  parentSessionPath?: string | null;
  payload?: unknown;
  meta?: Record<string, unknown>;
  intervalMs?: number;
  runAt?: number | string | Date;
  enabled?: boolean;
}

const EMPTY_PARAMETERS: JsonSchema = { type: 'object', properties: {} };

export function defineTool<Input = unknown, Output = unknown>(
  definition: AgentryToolDefinition<Input, Output>,
): AgentryToolDefinition<Input, Output> & { parameters: JsonSchema } {
  return {
    ...definition,
    parameters: definition.parameters ?? EMPTY_PARAMETERS,
  };
}

export function defineCommand<Context = AgentryCommandContext>(
  definition: AgentryCommandDefinition<Context>,
): AgentryCommandDefinition<Context> {
  return { ...definition };
}

export function defineProvider<T extends AgentryProviderDefinition>(definition: T): T {
  return definition;
}

export function defineBusHandler<
  Payload = unknown,
  Result = unknown,
  Context extends AgentryBusHandlerContext = AgentryBusHandlerContext,
>(
  definition: AgentryBusHandlerDefinition<Payload, Result, Context>,
): AgentryBusHandlerDefinition<Payload, Result, Context> {
  return { ...definition };
}

export function requestBus<Result = unknown, Payload = unknown>(
  ctx: { bus?: Pick<AgentryEventBus, 'request'> | null },
  type: string,
  payload?: Payload,
  options?: Record<string, unknown>,
): Promise<Result> {
  if (!ctx.bus || typeof ctx.bus.request !== 'function') {
    throw new Error('plugin bus request unavailable');
  }
  return ctx.bus.request<Result>(type, payload, options);
}

export function registerTask(
  ctx: { bus?: Pick<AgentryEventBus, 'request'> | null },
  input: AgentryTaskRegisterInput,
): Promise<{ ok: true }> {
  return requestBus(ctx, 'task:register', input);
}

export function updateTask(
  ctx: { bus?: Pick<AgentryEventBus, 'request'> | null },
  input: AgentryTaskUpdateInput,
): Promise<{ ok: true; task: AgentryTaskRecord }> {
  return requestBus(ctx, 'task:update', input);
}

export function completeTask(
  ctx: { bus?: Pick<AgentryEventBus, 'request'> | null },
  taskId: string,
  result?: unknown,
): Promise<{ ok: true; task: AgentryTaskRecord }> {
  return requestBus(ctx, 'task:complete', { taskId, result });
}

export function failTask(
  ctx: { bus?: Pick<AgentryEventBus, 'request'> | null },
  taskId: string,
  error: unknown,
): Promise<{ ok: true; task: AgentryTaskRecord }> {
  return requestBus(ctx, 'task:fail', { taskId, error });
}

export function cancelTask(
  ctx: { bus?: Pick<AgentryEventBus, 'request'> | null },
  taskId: string,
  reason?: string,
): Promise<{ result: string; canceled: boolean }> {
  return requestBus(ctx, 'task:cancel', { taskId, reason });
}

export function scheduleTask(
  ctx: { bus?: Pick<AgentryEventBus, 'request'> | null },
  input: AgentryTaskScheduleInput,
): Promise<{ ok: true; schedule: AgentryTaskSchedule }> {
  return requestBus(ctx, 'task:schedule', input);
}

export function unscheduleTask(
  ctx: { bus?: Pick<AgentryEventBus, 'request'> | null },
  scheduleId: string,
): Promise<{ ok: true; removed: boolean }> {
  return requestBus(ctx, 'task:unschedule', { scheduleId });
}

export function sessionFileToMediaItem(file: AgentrySessionFile): AgentrySessionFileMediaItem {
  const fileId = firstText(file.fileId, file.id);
  if (!fileId) {
    throw new Error('SessionFile media item requires id or fileId');
  }

  const item: AgentrySessionFileMediaItem = {
    type: 'session_file',
    fileId,
  };
  assignDefined(item, 'sessionPath', file.sessionPath);
  assignDefined(item, 'filePath', file.filePath);
  assignDefined(item, 'label', firstText(file.label, file.displayName, file.filename));
  assignDefined(item, 'mime', file.mime);
  assignDefined(item, 'size', file.size);
  assignDefined(item, 'kind', file.kind);
  return item;
}

type AgentryMediaInput = AgentrySessionFile | AgentrySessionFileMediaItem | AgentryStagedSessionFile;

export function createMediaDetails(items: AgentryMediaInput[]): AgentryMediaDetails {
  return {
    media: {
      items: items.map(normalizeMediaItem),
    },
  };
}

export function defineExtension<Pi = unknown>(factory: AgentryExtensionFactory<Pi>): AgentryExtensionFactory<Pi> {
  return factory;
}

export function definePlugin(lifecycle: AgentryPluginLifecycle): new () => AgentryPluginInstance {
  return class DefinedHanaPlugin implements AgentryPluginInstance {
    ctx!: AgentryPluginContext;
    register!: (disposable: AgentryPluginDisposable) => void;

    async onload(): Promise<void> {
      await lifecycle.onload?.(this.ctx, { register: this.register });
    }

    async onunload(): Promise<void> {
      await lifecycle.onunload?.(this.ctx);
    }
  };
}

function normalizeMediaItem(input: AgentryMediaInput): AgentrySessionFileMediaItem {
  if (isRecord(input) && isRecord(input.mediaItem)) {
    return normalizeSessionFileMediaItem(input.mediaItem);
  }
  if (isRecord(input) && input.type === 'session_file') {
    return normalizeSessionFileMediaItem(input);
  }
  if (isRecord(input)) {
    return sessionFileToMediaItem(input);
  }
  throw new Error('media details item must be a SessionFile, staged file, or session_file media item');
}

function normalizeSessionFileMediaItem(input: Record<string, unknown>): AgentrySessionFileMediaItem {
  if (input.type !== 'session_file') {
    throw new Error('media details item must be a session_file media item');
  }
  const fileId = firstText(input.fileId);
  if (!fileId) {
    throw new Error('SessionFile media item requires fileId');
  }
  return {
    ...input,
    type: 'session_file',
    fileId,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function assignDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    target[key] = value;
  }
}
