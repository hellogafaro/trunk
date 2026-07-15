/**
 * SessionViewer - Read-only session transcript viewer
 *
 * Platform-agnostic component for viewing session transcripts.
 * Used by the web viewer app. For interactive chat, Electron uses ChatDisplay.
 *
 * Renders a session's messages as turn cards with gradient fade at top/bottom.
 */

import type { ReactNode } from 'react'
import { useMemo, useState, useCallback } from 'react'
import type { StoredSession } from '@craft-agent/core'
import { cn } from '../../lib/utils'
import { CHAT_LAYOUT, CHAT_CLASSES } from '../../lib/layout'
import { PlatformProvider, type PlatformActions } from '../../context'
import { TurnCard } from './TurnCard'
import { UserMessageBubble } from './UserMessageBubble'
import { SystemMessage } from './SystemMessage'
import {
  groupMessagesByTurn,
  storedToMessage,
  getAssistantTurnUiKey,
  type ActivityItem,
} from './turn-utils'

export type SessionViewerMode = 'interactive' | 'readonly'

export interface SessionViewerProps {
  /** Session data to display */
  session: StoredSession
  /** View mode - 'readonly' for web viewer, 'interactive' for Electron */
  mode?: SessionViewerMode
  /** Platform-specific actions (file opening, URL handling, etc.) */
  platformActions?: PlatformActions
  /** Additional className for the container */
  className?: string
  /** Callback when a turn is clicked */
  onTurnClick?: (turnId: string) => void
  /** Callback when an activity is clicked */
  onActivityClick?: (activity: ActivityItem) => void
  /** Default expanded state for turns (true for readonly, false for interactive) */
  defaultExpanded?: boolean
  /** Custom header content */
  header?: ReactNode
  /** Custom footer content (input area for interactive mode) */
  footer?: ReactNode
  /** Optional session folder path for stripping from file paths in tool display */
  sessionFolderPath?: string
}

/** Trunk product mark used in shared session views. */
function TrunkLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 880 880"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M279.679 44.566c-39.268 24.617-74.157 46.405-77.689 48.669C182.498 105.543 34.607 198.071 26.838 202.74c-5.085 2.971-13.137 8.064-18.08 11.176L0 219.576l.283 110.495.423 110.495 30.652 19.241c141.111 88 143.512 89.556 144.359 94.084.566 2.263.848 51.923.707 110.353l-.141 106.11 25.849 16.411C282.928 837.698 350.87 880 352.141 880c1.413 0 17.092-9.762 166.254-103.28 67.942-42.585 206.51-129.312 226.003-141.479 21.612-13.44 51.133-31.974 60.456-37.916 5.226-3.254 11.724-7.216 14.408-8.772 2.683-1.556 17.374-10.752 32.488-20.231l27.544-17.402.424-110.496L880 329.929l-9.464-6.083c-5.367-3.254-12.713-8.065-16.668-10.47C811.352 286.212 353.13 0 352.141 0c-.706 0-33.335 20.09-72.462 44.566Zm-83.48 77.672c8.899 5.518 22.742 14.148 30.793 19.241 8.051 5.093 25.143 15.846 38.138 23.91 13.136 8.064 26.979 16.695 30.793 19.241 3.955 2.547 10.311 6.508 14.125 8.913 79.666 49.943 175.576 110.071 197.047 123.37 15.114 9.479 44.494 27.73 65.258 40.746 20.764 13.016 58.761 36.643 84.328 52.63l46.613 29.004.141 110.07c0 87.717-.424 109.93-1.695 109.081-2.26-1.274-55.936-34.663-121.053-75.409-27.544-17.26-50.568-31.267-51.274-31.267-.565 0-1.13 49.094-1.13 108.939v109.081l-3.108-1.698c-3.108-1.556-37.997-23.344-128.257-79.794l-43.082-27.023-.423-110.353-.283-110.354-67.518-42.302c-37.008-23.203-76.7-48.103-88.142-55.036l-20.764-12.874-.141-110.071c0-87.717.424-109.929 1.836-109.08.848.565 8.899 5.517 17.798 11.035Z"
      />
    </svg>
  )
}

/**
 * SessionViewer - Read-only session transcript viewer component
 */
export function SessionViewer({
  session,
  mode = 'readonly',
  platformActions = {},
  className,
  onTurnClick,
  onActivityClick,
  defaultExpanded = false,
  header,
  footer,
  sessionFolderPath,
}: SessionViewerProps) {
  // Convert StoredMessage[] to Message[] and group into turns.
  // Viewer is always a snapshot of a finished session, so we mark it as not processing
  // to force the open turn (if any) to flush with the intermediate-text fallback applied.
  const turns = useMemo(
    () => groupMessagesByTurn(session.messages.map(storedToMessage), { isSessionProcessing: false }),
    [session.messages]
  )

  // Track expanded turns (for controlled state)
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => {
    // Default: all turns collapsed, can override with defaultExpanded prop
    if (defaultExpanded) {
      return new Set(
        turns
          .map((turn, index) => turn.type === 'assistant' ? getAssistantTurnUiKey(turn, index) : null)
          .filter((key): key is string => !!key)
      )
    }
    return new Set()
  })

  // Track expanded activity groups
  const [expandedActivityGroups, setExpandedActivityGroups] = useState<Set<string>>(new Set())

  const handleExpandedChange = useCallback((turnId: string, expanded: boolean) => {
    setExpandedTurns(prev => {
      const next = new Set(prev)
      if (expanded) {
        next.add(turnId)
      } else {
        next.delete(turnId)
      }
      return next
    })
  }, [])

  const handleExpandedActivityGroupsChange = useCallback((groups: Set<string>) => {
    setExpandedActivityGroups(groups)
  }, [])

  const handleOpenActivityDetails = useCallback((activity: ActivityItem) => {
    if (onActivityClick) {
      onActivityClick(activity)
    } else if (platformActions.onOpenActivityDetails) {
      platformActions.onOpenActivityDetails(session.id, activity.id)
    }
  }, [onActivityClick, platformActions, session.id])

  const handleOpenTurnDetails = useCallback((turnId: string) => {
    if (onTurnClick) {
      onTurnClick(turnId)
    } else if (platformActions.onOpenTurnDetails) {
      platformActions.onOpenTurnDetails(session.id, turnId)
    }
  }, [onTurnClick, platformActions, session.id])

  return (
    <PlatformProvider actions={platformActions}>
      <div className={cn("flex flex-col h-full", className)}>
        {/* Header */}
        {header && (
          <div className="shrink-0 border-b">
            {header}
          </div>
        )}

        {/* Messages area with gradient fade mask at top/bottom */}
        <div
          className="flex-1 min-h-0"
          style={{
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)'
          }}
        >
          <div className="h-full overflow-y-auto">
            <div className={cn(CHAT_LAYOUT.maxWidth, "mx-auto", CHAT_LAYOUT.containerPadding, CHAT_LAYOUT.messageSpacing)}>
            {turns.map((turn, index) => {
              if (turn.type === 'user') {
                return (
                  <div key={turn.message.id} className={CHAT_LAYOUT.userMessagePadding}>
                    <UserMessageBubble
                      content={turn.message.content}
                      attachments={turn.message.attachments}
                      badges={turn.message.badges}
                      onUrlClick={platformActions.onOpenUrl}
                      onFileClick={platformActions.onOpenFile}
                    />
                  </div>
                )
              }

              if (turn.type === 'system') {
                const msgType = turn.message.role === 'error' ? 'error' :
                               turn.message.role === 'warning' ? 'warning' :
                               turn.message.role === 'info' ? 'info' : 'system'
                return (
                  <SystemMessage
                    key={turn.message.id}
                    content={turn.message.content}
                    type={msgType}
                  />
                )
              }

              if (turn.type === 'assistant') {
                const assistantUiKey = getAssistantTurnUiKey(turn, index)
                return (
                  <TurnCard
                    key={assistantUiKey}
                    turnId={turn.turnId}
                    activities={turn.activities}
                    response={turn.response}
                    intent={turn.intent}
                    isStreaming={turn.isStreaming}
                    isComplete={turn.isComplete}
                    isExpanded={expandedTurns.has(assistantUiKey)}
                    onExpandedChange={(expanded) => handleExpandedChange(assistantUiKey, expanded)}
                    onOpenFile={platformActions.onOpenFile}
                    onOpenUrl={platformActions.onOpenUrl}
                    onPopOut={platformActions.onOpenMarkdownPreview}
                    onOpenDetails={() => handleOpenTurnDetails(turn.turnId)}
                    onOpenActivityDetails={handleOpenActivityDetails}
                    todos={turn.todos}
                    expandedActivityGroups={expandedActivityGroups}
                    onExpandedActivityGroupsChange={handleExpandedActivityGroupsChange}
                    hasEditOrWriteActivities={turn.activities.some(a =>
                      a.toolName === 'Edit' || a.toolName === 'Write'
                    )}
                    onOpenMultiFileDiff={platformActions.onOpenMultiFileDiff
                      ? () => platformActions.onOpenMultiFileDiff!(session.id, turn.turnId)
                      : undefined
                    }
                    sessionFolderPath={sessionFolderPath}
                    annotationInteractionMode={mode === 'readonly' ? 'tooltip-only' : 'interactive'}
                  />
                )
              }

              return null
            })}

            {/* Bottom branding */}
            <div className={CHAT_CLASSES.brandingContainer}>
              <TrunkLogo className="w-8 h-8 text-foreground/40" />
            </div>
            </div>
          </div>
        </div>

        {/* Footer (input area) */}
        {footer && (
          <div className="shrink-0 border-t">
            {footer}
          </div>
        )}
      </div>
    </PlatformProvider>
  )
}
