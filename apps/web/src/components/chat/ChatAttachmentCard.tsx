import {
  CircleAlertIcon,
  FileArchiveIcon,
  FileAudioIcon,
  FileCodeIcon,
  FileIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  FileVideoIcon,
  XIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import type { ChatAttachment } from "../../types";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "../ui/attachment";

function attachmentExtension(name: string): string {
  const match = /\.([^.]+)$/u.exec(name.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

function formatAttachmentBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(sizeBytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function attachmentIcon(attachment: ChatAttachment): ComponentType<{ className?: string }> {
  const extension = attachmentExtension(attachment.name);
  if (["zip", "gz", "tgz", "tar", "rar", "7z"].includes(extension)) return FileArchiveIcon;
  if (["ts", "tsx", "js", "jsx", "json", "css", "html", "py", "rs", "go"].includes(extension)) {
    return FileCodeIcon;
  }
  if (["csv", "xls", "xlsx"].includes(extension)) return FileSpreadsheetIcon;
  if (attachment.mimeType.startsWith("audio/")) return FileAudioIcon;
  if (attachment.mimeType.startsWith("video/")) return FileVideoIcon;
  if (attachment.mimeType.startsWith("text/") || extension === "pdf") return FileTextIcon;
  return FileIcon;
}

export function ChatAttachmentCard(props: {
  attachment: ChatAttachment;
  nonPersisted?: boolean;
  onOpenImage?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
}) {
  const { attachment } = props;
  const isImage = attachment.type === "image";
  const FileTypeIcon = attachmentIcon(attachment);
  const extension = attachmentExtension(attachment.name);
  const typeLabel = extension ? extension.toUpperCase() : attachment.mimeType;

  return (
    <Attachment
      size="sm"
      orientation={isImage ? "vertical" : "horizontal"}
      state="done"
      className={isImage ? "w-24" : "max-w-72"}
    >
      <AttachmentMedia variant={isImage ? "image" : "icon"}>
        {isImage && attachment.previewUrl ? (
          <img src={attachment.previewUrl} alt="" />
        ) : (
          <FileTypeIcon />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle title={attachment.name}>{attachment.name}</AttachmentTitle>
        <AttachmentDescription>
          {typeLabel} · {formatAttachmentBytes(attachment.sizeBytes)}
        </AttachmentDescription>
      </AttachmentContent>
      {(props.nonPersisted || props.onRemove) && (
        <AttachmentActions>
          {props.nonPersisted && (
            <span
              role="img"
              aria-label="Draft attachment may not persist"
              title="Draft attachment may be lost on navigation"
              className="inline-flex items-center justify-center text-amber-600"
            >
              <CircleAlertIcon className="size-3.5" />
            </span>
          )}
          {props.onRemove && (
            <AttachmentAction aria-label={`Remove ${attachment.name}`} onClick={props.onRemove}>
              <XIcon />
            </AttachmentAction>
          )}
        </AttachmentActions>
      )}
      {isImage && attachment.previewUrl && props.onOpenImage && (
        <AttachmentTrigger aria-label={`Preview ${attachment.name}`} onClick={props.onOpenImage} />
      )}
    </Attachment>
  );
}

export { formatAttachmentBytes };
