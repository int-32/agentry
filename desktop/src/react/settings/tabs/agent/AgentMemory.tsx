import React, { useState, useEffect, useRef } from 'react';
import { useSettingsStore } from '../../store';
import { hanaFetch } from '../../api';
import { t, autoSaveConfig, savePins } from '../../helpers';
import { PinItem } from './AgentPins';
import { SettingsSection } from '../../components/SettingsSection';
import styles from '../../Settings.module.css';

export function MemorySection({ hasUtilityModel, memoryEnabled, isViewingOther, currentPins }: {
  hasUtilityModel: boolean;
  memoryEnabled: boolean;
  isViewingOther: boolean;
  currentPins: string[];
}) {
  const [pinInput, setPinInput] = useState('');
  const [selectedPinIndexes, setSelectedPinIndexes] = useState<Set<number>>(() => new Set());

  useEffect(() => {
    setSelectedPinIndexes(new Set());
  }, [currentPins]);

  const savePinList = (pins: string[]) => {
    const agentId = useSettingsStore.getState().getSettingsAgentId();
    useSettingsStore.setState({ currentPins: pins });
    savePins(pins, agentId);
  };

  const addPin = () => {
    const val = pinInput.trim();
    if (!val) return;
    const newPins = [...currentPins, val];
    setPinInput('');
    savePinList(newPins);
  };

  const deletePin = (index: number) => {
    const newPins = currentPins.filter((_, i) => i !== index);
    savePinList(newPins);
  };

  const togglePinSelection = (index: number, selected: boolean) => {
    setSelectedPinIndexes((current) => {
      const next = new Set(current);
      if (selected) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const selectedPinCount = selectedPinIndexes.size;
  const allPinsSelected = currentPins.length > 0 && selectedPinCount === currentPins.length;

  const toggleAllPins = () => {
    setSelectedPinIndexes(
      allPinsSelected
        ? new Set()
        : new Set(currentPins.map((_, index) => index)),
    );
  };

  const deleteSelectedPins = () => {
    if (selectedPinCount === 0) return;
    const newPins = currentPins.filter((_, index) => !selectedPinIndexes.has(index));
    setSelectedPinIndexes(new Set());
    savePinList(newPins);
  };

  /* 记忆开关作为 section title 右侧 context（和 WorkTab 的 AgentSelect 作 context 同构）
   * hasUtilityModel=false 时 toggle 禁用，below 显示提示 */
  const memoryToggle = (
    <button
      className={`hana-toggle${hasUtilityModel && memoryEnabled ? ' on' : ''}${!hasUtilityModel ? ' disabled' : ''}`}
      onClick={() => hasUtilityModel && autoSaveConfig({ memory: { enabled: !memoryEnabled } })}
      disabled={!hasUtilityModel}
      title={!hasUtilityModel ? t('settings.memory.needsUtilityModel') : undefined}
    />
  );

  return (
    <SettingsSection title={t('settings.memory.sectionTitle')} context={memoryToggle}>
      <div style={{ padding: 'var(--space-sm) var(--space-md)' }}>
        {!hasUtilityModel && (
          <p className={styles['settings-inline-note']} style={{ opacity: 0.6, marginTop: 0, marginBottom: 'var(--space-md)' }}>{t('settings.memory.needsUtilityModel')}</p>
        )}

        <div className={!hasUtilityModel || !memoryEnabled ? 'settings-disabled' : ''}>
          <div className={styles['settings-subsection']}>
            <div className={styles['settings-subsection-header']}>
              <h3 className={styles['settings-subsection-title']}>{t('settings.pins.title')}</h3>
              <span className={styles['settings-subsection-hint']}>{t('settings.pins.hint')}</span>
            </div>
            {currentPins.length > 0 && (
              <div className={styles['pin-bulk-row']}>
                <button className={styles['pin-bulk-btn']} onClick={toggleAllPins}>
                  {t(allPinsSelected ? 'settings.pins.clearSelection' : 'settings.pins.selectAll')}
                </button>
                <button
                  className={`${styles['pin-bulk-btn']} ${styles['danger']}`}
                  onClick={deleteSelectedPins}
                  disabled={selectedPinCount === 0}
                >
                  {t('settings.pins.deleteSelected', { count: selectedPinCount })}
                </button>
              </div>
            )}
            <div className={styles['pin-list']}>
              {currentPins.length === 0 ? (
                <div className={styles['pin-empty']}>{t('settings.pins.empty')}</div>
              ) : (
                currentPins.map((pin, i) => (
                  <PinItem
                    key={`${i}:${pin}`}
                    text={pin}
                    index={i}
                    selected={selectedPinIndexes.has(i)}
                    onSelectionChange={togglePinSelection}
                    onDelete={deletePin}
                  />
                ))
              )}
            </div>
            <div className={styles['pin-add-row']}>
              <input
                className={`${styles['settings-input']} ${styles['pin-add-input']}`}
                type="text"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPin(); } }}
                placeholder={t('settings.pins.addPlaceholder')}
              />
              <button className={styles['pin-add-btn']} onClick={addPin}>+</button>
            </div>
          </div>

          <div className={styles['settings-subsection']}>
            <div className={styles['settings-subsection-header']}>
              <h3 className={styles['settings-subsection-title']}>{t('settings.memory.compiled')}</h3>
              <span className={styles['settings-subsection-hint']}>{t('settings.memory.compiledHint')}</span>
            </div>
            <button
              className={`${styles['memory-action-btn']} ${styles['compiled-view-btn']}`}
              onClick={() => window.dispatchEvent(new Event('hana-view-compiled-memory'))}
            >
              {t('settings.memory.compiledView')}
            </button>
          </div>

          <div className={styles['settings-subsection']}>
            <h3 className={styles['settings-subsection-title']}>{t('settings.memory.allMemories')}</h3>
            <div className={`${styles['memory-actions-row']} ${styles['memory-actions-spaced']}`}>
              <button
                className={styles['memory-action-btn']}
                onClick={() => window.dispatchEvent(new Event('hana-view-memories'))}
              >
                {t('settings.memory.actions.view')}
              </button>
              <button
                className={`${styles['memory-action-btn']} ${styles['danger']}`}
                onClick={() => window.dispatchEvent(new Event('hana-show-clear-confirm'))}
              >
                {t('settings.memory.actions.clear')}
              </button>
              <MemoryMoreDropdown isViewingOther={isViewingOther} />
            </div>
          </div>
        </div>{/* settings-disabled wrapper */}
      </div>
    </SettingsSection>
  );
}

function MemoryMoreDropdown({ isViewingOther }: { isViewingOther: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Only actions needed — use getState() to avoid subscribing to the full store
  const getStore = () => useSettingsStore.getState();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  const exportMemories = async () => {
    setOpen(false);
    try {
      const aid = getStore().getSettingsAgentId();
      const res = await hanaFetch(`/api/memories/export?agentId=${aid}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      // eslint-disable-next-line no-restricted-syntax -- ephemeral download link for memory export
      const a = document.createElement('a');
      a.href = url;
      a.download = `hana-memories-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      getStore().showToast(t('settings.memory.actions.exportSuccess'), 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      getStore().showToast(t('settings.saveFailed') + ': ' + msg, 'error');
    }
  };

  const importMemories = async () => {
    setOpen(false);
    // eslint-disable-next-line no-restricted-syntax -- ephemeral file picker for memory import
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const entries = json.facts || json.memories;
        if (!Array.isArray(entries) || entries.length === 0) {
          getStore().showToast(t('settings.memory.actions.invalidFile'), 'error');
          return;
        }
        getStore().showToast(t('settings.memory.actions.importing'), 'success');
        const aid = getStore().getSettingsAgentId();
        const res = await hanaFetch(`/api/memories/import?agentId=${aid}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ facts: entries }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const importMsg = t('settings.memory.actions.importSuccess').replace('{count}', data.imported);
        getStore().showToast(importMsg, 'success');
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        getStore().showToast(t('settings.saveFailed') + ': ' + errMsg, 'error');
      }
    });
    input.click();
  };

  return (
    <div className={`${styles['memory-action-dropdown']}${open  ? ' ' + styles['open'] : ''}`} ref={ref}>
      <button className={`${styles['memory-action-btn']} ${styles['secondary']}`} onClick={() => setOpen(!open)}>
        <span>{t('settings.memory.actions.more')}</span>
        <svg className={styles['memory-more-arrow']} width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div className={styles['memory-more-popup']}>
        <button className={styles['memory-more-option']} onClick={exportMemories}>
          {t('settings.memory.actions.export')}
        </button>
        <button
          className={styles['memory-more-option']}
          onClick={importMemories}
          disabled={isViewingOther}
          title={isViewingOther ? t('settings.memory.activeOnly') : ''}
        >
          {t('settings.memory.actions.import')}
        </button>
      </div>
    </div>
  );
}
