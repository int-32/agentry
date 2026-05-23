// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TodoDisplay } from '../../components/input/TodoDisplay';
import { useStore } from '../../stores';

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

describe('TodoDisplay', () => {
  let getBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    useStore.setState({ jianOpen: false });
    window.t = ((key: string) => {
      if (key === 'common.allDone') return '全部完成';
      if (key === 'common.markAllComplete') return '全部标记为已完成';
      return key;
    }) as typeof window.t;
    getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  });

  afterEach(() => {
    useStore.setState({ jianOpen: true });
    HTMLElement.prototype.getBoundingClientRect = getBoundingClientRect;
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the complete-all action only after expanding the todo list', () => {
    const onCompleteAll = vi.fn();
    render(
      <TodoDisplay
        todos={[{ content: '写测试', activeForm: '正在写测试', status: 'in_progress' }]}
        onCompleteAll={onCompleteAll}
      />,
    );

    expect(screen.queryByRole('button', { name: '全部标记为已完成' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /正在写测试/ }));
    fireEvent.click(screen.getByRole('button', { name: '全部标记为已完成' }));

    expect(onCompleteAll).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('正在写测试')).toHaveLength(2);
  });

  it('shows the list and trigger on the right side when there is enough room', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this instanceof HTMLElement && this.classList.contains('main-content')) {
        return makeRect({ left: 0, right: 1100, top: 0, bottom: 900 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-chat-scroll-panel')) {
        return makeRect({ left: 0, right: 1100, top: 0, bottom: 820 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-chat-content-column')) {
        return makeRect({ left: 180, right: 720, top: 90, bottom: 760 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-input-wrapper')) {
        return makeRect({ left: 130, right: 700, top: 710, bottom: 790 });
      }
      return makeRect({ left: 0, right: 0, top: 0, bottom: 0 });
    };

    const { container } = render(
      <div className="main-content">
        <div data-chat-scroll-panel="">
          <div data-chat-content-column="" />
        </div>
        <div data-input-surface="">
          <div data-input-wrapper="" />
          <TodoDisplay
            todos={[
              { content: '定位 /m07 progress 前端路由和页面组件', activeForm: '正在追踪进度管理 API 与 BFF/后端实现', status: 'in_progress' },
              { content: '总结实现逻辑与风险点', activeForm: '总结实现逻辑与风险点', status: 'pending' },
            ]}
          />
        </div>
      </div>,
    );

    expect(screen.getAllByText('正在追踪进度管理 API 与 BFF/后端实现')).toHaveLength(2);
    expect(container.querySelector('[style*="--todo-side-left: 830px"]')).toBeTruthy();
    expect(container.querySelector('[style*="--todo-side-top: 76px"]')).toBeTruthy();
  });

  it('stacks the todo side display below the content navigator when both use the right lane', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this instanceof HTMLElement && this.classList.contains('main-content')) {
        return makeRect({ left: 0, right: 1100, top: 0, bottom: 900 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-chat-scroll-panel')) {
        return makeRect({ left: 0, right: 1100, top: 0, bottom: 820 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-chat-content-column')) {
        return makeRect({ left: 180, right: 720, top: 90, bottom: 760 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-chat-timeline-navigator')) {
        return makeRect({ left: 830, right: 1090, top: 76, bottom: 236 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-input-wrapper')) {
        return makeRect({ left: 130, right: 700, top: 710, bottom: 790 });
      }
      return makeRect({ left: 0, right: 0, top: 0, bottom: 0 });
    };

    const { container } = render(
      <div className="main-content">
        <div data-chat-scroll-panel="">
          <div data-chat-content-column="" />
          <nav data-chat-timeline-navigator="side" aria-label="对话轮次导航" />
        </div>
        <div data-input-surface="">
          <div data-input-wrapper="" />
          <TodoDisplay
            todos={[
              { content: '定位项目看板结构', activeForm: '正在定位项目看板结构', status: 'in_progress' },
              { content: '调整任务过滤', activeForm: '调整任务过滤', status: 'pending' },
            ]}
          />
        </div>
      </div>,
    );

    expect(container.querySelector('[style*="--todo-side-left: 830px"]')).toBeTruthy();
    expect(container.querySelector('[style*="--todo-side-top: 250px"]')).toBeTruthy();
    expect(container.querySelector('[style*="--todo-side-list-max-height: 512px"]')).toBeTruthy();
  });

  it('keeps the todo side display top fixed when content scrolls', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 900 });
    let contentTop = 90;
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this instanceof HTMLElement && this.classList.contains('main-content')) {
        return makeRect({ left: 0, right: 1100, top: 0, bottom: 900 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-chat-scroll-panel')) {
        return makeRect({ left: 0, right: 1100, top: 0, bottom: 820 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-chat-content-column')) {
        return makeRect({ left: 180, right: 720, top: contentTop, bottom: contentTop + 670 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-input-wrapper')) {
        return makeRect({ left: 130, right: 700, top: 710, bottom: 790 });
      }
      return makeRect({ left: 0, right: 0, top: 0, bottom: 0 });
    };

    const { container } = render(
      <div className="main-content">
        <div data-chat-scroll-panel="">
          <div data-chat-content-column="" />
        </div>
        <div data-input-surface="">
          <div data-input-wrapper="" />
          <TodoDisplay
            todos={[{ content: '定位进度管理逻辑', activeForm: '正在追踪进度管理逻辑', status: 'in_progress' }]}
          />
        </div>
      </div>,
    );

    expect(container.querySelector('[style*="--todo-side-top: 76px"]')).toBeTruthy();

    contentTop = -220;
    fireEvent(window, new Event('resize'));

    expect(container.querySelector('[style*="--todo-side-top: 76px"]')).toBeTruthy();
  });

  it('does not render the todo side display when the right workspace is open', async () => {
    useStore.setState({ jianOpen: true });
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this instanceof HTMLElement && this.classList.contains('main-content')) {
        return makeRect({ left: 0, right: 1100, top: 0, bottom: 900 });
      }
      if (this instanceof HTMLElement && this.hasAttribute('data-chat-content-column')) {
        return makeRect({ left: 180, right: 720, top: 90, bottom: 760 });
      }
      return makeRect({ left: 0, right: 0, top: 0, bottom: 0 });
    };

    render(
      <div className="main-content">
        <aside id="jianSidebar" />
        <div data-chat-content-column="" />
        <div data-input-surface="">
          <div data-input-wrapper="" />
          <TodoDisplay
            todos={[{ content: '写测试', activeForm: '正在写测试', status: 'in_progress' }]}
          />
        </div>
      </div>,
    );

    expect(screen.queryByRole('button', { name: /正在写测试/ })).not.toBeInTheDocument();
  });
});
