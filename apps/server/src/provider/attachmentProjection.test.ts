import { describe, expect, it } from "vite-plus/test";

import { appendFileAttachmentPaths } from "./attachmentProjection.ts";

describe("appendFileAttachmentPaths", () => {
  it("appends resolved file paths without projecting images", () => {
    const result = appendFileAttachmentPaths({
      text: "Inspect this",
      attachmentsDir: "/tmp/t3-attachments",
      attachments: [
        {
          type: "file",
          id: "thread-1-00000000-0000-4000-8000-000000000001",
          name: "data.zip",
          mimeType: "application/zip",
          sizeBytes: 42,
        },
        {
          type: "image",
          id: "thread-1-00000000-0000-4000-8000-000000000002",
          name: "screen.png",
          mimeType: "image/png",
          sizeBytes: 24,
        },
      ],
    });

    expect(result).toContain("Inspect this\n\n<attached_files>");
    expect(result).toContain('"data.zip"');
    expect(result).toContain(
      '"/tmp/t3-attachments/thread-1-00000000-0000-4000-8000-000000000001.zip"',
    );
    expect(result).not.toContain("screen.png");
  });

  it("leaves text unchanged without file attachments", () => {
    expect(
      appendFileAttachmentPaths({ text: "Hello", attachments: [], attachmentsDir: "/tmp" }),
    ).toBe("Hello");
  });
});
