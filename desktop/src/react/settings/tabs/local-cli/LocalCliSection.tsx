/**
 * LocalCliSection — Providers Tab 顶部的「本机 Agent CLI」独立区块
 *
 * agentry 之独家差异：与"云端 LLM 供应商"概念分层，按 PATH 扫描显示已装
 * agent CLI（claude / codex / gemini / qwen-code / opencode）+ 模型清单。
 */

import React, { useCallback, useEffect, useState } from "react";
import { hanaFetch } from "../../api";
import { SettingsSection } from "../../components/SettingsSection";

interface CliInfo {
  id: string;
  binary: string;
  displayName: string;
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  modelsCount: number;
}

interface ModelInfo {
  id: string;
  name: string;
  context: number | null;
  maxOutput: number | null;
  image: boolean;
  reasoning: boolean;
}

export function LocalCliSection() {
  const [cliS, setCliS] = useState<CliInfo[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [models, setModels] = useState<Record<string, ModelInfo[]>>({});
  const [scanning, setScanning] = useState(false);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await hanaFetch("/api/local-cli/scan");
      const data = await res.json();
      setCliS(data.clis || []);
    } catch (err) {
      console.warn("[local-cli] scan failed:", err);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { scan(); }, [scan]);

  const loadModels = useCallback(async (id: string) => {
    if (models[id]) return;
    try {
      const res = await hanaFetch(`/api/local-cli/${id}/models`);
      const data = await res.json();
      setModels(prev => ({ ...prev, [id]: data.models || [] }));
    } catch (err) {
      console.warn(`[local-cli] models for ${id} failed:`, err);
    }
  }, [models]);

  const toggleExpand = (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    loadModels(id);
  };

  return (
    <SettingsSection title="本机 Agent CLI">
      <div style={{ padding: "var(--space-md)", fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
        以下 CLI 经本机 PATH 扫得，无需 API key —— 用本机已 login 之 OAuth 即可。
        启用任一 CLI 即可在 agent 配置中选用其模型。
      </div>

      <div style={{ padding: "0 var(--space-md) var(--space-md)", display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
        {!cliS && <div style={{ color: "var(--text-muted)" }}>扫描中…</div>}
        {cliS && cliS.length === 0 && <div style={{ color: "var(--text-muted)" }}>无已知 CLI</div>}
        {cliS && cliS.map(cli => {
          const isExpanded = expanded === cli.id;
          const modelList = models[cli.id];
          return (
            <div
              key={cli.id}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                background: cli.installed ? "var(--bg-card)" : "var(--overlay-light)",
                opacity: cli.installed ? 1 : 0.55,
              }}
            >
              <button
                onClick={() => cli.installed && toggleExpand(cli.id)}
                disabled={!cli.installed}
                style={{
                  width: "100%",
                  padding: "var(--space-sm) var(--space-md)",
                  background: "transparent",
                  border: "none",
                  textAlign: "left",
                  cursor: cli.installed ? "pointer" : "default",
                  color: "var(--text)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  fontSize: "0.9rem",
                }}
              >
                <span
                  style={{
                    width: 8, height: 8, borderRadius: "50%",
                    background: cli.installed ? "var(--green, #6A8C5A)" : "var(--text-muted)",
                    flex: "0 0 8px",
                  }}
                />
                <span style={{ fontWeight: 500 }}>{cli.displayName}</span>
                {cli.version && <span style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>v{cli.version}</span>}
                {cli.installed && (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginLeft: "auto" }}>
                    {cli.modelsCount} 模型 {isExpanded ? "▴" : "▾"}
                  </span>
                )}
                {!cli.installed && (
                  <span style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginLeft: "auto" }}>
                    未装
                  </span>
                )}
              </button>

              {isExpanded && (
                <div style={{ padding: "0 var(--space-md) var(--space-sm)", borderTop: "1px solid var(--border)" }}>
                  {cli.binaryPath && (
                    <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", padding: "var(--space-xs) 0" }}>
                      路径：<code>{cli.binaryPath}</code>
                    </div>
                  )}
                  {!modelList && <div style={{ padding: "var(--space-xs) 0", color: "var(--text-muted)", fontSize: "0.78rem" }}>载入模型…</div>}
                  {modelList && modelList.length === 0 && (
                    <div style={{ padding: "var(--space-xs) 0", color: "var(--text-muted)", fontSize: "0.78rem" }}>
                      暂未维护模型清单
                    </div>
                  )}
                  {modelList && modelList.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "var(--space-xs) 0 var(--space-sm)" }}>
                      {modelList.slice(0, 30).map(m => (
                        <div key={m.id} style={{ fontSize: "0.78rem", display: "flex", gap: "var(--space-sm)", alignItems: "baseline" }}>
                          <code style={{ color: "var(--text)" }}>{m.id}</code>
                          <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>{m.name}</span>
                          {m.context && <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>{Math.round(m.context / 1000)}K</span>}
                          {m.reasoning && <span style={{ color: "var(--accent)", fontSize: "0.7rem" }}>R</span>}
                          {m.image && <span style={{ color: "var(--accent)", fontSize: "0.7rem" }}>V</span>}
                        </div>
                      ))}
                      {modelList.length > 30 && (
                        <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>… 还有 {modelList.length - 30} 个</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ padding: "0 var(--space-md) var(--space-md)" }}>
        <button
          onClick={scan}
          disabled={scanning}
          style={{
            padding: "var(--space-xs) var(--space-md)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg-card)",
            color: "var(--text)",
            cursor: scanning ? "default" : "pointer",
            fontSize: "0.8rem",
          }}
        >
          {scanning ? "扫描中…" : "重新扫描 PATH"}
        </button>
      </div>
    </SettingsSection>
  );
}
