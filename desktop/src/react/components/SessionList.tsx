/**
 * SessionList — 侧边栏 session 列表 React 组件
 *
 * Phase 6B: 替代 sidebar-shim.ts 中的 renderSessionList / createSessionItem。
 * 通过 portal 渲染到 #sessionList，从 Zustand sessions 状态驱动。
 */

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../stores';
import { hanaFetch } from '../hooks/use-hana-fetch';
import { useI18n } from '../hooks/use-i18n';
import { formatSessionDate } from '../utils/format';
import { switchSession, archiveSession, renameSession, pinSession } from '../stores/session-actions';
import { updateKeyed } from '../stores/create-keyed-slice';
import type { Session, Agent } from '../types';
import { AgentAvatar, resolveAgentDisplayInfo } from '../utils/agent-display';
import {
  autoProjectIdForCwd,
  buildSessionProjectView,
  buildSessionSections,
  type SessionProjectCatalog,
  type SessionProjectGroup,
  type SessionViewMode,
} from './session-sections';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { renderMarkdown } from '../utils/markdown';
import styles from './SessionList.module.css';

const SESSION_VIEW_MODE_KEY = 'hana-session-sidebar-view-mode';
const SESSION_DRAG_MIME = 'application/x-hana-session-path';
const PROJECT_DRAG_MIME = 'application/x-hana-project-id';

const EMPTY_PROJECT_CATALOG: SessionProjectCatalog = { projects: [] };

type SidebarDragState =
  | { kind: 'session'; sessionPath: string }
  | { kind: 'project'; projectId: string }
  | null;

type ProjectNameDialogState =
  | { kind: 'create-project'; value: string }
  | { kind: 'rename-project'; projectId: string; value: string }
  | null;

type ProjectActionMenuState = {
  position: { x: number; y: number };
  project: SessionProjectGroup;
} | null;

interface BrowserSessionState {
  url: string | null;
  running: boolean;
  resumable: boolean;
  unavailableReason: string | null;
}

interface SessionSearchResult extends Session {
  matchKind: 'title' | 'content';
  snippet: string;
  score?: number;
}

function normalizeBrowserSessionStates(data: unknown): Record<string, BrowserSessionState> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const result: Record<string, BrowserSessionState> = {};
  for (const [sessionPath, rawState] of Object.entries(data as Record<string, unknown>)) {
    if (typeof rawState === 'string') {
      result[sessionPath] = {
        url: rawState,
        running: false,
        resumable: true,
        unavailableReason: null,
      };
      continue;
    }
    if (!rawState || typeof rawState !== 'object' || Array.isArray(rawState)) continue;
    const state = rawState as Partial<BrowserSessionState>;
    result[sessionPath] = {
      url: typeof state.url === 'string' ? state.url : null,
      running: state.running === true,
      resumable: state.resumable !== false,
      unavailableReason: typeof state.unavailableReason === 'string' ? state.unavailableReason : null,
    };
  }
  return result;
}

function normalizeSessionSearchResults(data: unknown): SessionSearchResult[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  return results.flatMap((raw): SessionSearchResult[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Partial<SessionSearchResult>;
    if (typeof item.path !== 'string' || !item.path) return [];
    return [{
      path: item.path,
      title: typeof item.title === 'string' ? item.title : null,
      firstMessage: typeof item.firstMessage === 'string' ? item.firstMessage : '',
      modified: typeof item.modified === 'string' ? item.modified : '',
      messageCount: typeof item.messageCount === 'number' ? item.messageCount : 0,
      agentId: typeof item.agentId === 'string' ? item.agentId : null,
      agentName: typeof item.agentName === 'string' ? item.agentName : null,
      cwd: typeof item.cwd === 'string' ? item.cwd : null,
      projectId: typeof item.projectId === 'string' ? item.projectId : null,
      pinnedAt: typeof item.pinnedAt === 'string' ? item.pinnedAt : null,
      hasSummary: item.hasSummary === true,
      rcAttachment: null,
      matchKind: item.matchKind === 'content' ? 'content' : 'title',
      snippet: typeof item.snippet === 'string' ? item.snippet : '',
      score: typeof item.score === 'number' ? item.score : undefined,
    }];
  });
}

function readInitialSessionViewMode(): SessionViewMode {
  try {
    return window.localStorage?.getItem(SESSION_VIEW_MODE_KEY) === 'project' ? 'project' : 'time';
  } catch {
    return 'time';
  }
}

function normalizeProjectCatalog(data: unknown): SessionProjectCatalog {
  const raw = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { catalog?: unknown }).catalog
    : null;
  const catalog = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Partial<SessionProjectCatalog>
    : EMPTY_PROJECT_CATALOG;
  return {
    projects: Array.isArray(catalog.projects) ? catalog.projects : [],
  };
}

function dragSessionPath(event: React.DragEvent, state: SidebarDragState): string | null {
  const fromState = state?.kind === 'session' ? state.sessionPath : null;
  return event.dataTransfer.getData(SESSION_DRAG_MIME) || fromState;
}

function dragProjectId(event: React.DragEvent, state: SidebarDragState): string | null {
  const fromState = state?.kind === 'project' ? state.projectId : null;
  return event.dataTransfer.getData(PROJECT_DRAG_MIME) || fromState;
}

// ── 主组件 ──

export function SessionList() {
  return <SessionListInner />;
}

// ── 内部组件 ──

function SessionListInner() {
  const { t } = useI18n();
  const sessions = useStore(s => s.sessions);
  const currentSessionPath = useStore(s => s.currentSessionPath);
  const pendingSessionSwitchPath = useStore(s => s.pendingSessionSwitchPath);
  const pendingNewSession = useStore(s => s.pendingNewSession);
  const agents = useStore(s => s.agents);
  const streamingSessions = useStore(s => s.streamingSessions);
  const browserBySession = useStore(s => s.browserBySession);

  const [browserSessions, setBrowserSessions] = useState<Record<string, BrowserSessionState>>({});
  const [viewMode, setViewModeState] = useState<SessionViewMode>(readInitialSessionViewMode);
  const [projectCatalog, setProjectCatalog] = useState<SessionProjectCatalog>(EMPTY_PROJECT_CATALOG);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [projectMenuPosition, setProjectMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [projectActionMenu, setProjectActionMenu] = useState<ProjectActionMenuState>(null);
  const [projectNameDialog, setProjectNameDialog] = useState<ProjectNameDialogState>(null);
  const [dragState, setDragState] = useState<SidebarDragState>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [titleResults, setTitleResults] = useState<SessionSearchResult[]>([]);
  const [contentResults, setContentResults] = useState<SessionSearchResult[]>([]);
  const [searchStatus, setSearchStatus] = useState<'idle' | 'title' | 'content' | 'done' | 'error'>('idle');
  const closingBrowserSessionsRef = useRef(new Set<string>());
  const projectNameInputRef = useRef<HTMLInputElement>(null);
  const searchQueryTrimmed = searchQuery.trim();
  const sessionsSignature = useMemo(() => (
    sessions.map(s => `${s.path}:${s.title || ''}:${s.modified || ''}:${s.messageCount}:${s.projectId || ''}`).join('\n')
  ), [sessions]);

  const setVisibleBrowserSessions = useCallback((data: unknown) => {
    const states = normalizeBrowserSessionStates(data);
    for (const sessionPath of closingBrowserSessionsRef.current) {
      delete states[sessionPath];
    }
    setBrowserSessions(states);
  }, []);

  // Fetch browser sessions (re-fetch when browser state changes)
  useEffect(() => {
    let cancelled = false;
    if (sessions.length === 0) {
      setBrowserSessions({});
      return;
    }
    hanaFetch('/api/browser/session-states')
      .then(r => r.json())
      .then(data => {
        if (!cancelled) setVisibleBrowserSessions(data);
      })
      .catch(err => console.warn('[sessions] fetch browser sessions failed:', err));
    return () => {
      cancelled = true;
    };
  }, [sessions, browserBySession, setVisibleBrowserSessions]);

  useEffect(() => {
    if (!searchQueryTrimmed) {
      setTitleResults([]);
      setContentResults([]);
      setSearchStatus('idle');
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setTitleResults([]);
    setContentResults([]);
    setSearchStatus('title');

    const timer = window.setTimeout(async () => {
      const encodedQuery = encodeURIComponent(searchQueryTrimmed);
      try {
        const titleRes = await hanaFetch(`/api/sessions/search?q=${encodedQuery}&phase=title&limit=20`, {
          signal: controller.signal,
          timeout: 12_000,
        });
        const titleData = await titleRes.json();
        if (cancelled) return;
        setTitleResults(normalizeSessionSearchResults(titleData));
        setSearchStatus('content');

        const contentRes = await hanaFetch(`/api/sessions/search?q=${encodedQuery}&phase=content&limit=20`, {
          signal: controller.signal,
          timeout: 12_000,
        });
        const contentData = await contentRes.json();
        if (cancelled) return;
        setContentResults(normalizeSessionSearchResults(contentData));
        setSearchStatus('done');
      } catch (err) {
        if (controller.signal.aborted || cancelled) return;
        console.warn('[sessions] search failed:', err);
        setSearchStatus('error');
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchQueryTrimmed, sessionsSignature]);

  const setViewMode = useCallback((mode: SessionViewMode) => {
    setViewModeState(mode);
    try {
      window.localStorage?.setItem(SESSION_VIEW_MODE_KEY, mode);
    } catch {
      // localStorage can be unavailable in tests or privacy modes.
    }
  }, []);

  useEffect(() => {
    if (viewMode !== 'project') return;
    let cancelled = false;
    hanaFetch('/api/session-projects')
      .then(res => res.json())
      .then(data => {
        if (!cancelled) setProjectCatalog(normalizeProjectCatalog(data));
      })
      .catch(err => console.warn('[sessions] fetch project catalog failed:', err));
    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  useEffect(() => {
    if (!projectNameDialog) return;
    window.setTimeout(() => {
      projectNameInputRef.current?.focus();
      projectNameInputRef.current?.select();
    }, 0);
  }, [projectNameDialog]);

  const handleCloseBrowserSession = useCallback(async (sessionPath: string) => {
    closingBrowserSessionsRef.current.add(sessionPath);
    setBrowserSessions(prev => {
      const next = { ...prev };
      delete next[sessionPath];
      return next;
    });
    try {
      const res = await hanaFetch('/api/browser/close-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionPath }),
      });
      const data = await res.json();
      updateKeyed('browserBySession', sessionPath, { running: false, url: null, thumbnail: null });
      closingBrowserSessionsRef.current.delete(sessionPath);
      if (data?.sessions) {
        setBrowserSessions(normalizeBrowserSessionStates(data.sessions));
      }
    } catch (err) {
      closingBrowserSessionsRef.current.delete(sessionPath);
      console.warn('[sessions] close browser session failed:', err);
    }
  }, []);

  const updateSessionProjectAssignment = useCallback(async (sessionPath: string, projectId: string | null) => {
    await hanaFetch('/api/session-projects/session-assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionPath, projectId }),
    });
    useStore.setState(state => ({
      sessions: state.sessions.map(session => session.path === sessionPath
        ? { ...session, projectId }
        : session),
    }));
  }, []);

  const patchProject = useCallback(async (projectId: string, patch: { folderId?: string | null; name?: string }) => {
    const res = await hanaFetch(`/api/session-projects/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    const project = data?.project;
    if (!project || typeof project.id !== 'string') return null;
    setProjectCatalog(catalog => ({
      ...catalog,
      projects: catalog.projects.some(item => item.id === project.id)
        ? catalog.projects.map(item => item.id === project.id ? project : item)
        : [...catalog.projects, project],
    }));
    return project;
  }, []);

  const reorderProjects = useCallback(async (folderId: string | null, projectIds: string[]) => {
    const res = await hanaFetch('/api/session-projects/projects/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId, projectIds }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.catalog) {
      setProjectCatalog(normalizeProjectCatalog({ catalog: data.catalog }));
    }
  }, []);

  const createProject = useCallback(async (name: string) => {
    const res = await hanaFetch('/api/session-projects/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, folderId: null }),
    });
    const data = await res.json().catch(() => ({}));
    if (data?.project) {
      setProjectCatalog(catalog => ({ ...catalog, projects: [...catalog.projects, data.project] }));
    }
  }, []);

  const handleProjectNameDialogSubmit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectNameDialog) return;
    const name = projectNameDialog.value.trim();
    if (!name) return;
    if (projectNameDialog.kind === 'create-project') {
      await createProject(name);
    } else {
      await patchProject(projectNameDialog.projectId, { name });
    }
    setProjectNameDialog(null);
  }, [createProject, patchProject, projectNameDialog]);

  const handleSessionDragStart = useCallback((event: React.DragEvent, session: Session) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(SESSION_DRAG_MIME, session.path);
    setDragState({ kind: 'session', sessionPath: session.path });
  }, []);

  const handleProjectDragStart = useCallback((event: React.DragEvent, projectId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(PROJECT_DRAG_MIME, projectId);
    setDragState({ kind: 'project', projectId });
  }, []);

  const clearDragState = useCallback(() => {
    setDragState(null);
    setDropTargetId(null);
  }, []);

  const ensureCatalogProject = useCallback(async (project: SessionProjectGroup) => {
    if (projectCatalog.projects.some(item => item.id === project.id)) return;
    await patchProject(project.id, { name: project.name });
  }, [patchProject, projectCatalog.projects]);

  const handleDropOnProject = useCallback(async (event: React.DragEvent, project: SessionProjectGroup) => {
    event.preventDefault();
    const sessionPath = dragSessionPath(event, dragState);
    const projectId = dragProjectId(event, dragState);
    clearDragState();
    if (sessionPath) {
      const session = sessions.find(item => item.path === sessionPath) || null;
      const ownCwdProject = session ? autoProjectIdForCwd(session.cwd) : null;
      const assignmentId = project.source === 'cwd' && ownCwdProject === project.id ? null : project.id;
      await updateSessionProjectAssignment(sessionPath, assignmentId);
      return;
    }
    if (projectId && projectId !== project.id) {
      const visibleProjects = buildSessionProjectView(sessions, projectCatalog).rootProjects;
      const draggedProject = visibleProjects.find(item => item.id === projectId) || null;
      if (!draggedProject) return;
      const nextProjectIds = visibleProjects
        .map(item => item.id)
        .filter(id => id !== projectId);
      const insertIndex = nextProjectIds.indexOf(project.id);
      nextProjectIds.splice(insertIndex >= 0 ? insertIndex : nextProjectIds.length, 0, projectId);
      for (const id of nextProjectIds) {
        const visibleProject = visibleProjects.find(item => item.id === id);
        if (visibleProject) await ensureCatalogProject(visibleProject);
      }
      await reorderProjects(null, nextProjectIds);
    }
  }, [clearDragState, dragState, ensureCatalogProject, projectCatalog, reorderProjects, sessions, updateSessionProjectAssignment]);

  const activeSessionPath = pendingSessionSwitchPath || currentSessionPath;
  const renderSessionItem = (s: Session, options: { draggable?: boolean } = {}) => (
    <SessionItem
      key={s.path}
      session={s}
      isActive={!pendingNewSession && s.path === activeSessionPath}
      isStreaming={streamingSessions.includes(s.path)}
      isPinned={!!s.pinnedAt}
      agents={agents}
      browserState={browserSessions[s.path] || null}
      onCloseBrowser={handleCloseBrowserSession}
      draggable={options.draggable === true}
      onDragStart={handleSessionDragStart}
      onDragEnd={clearDragState}
    />
  );

  const sections = buildSessionSections(sessions, { mode: 'time' });
  const projectView = buildSessionProjectView(sessions, projectCatalog);
  const titleResultPaths = new Set(titleResults.map(result => result.path));
  const visibleContentResults = contentResults.filter(result => !titleResultPaths.has(result.path));
  const hasSearchResults = titleResults.length > 0 || visibleContentResults.length > 0;
  const isSearching = !!searchQueryTrimmed;
  const showEmptyState = sessions.length === 0 && !isSearching;
  const renderSortMenuButton = () => (
    <button
      type="button"
      className={styles.sectionIconButton}
      aria-label={t('sidebar.view.sort')}
      title={t('sidebar.view.sort')}
      onClick={(event) => setProjectMenuPosition({ x: event.clientX, y: event.clientY })}
    >
      <ListFilterIcon />
    </button>
  );
  const handleToggleProjectCollapsed = useCallback((projectId: string) => {
    setCollapsedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }, []);
  const handleProjectNameChange = useCallback((value: string) => {
    setProjectNameDialog(dialog => dialog ? { ...dialog, value } : dialog);
  }, []);
  const hasTodaySection = sections.some(section => section.kind === 'date' && section.group === 'today');
  const timeContent = sections.map(section => {
    const items = section.items.map(s => renderSessionItem(s));

    if (section.kind === 'pinned') {
      return (
        <section key={section.id} className={styles.pinnedSection}>
          <SectionTitle className={styles.pinnedSectionTitle}>
            <span>{t(section.titleKey)}</span>
            <PinIcon />
          </SectionTitle>
          {items}
        </section>
      );
    }

    return (
      <Fragment key={section.id}>
        <SectionTitle
          actions={section.group === 'today' ? renderSortMenuButton() : null}
        >
          <span>{t(section.titleKey)}</span>
        </SectionTitle>
        {items}
      </Fragment>
    );
  });
  if (!hasTodaySection && !showEmptyState) {
    const pinnedIndex = sections.findIndex(section => section.kind === 'pinned');
    timeContent.splice(Math.max(0, pinnedIndex + 1), 0, (
      <SectionTitle key="date:today-empty" actions={renderSortMenuButton()}>
        <span>{t('time.today')}</span>
      </SectionTitle>
    ));
  }
  const content = showEmptyState ? (
    <div className={styles.sessionEmpty}>{t('sidebar.empty')}</div>
  ) : isSearching ? (
    <SessionSearchResults
      titleResults={titleResults}
      contentResults={visibleContentResults}
      status={searchStatus}
      hasResults={hasSearchResults}
      agents={agents}
      activeSessionPath={activeSessionPath}
      pendingNewSession={pendingNewSession}
    />
  ) : viewMode === 'project' ? (
    <ProjectSessionView
      view={projectView}
      renderSessionItem={(session) => renderSessionItem(session, { draggable: true })}
      collapsedProjectIds={collapsedProjectIds}
      dragState={dragState}
      dropTargetId={dropTargetId}
      setDropTargetId={setDropTargetId}
      onToggleProject={handleToggleProjectCollapsed}
      onProjectDragStart={handleProjectDragStart}
      onDragEnd={clearDragState}
      onDropProject={handleDropOnProject}
      onOpenMenu={setProjectMenuPosition}
      onCreateProject={() => setProjectNameDialog({ kind: 'create-project', value: '' })}
      onOpenProjectMenu={(position, project) => setProjectActionMenu({ position, project })}
    />
  ) : timeContent;

  return (
    <>
      <SessionSearchBox
        value={searchQuery}
        onChange={setSearchQuery}
        onClear={() => setSearchQuery('')}
      />
      <div className={styles.sessionListScroller}>
        {content}
      </div>
      {projectMenuPosition && (
        <ContextMenu
          position={projectMenuPosition}
          onClose={() => setProjectMenuPosition(null)}
          items={[
            {
              label: t('sidebar.view.time'),
              checked: viewMode === 'time',
              action: () => setViewMode('time'),
            },
            {
              label: t('sidebar.view.project'),
              checked: viewMode === 'project',
              action: () => setViewMode('project'),
            },
          ]}
        />
      )}
      {projectActionMenu && (
        <ContextMenu
          position={projectActionMenu.position}
          onClose={() => setProjectActionMenu(null)}
          items={[
            {
              label: t('sidebar.projects.renameProject'),
              action: () => setProjectNameDialog({
                kind: 'rename-project',
                projectId: projectActionMenu.project.id,
                value: projectActionMenu.project.name,
              }),
            },
          ]}
        />
      )}
      {projectNameDialog && (
        <ProjectNameDialog
          dialog={projectNameDialog}
          inputRef={projectNameInputRef}
          onChange={handleProjectNameChange}
          onSubmit={handleProjectNameDialogSubmit}
          onClose={() => setProjectNameDialog(null)}
        />
      )}
    </>
  );
}

function SectionTitle({
  children,
  actions = null,
  className = '',
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.sessionSectionTitle}${className ? ` ${className}` : ''}`}>
      <div className={styles.sessionSectionTitleMain}>{children}</div>
      {actions && <div className={styles.sectionTitleActions}>{actions}</div>}
    </div>
  );
}

function ProjectNameDialog({
  dialog,
  inputRef,
  onChange,
  onSubmit,
  onClose,
}: {
  dialog: NonNullable<ProjectNameDialogState>;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleKey = dialog.kind === 'create-project'
    ? 'sidebar.projects.newProject'
    : 'sidebar.projects.renameProject';
  const placeholderKey = 'sidebar.projects.newProjectPrompt';
  const actionKey = dialog.kind === 'rename-project'
    ? 'sidebar.projects.save'
    : 'sidebar.projects.createAction';

  return createPortal(
    <div
      className={styles.projectNameDialogBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className={styles.projectNameDialog} onSubmit={onSubmit}>
        <div className={styles.projectNameDialogTitle}>{t(titleKey)}</div>
        <input
          ref={inputRef}
          className={styles.projectNameInput}
          value={dialog.value}
          placeholder={t(placeholderKey)}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
          }}
        />
        <div className={styles.projectNameDialogActions}>
          <button type="button" onClick={onClose}>{t('sidebar.projects.cancel')}</button>
          <button type="submit" disabled={!dialog.value.trim()}>{t(actionKey)}</button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function ProjectSessionView({
  view,
  renderSessionItem,
  collapsedProjectIds,
  dragState,
  dropTargetId,
  setDropTargetId,
  onToggleProject,
  onProjectDragStart,
  onDragEnd,
  onDropProject,
  onOpenMenu,
  onCreateProject,
  onOpenProjectMenu,
}: {
  view: ReturnType<typeof buildSessionProjectView>;
  renderSessionItem: (session: Session) => React.ReactNode;
  collapsedProjectIds: Set<string>;
  dragState: SidebarDragState;
  dropTargetId: string | null;
  setDropTargetId: (id: string | null) => void;
  onToggleProject: (projectId: string) => void;
  onProjectDragStart: (event: React.DragEvent, projectId: string) => void;
  onDragEnd: () => void;
  onDropProject: (event: React.DragEvent, project: SessionProjectGroup) => void;
  onOpenMenu: (position: { x: number; y: number }) => void;
  onCreateProject: () => void;
  onOpenProjectMenu: (position: { x: number; y: number }, project: SessionProjectGroup) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <section className={styles.pinnedSection}>
        <SectionTitle className={styles.pinnedSectionTitle}>
          <span>{t('sidebar.pinned')}</span>
          <PinIcon />
        </SectionTitle>
        {view.pinned.map(session => renderSessionItem(session))}
      </section>
      <SectionTitle
        actions={(
          <>
            <button
              type="button"
              className={styles.sectionIconButton}
              aria-label={t('sidebar.projects.create')}
              title={t('sidebar.projects.create')}
              onClick={onCreateProject}
            >
              <ProjectPlusIcon />
            </button>
            <button
              type="button"
              className={styles.sectionIconButton}
              aria-label={t('sidebar.view.sort')}
              title={t('sidebar.view.sort')}
              onClick={(event) => onOpenMenu({ x: event.clientX, y: event.clientY })}
            >
              <ListFilterIcon />
            </button>
          </>
        )}
      >
        <span>{t('sidebar.projects.title')}</span>
      </SectionTitle>
      <div
        className={`${styles.projectRootDrop}${dropTargetId === 'root' ? ` ${styles.dropTarget}` : ''}`}
        onDragOver={(event) => {
          if (dragState?.kind !== 'project') return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropTargetId('root');
        }}
        onDragLeave={() => setDropTargetId(null)}
      >
        {view.rootProjects.map(project => (
          <ProjectBlock
            key={project.id}
            project={project}
            expanded={!collapsedProjectIds.has(project.id)}
            onToggle={() => onToggleProject(project.id)}
            renderSessionItem={renderSessionItem}
            dropTargetId={dropTargetId}
            setDropTargetId={setDropTargetId}
            onProjectDragStart={onProjectDragStart}
            onDragEnd={onDragEnd}
            onDropProject={onDropProject}
            onOpenProjectMenu={onOpenProjectMenu}
          />
        ))}
      </div>
      {view.rootProjects.length === 0 && (
        <div className={styles.sessionEmpty}>{t('sidebar.projects.empty')}</div>
      )}
    </>
  );
}

function ProjectBlock({
  project,
  expanded,
  onToggle,
  renderSessionItem,
  dropTargetId,
  setDropTargetId,
  onProjectDragStart,
  onDragEnd,
  onDropProject,
  onOpenProjectMenu,
}: {
  project: SessionProjectGroup;
  expanded: boolean;
  onToggle: () => void;
  renderSessionItem: (session: Session) => React.ReactNode;
  dropTargetId: string | null;
  setDropTargetId: (id: string | null) => void;
  onProjectDragStart: (event: React.DragEvent, projectId: string) => void;
  onDragEnd: () => void;
  onDropProject: (event: React.DragEvent, project: SessionProjectGroup) => void;
  onOpenProjectMenu: (position: { x: number; y: number }, project: SessionProjectGroup) => void;
}) {
  const visibleItems = expanded ? project.items : [];
  const lastDragEndAtRef = useRef(0);
  return (
    <div className={styles.projectBlock}>
      <div
        className={`${styles.projectRow}${dropTargetId === project.id ? ` ${styles.dropTarget}` : ''}`}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        draggable
        onClick={() => {
          if (Date.now() - lastDragEndAtRef.current < 250) return;
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          onToggle();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          onOpenProjectMenu({ x: event.clientX, y: event.clientY }, project);
        }}
        onDragStart={(event) => onProjectDragStart(event, project.id)}
        onDragEnd={() => {
          lastDragEndAtRef.current = Date.now();
          onDragEnd();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropTargetId(project.id);
        }}
        onDragLeave={() => setDropTargetId(null)}
        onDrop={(event) => onDropProject(event, project)}
      >
        <FolderIcon />
        <span className={styles.projectName}>{project.name}</span>
      </div>
      <div className={styles.projectSessionList}>
        {visibleItems.map(session => renderSessionItem(session))}
      </div>
    </div>
  );
}

function FolderIcon() {
  return (
    <svg className={styles.projectIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7.5a2 2 0 0 1 2-2h4.2l2 2H19a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function ListFilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M7 12h10" />
      <path d="M10 17h4" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg className={styles.pinnedTitleIcon} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M8 9h8" />
    </svg>
  );
}

function ProjectPlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4.8" y="4.8" width="14.4" height="14.4" rx="4.2" />
      <path d="M8.8 12h6.4" />
      <path d="M12 8.8v6.4" />
    </svg>
  );
}

function SessionSearchBox({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={styles.sessionSearchBox}>
      <svg className={styles.sessionSearchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        className={styles.sessionSearchInput}
        value={value}
        placeholder={t('sidebar.searchPlaceholder')}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className={styles.sessionSearchClear}
          aria-label={t('sidebar.searchClear')}
          onClick={onClear}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SessionSearchResults({
  titleResults,
  contentResults,
  status,
  hasResults,
  agents,
  activeSessionPath,
  pendingNewSession,
}: {
  titleResults: SessionSearchResult[];
  contentResults: SessionSearchResult[];
  status: 'idle' | 'title' | 'content' | 'done' | 'error';
  hasResults: boolean;
  agents: Agent[];
  activeSessionPath: string | null;
  pendingNewSession: boolean;
}) {
  const { t } = useI18n();

  if (status === 'error') {
    return <div className={styles.sessionSearchEmpty}>{t('sidebar.searchFailed')}</div>;
  }

  return (
    <>
      {titleResults.length > 0 && (
        <SessionSearchSection
          title={t('sidebar.searchTitleMatches')}
          results={titleResults}
          agents={agents}
          activeSessionPath={activeSessionPath}
          pendingNewSession={pendingNewSession}
        />
      )}
      {status === 'title' && (
        <div className={styles.sessionSearchStatus}>{t('sidebar.searchingTitles')}</div>
      )}
      {(contentResults.length > 0 || status === 'content') && (
        <SessionSearchSection
          title={t('sidebar.searchContentMatches')}
          results={contentResults}
          agents={agents}
          activeSessionPath={activeSessionPath}
          pendingNewSession={pendingNewSession}
          placeholder={status === 'content' && contentResults.length === 0 ? t('sidebar.searchingContent') : null}
        />
      )}
      {status === 'done' && !hasResults && (
        <div className={styles.sessionSearchEmpty}>{t('sidebar.searchNoResults')}</div>
      )}
    </>
  );
}

function SessionSearchSection({
  title,
  results,
  agents,
  activeSessionPath,
  pendingNewSession,
  placeholder = null,
}: {
  title: string;
  results: SessionSearchResult[];
  agents: Agent[];
  activeSessionPath: string | null;
  pendingNewSession: boolean;
  placeholder?: string | null;
}) {
  return (
    <section className={styles.sessionSearchSection}>
      <div className={styles.sessionSearchSectionTitle}>{title}</div>
      {placeholder ? (
        <div className={styles.sessionSearchStatus}>{placeholder}</div>
      ) : results.map(result => (
        <SessionSearchItem
          key={`${result.matchKind}:${result.path}`}
          result={result}
          isActive={!pendingNewSession && result.path === activeSessionPath}
          agents={agents}
        />
      ))}
    </section>
  );
}

const SessionSearchItem = memo(function SessionSearchItem({
  result,
  isActive,
  agents,
}: {
  result: SessionSearchResult;
  isActive: boolean;
  agents: Agent[];
}) {
  const { t } = useI18n();
  const parts: string[] = [];
  if (result.agentName || result.agentId) parts.push(result.agentName || result.agentId!);
  if (result.cwd) {
    const dirName = result.cwd.split(/[/\\]/).filter(Boolean).pop();
    if (dirName) parts.push(dirName);
  }
  if (result.modified) parts.push(formatSessionDate(result.modified));

  const handleClick = useCallback(() => {
    switchSession(result.path);
  }, [result.path]);

  return (
    <button
      className={`${styles.sessionSearchItem}${isActive ? ` ${styles.sessionSearchItemActive}` : ''}`}
      data-session-path={result.path}
      onClick={handleClick}
    >
      <div className={styles.sessionItemHeader}>
        {result.agentId && (
          <AgentBadge agentId={result.agentId} agentName={result.agentName} agents={agents} />
        )}
        <div className={styles.sessionItemTitle}>
          {result.title || result.firstMessage || t('session.untitled')}
        </div>
      </div>
      <div className={styles.sessionItemMeta}>{parts.join(' · ')}</div>
      {result.snippet && (
        <div className={styles.sessionSearchSnippet}>{result.snippet}</div>
      )}
    </button>
  );
});

// ── Session Item ──

const SessionItem = memo(function SessionItem({ session: s, isActive, isStreaming, isPinned, agents, browserState, onCloseBrowser, draggable = false, onDragStart, onDragEnd }: {
  session: Session;
  isActive: boolean;
  isStreaming: boolean;
  isPinned: boolean;
  agents: Agent[];
  browserState: BrowserSessionState | null;
  onCloseBrowser: (sessionPath: string) => void;
  draggable?: boolean;
  onDragStart?: (event: React.DragEvent, session: Session) => void;
  onDragEnd?: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [summaryPreviewPosition, setSummaryPreviewPosition] = useState<{ x: number; y: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    if (editing) return;
    switchSession(s.path);
  }, [s.path, editing]);

  const handleArchive = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    archiveSession(s.path);
  }, [s.path]);

  const handlePin = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    pinSession(s.path, !isPinned);
  }, [s.path, isPinned]);

  const beginRename = useCallback(() => {
    setEditValue(s.title || s.firstMessage || '');
    setEditing(true);
  }, [s.title, s.firstMessage]);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    beginRename();
  }, [beginRename]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    setEditing(false);
    if (trimmed && trimmed !== (s.title || s.firstMessage || '')) {
      renameSession(s.path, trimmed);
    }
  }, [editValue, s.path, s.title, s.firstMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditing(false);
    }
  }, [commitRename]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSummaryPreviewPosition(null);
    setMenuPosition({ x: e.clientX, y: e.clientY });
  }, []);

  // Auto-focus input when editing starts
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Meta line
  const parts: string[] = [];
  if (s.agentName || s.agentId) parts.push(s.agentName || s.agentId!);
  if (s.cwd) {
    const dirName = s.cwd.split(/[/\\]/).filter(Boolean).pop();
    if (dirName) parts.push(dirName);
  }
  if (s.modified) parts.push(formatSessionDate(s.modified));
  const rcLabel = s.rcAttachment ? `${formatRcPlatform(s.rcAttachment.platform)} 接管中` : null;
  const browserUrl = browserState?.url || null;
  const browserTitle = [
    browserUrl,
    browserState?.unavailableReason,
    t('browser.close'),
  ].filter(Boolean).join('\n');

  const handleBrowserClose = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCloseBrowser(s.path);
  }, [onCloseBrowser, s.path]);

  const handleBrowserKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    handleBrowserClose(e);
  }, [handleBrowserClose]);

  return (
    <>
      <button
        className={`${styles.sessionItem}${isActive ? ` ${styles.sessionItemActive}` : ''}`}
        data-session-path={s.path}
        draggable={draggable && !editing}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDragStart={draggable ? (event) => onDragStart?.(event, s) : undefined}
        onDragEnd={draggable ? onDragEnd : undefined}
      >
        <div className={styles.sessionItemHeader}>
          {s.agentId && (
            <AgentBadge agentId={s.agentId} agentName={s.agentName} agents={agents} />
          )}
          {isStreaming && <span className={styles.sessionStreamingDot} />}
          {editing ? (
            <input
              ref={inputRef}
              className={styles.sessionRenameInput}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commitRename}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <div className={styles.sessionItemTitle}>
              {s.title || s.firstMessage || t('session.untitled')}
            </div>
          )}
        </div>

        {!editing && (
          <div className={styles.sessionPinBtn} title={t(isPinned ? 'session.unpin' : 'session.pin')} onClick={handlePin}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 17v5" />
              <path d="M5 17h14" />
              <path d="M7 3h10l-2 9H9L7 3z" />
              <path d="M9 12l-2 5h10l-2-5" />
            </svg>
          </div>
        )}

        {!editing && (
          <div className={styles.sessionRenameBtn} title={t('session.rename')} onClick={startRename}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </div>
        )}

        <div className={styles.sessionArchiveBtn} title={t('session.archive')} onClick={handleArchive}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 8 21 21 3 21 3 8" />
            <rect x="1" y="3" width="22" height="5" />
            <line x1="10" y1="12" x2="14" y2="12" />
          </svg>
        </div>

        <div className={styles.sessionItemMeta}>
          {parts.join(' · ')}
        </div>

        {rcLabel && (
          <div className={styles.sessionRcBadge}>
            {rcLabel}
          </div>
        )}

        {browserUrl && (
          <span
            className={styles.sessionBrowserBadge}
            title={browserTitle}
            role="button"
            tabIndex={0}
            aria-label={t('browser.close')}
            data-running={browserState?.running ? 'true' : 'false'}
            data-resumable={browserState?.resumable ? 'true' : 'false'}
            onClick={handleBrowserClose}
            onKeyDown={handleBrowserKeyDown}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </span>
        )}
      </button>
      {menuPosition && (
        <SessionContextMenu
          session={s}
          isPinned={isPinned}
          position={menuPosition}
          onClose={() => setMenuPosition(null)}
          onRename={beginRename}
          onShowSummary={(position) => setSummaryPreviewPosition(position)}
        />
      )}
      {summaryPreviewPosition && (
        <SessionSummaryPreviewCard
          session={s}
          position={summaryPreviewPosition}
          onClose={() => setSummaryPreviewPosition(null)}
        />
      )}
    </>
  );
});

interface SessionSummaryResponse {
  hasSummary?: boolean;
  summary?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

type SummaryState =
  | { status: 'loading'; text: null }
  | { status: 'ready'; text: string }
  | { status: 'empty'; text: null }
  | { status: 'error'; text: null };

const SessionContextMenu = memo(function SessionContextMenu({
  session,
  isPinned,
  position,
  onClose,
  onRename,
  onShowSummary,
}: {
  session: Session;
  isPinned: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onRename: () => void;
  onShowSummary: (position: { x: number; y: number }) => void;
}) {
  const { t } = useI18n();
  const items = useMemo<ContextMenuItem[]>(() => [
    {
      label: t('session.summary.open'),
      disabled: session.hasSummary !== true,
      action: () => onShowSummary(position),
    },
    {
      label: t(isPinned ? 'session.unpin' : 'session.pin'),
      action: () => pinSession(session.path, !isPinned),
    },
    {
      label: t('session.rename'),
      action: onRename,
    },
    {
      label: t('session.archive'),
      danger: true,
      action: () => archiveSession(session.path),
    },
  ], [isPinned, onRename, onShowSummary, position, session.path, t]);

  return (
    <ContextMenu
      items={items}
      position={position}
      onClose={onClose}
    />
  );
});

const SessionSummaryPreviewCard = memo(function SessionSummaryPreviewCard({
  session,
  position,
  onClose,
}: {
  session: Session;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const [summaryState, setSummaryState] = useState<SummaryState>(
    session.hasSummary === true
      ? { status: 'loading', text: null }
      : { status: 'empty', text: null },
  );

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    let { x, y } = position;
    if (x + rect.width > window.innerWidth) x = Math.max(4, window.innerWidth - rect.width - 4);
    if (y + rect.height > window.innerHeight) y = Math.max(4, window.innerHeight - rect.height - 4);
    card.style.left = x + 'px';
    card.style.top = y + 'px';
  }, [position, summaryState]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const handleContextMenu = (e: MouseEvent) => {
      if (cardRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClick, true);
      document.addEventListener('contextmenu', handleContextMenu, true);
      document.addEventListener('keydown', handleKeyDown);
    });
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (session.hasSummary !== true) {
      setSummaryState({ status: 'empty', text: null });
      return;
    }

    let cancelled = false;
    setSummaryState({ status: 'loading', text: null });
    hanaFetch(`/api/sessions/summary?path=${encodeURIComponent(session.path)}`)
      .then(res => res.json())
      .then((data: SessionSummaryResponse) => {
        if (cancelled) return;
        const summary = typeof data.summary === 'string' ? data.summary.trim() : '';
        if (data.hasSummary && summary) {
          setSummaryState({ status: 'ready', text: summary });
        } else {
          setSummaryState({ status: 'empty', text: null });
        }
      })
      .catch(() => {
        if (!cancelled) setSummaryState({ status: 'error', text: null });
      });

    return () => {
      cancelled = true;
    };
  }, [session.path, session.hasSummary]);

  const summaryHtml = useMemo(() => (
    summaryState.status === 'ready' ? renderMarkdown(summaryState.text) : ''
  ), [summaryState]);

  return createPortal(
    <div
      ref={cardRef}
      className={styles.sessionSummaryCard}
      style={{ left: position.x, top: position.y }}
      data-testid="session-summary-card"
      data-scrollable="true"
    >
      <div className={styles.sessionSummaryTitle}>{t('session.summary.title')}</div>
      <div className={styles.sessionSummaryBody}>
        {summaryState.status === 'ready' ? (
          <div dangerouslySetInnerHTML={{ __html: summaryHtml }} />
        ) : (
          <span className={styles.sessionSummaryPlaceholder}>
            {summaryState.status === 'loading'
              ? t('session.summary.loading')
              : summaryState.status === 'error'
                ? t('session.summary.loadFailed')
                : t('session.summary.empty')}
          </span>
        )}
      </div>
    </div>,
    document.body,
  );
});

function formatRcPlatform(platform: string) {
  const lower = (platform || '').toLowerCase();
  if (lower === 'tg' || lower === 'telegram') return 'Telegram';
  if (lower === 'feishu' || lower === 'fs') return '飞书';
  if (lower === 'wechat' || lower === 'wx') return '微信';
  if (lower === 'qq') return 'QQ';
  return platform || 'Bridge';
}

// ── Agent Avatar Badge ──

const AgentBadge = memo(function AgentBadge({ agentId, agentName, agents }: {
  agentId: string;
  agentName: string | null;
  agents: Agent[];
}) {
  const info = resolveAgentDisplayInfo({
    id: agentId,
    agents,
    fallbackAgentName: agentName || agentId,
  });

  return (
    <AgentAvatar
      info={info}
      className={styles.sessionAgentBadge}
      title={agentName || agentId}
    />
  );
});
