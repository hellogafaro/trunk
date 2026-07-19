import type { PreviewAnnotationRect } from "@t3tools/contracts";

export interface BrowserAnnotationPoint {
  readonly x: number;
  readonly y: number;
}

export const annotationRectFromPoints = (
  start: BrowserAnnotationPoint,
  end: BrowserAnnotationPoint,
): PreviewAnnotationRect => ({
  x: Math.min(start.x, end.x),
  y: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

export const annotationPointInRect = (
  point: BrowserAnnotationPoint,
  rect: PreviewAnnotationRect,
  padding = 0,
): boolean =>
  point.x >= rect.x - padding &&
  point.y >= rect.y - padding &&
  point.x <= rect.x + rect.width + padding &&
  point.y <= rect.y + rect.height + padding;

export const annotationStrokeBounds = (
  points: ReadonlyArray<BrowserAnnotationPoint>,
  width: number,
): PreviewAnnotationRect => {
  const first = points[0];
  if (!first) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = first.x;
  let maxX = first.x;
  let minY = first.y;
  let maxY = first.y;
  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const padding = width / 2;
  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
};
