import { useCallback, useEffect, useMemo, useState } from 'react';
import { hanaFetch } from '../../api';
import { t } from '../../helpers';
import { SettingsSection } from '../../components/SettingsSection';
import { SettingsRow } from '../../components/SettingsRow';
import { summarizeComputerPermissions } from '../computer-use-ui';
import styles from '../../Settings.module.css';

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
    providers?: ComputerProviderStatus[];
  } | null;
  settings?: {
    app_approvals?: Array<{ providerId: string; appId: string; appName?: string }>;
  };
}

function StatusText({ ok, text }: { ok: boolean; text: string }) {
  return (
    <span style={{
      color: ok ? 'var(--accent)' : 'var(--text-muted)',
      fontSize: '0.78rem',
      whiteSpace: 'nowrap',
      maxWidth: 260,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}>
      {text}
    </span>
  );
}

export function ComputerUseStatusSection({ visible }: { visible: boolean }) {
  const [data, setData] = useState<ComputerUseStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!visible) return;
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
  }, [visible]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!visible) return undefined;
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
  }, [load, visible]);

  const selectedProvider = useMemo(() => {
    const id = data?.selectedProviderId || null;
    return data?.status?.providers?.find((provider) => provider.providerId === id) || null;
  }, [data]);

  if (!visible) return null;

  const available = selectedProvider?.status?.available === true;
  const permissions = selectedProvider?.status?.permissions || [];
  const permissionState = summarizeComputerPermissions(permissions);
  const approvals = data?.settings?.app_approvals || [];
  const approvalsText = approvals.length > 0
    ? approvals.map((item) => item.appName || item.appId).join(' · ')
    : t('settings.agent.computerUse.approvalsEmpty');

  const refreshButton = (
    <button
      className={styles['settings-save-btn-sm']}
      onClick={load}
      disabled={loading}
      style={{ minWidth: 72 }}
    >
      {t('settings.agent.computerUse.refresh')}
    </button>
  );

  return (
    <SettingsSection title={t('settings.agent.computerUse.title')} context={refreshButton}>
      <SettingsSection.Note>
        {t('settings.agent.computerUse.description')}
      </SettingsSection.Note>
      <SettingsRow
        label={t('settings.agent.computerUse.provider')}
        control={<StatusText ok={!!data?.selectedProviderId} text={data?.selectedProviderId || '-'} />}
      />
      <SettingsRow
        label={t('settings.agent.computerUse.availability')}
        hint={selectedProvider?.status?.reason || selectedProvider?.status?.error || undefined}
        control={<StatusText ok={available} text={available ? t('settings.agent.computerUse.available') : t('settings.agent.computerUse.unavailable')} />}
      />
      <SettingsRow
        label={t('settings.agent.computerUse.permissions')}
        control={<StatusText ok={permissionState.ok} text={permissionState.text} />}
      />
      <SettingsRow
        label={t('settings.agent.computerUse.approvals')}
        control={<StatusText ok={approvals.length > 0} text={approvalsText} />}
      />
    </SettingsSection>
  );
}
