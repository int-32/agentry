import React, { useState, useEffect, useRef } from 'react';
import { useSettingsStore } from '../../store';
import { t, savePins } from '../../helpers';
import styles from '../../Settings.module.css';

export function PinItem({
  text,
  index,
  selected,
  onSelectionChange,
  onDelete,
}: {
  text: string;
  index: number;
  selected: boolean;
  onSelectionChange: (index: number, selected: boolean) => void;
  onDelete: (i: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = () => {
    const val = editVal.trim();
    const pins = [...useSettingsStore.getState().currentPins];
    if (val && val !== text) {
      pins[index] = val;
      useSettingsStore.setState({ currentPins: pins });
      savePins(pins, useSettingsStore.getState().getSettingsAgentId());
    } else if (!val) {
      pins.splice(index, 1);
      useSettingsStore.setState({ currentPins: pins });
      savePins(pins, useSettingsStore.getState().getSettingsAgentId());
    }
    setEditing(false);
  };

  return (
    <div className={styles['pin-item']}>
      <input
        type="checkbox"
        className={styles['pin-item-checkbox']}
        checked={selected}
        onChange={(e) => onSelectionChange(index, e.target.checked)}
        aria-label={t('settings.pins.selectItem', { text })}
      />
      {editing ? (
        <input
          ref={inputRef}
          className={`${styles['settings-input']} ${styles['pin-edit-input']}`}
          value={editVal}
          onChange={(e) => setEditVal(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur(); }
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <span className={styles['pin-item-text']} title={text} onClick={() => { setEditVal(text); setEditing(true); }}>
          {text}
        </span>
      )}
      <div className={styles['pin-item-actions']}>
        <button className={`${styles['pin-item-action']} ${styles['delete']}`} title={t('settings.pins.delete')} onClick={() => onDelete(index)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
