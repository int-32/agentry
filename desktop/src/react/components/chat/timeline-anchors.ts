import type { ChatListItem, ChatMessage, ChatTimelineAnchor, SessionUserTurn, UserAttachment } from '../../stores/chat-types';
import { parseUserAttachments } from '../../utils/message-parser';

export type TimelineAnchor = ChatTimelineAnchor;

interface TimelineAnchorOptions {
  now?: Date;
  locale?: string;
  timeZone?: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function parseTimestamp(value: ChatMessage['timestamp'] | SessionUserTurn['timestamp']): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

const PREVIEW_SCAN_LIMIT = 256;

function normalizedPreviewInfo(message: ChatMessage): { source: string; lengthForWidth: number } {
  if (message.text) {
    const sampled = message.text.slice(0, PREVIEW_SCAN_LIMIT).replace(/\s+/g, ' ').trim();
    if (sampled) {
      return {
        source: sampled,
        lengthForWidth: message.text.length > PREVIEW_SCAN_LIMIT
          ? PREVIEW_SCAN_LIMIT
          : Array.from(sampled).length,
      };
    }
  }

  const firstAttachment = message.attachments?.find(attachment => attachment.name?.trim());
  if (firstAttachment?.name) {
    const source = firstAttachment.name.trim();
    return { source, lengthForWidth: Array.from(source).length };
  }

  const source = message.role === 'user' ? '用户消息' : '助手消息';
  return { source, lengthForWidth: Array.from(source).length };
}

function attachmentsFromUserTurn(turn: SessionUserTurn): UserAttachment[] | undefined {
  const parsed = parseUserAttachments(turn.content || '');
  const attachments: UserAttachment[] = [
    ...parsed.files.map(file => ({
      path: file.path,
      name: file.name,
      isDir: file.isDirectory,
    })),
    ...parsed.attachedImages.map(image => ({
      path: image.path,
      name: image.name,
      isDir: false,
    })),
    ...parsed.attachedVideos.map(video => ({
      path: video.path,
      name: video.name,
      isDir: false,
    })),
  ];

  if (turn.imageCount && turn.imageCount > attachments.length) {
    for (let i = attachments.length; i < turn.imageCount; i++) {
      attachments.push({
        path: `image-${i}`,
        name: `image-${i}`,
        isDir: false,
      });
    }
  }

  return attachments.length ? attachments : undefined;
}

function userTurnToChatMessage(turn: SessionUserTurn): ChatMessage {
  const parsed = parseUserAttachments(turn.content || '');
  const timestamp = parseTimestamp(turn.timestamp);
  return {
    id: turn.id,
    sourceEntryId: turn.entryId,
    role: 'user',
    text: parsed.text,
    attachments: attachmentsFromUserTurn(turn),
    timestamp: timestamp ?? undefined,
  };
}

export function formatTimelinePromptPreview(text: string, maxChars = 48): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const chars = Array.from(normalized);
  if (chars.length <= maxChars) return normalized;
  return `${chars.slice(0, maxChars).join('')}...`;
}

export function measureTimelineMarkerWidthEm(promptLength: number): number {
  if (!Number.isFinite(promptLength) || promptLength <= 2) return 0.5;

  const normalized = Math.min(1, Math.log1p(promptLength - 2) / Math.log1p(80));
  return Number((0.5 + normalized * 0.5).toFixed(3));
}

function readDateParts(timestamp: number, timeZone?: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const values: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type === 'literal') continue;
    values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function sameDay(a: DateParts, b: DateParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function formatTimelineAnchorLabel(
  timestamp: number,
  options: TimelineAnchorOptions = {},
): string {
  const locale = options.locale || (typeof window !== 'undefined' ? window.navigator?.language : 'zh-CN') || 'zh-CN';
  const parts = readDateParts(timestamp, options.timeZone);
  const nowParts = readDateParts((options.now ?? new Date()).getTime(), options.timeZone);
  const time = `${twoDigits(parts.hour)}:${twoDigits(parts.minute)}`;

  if (sameDay(parts, nowParts)) return time;

  const isZh = locale.toLowerCase().startsWith('zh');
  if (parts.year === nowParts.year) {
    return isZh
      ? `${parts.month}月${parts.day}日 ${time}`
      : `${parts.month}/${parts.day} ${time}`;
  }
  return isZh
    ? `${parts.year}年${parts.month}月${parts.day}日 ${time}`
    : `${parts.year}/${parts.month}/${parts.day} ${time}`;
}

export function buildTimelineAnchors(
  items: ChatListItem[],
): TimelineAnchor[] {
  const messages = items
    .filter((item): item is Extract<ChatListItem, { type: 'message' }> => item.type === 'message')
    .map(item => item.data);

  const userTurns = messages.filter(message => message.role === 'user');
  const source = userTurns.length > 0 ? userTurns : messages;

  return source.map((message) => {
    const { source: previewSource, lengthForWidth } = normalizedPreviewInfo(message);
    return {
      messageId: message.id,
      sourceEntryId: message.sourceEntryId,
      timestamp: parseTimestamp(message.timestamp),
      role: message.role,
      label: formatTimelinePromptPreview(previewSource),
      markerWidthEm: measureTimelineMarkerWidthEm(lengthForWidth),
    };
  });
}

export function buildTimelineAnchorsFromUserTurns(turns: SessionUserTurn[]): TimelineAnchor[] {
  return turns.map((turn) => {
    const message = userTurnToChatMessage(turn);
    const { source: previewSource, lengthForWidth } = normalizedPreviewInfo(message);
    return {
      messageId: message.id,
      sourceEntryId: message.sourceEntryId,
      timestamp: parseTimestamp(message.timestamp),
      role: 'user',
      label: formatTimelinePromptPreview(previewSource),
      markerWidthEm: measureTimelineMarkerWidthEm(lengthForWidth),
    };
  });
}
