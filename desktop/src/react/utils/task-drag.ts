export const TASK_DRAG_MIME = 'application/x-agentry-task-id';

export function hasTaskDrag(dataTransfer?: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types || []).includes(TASK_DRAG_MIME);
}
