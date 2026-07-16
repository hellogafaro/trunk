export type BrowserViewportMode = 'responsive' | 'desktop' | 'tablet' | 'mobile'

export const BROWSER_VIEWPORT_WIDTHS: Record<Exclude<BrowserViewportMode, 'responsive'>, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 390,
}

export interface BrowserViewportSize {
  width: number
  height: number
}

export function resolveBrowserViewportSize(
  mode: BrowserViewportMode,
  hostWidth: number,
  hostHeight: number,
): BrowserViewportSize {
  return {
    width: mode === 'responsive'
      ? Math.max(320, Math.floor(hostWidth))
      : BROWSER_VIEWPORT_WIDTHS[mode],
    height: Math.max(240, Math.floor(hostHeight)),
  }
}

export function resolveBrowserFrameSize(
  hostWidth: number,
  hostHeight: number,
  frameWidth: number,
  frameHeight: number,
): BrowserViewportSize {
  if (hostWidth <= 0 || hostHeight <= 0 || frameWidth <= 0 || frameHeight <= 0) {
    return { width: 0, height: 0 }
  }

  const scale = Math.min(1, hostWidth / frameWidth, hostHeight / frameHeight)
  return {
    width: Math.max(1, Math.floor(frameWidth * scale)),
    height: Math.max(1, Math.floor(frameHeight * scale)),
  }
}

export function mapBrowserPointer(
  clientX: number,
  clientY: number,
  displayRect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number } {
  const localX = Math.max(0, Math.min(displayRect.width, clientX - displayRect.left))
  const localY = Math.max(0, Math.min(displayRect.height, clientY - displayRect.top))
  return {
    x: displayRect.width > 0 ? localX * (frameWidth / displayRect.width) : 0,
    y: displayRect.height > 0 ? localY * (frameHeight / displayRect.height) : 0,
  }
}

export interface BrowserAnnotationRegion {
  x: number
  y: number
  width: number
  height: number
  note: string
}

export interface BrowserAnnotationDraftRect {
  left: number
  top: number
  width: number
  height: number
}

export function resolveBrowserAnnotationDraftRect(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): BrowserAnnotationDraftRect {
  return {
    left: Math.min(startX, endX),
    top: Math.min(startY, endY),
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  }
}

export function normalizeBrowserAnnotationRegion(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  displayWidth: number,
  displayHeight: number,
): Omit<BrowserAnnotationRegion, 'note'> | null {
  if (displayWidth <= 0 || displayHeight <= 0) return null
  const left = Math.max(0, Math.min(startX, endX))
  const top = Math.max(0, Math.min(startY, endY))
  const right = Math.min(displayWidth, Math.max(startX, endX))
  const bottom = Math.min(displayHeight, Math.max(startY, endY))
  if (right - left < 8 || bottom - top < 8) return null
  return {
    x: left / displayWidth,
    y: top / displayHeight,
    width: (right - left) / displayWidth,
    height: (bottom - top) / displayHeight,
  }
}
