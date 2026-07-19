import { describe, expect, it } from "vite-plus/test";

import {
  annotationPointInRect,
  annotationRectFromPoints,
  annotationStrokeBounds,
} from "./browserAnnotationGeometry";

describe("browserAnnotationGeometry", () => {
  it("normalizes a region dragged in any direction", () => {
    expect(annotationRectFromPoints({ x: 80, y: 70 }, { x: 20, y: 10 })).toEqual({
      x: 20,
      y: 10,
      width: 60,
      height: 60,
    });
  });

  it("uses padding when erasing a narrow target", () => {
    const rect = { x: 20, y: 20, width: 10, height: 10 };
    expect(annotationPointInRect({ x: 14, y: 25 }, rect, 8)).toBe(true);
    expect(annotationPointInRect({ x: 10, y: 25 }, rect, 8)).toBe(false);
  });

  it("includes the stroke width in calculated bounds", () => {
    expect(
      annotationStrokeBounds(
        [
          { x: 10, y: 20 },
          { x: 40, y: 70 },
        ],
        6,
      ),
    ).toEqual({ x: 7, y: 17, width: 36, height: 56 });
  });
});
