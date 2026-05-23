import type { Session } from '../types';

export type SessionViewMode = 'time' | 'workspace';
export type DateGroup = 'today' | 'thisWeek' | 'earlier';

export type SessionSection =
  | {
      id: 'pinned';
      kind: 'pinned';
      titleKey: 'sidebar.pinned';
      items: Session[];
    }
  | {
      id: `date:${DateGroup}`;
      kind: 'date';
      titleKey: `time.${DateGroup}`;
      group: DateGroup;
      items: Session[];
    }
  | {
      id: `workspace:${string}`;
      kind: 'workspace';
      title: string | null;
      titleKey?: 'sidebar.noWorkspace';
      workspacePath: string | null;
      items: Session[];
    };

interface BuildSessionSectionsOptions {
  mode?: SessionViewMode;
  now?: Date;
}

const DATE_GROUP_ORDER: DateGroup[] = ['today', 'thisWeek', 'earlier'];

function getSessionDateGroup(isoStr: string | null, now: Date): DateGroup {
  if (!isoStr) return 'earlier';
  const date = new Date(isoStr);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);

  if (date >= today) return 'today';
  if (date >= weekAgo) return 'thisWeek';
  return 'earlier';
}

function isPinnedSession(session: Session): boolean {
  return typeof session.pinnedAt === 'string' && session.pinnedAt.length > 0;
}

function pinnedTime(session: Session): number {
  return timestamp(session.pinnedAt);
}

function modifiedTime(session: Session): number {
  return timestamp(session.modified);
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function compareByPath(a: Session, b: Session): number {
  return String(a.path || '').localeCompare(String(b.path || ''));
}

function workspaceDisplayName(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!normalized) return path;
  if (normalized === '/') return '/';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function normalizeWorkspacePath(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\\/g, '/');
  if (normalized === '/') return '/';
  return normalized.replace(/\/+$/g, '');
}

function pushPinnedSection(sections: SessionSection[], pinned: Session[]): void {
  sections.push({
    id: 'pinned',
    kind: 'pinned',
    titleKey: 'sidebar.pinned',
    items: pinned,
  });
}

function buildDateSections(
  sections: SessionSection[],
  regular: Session[],
  now: Date,
): void {
  const dateGroups: Record<DateGroup, Session[]> = {
    today: [],
    thisWeek: [],
    earlier: [],
  };
  for (const session of regular) {
    dateGroups[getSessionDateGroup(session.modified, now)].push(session);
  }

  // Sort within each group: newest modified first
  for (const group of DATE_GROUP_ORDER) {
    dateGroups[group].sort((a, b) => modifiedTime(b) - modifiedTime(a) || compareByPath(a, b));
  }

  for (const group of DATE_GROUP_ORDER) {
    const items = dateGroups[group];
    if (items.length === 0) continue;
    sections.push({
      id: `date:${group}`,
      kind: 'date',
      titleKey: `time.${group}`,
      group,
      items,
    });
  }
}

function buildWorkspaceSections(sections: SessionSection[], regular: Session[]): void {
  const groups = new Map<string, {
    workspacePath: string | null;
    title: string | null;
    items: Session[];
    newestModified: number;
  }>();

  for (const session of regular) {
    const workspacePath = normalizeWorkspacePath(session.cwd);
    const key = workspacePath ?? '__no_workspace__';
    const group = groups.get(key) ?? {
      workspacePath,
      title: workspacePath ? workspaceDisplayName(workspacePath) : null,
      items: [],
      newestModified: 0,
    };
    group.items.push(session);
    group.newestModified = Math.max(group.newestModified, modifiedTime(session));
    groups.set(key, group);
  }

  const ordered = Array.from(groups.entries()).sort(([, a], [, b]) => {
    if (a.workspacePath && !b.workspacePath) return -1;
    if (!a.workspacePath && b.workspacePath) return 1;
    return b.newestModified - a.newestModified
      || String(a.title || '').localeCompare(String(b.title || ''))
      || String(a.workspacePath || '').localeCompare(String(b.workspacePath || ''));
  });

  for (const [key, group] of ordered) {
    group.items.sort((a, b) => modifiedTime(b) - modifiedTime(a) || compareByPath(a, b));
    sections.push({
      id: `workspace:${key}`,
      kind: 'workspace',
      title: group.title,
      titleKey: group.workspacePath ? undefined : 'sidebar.noWorkspace',
      workspacePath: group.workspacePath,
      items: group.items,
    });
  }
}

export function buildSessionSections(
  sessions: Session[],
  options: BuildSessionSectionsOptions = {},
): SessionSection[] {
  const mode = options.mode ?? 'time';
  if (mode !== 'time' && mode !== 'workspace') {
    const exhaustive: never = mode;
    throw new Error(`Unsupported session view mode: ${exhaustive}`);
  }

  const pinned = sessions
    .filter(isPinnedSession)
    .sort((a, b) => pinnedTime(b) - pinnedTime(a) || compareByPath(a, b));
  const regular = sessions.filter(session => !isPinnedSession(session));

  const sections: SessionSection[] = [];
  pushPinnedSection(sections, pinned);
  if (mode === 'workspace') {
    buildWorkspaceSections(sections, regular);
  } else {
    buildDateSections(sections, regular, options.now ?? new Date());
  }

  return sections;
}
