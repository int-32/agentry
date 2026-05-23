import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './InputArea.module.css';
import { useI18n } from '../../hooks/use-i18n';
import { useStore } from '../../stores';
import type { TodoItem, TodoStatus } from '../../types';

/**
 * TodoDisplay — 对标 Claude Code TodoWrite 的三态渲染组件
 *
 * - pending: ○ 灰色默认
 * - in_progress: ⟳ accent 色，显示 activeForm
 * - completed: ✓ success 色 + 删除线
 *
 * TodoItem 严格 3 字段，不加索引签名或透传式消费。
 */

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '○',
  in_progress: '⟳',
  completed: '✓',
};

const STATUS_CLASS: Record<TodoStatus, string> = {
  pending: 'todo-bar-pending',
  in_progress: 'todo-bar-in-progress',
  completed: 'todo-bar-done',
};

const SIDE_PANEL_WIDTH = 260;
const SIDE_PANEL_GAP = 14;
const VIEWPORT_GAP = 10;
const PANEL_TOP_INSET = 76;
const CONTENT_RESERVED_WIDTH = 520;
const TIMELINE_NAV_SELECTOR = '[data-chat-timeline-navigator="side"]';
const SIDE_TRIGGER_RESERVED_HEIGHT = 48;

interface SidePlacement {
  left: number;
  top: number;
  width: number;
  maxListHeight: number;
}

function isRightWorkspaceVisible(): boolean {
  const sidebar = document.getElementById('jianSidebar');
  if (!sidebar) return false;
  if (!sidebar.classList.contains('collapsed')) return true;

  const rect = sidebar.getBoundingClientRect();
  const style = window.getComputedStyle(sidebar);
  const hidden = style.display === 'none' || style.visibility === 'hidden' || rect.width < 80;
  return !hidden;
}

function readPanelTopInset(panel: HTMLElement): number {
  const parsed = Number.parseFloat(window.getComputedStyle(panel).paddingTop || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PANEL_TOP_INSET;
}

function readTimelineBottom(mainContent: HTMLElement): number | null {
  const timeline = mainContent.querySelector(TIMELINE_NAV_SELECTOR) as HTMLElement | null;
  if (!timeline) return null;

  const rect = timeline.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const style = window.getComputedStyle(timeline);
  if (style.display === 'none' || style.visibility === 'hidden') return null;

  return rect.bottom;
}

/**
 * 展示文案：in_progress 用 activeForm，否则用 content
 * 若 activeForm 缺失（旧数据降级），fallback 到 content
 */
function displayText(todo: TodoItem): string {
  if (todo.status === 'in_progress' && todo.activeForm) return todo.activeForm;
  return todo.content || todo.activeForm || '';
}

/**
 * 折叠态预览：优先第一个 in_progress，否则第一个 pending，全完成显示 allDone 文案
 */
function pickPreview(todos: TodoItem[], allDoneText: string): string {
  const inProgress = todos.find((t) => t.status === 'in_progress');
  if (inProgress) return displayText(inProgress);
  const pending = todos.find((t) => t.status === 'pending');
  if (pending) return displayText(pending);
  return allDoneText;
}

export function TodoDisplay({
  todos,
  onCompleteAll,
  completing = false,
}: {
  todos: TodoItem[];
  onCompleteAll?: () => void;
  completing?: boolean;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const jianOpen = useStore(s => s.jianOpen);
  const [open, setOpen] = useState(false);
  const [sidePlacement, setSidePlacement] = useState<SidePlacement | null>(null);
  const [rightWorkspaceExpanded, setRightWorkspaceExpanded] = useState(false);

  const updateSidePlacement = useCallback(() => {
    const rightExpanded = jianOpen || isRightWorkspaceVisible();
    setRightWorkspaceExpanded(rightExpanded);
    if (rightExpanded) {
      setSidePlacement(null);
      return;
    }

    const root = rootRef.current;
    const surface = root?.closest('[data-input-surface]') as HTMLElement | null;
    const wrapper = surface?.querySelector('[data-input-wrapper]') as HTMLElement | null;
    const mainContent = surface?.closest('.main-content') as HTMLElement | null;
    const contentColumn = mainContent?.querySelector('[data-chat-content-column]') as HTMLElement | null;
    const scrollPanel = mainContent?.querySelector('[data-chat-scroll-panel]') as HTMLElement | null;
    const anchor = contentColumn || wrapper;
    if (!root || !surface || !anchor || !mainContent) {
      setSidePlacement(null);
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const mainRect = mainContent.getBoundingClientRect();
    const panelLeft = mainRect.right - VIEWPORT_GAP - SIDE_PANEL_WIDTH;
    const contentLaneRight = Math.min(
      anchorRect.right,
      anchorRect.left + CONTENT_RESERVED_WIDTH,
    );
    const availableGap = panelLeft - contentLaneRight;
    if (availableGap < SIDE_PANEL_GAP) {
      setSidePlacement(null);
      return;
    }

    const panelRect = scrollPanel?.getBoundingClientRect();
    const panelTop = scrollPanel && panelRect
      ? panelRect.top + readPanelTopInset(scrollPanel)
      : (contentColumn?.getBoundingClientRect().top ?? mainRect.top);
    const timelineBottom = readTimelineBottom(mainContent);
    const top = Math.max(
      mainRect.top + VIEWPORT_GAP,
      panelTop,
      timelineBottom == null ? panelTop : timelineBottom + SIDE_PANEL_GAP,
    );
    const bottomBoundary = Math.min(
      window.innerHeight || mainRect.bottom,
      panelRect?.bottom ?? mainRect.bottom,
      mainRect.bottom,
    );
    const maxListHeight = bottomBoundary - top - VIEWPORT_GAP - SIDE_TRIGGER_RESERVED_HEIGHT;
    if (maxListHeight < 72) {
      setSidePlacement(null);
      return;
    }

    setSidePlacement({
      left: panelLeft,
      top,
      width: SIDE_PANEL_WIDTH,
      maxListHeight,
    });
  }, [jianOpen]);

  useLayoutEffect(() => {
    if (!todos || todos.length === 0) return;

    updateSidePlacement();
  }, [todos, updateSidePlacement]);

  useEffect(() => {
    if (!todos || todos.length === 0) return;

    window.addEventListener('resize', updateSidePlacement);

    const root = rootRef.current;
    const surface = root?.closest('[data-input-surface]') as HTMLElement | null;
    const wrapper = surface?.querySelector('[data-input-wrapper]') as HTMLElement | null;
    const mainContent = surface?.closest('.main-content') as HTMLElement | null;
    const contentColumn = mainContent?.querySelector('[data-chat-content-column]') as HTMLElement | null;
    const scrollPanel = mainContent?.querySelector('[data-chat-scroll-panel]') as HTMLElement | null;
    const timelineNav = mainContent?.querySelector(TIMELINE_NAV_SELECTOR) as HTMLElement | null;
    const rightWorkspace = document.getElementById('jianSidebar') as HTMLElement | null;
    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== 'undefined') {
      for (const target of [surface, wrapper, mainContent, contentColumn, scrollPanel, timelineNav, rightWorkspace]) {
        if (!target) continue;
        const observer = new ResizeObserver(updateSidePlacement);
        observer.observe(target);
        observers.push(observer);
      }
    }
    const mutationObserver = typeof MutationObserver !== 'undefined' && mainContent
      ? new MutationObserver(updateSidePlacement)
      : null;
    if (mutationObserver && mainContent) {
      mutationObserver.observe(mainContent, { childList: true, subtree: true });
    }

    return () => {
      window.removeEventListener('resize', updateSidePlacement);
      observers.forEach(observer => observer.disconnect());
      mutationObserver?.disconnect();
    };
  }, [todos, updateSidePlacement]);

  if (!todos || todos.length === 0) return null;
  if (rightWorkspaceExpanded) return null;

  const completedCount = todos.filter((t) => t.status === 'completed').length;
  const preview = pickPreview(todos, t('common.allDone'));
  const listOpen = !!sidePlacement || open;
  const sideStyle = sidePlacement ? {
    '--todo-side-left': `${sidePlacement.left}px`,
    '--todo-side-top': `${sidePlacement.top}px`,
    '--todo-side-width': `${sidePlacement.width}px`,
    '--todo-side-list-max-height': `${sidePlacement.maxListHeight}px`,
  } as CSSProperties : undefined;

  return (
    <div
      ref={rootRef}
      className={`${styles['todo-bar']}${listOpen ? ` ${styles['todo-bar-open']}` : ''}${sidePlacement ? ` ${styles['todo-bar-side']}` : ''}`}
      style={sideStyle}
    >
      {listOpen && (
        <div className={styles['todo-bar-list']}>
          {todos.map((td, i) => {
            const statusClass = styles[STATUS_CLASS[td.status]] ?? '';
            return (
              <div
                key={`todo-${i}`}
                className={`${styles['todo-bar-item']}${statusClass ? ` ${statusClass}` : ''}`}
              >
                <span className={styles['todo-bar-check']}>{STATUS_ICON[td.status]}</span>
                <span>{displayText(td)}</span>
              </div>
            );
          })}
          {onCompleteAll && (
            <button
              type="button"
              className={styles['todo-bar-complete-row']}
              disabled={completing}
              onClick={(event) => {
                event.stopPropagation();
                onCompleteAll();
              }}
            >
              <span className={styles['todo-bar-complete-icon']} aria-hidden="true">✓</span>
              <span>{t('common.markAllComplete')}</span>
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        className={styles['todo-bar-trigger']}
        onClick={() => {
          if (!sidePlacement) setOpen(!open);
        }}
      >
        <span className={styles['todo-bar-icon']}>☑</span>
        <span className={styles['todo-bar-preview']}>{preview}</span>
        <span className={styles['todo-bar-count']}>
          {completedCount}/{todos.length}
        </span>
      </button>
    </div>
  );
}
