import type { ChatAttachment } from "@t3tools/contracts";

import { resolveAttachmentPath } from "../attachmentStore.ts";

export function appendFileAttachmentPaths(input: {
  readonly text: string | undefined;
  readonly attachments: ReadonlyArray<ChatAttachment> | undefined;
  readonly attachmentsDir: string;
}): string | undefined {
  const lines = (input.attachments ?? []).flatMap((attachment) => {
    if (attachment.type !== "file") {
      return [];
    }
    const attachmentPath = resolveAttachmentPath({
      attachmentsDir: input.attachmentsDir,
      attachment,
    });
    return attachmentPath
      ? [`- ${JSON.stringify(attachment.name)}: ${JSON.stringify(attachmentPath)}`]
      : [];
  });

  if (lines.length === 0) {
    return input.text;
  }

  const block = [
    "<attached_files>",
    "The user attached the following file(s), saved on disk. Read or extract them with your tools as needed; do not assume their contents.",
    ...lines,
    "</attached_files>",
  ].join("\n");

  return input.text ? `${input.text}\n\n${block}` : block;
}
