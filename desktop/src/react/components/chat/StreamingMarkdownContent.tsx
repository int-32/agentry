import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { useTypewriterText } from '../../hooks/use-typewriter-text';
import { splitGraphemes } from '../../utils/grapheme';
import { renderMarkdown } from '../../utils/markdown';
import { MarkdownContent } from './MarkdownContent';

interface Props {
  html: string;
  source?: string;
  active?: boolean;
  className?: string;
}

const COMPLEX_MARKDOWN_PATTERNS = [
  /(^|\n)\s*(```|~~~)/,
  /(^|\n)\s*\$\$/,
  /(^|\n)\s*\\\[/,
  /(^|\n)\s*\|.*\|/,
  /(^|\n)\s{4,}\S/,
  /(^|\n)\s*<[^>\n]+>/,
];
const BACKTICK_SENSITIVE_MARKDOWN = /`/;
const MAX_TAIL_FADE_COUNT = 6;
const TYPEWRITER_MAX_SOURCE_CHARS = 4000;

export function isTypewriterEligibleMarkdownSource(source: string): boolean {
  if (!source.trim()) return false;
  if (source.length > TYPEWRITER_MAX_SOURCE_CHARS) return false;
  if (BACKTICK_SENSITIVE_MARKDOWN.test(source)) return false;
  return !COMPLEX_MARKDOWN_PATTERNS.some((pattern) => pattern.test(source));
}

function countNewTailGraphemes(previous: string | null, current: string): number {
  if (!current) return 0;
  const newText = previous && current.startsWith(previous)
    ? current.slice(previous.length)
    : current;
  return Math.min(MAX_TAIL_FADE_COUNT, splitGraphemes(newText).length);
}

export const StreamingMarkdownContent = memo(function StreamingMarkdownContent({
  html,
  source,
  active = false,
  className,
}: Props) {
  const shouldType = !!source && active && isTypewriterEligibleMarkdownSource(source);
  const previousVisibleSourceRef = useRef<string | null>(null);
  const visibleSource = useTypewriterText(source || '', {
    active: shouldType,
    displayFps: 30,
    minBatch: 1,
    maxBatch: 24,
    catchUpThreshold: 24,
  });
  const visibleHtml = useMemo(
    () => shouldType ? renderMarkdown(visibleSource) : html,
    [html, shouldType, visibleSource],
  );
  const targetSource = source || '';
  const tailFadeCount = useMemo(
    () => {
      // targetSource 变化但 visibleSource 还没追上时，也要清掉上一帧尾部动画。
      void targetSource;
      return shouldType
        ? countNewTailGraphemes(previousVisibleSourceRef.current, visibleSource)
        : 0;
    },
    [shouldType, targetSource, visibleSource],
  );

  useLayoutEffect(() => {
    previousVisibleSourceRef.current = shouldType ? visibleSource : null;
  }, [shouldType, visibleSource]);

  return (
    <MarkdownContent
      html={visibleHtml}
      className={className}
      tailFadeCount={tailFadeCount}
    />
  );
});
