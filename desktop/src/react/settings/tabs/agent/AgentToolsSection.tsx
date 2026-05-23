import React, { useEffect, useRef } from "react";
import { t, autoSaveConfig } from "../../helpers";
import { Toggle } from "../../widgets/Toggle";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsRow } from "../../components/SettingsRow";
import styles from "../../Settings.module.css";

// Local copy of CONFIGURABLE_TOOL_NAMES. Frontend intentionally does NOT import
// from shared/tool-categories.js to keep the desktop bundle independent of
// node-only server code. Drift between this constant and the backend's
// shared/tool-categories.js is caught by tests/optional-tool-names-drift.test.js
// (Task 10b) which imports both and asserts equality.
const CONFIGURABLE_TOOL_NAMES = [
  "web_fetch",
  "todo_write",
  "create_artifact",
  "notify",
  "stage_files",
  "subagent",
  "channel",
  "record_experience",
  "recall_experience",
  "check_pending_tasks",
  "current_status",
  "wait",
  "stop_task",
  "terminal",
  "task_create",
  "task_orchestrate",
  "task_complete",
  "task_block",
  "task_heartbeat",
  "task_comment",
  "browser",
  "cron",
  "dm",
  "install_skill",
  "update_settings",
] as const;

type ConfigurableToolName = (typeof CONFIGURABLE_TOOL_NAMES)[number];
const CONFIGURABLE_TOOL_NAME_SET = new Set<string>(CONFIGURABLE_TOOL_NAMES);

function normalizeDisabledTools(disabled: string[]) {
  return (disabled || []).filter((name) => CONFIGURABLE_TOOL_NAME_SET.has(name));
}

interface Props {
  availableTools?: string[];
  disabled: string[];
  pluginTools?: PluginToolInfo[];
}

interface PluginToolInfo {
  name: string;
  description?: string;
  pluginId?: string;
  pluginName?: string;
  hidden?: boolean;
}

function normalizePluginTools(pluginTools?: PluginToolInfo[]) {
  if (!Array.isArray(pluginTools)) return [];
  return pluginTools.filter((tool) => tool && typeof tool.name === "string" && tool.name.trim());
}

function pluginToolHint(tool: PluginToolInfo) {
  const sourceName = tool.pluginName || tool.pluginId || "";
  const source = sourceName
    ? `${t("settings.agent.tools.pluginSource")}: ${sourceName}`
    : t("settings.agent.tools.pluginSource");
  return tool.description ? `${tool.description} · ${source}` : source;
}

export function AgentToolsSection({ availableTools, disabled, pluginTools }: Props) {
  // Only render rows for tools the agent actually has registered.
  // This naturally hides context-specific tools in environments where the
  // agent has no matching wiring.
  // If the field is absent (old backend / config still loading), render the
  // built-in configurable list. An explicit [] still means "no configurable tools".
  const renderable = Array.isArray(availableTools)
    ? CONFIGURABLE_TOOL_NAMES.filter((name) => availableTools.includes(name))
    : [...CONFIGURABLE_TOOL_NAMES];
  const renderablePluginTools = normalizePluginTools(pluginTools);

  // Toggle visual state is derived from the `disabled` prop (no useState),
  // but writes must be computed from the freshest known list, not the prop
  // captured at the previous render. Rapid-click-before-prop-refresh would
  // otherwise rebuild `newDisabled` from stale data and silently clobber the
  // earlier click. disabledRef tracks the latest known value (updated both
  // by prop sync below and optimistically after each toggleTool call) so
  // two consecutive toggles on different tools before the first PUT+GET
  // round-trip both survive.
  const normalizedDisabled = normalizeDisabledTools(disabled);
  const disabledRef = useRef(normalizedDisabled);
  useEffect(() => {
    disabledRef.current = normalizedDisabled;
  }, [normalizedDisabled]);

  const toggleTool = (name: ConfigurableToolName) => {
    const current = disabledRef.current;
    const currentlyOff = current.includes(name);
    const newDisabled = currentlyOff
      ? current.filter((n) => n !== name)
      : [...current, name];
    disabledRef.current = newDisabled;
    autoSaveConfig({ tools: { disabled: newDisabled } });
  };

  if (renderable.length === 0 && renderablePluginTools.length === 0) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.agent.tools.title")}>
      {renderable.length > 0 && (
        <SettingsSection.Note>
          {t("settings.agent.tools.description")}
        </SettingsSection.Note>
      )}
      {renderable.map((name) => {
        const isOn = !normalizedDisabled.includes(name);
        return (
          <SettingsRow
            key={name}
            data-tool-name={name}
            label={t(`settings.agent.tools.items.${name}.label`)}
            hint={t(`settings.agent.tools.items.${name}.summary`)}
            control={<Toggle on={isOn} onChange={() => toggleTool(name)} />}
          />
        );
      })}
      {renderablePluginTools.length > 0 && (
        <SettingsSection.Note>
          {t("settings.agent.tools.pluginDescription")}
        </SettingsSection.Note>
      )}
      {renderablePluginTools.map((tool) => (
        <SettingsRow
          key={`${tool.pluginId || ""}:${tool.name}`}
          data-plugin-tool-name={tool.name}
          label={tool.name}
          hint={pluginToolHint(tool)}
          control={
            <span className={styles["agent-plugin-tool-badge"]}>
              {t("settings.agent.tools.pluginBadge")}
            </span>
          }
        />
      ))}
    </SettingsSection>
  );
}
