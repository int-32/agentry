import { useCallback, useEffect, useMemo, useState } from 'react';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import { Toggle } from '../widgets/Toggle';
import { useSettingsStore } from '../store';
import {
  approvalKey,
  approvalMeta,
  summarizeComputerPermissions,
  type ApprovedApp,
} from './computer-use-ui';
import styles from '../Settings.module.css';

interface ComputerProviderStatus {
  providerId: string;
  status?: {
    available?: boolean;
    reason?: string;
    error?: string;
    permissions?: Array<{ name?: string; granted?: boolean }>;
  };
}

interface ComputerUseStatusResponse {
  selectedProviderId?: string | null;
  status?: {
    enabled?: boolean;
    platform?: string;
    supported?: boolean;
    selectedProviderId?: string | null;
    activeLease?: {
      leaseId?: string;
      agentId?: string | null;
      appId?: string | null;
      providerId?: string | null;
    } | null;
    providers?: ComputerProviderStatus[];
  } | null;
  settings?: {
    enabled?: boolean;
    provider_by_platform?: Record<string, string>;
    allow_windows_input_injection?: boolean;
    app_approvals?: ApprovedApp[];
  };
}

function StatusText({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span style={{
      color: ok ? 'var(--accent)' : 'var(--text-muted)',
      fontSize: '0.78rem',
      whiteSpace: 'nowrap',
      maxWidth: 280,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}>
      {text}
    </span>
  );
}

function ApprovedAppsControl({
  approvals,
  revokingKey,
  onRevoke,
}: {
  approvals: ApprovedApp[];
  revokingKey: string | null;
  onRevoke: (approval: ApprovedApp) => void;
}) {
  if (!approvals.length) {
    return <StatusText ok={false} text={t('settings.computerUse.approvalsEmpty')} />;
  }
  return (
    <div style={{ display: 'grid', gap: 6, minWidth: 240, maxWidth: 420 }}>
      {approvals.map((item) => {
        const key = approvalKey(item);
        const meta = approvalMeta(item);
        return (
          <div
            key={key}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <span
              title={`${item.providerId} · ${item.appId}`}
              style={{
                minWidth: 0,
                overflow: 'hidden',
                color: 'var(--text)',
              }}
            >
              <span style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.78rem',
              }}>
                {item.appName || item.appId}
              </span>
              <span style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: '0.68rem',
                color: 'var(--text-muted)',
              }}>
                {meta}
              </span>
            </span>
            <button
              type="button"
              className={styles['settings-save-btn-ghost']}
              onClick={() => onRevoke(item)}
              disabled={revokingKey === key}
              style={{ minWidth: 56, padding: '4px 8px' }}
            >
              {t('settings.computerUse.revokeApproval')}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function ComputerUseTab() {
  const [data, setData] = useState<ComputerUseStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [revokingKey, setRevokingKey] = useState<string | null>(null);
  const showToast = useSettingsStore((state) => state.showToast);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await hanaFetch('/api/preferences/computer-use');
      setData(await res.json());
    } catch (err) {
      console.warn('[computer-use] load status failed:', err);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const relevantEvents = new Set([
      'computer-use-settings-changed',
      'computer-use-permissions-requested',
    ]);
    const onLocalSettings = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (relevantEvents.has(detail?.type)) void load();
    };
    window.addEventListener('hana-settings', onLocalSettings);
    const cleanup = window.platform?.onSettingsChanged?.((type: string) => {
      if (relevantEvents.has(type)) void load();
    });
    return () => {
      window.removeEventListener('hana-settings', onLocalSettings);
      if (typeof cleanup === 'function') cleanup();
    };
  }, [load]);

  const selectedProvider = useMemo(() => {
    const id = data?.selectedProviderId || null;
    return data?.status?.providers?.find((provider) => provider.providerId === id) || null;
  }, [data]);
  const platform = data?.status?.platform || null;
  const providerOptions = useMemo(() => {
    const providers = data?.status?.providers || [];
    const selectedId = data?.selectedProviderId || data?.status?.selectedProviderId || null;
    const out = [...providers];
    if (selectedId && !out.some((provider) => provider.providerId === selectedId)) {
      out.unshift({ providerId: selectedId, status: { available: false } });
    }
    return out;
  }, [data]);

  const enabled = data?.settings?.enabled === true;
  const windowsInputInjection = data?.settings?.allow_windows_input_injection === true;
  const showWindowsInputInjection = platform === 'win32';
  const available = selectedProvider?.status?.available === true;
  const availabilityIssue = selectedProvider?.status?.reason || selectedProvider?.status?.error || '';
  const permissions = selectedProvider?.status?.permissions || [];
  const permissionState = summarizeComputerPermissions(permissions);
  const approvals = data?.settings?.app_approvals || [];
  const activeLease = data?.status?.activeLease;
  const activeLeaseText = activeLease
    ? activeLease.appId || activeLease.agentId || activeLease.leaseId || t('settings.computerUse.active')
    : t('settings.computerUse.idle');

  const saveEnabled = async (next: boolean) => {
    setSaving(true);
    try {
      const res = await hanaFetch('/api/preferences/computer-use', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { enabled: next } }),
      });
      const body = await res.json();
      setData((prev) => ({
        ...(prev || {}),
        settings: {
          ...(prev?.settings || {}),
          ...(body.settings || {}),
        },
      }));
    } finally {
      setSaving(false);
    }
  };

  const saveProvider = async (providerId: string) => {
    if (!platform || !providerId || providerId === data?.selectedProviderId) return;
    setSaving(true);
    try {
      const providerByPlatform = {
        ...(data?.settings?.provider_by_platform || {}),
        [platform]: providerId,
      };
      const res = await hanaFetch('/api/preferences/computer-use', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { provider_by_platform: providerByPlatform } }),
      });
      const body = await res.json();
      setData((prev) => ({
        ...(prev || {}),
        selectedProviderId: providerId,
        status: prev?.status ? { ...prev.status, selectedProviderId: providerId } : prev?.status,
        settings: {
          ...(prev?.settings || {}),
          ...(body.settings || {}),
        },
      }));
    } finally {
      setSaving(false);
    }
  };

  const saveWindowsInputInjection = async (next: boolean) => {
    setSaving(true);
    try {
      const res = await hanaFetch('/api/preferences/computer-use', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { allow_windows_input_injection: next } }),
      });
      const body = await res.json();
      setData((prev) => ({
        ...(prev || {}),
        settings: {
          ...(prev?.settings || {}),
          ...(body.settings || {}),
        },
      }));
    } finally {
      setSaving(false);
    }
  };

  const revokeApproval = async (approval: ApprovedApp) => {
    const key = approvalKey(approval);
    setRevokingKey(key);
    try {
      const res = await hanaFetch('/api/preferences/computer-use/approvals', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: approval.providerId, appId: approval.appId }),
      });
      const body = await res.json();
      setData((prev) => ({
        ...(prev || {}),
        settings: {
          ...(prev?.settings || {}),
          ...(body.settings || {}),
        },
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`${t('settings.computerUse.revokeApprovalFailed')}: ${message}`, 'error');
    } finally {
      setRevokingKey(null);
    }
  };

  const requestPermissions = async () => {
    setRequesting(true);
    try {
      const res = await hanaFetch('/api/preferences/computer-use/request-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: data?.selectedProviderId || undefined }),
      });
      const body = await res.json();
      const result = body?.result;
      if (result?.providerId && Array.isArray(result.permissions)) {
        setData((prev) => ({
          ...(prev || {}),
          status: prev?.status ? {
            ...prev.status,
            providers: (prev.status.providers || []).map((provider) =>
              provider.providerId === result.providerId
                ? { ...provider, status: { ...(provider.status || {}), permissions: result.permissions } }
                : provider
            ),
          } : prev?.status,
        }));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`${t('settings.computerUse.requestPermissionsFailed')}: ${message}`, 'error');
    } finally {
      setRequesting(false);
    }
  };

  const refreshButton = (
    <button
      className={styles['settings-save-btn-sm']}
      onClick={load}
      disabled={loading}
      style={{ minWidth: 72 }}
    >
      {t('settings.computerUse.refresh')}
    </button>
  );

  const permissionsButton = (
    <button
      className={styles['settings-save-btn-sm']}
      onClick={requestPermissions}
      disabled={requesting || loading || !data?.selectedProviderId}
      style={{ minWidth: 120 }}
    >
      {requesting ? t('settings.computerUse.checkingPermissions') : permissionState.buttonLabel}
    </button>
  );

  const providerControl = (
    <select
      value={data?.selectedProviderId || ''}
      onChange={(event) => saveProvider(event.target.value)}
      disabled={saving || loading || !platform || providerOptions.length === 0}
      style={{
        minWidth: 180,
        maxWidth: 280,
        height: 28,
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontSize: '0.78rem',
        padding: '0 8px',
      }}
    >
      {providerOptions.length === 0 && <option value="">{data?.selectedProviderId || '-'}</option>}
      {providerOptions.map((provider) => {
        const isAvailable = provider.status?.available === true;
        const isSelected = provider.providerId === data?.selectedProviderId;
        const label = isAvailable
          ? provider.providerId
          : `${provider.providerId} (${t('settings.computerUse.unavailable')})`;
        return (
          <option key={provider.providerId} value={provider.providerId} disabled={!isAvailable && !isSelected}>
            {label}
          </option>
        );
      })}
    </select>
  );

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="computer">
      <SettingsSection title={t('settings.computerUse.title')} context={refreshButton}>
        <SettingsSection.Warning data-testid="computer-use-experimental-warning">
          {t('settings.computerUse.experimentalWarning')}
        </SettingsSection.Warning>
        <SettingsSection.Note>
          {t('settings.computerUse.description')}
        </SettingsSection.Note>
        <SettingsRow
          label={t('settings.computerUse.enabled')}
          hint={t('settings.computerUse.enabledHint')}
          control={<Toggle on={enabled} onChange={(next) => saveEnabled(next)} disabled={saving || loading} />}
        />
        {showWindowsInputInjection && (
          <SettingsRow
            label={t('settings.computerUse.windowsInputInjection')}
            hint={t('settings.computerUse.windowsInputInjectionHint')}
            control={<Toggle on={windowsInputInjection} onChange={(next) => saveWindowsInputInjection(next)} disabled={saving || loading} />}
          />
        )}
        <SettingsRow
          label={t('settings.computerUse.provider')}
          control={providerControl}
        />
        <SettingsRow
          label={t('settings.computerUse.availability')}
          hint={availabilityIssue || undefined}
          control={<StatusText ok={available} text={available ? t('settings.computerUse.available') : t('settings.computerUse.unavailable')} />}
        />
        <SettingsRow
          label={t('settings.computerUse.permissions')}
          hint={permissionState.granted ? t('settings.computerUse.permissionsGrantedHint') : t('settings.computerUse.permissionsHint')}
          control={permissionsButton}
        />
        <SettingsRow
          label={t('settings.computerUse.permissionsStatus')}
          control={<StatusText ok={permissionState.ok} text={permissionState.text} />}
        />
        <SettingsRow
          label={t('settings.computerUse.approvals')}
          control={<ApprovedAppsControl approvals={approvals} revokingKey={revokingKey} onRevoke={revokeApproval} />}
        />
        <SettingsRow
          label={t('settings.computerUse.activeSession')}
          control={<StatusText ok={!activeLease} text={activeLeaseText} />}
        />
      </SettingsSection>
    </div>
  );
}
