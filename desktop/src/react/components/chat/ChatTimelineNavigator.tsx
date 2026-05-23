import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { useStore } from '../../stores';
import type { TimelineAnchor } from './timeline-anchors';
import styles from './Chat.module.css';

const TIMELINE_MEASURE_DEBOUNCE_MS = 120;
const TIMELINE_SIDE_PANEL_WIDTH = 260;
const TIMELINE_SIDE_PANEL_GAP = 14;
const TIMELINE_VIEWPORT_GAP = 10;
const TIMELINE_ROW_HEIGHT = 28;
const TIMELINE_CARD_VERTICAL_PADDING = 12;
const TIMELINE_PANEL_TOP_INSET = 76;
const TIMELINE_CONTENT_RESERVED_WIDTH = 520;

interface MarkerLayout {
  targetTop: number;
}

interface SidePlacement {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
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

interface Props {
  anchors: TimelineAnchor[];
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  messageElementsRef: RefObject<Map<string, HTMLDivElement>>;
  active: boolean;
  onRequestAnchorLoad?: (anchor: TimelineAnchor) => Promise<boolean> | boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function readPanelTopInset(panel: HTMLElement): number {
  const parsed = Number.parseFloat(window.getComputedStyle(panel).paddingTop || '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : TIMELINE_PANEL_TOP_INSET;
}

export const ChatTimelineNavigator = memo(function ChatTimelineNavigator({
  anchors,
  scrollRef,
  contentRef,
  messageElementsRef,
  active,
  onRequestAnchorLoad,
}: Props) {
  const jianOpen = useStore(s => s.jianOpen);
  const [layouts, setLayouts] = useState<Record<string, MarkerLayout>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [sidePlacement, setSidePlacement] = useState<SidePlacement | null>(null);
  const [rightWorkspaceExpanded, setRightWorkspaceExpanded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const measureTimerRef = useRef<number | null>(null);
  const pendingJumpIdRef = useRef<string | null>(null);

  const updateSidePlacement = useCallback(() => {
    const rightExpanded = jianOpen || isRightWorkspaceVisible();
    setRightWorkspaceExpanded(rightExpanded);
    if (rightExpanded) {
      setSidePlacement(null);
      return;
    }

    const panel = scrollRef.current;
    const content = contentRef.current;
    const mainContent = panel?.closest('.main-content') as HTMLElement | null;
    if (!active || anchors.length === 0 || !panel || !content || !mainContent) {
      setSidePlacement(null);
      return;
    }

    const contentRect = content.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const mainRect = mainContent.getBoundingClientRect();
    const left = mainRect.right - TIMELINE_VIEWPORT_GAP - TIMELINE_SIDE_PANEL_WIDTH;
    const contentLaneRight = Math.min(
      contentRect.right,
      contentRect.left + TIMELINE_CONTENT_RESERVED_WIDTH,
    );
    const availableGap = left - contentLaneRight;
    if (availableGap < TIMELINE_SIDE_PANEL_GAP) {
      setSidePlacement(null);
      return;
    }

    const top = Math.max(
      mainRect.top + TIMELINE_VIEWPORT_GAP,
      panelRect.top + readPanelTopInset(panel),
    );
    const bottomBoundary = Math.min(
      window.innerHeight || panelRect.bottom,
      panelRect.bottom,
      mainRect.bottom,
    );
    const maxHeight = Math.max(
      TIMELINE_ROW_HEIGHT + TIMELINE_CARD_VERTICAL_PADDING,
      bottomBoundary - top - TIMELINE_VIEWPORT_GAP,
    );

    setSidePlacement({
      left,
      top,
      width: TIMELINE_SIDE_PANEL_WIDTH,
      maxHeight,
    });
  }, [active, anchors.length, contentRef, jianOpen, scrollRef]);

  const measure = useCallback(() => {
    const panel = scrollRef.current;
    if (!panel || anchors.length === 0) {
      setLayouts({});
      setActiveId(null);
      return;
    }

    const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
    const panelRect = panel.getBoundingClientRect();
    const next: Record<string, MarkerLayout> = {};

    for (const anchor of anchors) {
      const element = messageElementsRef.current?.get(anchor.messageId);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const targetTop = clamp(panel.scrollTop + rect.top - panelRect.top - 16, 0, maxScroll);
      next[anchor.messageId] = {
        targetTop,
      };
    }

    setLayouts(next);
  }, [anchors, messageElementsRef, scrollRef]);

  const scheduleMeasure = useCallback(() => {
    if (measureTimerRef.current != null) return;
    measureTimerRef.current = window.setTimeout(() => {
      measureTimerRef.current = null;
      measure();
    }, TIMELINE_MEASURE_DEBOUNCE_MS);
  }, [measure]);

  const updateActive = useCallback(() => {
    const panel = scrollRef.current;
    if (!panel || anchors.length === 0) {
      setActiveId(null);
      return;
    }

    const threshold = panel.scrollTop + 96;
    let nextId = anchors[0]?.messageId ?? null;
    for (const anchor of anchors) {
      const layout = layouts[anchor.messageId];
      if (!layout) continue;
      if (layout.targetTop <= threshold) {
        nextId = anchor.messageId;
      } else {
        break;
      }
    }
    setActiveId(nextId);
  }, [anchors, layouts, scrollRef]);

  useLayoutEffect(() => {
    if (!active) {
      if (measureTimerRef.current != null) {
        window.clearTimeout(measureTimerRef.current);
        measureTimerRef.current = null;
      }
      setLayouts({});
      setActiveId(null);
      setSidePlacement(null);
      return;
    }
    measure();
    updateSidePlacement();
  }, [active, measure, updateSidePlacement]);

  useEffect(() => {
    if (!active || anchors.length === 0) return;

    window.addEventListener('resize', updateSidePlacement);

    const panel = scrollRef.current;
    const content = contentRef.current;
    const mainContent = panel?.closest('.main-content') as HTMLElement | null;
    const rightWorkspace = document.getElementById('jianSidebar') as HTMLElement | null;
    const observers: ResizeObserver[] = [];
    if (typeof ResizeObserver !== 'undefined') {
      for (const target of [panel, content, mainContent, rightWorkspace]) {
        if (!target) continue;
        const observer = new ResizeObserver(updateSidePlacement);
        observer.observe(target);
        observers.push(observer);
      }
    }

    return () => {
      window.removeEventListener('resize', updateSidePlacement);
      observers.forEach(observer => observer.disconnect());
    };
  }, [active, anchors.length, contentRef, scrollRef, updateSidePlacement]);

  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel || !active) return;
    const content = contentRef.current;
    const observer = new ResizeObserver(() => scheduleMeasure());
    observer.observe(panel);
    if (content) observer.observe(content);
    return () => {
      observer.disconnect();
      if (measureTimerRef.current != null) {
        window.clearTimeout(measureTimerRef.current);
        measureTimerRef.current = null;
      }
    };
  }, [active, contentRef, scheduleMeasure, scrollRef]);

  useEffect(() => {
    const panel = scrollRef.current;
    if (!panel || !active) return;

    const schedule = () => {
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        updateActive();
      });
    };

    updateActive();
    panel.addEventListener('scroll', schedule, { passive: true });
    return () => {
      panel.removeEventListener('scroll', schedule);
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [active, scrollRef, updateActive]);

  const scrollToAnchorElement = useCallback((anchor: TimelineAnchor): boolean => {
    const panel = scrollRef.current;
    if (!panel) return false;

    const layout = layouts[anchor.messageId];
    if (layout) {
      panel.scrollTo({ top: layout.targetTop, behavior: 'smooth' });
      return true;
    }

    const element = messageElementsRef.current?.get(anchor.messageId);
    if (!element) return false;
    const panelRect = panel.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight);
    const targetTop = clamp(panel.scrollTop + rect.top - panelRect.top - 16, 0, maxScroll);
    panel.scrollTo({ top: targetTop, behavior: 'smooth' });
    return true;
  }, [layouts, messageElementsRef, scrollRef]);

  const jumpTo = useCallback(async (anchor: TimelineAnchor) => {
    if (scrollToAnchorElement(anchor)) return;
    if (!onRequestAnchorLoad) return;

    pendingJumpIdRef.current = anchor.messageId;
    const loaded = await onRequestAnchorLoad(anchor);
    if (!loaded || pendingJumpIdRef.current !== anchor.messageId) return;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (pendingJumpIdRef.current !== anchor.messageId) return;
        pendingJumpIdRef.current = null;
        measure();
        scrollToAnchorElement(anchor);
      });
    });
  }, [measure, onRequestAnchorLoad, scrollToAnchorElement]);

  const renderedAnchors = useMemo(
    () => anchors,
    [anchors],
  );

  const visibleRows = renderedAnchors.length;
  const renderedAnchorSignature = useMemo(
    () => renderedAnchors.map(anchor => anchor.messageId).join('|'),
    [renderedAnchors],
  );

  useLayoutEffect(() => {
    if (!active || !sidePlacement) return;
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = 0;
  }, [active, renderedAnchorSignature, sidePlacement]);

  if (!active || anchors.length === 0 || rightWorkspaceExpanded || !sidePlacement) return null;

  const navStyle: CSSProperties | undefined = sidePlacement ? {
    left: `${sidePlacement.left}px`,
    top: `${sidePlacement.top}px`,
    width: `${sidePlacement.width}px`,
  } : undefined;
  const cardVars: CSSProperties & {
    '--timeline-visible-rows': number;
    '--timeline-max-height': string;
  } = {
    '--timeline-visible-rows': Math.max(1, visibleRows),
    '--timeline-max-height': `${sidePlacement.maxHeight}px`,
  };

  return (
    <nav
      className={`${styles.timelineNav}${cardOpen ? ` ${styles.timelineNavExpanded}` : ''} ${styles.timelineNavSide}`}
      data-chat-timeline-navigator="side"
      style={navStyle}
      aria-label="对话轮次导航"
      onMouseLeave={() => setCardOpen(false)}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
        setCardOpen(false);
      }}
    >
      <div
        className={styles.timelineCard}
        style={cardVars}
      >
        <div
          ref={listRef}
          className={styles.timelineList}
        >
          {renderedAnchors.map((anchor) => {
            const selected = anchor.messageId === activeId;
            const markerStyle: CSSProperties & { '--timeline-marker-width': string } = {
              '--timeline-marker-width': `${anchor.markerWidthEm}em`,
            };
            return (
              <button
                key={anchor.messageId}
                type="button"
                className={`${styles.timelineMarker}${selected ? ` ${styles.timelineMarkerActive}` : ''}`}
                style={markerStyle}
                aria-label={`跳转到 ${anchor.label}`}
                title={anchor.label}
                onFocus={() => setCardOpen(true)}
                onClick={() => jumpTo(anchor)}
              >
                <span className={styles.timelineLabel}>{anchor.label}</span>
                <span
                  className={styles.timelineLine}
                  aria-hidden="true"
                  onMouseEnter={() => setCardOpen(true)}
                />
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
});
