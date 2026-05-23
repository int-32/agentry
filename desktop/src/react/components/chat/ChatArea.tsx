/**
 * ChatArea — 聊天消息列表（干净重写版）
 *
 * 原理：只挂载当前 session 的原生滚动 div，滚动位置写入 store。
 * 避免多个长会话同时留在 DOM 里拖慢布局/绘制。
 */

import { memo, useRef, useEffect, useState, useCallback, useMemo, useLayoutEffect } from 'react';
import { useStore } from '../../stores';
import { ensureMessageLoaded, loadMoreMessages, loadSessionUserTurns } from '../../stores/session-actions';
import { useContinuousBottomScroll } from '../../hooks/use-continuous-bottom-scroll';

const EMPTY_ITEMS: ChatListItem[] = [];
import type { ChatListItem, SessionUserTurn } from '../../stores/chat-types';
import { ChatTranscript } from './ChatTranscript';
import { ChatTimelineNavigator } from './ChatTimelineNavigator';
import { buildTimelineAnchors, buildTimelineAnchorsFromUserTurns } from './timeline-anchors';
import type { TimelineAnchor } from './timeline-anchors';
import styles from './Chat.module.css';

const LOAD_MORE_THRESHOLD = 200; // 距顶部多少 px 触发加载
const SCROLL_POSITION_SAVE_INTERVAL = 250;
const EMPTY_TIMELINE_ANCHORS: TimelineAnchor[] = [];

function buildTimelineAnchorSignature(items: ChatListItem[]): string {
  const userParts: string[] = [];
  const fallbackParts: string[] = [];

  for (const item of items) {
    if (item.type !== 'message') continue;
    const message = item.data;
    const timestamp = message.timestamp ?? '';
    if (message.role === 'user') {
      const textSeed = message.text?.slice(0, 256).replace(/\s+/g, ' ').trim().slice(0, 32);
      const previewSeed = textSeed ||
        message.attachments?.find(attachment => attachment.name?.trim())?.name?.trim().slice(0, 32) ||
        '';
      userParts.push(`${message.id}:${timestamp}:${previewSeed}`);
    } else {
      fallbackParts.push(`${message.id}:${timestamp}:${message.role}`);
    }
  }

  return userParts.length > 0
    ? `u|${userParts.join('|')}`
    : `m|${fallbackParts.join('|')}`;
}

function buildUserTurnSignature(turns: SessionUserTurn[]): string {
  return turns
    .map(turn => `${turn.id}:${turn.timestamp ?? ''}:${turn.content.slice(0, 32)}:${turn.imageCount ?? 0}`)
    .join('|');
}

function timelineAnchorSortKey(anchor: TimelineAnchor): number {
  const messageIndex = Number(anchor.messageId);
  if (Number.isFinite(messageIndex)) return messageIndex;
  return anchor.timestamp ?? 0;
}

function mergeTimelineAnchors(indexedAnchors: TimelineAnchor[], loadedAnchors: TimelineAnchor[]): TimelineAnchor[] {
  if (indexedAnchors.length === 0) return loadedAnchors;

  const seen = new Set(indexedAnchors.map(anchor => anchor.messageId));
  const merged = [
    ...indexedAnchors,
    ...loadedAnchors.filter(anchor => !seen.has(anchor.messageId)),
  ];
  return merged.sort((a, b) => timelineAnchorSortKey(a) - timelineAnchorSortKey(b));
}

// ── 入口 ──

export function ChatArea() {
  return (
    <>
      <PanelHost />
      <ScrollToBottomBtn />
    </>
  );
}

// ── PanelHost：只挂当前会话 ──

function PanelHost() {
  const currentPath = useStore(s => s.currentSessionPath);
  const currentHasItems = useStore(s => !!(currentPath && s.chatSessions[currentPath]?.items?.length));
  const welcomeVisible = useStore(s => s.welcomeVisible);

  if (welcomeVisible || !currentPath || !currentHasItems) return null;

  return <Panel key={currentPath} path={currentPath} active />;
}

// ── Panel：一个 session 的原生滚动容器 ──

const SCROLL_THRESHOLD = 50;

const Panel = memo(function Panel({ path, active }: { path: string; active: boolean }) {
  const items = useStore(s => s.chatSessions[path]?.items || EMPTY_ITEMS);
  const hasMore = useStore(s => s.chatSessions[path]?.hasMore ?? false);
  const loadingMore = useStore(s => s.chatSessions[path]?.loadingMore ?? false);
  const timelineIndex = useStore(s => s.sessionUserTurnsByPath[path]);
  const isSessionStreaming = useStore(s => s.streamingSessions.includes(path));
  const sessionAgentId = useStore(s => s.sessions.find(se => se.path === path)?.agentId ?? null);
  const saveScrollPosition = useStore(s => s.saveScrollPosition);
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageElementsRef = useRef(new Map<string, HTMLDivElement>());
  const scrollSaveTimerRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number | null>(null);
  const restoredPathRef = useRef<string | null>(null);
  const initialSavedScrollTopRef = useRef(useStore.getState().scrollPositions[path]);
  const bottomScroll = useContinuousBottomScroll({
    scrollRef: ref,
    contentRef,
    active,
    stickyThreshold: SCROLL_THRESHOLD,
  });
  const loadedTimelineAnchors = useMemo(
    () => {
      if (!active) return EMPTY_TIMELINE_ANCHORS;
      return buildTimelineAnchors(items);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assistant streaming updates do not change timeline anchors.
    [active, buildTimelineAnchorSignature(items)],
  );
  const indexedTimelineAnchors = useMemo(
    () => {
      if (!active || !timelineIndex?.turns?.length) return EMPTY_TIMELINE_ANCHORS;
      return buildTimelineAnchorsFromUserTurns(timelineIndex.turns);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only lightweight user-turn fields affect the navigator.
    [active, buildUserTurnSignature(timelineIndex?.turns ?? [])],
  );
  const timelineAnchors = useMemo(
    () => mergeTimelineAnchors(indexedTimelineAnchors, loadedTimelineAnchors),
    [indexedTimelineAnchors, loadedTimelineAnchors],
  );
  const registerMessageElement = useCallback((messageId: string, element: HTMLDivElement | null) => {
    if (element) {
      messageElementsRef.current.set(messageId, element);
    } else {
      messageElementsRef.current.delete(messageId);
    }
  }, []);

  const handleTimelineAnchorLoad = useCallback((anchor: TimelineAnchor) => {
    return ensureMessageLoaded(path, anchor.messageId);
  }, [path]);

  useEffect(() => {
    if (!active) return;
    if (timelineIndex?.loading || timelineIndex?.loaded) return;
    loadSessionUserTurns(path);
  }, [active, path, timelineIndex?.loaded, timelineIndex?.loading]);

  const flushScrollPosition = useCallback(() => {
    if (scrollSaveTimerRef.current != null) {
      window.clearTimeout(scrollSaveTimerRef.current);
      scrollSaveTimerRef.current = null;
    }
    const top = pendingScrollTopRef.current;
    if (top == null) return;
    pendingScrollTopRef.current = null;
    saveScrollPosition(path, top);
  }, [path, saveScrollPosition]);

  const scheduleScrollPositionSave = useCallback((scrollTop: number) => {
    pendingScrollTopRef.current = scrollTop;
    if (scrollSaveTimerRef.current != null) return;
    scrollSaveTimerRef.current = window.setTimeout(() => {
      scrollSaveTimerRef.current = null;
      const top = pendingScrollTopRef.current;
      if (top == null) return;
      pendingScrollTopRef.current = null;
      saveScrollPosition(path, top);
    }, SCROLL_POSITION_SAVE_INTERVAL);
  }, [path, saveScrollPosition]);

  // scroll 事件维护 sticky 标志 + 上滑加载更多 + 滚动中显现 scrollbar
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      const sticky = bottomScroll.checkSticky();
      if (active) scheduleScrollPositionSave(el.scrollTop);
      if (active) setScrollButton(el, !sticky, () => {
        bottomScroll.scrollToBottom({ mode: 'follow', forceSticky: true });
      });
      // 触顶加载更多
      if (el.scrollTop < LOAD_MORE_THRESHOLD) {
        const session = useStore.getState().chatSessions[path];
        if (session?.hasMore && !session.loadingMore) {
          loadMoreMessages(path);
        }
      }
      // 滚动中显示 scrollbar，停下 800ms 后隐藏
      el.classList.add(styles['is-scrolling']);
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        el.classList.remove(styles['is-scrolling']);
      }, 800);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    if (active) {
      setScrollButton(el, !bottomScroll.checkSticky(), () => {
        bottomScroll.scrollToBottom({ mode: 'follow', forceSticky: true });
      });
    }
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (hideTimer) clearTimeout(hideTimer);
      if (active) {
        pendingScrollTopRef.current = el.scrollTop;
        flushScrollPosition();
      }
      if (_scrollBtn.el === el) setScrollButton(null, false, null);
    };
  }, [active, bottomScroll, flushScrollPosition, path, scheduleScrollPositionSave]);

  // prepend 后保持滚动位置：监听 items 变化，如果头部变了就修正 scrollTop
  const prevFirstId = useRef<string | undefined>(undefined);
  useEffect(() => {
    const firstId = items[0]?.type === 'message' ? items[0].data.id : undefined;
    const el = ref.current;
    if (el && prevFirstId.current && firstId !== prevFirstId.current) {
      // 头部 id 变了 → prepend 发生，修正 scrollTop 让原来的内容不跳
      const prevHeight = el.dataset.prevScrollHeight;
      if (prevHeight) {
        el.scrollTop += el.scrollHeight - Number(prevHeight);
      }
    }
    prevFirstId.current = firstId;
  }, [items]);

  // 在 loadingMore 变成 true 前快照 scrollHeight
  useEffect(() => {
    const el = ref.current;
    if (el && loadingMore) {
      el.dataset.prevScrollHeight = String(el.scrollHeight);
    }
  }, [loadingMore]);

  // 首次挂载当前会话：优先恢复历史 scrollTop，没有保存值才滚到底。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active || items.length === 0 || restoredPathRef.current === path) return;
    const savedScrollTop = initialSavedScrollTopRef.current;
    if (typeof savedScrollTop === 'number' && Number.isFinite(savedScrollTop)) {
      el.scrollTop = savedScrollTop;
      bottomScroll.checkSticky();
    } else {
      bottomScroll.scrollToBottom({ mode: 'instant', forceSticky: true });
    }
    restoredPathRef.current = path;
  }, [active, bottomScroll, items.length, path]);

  // 只有用户自己发出新消息时才恢复 sticky；assistant/tool 流式追加必须尊重用户上滑。
  const prevLen = useRef(items.length);
  useEffect(() => {
    if (items.length > prevLen.current && active) {
      const last = items[items.length - 1];
      if (last?.type === 'message' && last.data.role === 'user') {
        bottomScroll.scrollToBottom({ mode: 'instant', forceSticky: true });
      } else {
        bottomScroll.followBottom();
      }
    }
    prevLen.current = items.length;
  }, [items, items.length, active, bottomScroll]);

  if (items.length === 0) return null;

  return (
    <div
      className={styles.sessionShell}
      style={{
        visibility: active ? 'visible' : 'hidden',
        zIndex: active ? 1 : 0,
        pointerEvents: active ? 'auto' : 'none',
      }}
    >
      <div ref={ref} className={styles.sessionPanel} data-chat-scroll-panel="">
        <div ref={contentRef} className={styles.sessionMessages} data-chat-content-column="">
          {hasMore && (
            <div className={styles.loadMoreHint}>
              {loadingMore ? '...' : ''}
            </div>
          )}
          <ChatTranscript
            items={items}
            sessionPath={path}
            agentId={sessionAgentId}
            registerMessageElement={registerMessageElement}
          />
          {isSessionStreaming && (
            <div className={styles.typingIndicator} />
          )}
          <div className={styles.sessionFooter} />
        </div>
      </div>
      {active && (
        <ChatTimelineNavigator
          anchors={timelineAnchors}
          scrollRef={ref}
          contentRef={contentRef}
          messageElementsRef={messageElementsRef}
          active={active}
          onRequestAnchorLoad={handleTimelineAnchorLoad}
        />
      )}
    </div>
  );
});

// ── ScrollToBottom 按钮 ──

const _scrollBtn = {
  el: null as HTMLElement | null,
  visible: false,
  scrollToBottom: null as (() => void) | null,
  listeners: [] as (() => void)[],
};

function setScrollButton(el: HTMLElement | null, visible: boolean, scrollToBottom: (() => void) | null) {
  _scrollBtn.el = el;
  _scrollBtn.visible = visible;
  _scrollBtn.scrollToBottom = scrollToBottom;
  _scrollBtn.listeners.forEach(listener => listener());
}

function ScrollToBottomBtn() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(_scrollBtn.visible);
    _scrollBtn.listeners.push(update);
    return () => { _scrollBtn.listeners = _scrollBtn.listeners.filter(f => f !== update); };
  }, []);

  if (!visible) return null;
  return (
    <button className={styles.scrollToBottomFab} onClick={() => {
      _scrollBtn.scrollToBottom?.();
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}
