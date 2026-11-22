import { useEffect, useState } from 'react'
import {
  Check,
  HardDrive,
  LoaderCircle,
  LockKeyhole,
  Network,
  Save,
  SlidersHorizontal,
} from 'lucide-react'
import { api } from '../lib/api'
import type { Session } from '../lib/types'

export function Settings({
  session,
  connected,
  notify,
  authRequired,
  onLogout,
}: {
  session: Session
  connected: boolean
  notify: (message: string) => void
  authRequired: boolean
  onLogout: () => void
}) {
  const [form, setForm] = useState<Session>(session)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    if (!dirty) setForm(session)
  }, [session, dirty])
  function update(value: Partial<Session>) {
    setForm((current) => ({ ...current, ...value }))
    setDirty(true)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    const {
      speed_limit_down,
      speed_limit_down_enabled,
      speed_limit_up,
      speed_limit_up_enabled,
      download_queue_size,
      download_queue_enabled,
    } = form
    try {
      await api('/session', {
        method: 'PATCH',
        body: JSON.stringify({
          speed_limit_down,
          speed_limit_down_enabled,
          speed_limit_up,
          speed_limit_up_enabled,
          download_queue_size,
          download_queue_enabled,
        }),
      })
      notify('Your preferences are saved.')
      setDirty(false)
    } catch (err) {
      notify((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="settings-layout">
      <form className="settings-panel" onSubmit={save}>
        <div className="section-heading">
          <SlidersHorizontal size={20} />
          <div>
            <h2>Bandwidth & queue</h2>
            <p>Make room for everything else on your network.</p>
          </div>
        </div>
        <div className="setting-row">
          <label htmlFor="download-limit">
            <strong>Download speed limit</strong>
            <span>Maximum speed across all downloads</span>
          </label>
          <div className="setting-control">
            <input
              aria-label="Enable download speed limit"
              type="checkbox"
              checked={!!form.speed_limit_down_enabled}
              onChange={(e) => update({ speed_limit_down_enabled: e.target.checked })}
            />
            <div className="number-input">
              <input
                id="download-limit"
                aria-label="Download speed limit"
                type="number"
                min={0}
                max={1000000}
                value={form.speed_limit_down ?? 1000}
                onChange={(e) => update({ speed_limit_down: Number(e.target.value) })}
              />
              <span>KB/s</span>
            </div>
          </div>
        </div>
        <div className="setting-row">
          <label htmlFor="upload-limit">
            <strong>Upload speed limit</strong>
            <span>Keep your connection comfortable while seeding</span>
          </label>
          <div className="setting-control">
            <input
              aria-label="Enable upload speed limit"
              type="checkbox"
              checked={!!form.speed_limit_up_enabled}
              onChange={(e) => update({ speed_limit_up_enabled: e.target.checked })}
            />
            <div className="number-input">
              <input
                id="upload-limit"
                aria-label="Upload speed limit"
                type="number"
                min={0}
                max={1000000}
                value={form.speed_limit_up ?? 100}
                onChange={(e) => update({ speed_limit_up: Number(e.target.value) })}
              />
              <span>KB/s</span>
            </div>
          </div>
        </div>
        <div className="setting-row">
          <label htmlFor="queue-size">
            <strong>Active download queue</strong>
            <span>How many torrents can download at once</span>
          </label>
          <div className="setting-control">
            <input
              aria-label="Enable download queue"
              type="checkbox"
              checked={!!form.download_queue_enabled}
              onChange={(e) => update({ download_queue_enabled: e.target.checked })}
            />
            <div className="number-input">
              <input
                id="queue-size"
                aria-label="Active download queue"
                type="number"
                min={1}
                max={100}
                value={form.download_queue_size ?? 5}
                onChange={(e) => update({ download_queue_size: Number(e.target.value) })}
              />
              <span>torrents</span>
            </div>
          </div>
        </div>
        <footer className="settings-footer">
          <span>
            <Check size={14} />
            Applied directly to Transmission
          </span>
          <button className="button primary" disabled={!connected || busy || !dirty}>
            {busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />}Save
            preferences
          </button>
        </footer>
      </form>
      <div className="settings-side">
        <div className="info-card">
          <Network size={21} />
          <h3>Your connection</h3>
          <p>Transmission {session.version || '—'}</p>
          <span className={`badge ${connected ? 'green' : 'error'}`}>
            {connected ? 'Connected' : 'Offline'}
          </span>
        </div>
        <div className="info-card">
          <HardDrive size={21} />
          <h3>Download location</h3>
          <code>{session.download_dir || 'Waiting for connection'}</code>
          <p>FastAPI and Transmission share this folder for direct playback.</p>
        </div>
        <div className="info-card">
          <LockKeyhole size={21} />
          <h3>Workspace access</h3>
          <p>
            {authRequired
              ? 'Password protection is enabled.'
              : 'Local access. Set APP_PASSWORD on the server to enable a login.'}
          </p>
          {authRequired && (
            <button className="button secondary small" onClick={onLogout} type="button">
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
