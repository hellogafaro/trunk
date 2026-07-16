import { describe, expect, it } from 'bun:test'
import {
  mapBrowserPointer,
  normalizeBrowserAnnotationRegion,
  resolveBrowserAnnotationDraftRect,
  resolveBrowserFrameSize,
  resolveBrowserViewportSize,
} from '../browser-viewport'

describe('browser viewport helpers', () => {
  it('uses the host width in responsive mode and fixed preset widths otherwise', () => {
    expect(resolveBrowserViewportSize('responsive', 997.8, 650.9)).toEqual({ width: 997, height: 650 })
    expect(resolveBrowserViewportSize('desktop', 997, 650)).toEqual({ width: 1280, height: 650 })
    expect(resolveBrowserViewportSize('tablet', 997, 650)).toEqual({ width: 768, height: 650 })
    expect(resolveBrowserViewportSize('mobile', 997, 650)).toEqual({ width: 390, height: 650 })
  })

  it('scales a frame proportionally to fit the host without stretching', () => {
    expect(resolveBrowserFrameSize(1000, 700, 1280, 700)).toEqual({ width: 1000, height: 546 })
    expect(resolveBrowserFrameSize(1000, 700, 390, 700)).toEqual({ width: 390, height: 700 })
  })

  it('maps displayed pointer coordinates back to the remote viewport', () => {
    const point = mapBrowserPointer(600, 350, { left: 100, top: 50, width: 1000, height: 546 }, 1280, 700)
    expect(point.x).toBe(640)
    expect(point.y).toBeCloseTo(384.62, 2)
  })

  it('normalizes annotation rectangles and rejects accidental clicks', () => {
    expect(normalizeBrowserAnnotationRegion(300, 200, 100, 50, 400, 300)).toEqual({
      x: 0.25,
      y: 1 / 6,
      width: 0.5,
      height: 0.5,
    })
    expect(normalizeBrowserAnnotationRegion(10, 10, 14, 14, 400, 300)).toBeNull()
  })

  it('positions the drag preview at its real origin in either drag direction', () => {
    expect(resolveBrowserAnnotationDraftRect(120, 90, 260, 210)).toEqual({
      left: 120,
      top: 90,
      width: 140,
      height: 120,
    })
    expect(resolveBrowserAnnotationDraftRect(260, 210, 120, 90)).toEqual({
      left: 120,
      top: 90,
      width: 140,
      height: 120,
    })
  })
})
