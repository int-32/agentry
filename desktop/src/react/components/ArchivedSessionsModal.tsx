import { useCallback, useEffect, useMemo, useState } from 'react';
import { useI18n } from '../hooks/use-i18n';
import { Overlay } from '../ui';
import {
  listArchivedSessions,
  restoreSession,
  deleteArchivedSession,
  cleanupArchivedSessions,
  showSidebarToast,
  loadSessions,
  type ArchivedSession,
} from '../stores/session-actions';
import styles from './ArchivedSessionsModal.module.css';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function formatAgo(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400_000);
  if (days < 1) return t('time.today');
  if (days === 1) return t('time.yesterday');
  return t('session.archived.daysAgo', { days });
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ArchivedSessionsModal({ open, onClose }: Props) {
  const { t } = useI18n();
  const [list, setList] = useState<ArchivedSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    setList(await listArchivedSessions());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setSelectedPaths(new Set());
      return;
    }
    setSelectedPaths((prev) => {
      const valid = new Set(list.map((item) => item.path));
      const next = new Set([...prev].filter((path) => valid.has(path)));
      return next.size === prev.size ? prev : next;
    });
  }, [list, open]);

  const totalSize = list.reduce((s, x) => s + x.sizeBytes, 0);
  const selectedItems = useMemo(
    () => list.filter((item) => selectedPaths.has(item.path)),
    [list, selectedPaths],
  );
  const selectedSize = selectedItems.reduce((s, x) => s + x.sizeBytes, 0);
  const selectedCount = selectedItems.length;
  const allSelected = list.length > 0 && selectedCount === list.length;

  const toggleSelected = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedPaths((prev) => (
      list.length > 0 && prev.size === list.length
        ? new Set()
        : new Set(list.map((item) => item.path))
    ));
  };

  const handleRestore = async (p: string) => {
    if (!window.confirm(t('session.archived.restoreConfirm'))) return;
    const r = await restoreSession(p);
    if (r === 'conflict') {
      showSidebarToast(t('session.archived.restoreConflict'));
      return;
    }
    if (r === 'error') {
      showSidebarToast(t('session.archived.restoreFailed'));
      return;
    }
    await refresh();
    // 恢复后主列表应同步刷新
    await loadSessions();
  };

  const handleDelete = async (p: string) => {
    if (!window.confirm(t('session.archived.deleteConfirm'))) return;
    const ok = await deleteArchivedSession(p);
    if (ok) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        next.delete(p);
        return next;
      });
      await refresh();
    }
    else showSidebarToast(t('session.archived.deleteFailed'));
  };

  const handleDeleteSelected = async () => {
    if (selectedItems.length === 0) return;
    const msg = t('session.archived.deleteSelectedConfirm', {
      count: selectedItems.length,
      size: formatBytes(selectedSize),
    });
    if (!window.confirm(msg)) return;

    const results = await Promise.all(
      selectedItems.map(async (item) => ({
        path: item.path,
        ok: await deleteArchivedSession(item.path),
      })),
    );
    const deleted = results.filter((result) => result.ok).length;
    const failed = results.length - deleted;

    setSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const result of results) {
        if (result.ok) next.delete(result.path);
      }
      return next;
    });

    if (deleted > 0) {
      await refresh();
    }
    if (failed > 0 && deleted > 0) {
      showSidebarToast(t('session.archived.deleteSelectedPartial', { deleted, failed }));
    } else if (failed > 0) {
      showSidebarToast(t('session.archived.deleteSelectedFailed', { count: failed }));
    } else {
      showSidebarToast(t('session.archived.deleteSelectedDone', { count: deleted }));
    }
  };

  const handleCleanup = async (days: 30 | 90) => {
    const toDelete = list.filter(
      (x) => Date.now() - new Date(x.archivedAt).getTime() > days * 86400_000,
    );
    if (toDelete.length === 0) {
      showSidebarToast(t('session.archived.cleanupNoMatch'));
      return;
    }
    const size = toDelete.reduce((s, x) => s + x.sizeBytes, 0);
    const msg = t('session.archived.cleanupConfirm', {
      count: toDelete.length,
      size: formatBytes(size),
    });
    if (!window.confirm(msg)) return;
    const { deleted } = await cleanupArchivedSessions(days);
    showSidebarToast(t('session.archived.cleanupDone', { count: deleted }));
    await refresh();
  };

  return (
    <Overlay
      open={open}
      onClose={onClose}
      backdrop="blur"
      zIndex={1000}
      className={styles.modal}
      disableContainerAnimation
    >
        <div className={styles.header}>
          <h2 className={styles.title}>{t('session.archived.title')}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryText}>
              {t('session.archived.stats', {
                count: list.length,
                size: formatBytes(totalSize),
              })}
            </span>
            <div className={styles.cleanupBtns}>
              <button onClick={() => handleCleanup(30)}>
                {t('session.archived.cleanup30')}
              </button>
              <button onClick={() => handleCleanup(90)}>
                {t('session.archived.cleanup90')}
              </button>
            </div>
          </div>

          <div className={styles.listCard}>
            {list.length > 0 && (
              <div className={styles.bulkBar}>
                <label className={styles.selectAllLabel}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label={t('session.archived.selectAll')}
                  />
                  <span>{t('session.archived.selectAll')}</span>
                </label>
                <div className={styles.bulkActions}>
                  <span className={styles.selectedText}>
                    {t('session.archived.selectedStats', {
                      count: selectedCount,
                      size: formatBytes(selectedSize),
                    })}
                  </span>
                  <button
                    className={styles.dangerBtn}
                    onClick={handleDeleteSelected}
                    disabled={selectedCount === 0}
                  >
                    {t('session.archived.deleteSelected', { count: selectedCount })}
                  </button>
                </div>
              </div>
            )}
            <div className={styles.list}>
              {loading ? (
                <div className={styles.loading}>{t('common.loading')}</div>
              ) : list.length === 0 ? (
                <div className={styles.empty}>{t('session.archived.empty')}</div>
              ) : (
                list.map((item) => (
                  <div key={item.path} className={styles.row}>
                    <label className={styles.rowSelect}>
                      <input
                        type="checkbox"
                        checked={selectedPaths.has(item.path)}
                        onChange={() => toggleSelected(item.path)}
                        aria-label={t('session.archived.selectItem', {
                          title: item.title || t('session.untitled'),
                        })}
                      />
                    </label>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>
                        {item.title || t('session.untitled')}
                      </div>
                      <div className={styles.rowMeta}>
                        {item.agentName} · {formatAgo(item.archivedAt, t)} ·{' '}
                        {formatBytes(item.sizeBytes)}
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        title={t('session.archived.restore')}
                        onClick={() => handleRestore(item.path)}
                      >
                        {t('session.archived.restore')}
                      </button>
                      <button
                        title={t('session.archived.deleteForever')}
                        onClick={() => handleDelete(item.path)}
                      >
                        {t('session.archived.deleteForever')}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
    </Overlay>
  );
}
