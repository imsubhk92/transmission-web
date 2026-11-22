import { useEffect, useState } from 'react'
import { api } from './api'
import type { Snapshot } from './types'

const empty: Snapshot = { connected: false, torrents: [], stats: {}, session: {} }

export function useLiveState(enabled: boolean, onUnauthorized: () => void) {
  const [state, setState] = useState<Snapshot>(empty)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let active = true
    void api<Snapshot>('/state')
      .then((data) => {
        if (active) {
          setState(data)
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })
    const source = new EventSource('/api/events')
    source.addEventListener('state', (event: MessageEvent) => {
      if (!active) return
      try {
        setState(JSON.parse(event.data))
        setLive(true)
        setLoading(false)
      } catch {
        /* reconnect on next event */
      }
    })
    source.onerror = () => {
      setLive(false)
      void api<{ authenticated: boolean }>('/auth')
        .then((auth) => {
          if (active && !auth.authenticated) onUnauthorized()
        })
        .catch(() => {})
    }
    return () => {
      active = false
      source.close()
    }
  }, [enabled, onUnauthorized])
  return { state, loading, live }
}
