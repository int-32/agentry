// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../stores';

vi.mock('../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(),
}));

describe('MainContent app file drag attachments', () => {
  beforeEach(() => {
    window.t = ((key: string) => key) as typeof window.t;
    useStore.setState({
      currentSessionPath: '/sessions/main.jsonl',
      attachedFiles: [],
      attachedFilesBySession: {},
    } as never);
  });

  it('attaches dragged session files without re-uploading them', async () => {
    const { attachAppFileDragPayloadToInput } = await import('../../MainContent');

    await attachAppFileDragPayloadToInput({
      dragId: 'hana-drag-test',
      source: 'session-file',
      files: [{
        id: 'sf_report',
        fileId: 'sf_report',
        name: 'report.pdf',
        path: '/tmp/session-files/report.pdf',
        isDirectory: false,
      }],
    });

    expect(useStore.getState().attachedFiles).toEqual([{
      fileId: 'sf_report',
      path: '/tmp/session-files/report.pdf',
      name: 'report.pdf',
      isDirectory: false,
    }]);
    expect(useStore.getState().attachedFilesBySession['/sessions/main.jsonl']).toEqual(useStore.getState().attachedFiles);
  });

  it('does not treat task-card drags as chat attachment drags', async () => {
    const { isMainContentAttachmentDrag } = await import('../../MainContent');
    const { TASK_DRAG_MIME } = await import('../../utils/task-drag');

    expect(isMainContentAttachmentDrag({
      types: [TASK_DRAG_MIME],
    } as unknown as DataTransfer)).toBe(false);
  });

  it('still treats native files and app files as chat attachment drags', async () => {
    const { isMainContentAttachmentDrag } = await import('../../MainContent');
    const { APP_FILE_DRAG_MIME } = await import('../../utils/app-file-drag');

    expect(isMainContentAttachmentDrag({
      types: ['Files'],
    } as unknown as DataTransfer)).toBe(true);
    expect(isMainContentAttachmentDrag({
      types: [APP_FILE_DRAG_MIME],
    } as unknown as DataTransfer)).toBe(true);
  });
});
