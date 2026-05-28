import React, { useEffect, useRef, useState } from 'react';
import { hanaFetch } from '../api';
import { t } from '../helpers';
import { useSettingsStore } from '../store';
import { SettingsSection } from '../components/SettingsSection';
import { SettingsRow } from '../components/SettingsRow';
import styles from '../Settings.module.css';

type ProjectEntry = {
  id: string;
  name: string;
  workspaceRoot: string;
  docsRoot?: string;
  testCommand?: string;
  description?: string;
  modules?: string[];
  createdAt?: string;
  updatedAt?: string;
};

type Draft = {
  name: string;
  workspaceRoot: string;
  docsRoot: string;
  testCommand: string;
  description: string;
  modulesText: string;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  workspaceRoot: '',
  docsRoot: '',
  testCommand: '',
  description: '',
  modulesText: '',
};

function projectToDraft(project: ProjectEntry): Draft {
  return {
    name: project.name || '',
    workspaceRoot: project.workspaceRoot || '',
    docsRoot: project.docsRoot || '',
    testCommand: project.testCommand || '',
    description: project.description || '',
    modulesText: (project.modules || []).join(', '),
  };
}

function draftToPayload(draft: Draft) {
  return {
    name: draft.name.trim(),
    workspaceRoot: draft.workspaceRoot.trim(),
    docsRoot: draft.docsRoot.trim(),
    testCommand: draft.testCommand.trim(),
    description: draft.description.trim(),
    modules: draft.modulesText
      .split(',')
      .map(item => item.trim())
      .filter(Boolean),
  };
}

function PathPicker({
  value,
  placeholder,
  onPick,
  onClear,
}: {
  value: string;
  placeholder: string;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className={styles['settings-folder-picker']}>
      <input
        type="text"
        className={`${styles['settings-input']} ${styles['settings-folder-input']}`}
        readOnly
        value={value}
        placeholder={placeholder}
        onClick={onPick}
      />
      <button type="button" className={styles['settings-folder-browse']} onClick={onPick} aria-label={t('settings.projects.browse')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      {value && (
        <button type="button" className={styles['settings-folder-clear']} onClick={onClear} aria-label={t('settings.projects.clear')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function ProjectsTab() {
  const showToast = useSettingsStore(s => s.showToast);
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [formOpen, setFormOpen] = useState(false);
  const formAnchorRef = useRef<HTMLDivElement | null>(null);
  const shouldScrollToFormRef = useRef(false);

  const loadProjects = async () => {
    setLoading(true);
    try {
      const res = await hanaFetch('/api/projects');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (err: any) {
      showToast(`${t('settings.projects.loadFailed')}: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects().catch(() => {});
  }, []);

  useEffect(() => {
    if (!formOpen || !shouldScrollToFormRef.current) return;
    shouldScrollToFormRef.current = false;
    formAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [formOpen, editingId]);

  const updateDraft = (patch: Partial<Draft>) => {
    setDraft(prev => ({ ...prev, ...patch }));
  };

  const resetDraft = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setFormOpen(false);
  };

  const openCreateForm = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    shouldScrollToFormRef.current = true;
    setFormOpen(true);
  };

  const openEditForm = (project: ProjectEntry) => {
    setEditingId(project.id);
    setDraft(projectToDraft(project));
    shouldScrollToFormRef.current = true;
    setFormOpen(true);
  };

  const pickPath = async (field: 'workspaceRoot' | 'docsRoot') => {
    const folder = await window.platform?.selectFolder?.();
    if (!folder) return;
    updateDraft({ [field]: folder } as Partial<Draft>);
  };

  const saveProject = async () => {
    const payload = draftToPayload(draft);
    if (!payload.name) {
      showToast(t('settings.projects.nameRequired'), 'error');
      return;
    }
    if (!payload.workspaceRoot) {
      showToast(t('settings.projects.workspaceRequired'), 'error');
      return;
    }

    setSaving(true);
    try {
      const path = editingId ? `/api/projects/${encodeURIComponent(editingId)}` : '/api/projects';
      const res = await hanaFetch(path, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      showToast(t(editingId ? 'settings.projects.updated' : 'settings.projects.created'), 'success');
      resetDraft();
      await loadProjects();
    } catch (err: any) {
      showToast(`${t('settings.saveFailed')}: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const deleteProject = async (project: ProjectEntry) => {
    if (!window.confirm(t('settings.projects.deleteConfirm', { name: project.name }))) return;
    try {
      const res = await hanaFetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (editingId === project.id) resetDraft();
      showToast(t('settings.projects.deleted'), 'success');
      await loadProjects();
    } catch (err: any) {
      showToast(`${t('settings.projects.deleteFailed')}: ${err.message}`, 'error');
    }
  };

  return (
    <div className={`${styles['settings-tab-content']} ${styles['active']}`} data-tab="projects">
      <SettingsSection
        title={t('settings.projects.registryTitle')}
        context={
          <button type="button" className={styles['settings-save-btn-sm']} onClick={openCreateForm}>
            {t('settings.projects.newProject')}
          </button>
        }
      >
        {loading ? (
          <div className={styles['project-empty']}>{t('status.loading')}</div>
        ) : projects.length === 0 ? (
          <div className={styles['project-empty']}>{t('settings.projects.empty')}</div>
        ) : (
          <div className={styles['project-list']}>
            {projects.map(project => (
              <div key={project.id} className={styles['project-list-item']}>
                <div className={styles['project-list-main']}>
                  <div className={styles['project-list-title-row']}>
                    <div className={styles['project-list-title']}>{project.name}</div>
                    {project.modules && project.modules.length > 0 && (
                      <div className={styles['project-chip-row']}>
                        {project.modules.map(module => (
                          <span key={module} className={styles['project-chip']}>{module}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className={styles['project-path']} title={project.workspaceRoot}>
                    {t('settings.projects.workspaceRoot')}: {project.workspaceRoot}
                  </div>
                  {project.docsRoot && (
                    <div className={styles['project-path']} title={project.docsRoot}>
                      {t('settings.projects.docsRoot')}: {project.docsRoot}
                    </div>
                  )}
                  {project.testCommand && (
                    <div className={styles['project-command']} title={project.testCommand}>
                      {project.testCommand}
                    </div>
                  )}
                  {project.description && (
                    <div className={styles['project-description']}>{project.description}</div>
                  )}
                </div>
                <div className={styles['project-list-actions']}>
                  <button type="button" className={styles['settings-save-btn-ghost']} onClick={() => openEditForm(project)}>
                    {t('common.edit')}
                  </button>
                  <button type="button" className={`${styles['settings-save-btn-ghost']} ${styles['project-danger-action']}`} onClick={() => deleteProject(project)}>
                    {t('settings.projects.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {formOpen && (
        <div ref={formAnchorRef}>
          <SettingsSection title={t(editingId ? 'settings.projects.editProject' : 'settings.projects.newProject')}>
            <SettingsSection.Note>
              {t('settings.projects.desc')}
            </SettingsSection.Note>
            <SettingsRow
              layout="stacked"
              label={t('settings.projects.name')}
              control={
                <input
                  className={styles['settings-input']}
                  value={draft.name}
                  placeholder={t('settings.projects.namePlaceholder')}
                  onChange={event => updateDraft({ name: event.target.value })}
                />
              }
            />
            <SettingsRow
              layout="stacked"
              label={t('settings.projects.modules')}
              control={
                <input
                  className={styles['settings-input']}
                  value={draft.modulesText}
                  placeholder={t('settings.projects.modulesPlaceholder')}
                  onChange={event => updateDraft({ modulesText: event.target.value })}
                />
              }
            />
            <SettingsRow
              layout="stacked"
              label={t('settings.projects.workspaceRoot')}
              control={
                <PathPicker
                  value={draft.workspaceRoot}
                  placeholder={t('settings.projects.workspacePlaceholder')}
                  onPick={() => pickPath('workspaceRoot')}
                  onClear={() => updateDraft({ workspaceRoot: '' })}
                />
              }
            />
            <SettingsRow
              layout="stacked"
              label={t('settings.projects.docsRoot')}
              control={
                <PathPicker
                  value={draft.docsRoot}
                  placeholder={t('settings.projects.docsPlaceholder')}
                  onPick={() => pickPath('docsRoot')}
                  onClear={() => updateDraft({ docsRoot: '' })}
                />
              }
            />
            <SettingsRow
              layout="stacked"
              label={t('settings.projects.testCommand')}
              control={
                <input
                  className={styles['settings-input']}
                  value={draft.testCommand}
                  placeholder={t('settings.projects.testCommandPlaceholder')}
                  onChange={event => updateDraft({ testCommand: event.target.value })}
                />
              }
            />
            <SettingsRow
              layout="stacked"
              label={t('settings.projects.description')}
              control={
                <textarea
                  className={`${styles['settings-textarea']} ${styles['project-description-input']}`}
                  value={draft.description}
                  placeholder={t('settings.projects.descriptionPlaceholder')}
                  onChange={event => updateDraft({ description: event.target.value })}
                />
              }
            />
            <SettingsSection.Footer>
              <button type="button" className={styles['settings-save-btn-ghost']} onClick={resetDraft}>
                {t('common.cancel')}
              </button>
              <button type="button" className={styles['settings-save-btn-sm']} onClick={saveProject} disabled={saving}>
                {t('settings.save')}
              </button>
            </SettingsSection.Footer>
          </SettingsSection>
        </div>
      )}
    </div>
  );
}
