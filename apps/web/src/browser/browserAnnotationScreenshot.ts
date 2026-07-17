import type {
  PreviewAnnotationElementTarget,
  PreviewAnnotationRect,
  PreviewAnnotationRegionTarget,
  PreviewAnnotationScreenshot,
  PreviewAnnotationStrokeTarget,
  PreviewBrowserFrame,
} from "@t3tools/contracts";

const ANNOTATION_COLOR = "#2563eb";

const loadFrameImage = (frame: PreviewBrowserFrame): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Unable to load the browser frame.")), {
      once: true,
    });
    image.src = `data:${frame.mimeType};base64,${frame.data}`;
  });

const drawTarget = (
  context: CanvasRenderingContext2D,
  rect: PreviewAnnotationRect,
  index: number,
  dashed: boolean,
): void => {
  const lineWidth = Math.max(2, Math.round(context.canvas.width / 520));
  const badgeRadius = Math.max(11, Math.round(context.canvas.width / 70));
  context.save();
  context.strokeStyle = ANNOTATION_COLOR;
  context.fillStyle = ANNOTATION_COLOR;
  context.lineWidth = lineWidth;
  context.setLineDash(dashed ? [lineWidth * 3, lineWidth * 2] : []);
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  context.setLineDash([]);
  const badgeX = Math.max(badgeRadius + 2, rect.x);
  const badgeY = Math.max(badgeRadius + 2, rect.y);
  context.beginPath();
  context.arc(badgeX, badgeY, badgeRadius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff";
  context.font = `600 ${Math.max(12, Math.round(badgeRadius))}px ui-sans-serif, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(index + 1), badgeX, badgeY + 0.5);
  context.restore();
};

export async function createBrowserAnnotationScreenshot(input: {
  readonly frame: PreviewBrowserFrame;
  readonly elements: ReadonlyArray<PreviewAnnotationElementTarget>;
  readonly regions: ReadonlyArray<PreviewAnnotationRegionTarget>;
  readonly strokes: ReadonlyArray<PreviewAnnotationStrokeTarget>;
}): Promise<PreviewAnnotationScreenshot> {
  const { frame, elements, regions, strokes } = input;
  const image = await loadFrameImage(frame);
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable.");
  context.drawImage(image, 0, 0, frame.width, frame.height);

  elements.forEach((target, index) => drawTarget(context, target.rect, index, false));
  regions.forEach((target, index) =>
    drawTarget(context, target.rect, elements.length + index, true),
  );
  for (const stroke of strokes) {
    const first = stroke.points[0];
    if (!first) continue;
    context.save();
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(first.x, first.y);
    for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
    context.restore();
  }

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: frame.width,
    height: frame.height,
    cropRect: { x: 0, y: 0, width: frame.width, height: frame.height },
  };
}
