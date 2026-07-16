import { useEffect, useRef } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import type { BrowserInstanceInfo } from '../../shared/types'
import {
  activeBrowserInstanceIdAtom,
  browserInstancesAtom,
  removeBrowserInstanceAtom,
  setBrowserInstancesAtom,
  updateBrowserInstanceAtom,
} from '@/atoms/browser-pane'

/**
 * Keep the renderer's browser registry synchronized with the active runtime.
 *
 * This deliberately lives outside the top-bar browser control: browser state
 * must continue updating when there is no badge to render or an overlay is
 * closed.
 */
export function useBrowserPaneRegistry(): void {
  const [instances] = useAtom(browserInstancesAtom)
  const [, setActiveInstanceId] = useAtom(activeBrowserInstanceIdAtom)
  const setInstances = useSetAtom(setBrowserInstancesAtom)
  const updateInstance = useSetAtom(updateBrowserInstanceAtom)
  const removeInstance = useSetAtom(removeBrowserInstanceAtom)
  const instancesRef = useRef(instances)
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    instancesRef.current = instances
  }, [instances])

  useEffect(() => {
    const browserPaneApi = window.electronAPI?.browserPane
    if (!browserPaneApi || !window.electronAPI.isChannelAvailable('browser-pane:list')) {
      setInstances([])
      setActiveInstanceId(null)
      return
    }

    void browserPaneApi.list()
      .then((items) => {
        setInstances(items)
        setActiveInstanceId((previous) => {
          if (previous && items.some((item) => item.id === previous)) return previous
          return items.at(-1)?.id ?? null
        })
      })
      .catch((error) => {
        console.warn('[BrowserRegistry] Failed to list browser panes:', error)
        setInstances([])
        setActiveInstanceId(null)
      })

    const cleanupState = browserPaneApi.onStateChanged((info: BrowserInstanceInfo) => {
      updateInstance(info)
    })

    const cleanupRemoved = browserPaneApi.onRemoved((id: string) => {
      removeInstance(id)
      setActiveInstanceId((previous) => {
        if (previous !== id) return previous
        const remaining = instancesRef.current.filter((item) => item.id !== id)
        return remaining.at(-1)?.id ?? null
      })

      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current)
      reconcileTimerRef.current = setTimeout(() => {
        reconcileTimerRef.current = null
        void browserPaneApi.list()
          .then((items) => {
            setInstances(items)
            setActiveInstanceId((previous) => {
              if (previous && items.some((item) => item.id === previous)) return previous
              return items.at(-1)?.id ?? null
            })
          })
          .catch((error) => console.warn('[BrowserRegistry] Reconcile failed:', error))
      }, 75)
    })

    const cleanupInteracted = browserPaneApi.onInteracted((id: string) => {
      setActiveInstanceId(id)
    })

    return () => {
      cleanupState()
      cleanupRemoved()
      cleanupInteracted()
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current)
    }
  }, [removeInstance, setActiveInstanceId, setInstances, updateInstance])
}
