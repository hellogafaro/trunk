export function nextFilePreviewRefreshTarget(input: {
  readonly lastTarget: string | null;
  readonly relativePath: string | null;
  readonly refreshKey: string | null;
  readonly hasPendingChange: boolean;
}): string | null {
  if (input.hasPendingChange || !input.relativePath || !input.refreshKey) return null;

  const target = JSON.stringify([input.relativePath, input.refreshKey]);
  return target === input.lastTarget ? null : target;
}
