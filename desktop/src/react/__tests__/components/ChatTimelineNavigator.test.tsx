// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { ChatTimelineNavigator } from '../../components/chat/ChatTimelineNavigator';
import type { TimelineAnchor } from '../../components/chat/timeline-anchors';
import { useStore } from '../../stores';
import styles from '../../components/chat/Chat.module.css';

function makeRect(partial: Partial<DOMRect>): DOMRect {
  const left = partial.left ?? 0;
  const top = partial.top ?? 0;
  const right = partial.right ?? left + (partial.width ?? 0);
  const bottom = partial.bottom ?? top + (partial.height ?? 0);
  return {
    x: partial.x ?? left,
    y: partial.y ?? top,
    left,
    top,
    right,
    bottom,
    width: partial.width ?? right - left,
    height: partial.height ?? bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

const anchors: TimelineAnchor[] = [
  {
    messageId: 'm0',
    timestamp: null,
    label: '更早的用户输入...',
    role: 'user',
    markerWidthEm: 0.7,
  },
  {
    messageId: 'm1',
    timestamp: null,
    label: '生成资料清单的功能现...',
    role: 'user',
    markerWidthEm: 0.8,
  },
];

function Harness({
  rightOpen = false,
  onRequestAnchorLoad,
  navAnchors = anchors,
}: {
  rightOpen?: boolean;
  onRequestAnchorLoad?: (anchor: TimelineAnchor) => Promise<boolean> | boolean;
  navAnchors?: TimelineAnchor[];
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const messageElementsRef = useRef(new Map<string, HTMLDivElement>());

  return (
    <div className="main-content">
      <aside id="jianSidebar" className={rightOpen ? '' : 'collapsed'} />
      <div ref={panelRef} data-panel="">
        <div ref={contentRef} data-content="">
          <div
            data-message=""
            ref={(node) => {
              if (node) messageElementsRef.current.set('m1', node);
            }}
          >
            message
          </div>
        </div>
      </div>
      <ChatTimelineNavigator
        anchors={navAnchors}
        scrollRef={panelRef}
        contentRef={contentRef}
        messageElementsRef={messageElementsRef}
        active
        onRequestAnchorLoad={onRequestAnchorLoad}
      />
    </div>
  );
}

describe('ChatTimelineNavigator', () => {
  let getBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;
  let mainRight = 1100;
  let contentTop = 90;

  beforeEach(() => {
    mainRight = 1100;
    contentTop = 90;
    useStore.setState({ jianOpen: false });
    getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      disconnect() {}
    });
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this instanceof HTMLElement && this.classList.contains('main-content')) {
        return makeRect({ left: 0, right: mainRight, top: 0, bottom: 900 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-panel')) {
        return makeRect({ left: 0, right: 1100, top: 0, bottom: 820 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-content')) {
        return makeRect({ left: 180, right: 720, top: contentTop, bottom: contentTop + 670 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-message')) {
        return makeRect({ left: 180, right: 720, top: 120, bottom: 160 });
      }
      return makeRect({ left: 0, right: 0, top: 0, bottom: 0 });
    };
  });

  afterEach(() => {
    useStore.setState({ jianOpen: true });
    cleanup();
    HTMLElement.prototype.getBoundingClientRect = getBoundingClientRect;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps the timeline list in the right blank lane when there is room', async () => {
    render(<Harness />);

    await waitFor(() => {
      const nav = screen.getByLabelText('对话轮次导航');
      expect(screen.getByRole('button', { name: '跳转到 更早的用户输入...' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '跳转到 生成资料清单的功能现...' })).toBeInTheDocument();
      expect(nav).toHaveStyle('left: 830px');
      expect(nav).toHaveStyle('top: 76px');
      expect(nav).toHaveStyle('width: 260px');
      expect(nav).toHaveAttribute('data-chat-timeline-navigator', 'side');
    });
  });

  it('still shows the side card in the narrower lane after reducing width', async () => {
    mainRight = 1000;
    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByLabelText('对话轮次导航')).toHaveStyle('left: 730px');
    });
  });

  it('keeps the side card top fixed when the chat content scrolls', async () => {
    render(<Harness />);

    const nav = await screen.findByLabelText('对话轮次导航');
    await waitFor(() => {
      expect(nav).toHaveStyle('top: 76px');
    });

    contentTop = -220;
    fireEvent(window, new Event('resize'));

    await waitFor(() => {
      expect(nav).toHaveStyle('top: 76px');
    });
  });

  it('hides the timeline list when the right workspace is open', async () => {
    useStore.setState({ jianOpen: true });
    render(<Harness rightOpen />);

    await waitFor(() => {
      expect(screen.queryByLabelText('对话轮次导航')).not.toBeInTheDocument();
    });
  });

  it('hides the timeline list when the window is too narrow for the right lane', async () => {
    mainRight = 950;
    render(<Harness />);

    await waitFor(() => {
      expect(screen.queryByLabelText('对话轮次导航')).not.toBeInTheDocument();
    });
  });

  it('renders unloaded index anchors and asks the caller to load them on click', async () => {
    const onRequestAnchorLoad = vi.fn(async () => true);
    render(<Harness onRequestAnchorLoad={onRequestAnchorLoad} />);

    const button = await screen.findByRole('button', { name: '跳转到 更早的用户输入...' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(onRequestAnchorLoad).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm0' }));
    });
  });

  it('sizes the side card to all timeline anchors instead of forcing the list to the bottom', async () => {
    const navAnchors = Array.from({ length: 12 }, (_, index) => ({
      messageId: `m${index}`,
      timestamp: null,
      label: `用户输入 ${index + 1}`,
      role: 'user' as const,
      markerWidthEm: 0.7,
    }));

    render(<Harness navAnchors={navAnchors} />);

    await waitFor(() => {
      const nav = screen.getByLabelText('对话轮次导航');
      expect(nav.querySelector(`.${styles.timelineCard}`)).toHaveStyle('--timeline-visible-rows: 12');
      expect(screen.getByRole('button', { name: '跳转到 用户输入 1' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '跳转到 用户输入 12' })).toBeInTheDocument();
    });
  });

  it('resets the side list to the first anchor when earlier turns are inserted', async () => {
    const initialAnchors: TimelineAnchor[] = [
      {
        messageId: 'm1',
        timestamp: null,
        label: '再试一下',
        role: 'user',
        markerWidthEm: 0.7,
      },
      {
        messageId: 'm2',
        timestamp: null,
        label: '分析一下这个项目，重...',
        role: 'user',
        markerWidthEm: 0.8,
      },
    ];
    const completeAnchors: TimelineAnchor[] = [
      {
        messageId: 'm0',
        timestamp: null,
        label: '从 git上更新代码',
        role: 'user',
        markerWidthEm: 0.7,
      },
      ...initialAnchors,
    ];

    const { rerender } = render(<Harness navAnchors={initialAnchors} />);

    let list: HTMLDivElement | null = null;
    await waitFor(() => {
      const nav = screen.getByLabelText('对话轮次导航');
      list = nav.querySelector(`.${styles.timelineList}`) as HTMLDivElement | null;
      expect(list).not.toBeNull();
    });
    list!.scrollTop = 28;

    rerender(<Harness navAnchors={completeAnchors} />);

    await waitFor(() => {
      expect(list!.scrollTop).toBe(0);
      expect(screen.getByRole('button', { name: '跳转到 从 git上更新代码' })).toBeInTheDocument();
    });
  });
});
