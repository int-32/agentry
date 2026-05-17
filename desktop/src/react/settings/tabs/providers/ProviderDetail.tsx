import React, { useEffect, useState } from 'react';
import { useSettingsStore, type ProviderSummary } from '../../store';
import { hanaFetch } from '../../api';
import { invalidateConfigCache } from '../../../hooks/use-config';
import { t } from '../../helpers';
import { OAuthCredentials } from './OAuthCredentials';
import { ApiKeyCredentials } from './ApiKeyCredentials';
import { ProviderModelList } from './ProviderModelList';
import styles from '../../Settings.module.css';

export function ProviderDetail({ providerId, summary, isPresetSetup, presetInfo, onRefresh }: {
  providerId: string;
  summary: ProviderSummary;
  isPresetSetup?: boolean;
  presetInfo?: { label: string; value: string; url?: string; api?: string; local?: boolean };
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className={styles['pv-detail-inner']}>
      <div className={styles['pv-detail-header']}>
        <ProviderNameEditor
          providerId={providerId}
          displayName={summary.display_name || providerId}
          disabled={!!isPresetSetup}
          onRefresh={onRefresh}
        />
        {summary.can_delete && !isPresetSetup && (
          <ProviderDeleteButton
            providerId={providerId}
            displayName={summary.display_name || providerId}
            clearsBuiltInConfig={!!presetInfo}
            onRefresh={onRefresh}
          />
        )}
      </div>
      {summary.config_status === 'invalid' && (
        <div className={styles['pv-config-alert']}>
          {t('settings.providers.configInvalid')}
        </div>
      )}
      {summary.config_status === 'needs_setup' && summary.can_delete && !summary.config_error && (
        <div className={styles['pv-config-alert']}>
          {t('settings.providers.configIncomplete')}
        </div>
      )}
      {summary.supports_oauth ? (
        <OAuthCredentials providerId={providerId} summary={summary} onRefresh={onRefresh} />
      ) : (
        <ApiKeyCredentials
          providerId={providerId}
          summary={summary}
          isPresetSetup={isPresetSetup}
          presetInfo={presetInfo}
          onRefresh={onRefresh}
        />
      )}
      <ProviderModelList providerId={providerId} summary={summary} onRefresh={onRefresh} />
    </div>
  );
}

function ProviderNameEditor({
  providerId,
  displayName,
  disabled,
  onRefresh,
}: {
  providerId: string;
  displayName: string;
  disabled?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const showToast = useSettingsStore(s => s.showToast);
  const [value, setValue] = useState(displayName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(displayName);
  }, [displayName]);

  const save = async () => {
    if (disabled || saving) return;
    const nextName = value.trim();
    if (!nextName) {
      setValue(displayName);
      showToast(t('settings.providers.nameRequired'), 'error');
      return;
    }
    if (nextName === displayName) {
      setValue(nextName);
      return;
    }
    setSaving(true);
    try {
      const res = await hanaFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: { [providerId]: { display_name: nextName } } }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      invalidateConfigCache();
      showToast(t('settings.saved'), 'success');
      await onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
      setValue(displayName);
    } finally {
      setSaving(false);
    }
  };

  return (
    <input
      className={styles['pv-detail-title-input']}
      aria-label={t('settings.api.displayName')}
      value={value}
      disabled={disabled || saving}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => { void save(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setValue(displayName);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function ProviderDeleteButton({
  providerId,
  displayName,
  clearsBuiltInConfig,
  onRefresh,
}: {
  providerId: string;
  displayName: string;
  clearsBuiltInConfig?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const showToast = useSettingsStore(s => s.showToast);
  const [confirming, setConfirming] = useState(false);
  const actionLabel = clearsBuiltInConfig
    ? t('settings.providers.clearConfig')
    : t('settings.providers.delete');

  const handleDelete = async () => {
    try {
      const res = await hanaFetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: { [providerId]: null } }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      invalidateConfigCache();
      showToast(
        clearsBuiltInConfig
          ? t('settings.providers.clearedConfig', { name: displayName })
          : t('settings.providers.deleted', { name: displayName }),
        'success',
      );
      if (!clearsBuiltInConfig) useSettingsStore.setState({ selectedProviderId: null });
      setConfirming(false);
      await onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    }
  };

  return (
    <>
      <button className={styles['pv-delete-btn']} onClick={() => setConfirming(true)}>
        {actionLabel}
      </button>
      {confirming && (
        <>
          <div className={styles['pv-model-edit-overlay']} onClick={() => setConfirming(false)} />
          <div className={styles['pv-confirm-dialog']}>
            <p className={styles['pv-confirm-text']}>
              {clearsBuiltInConfig
                ? t('settings.providers.clearConfigConfirm', { name: displayName })
                : t('settings.providers.deleteConfirm', { name: displayName })}
            </p>
            <div className={styles['pv-confirm-actions']}>
              <button className={styles['pv-add-form-btn']} onClick={() => setConfirming(false)}>{t('settings.api.cancel')}</button>
              <button className={`${styles['pv-add-form-btn']} ${styles['danger']}`} onClick={handleDelete}>{actionLabel}</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
