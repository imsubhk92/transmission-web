import { useRef, useState } from 'react'
import { FileUp, Link2, LoaderCircle, Plus, Upload } from 'lucide-react'
import { api } from '../lib/api'
import { Modal } from './Modal'

export function AddTorrent({
  onClose,
  onAdded,
  connected,
}: {
  onClose: () => void
  onAdded: (message: string) => void
  connected: boolean
}) {
  const [tab, setTab] = useState<'magnet' | 'file'>('magnet')
  const [magnet, setMagnet] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [paused, setPaused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      let result: { torrent_duplicate?: object }
      if (tab === 'file') {
        if (!file) throw new Error('Choose a .torrent file first.')
        if (!file.name.toLowerCase().endsWith('.torrent'))
          throw new Error('Choose a file ending in .torrent.')
        if (file.size > 8 * 1024 * 1024)
          throw new Error('The torrent file must be smaller than 8 MB.')
        const body = new FormData()
        body.append('file', file)
        result = await api(`/torrents/upload?paused=${paused}`, { method: 'POST', body })
      } else {
        result = await api('/torrents', {
          method: 'POST',
          body: JSON.stringify({ magnet: magnet.trim(), paused }),
        })
      }
      onAdded(
        result.torrent_duplicate
          ? 'This torrent is already in your downloads.'
          : 'Torrent added to your downloads.',
      )
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title="Add a torrent"
      subtitle="The next thing you love is one link away."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="segmented">
          <button
            type="button"
            className={tab === 'magnet' ? 'selected' : ''}
            onClick={() => setTab('magnet')}
          >
            <Link2 size={16} />
            Magnet link
          </button>
          <button
            type="button"
            className={tab === 'file' ? 'selected' : ''}
            onClick={() => setTab('file')}
          >
            <FileUp size={16} />
            Torrent file
          </button>
        </div>
        {tab === 'magnet' ? (
          <label className="field-label">
            Magnet link
            <textarea
              autoFocus
              required
              placeholder="magnet:?xt=urn:btih:…"
              value={magnet}
              onChange={(e) => setMagnet(e.target.value)}
              rows={4}
            />
            <span className="field-help">Paste the full magnet link from your torrent source.</span>
          </label>
        ) : (
          <>
            <input
              ref={input}
              type="file"
              accept=".torrent,application/x-bittorrent"
              className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
            <button
              type="button"
              className="upload-zone"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                setFile(e.dataTransfer.files[0] || null)
              }}
            >
              <span className="upload-icon">
                <Upload size={24} />
              </span>
              <strong>{file ? file.name : 'Drop your .torrent file here'}</strong>
              <span>
                {file
                  ? `${(file.size / 1024).toFixed(1)} KB · Click to change`
                  : 'or click to browse · up to 8 MB'}
              </span>
            </button>
          </>
        )}
        <label className="checkbox-label">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          Add paused
        </label>
        {!connected && (
          <p className="inline-error">Connect Transmission before adding a torrent.</p>
        )}
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button primary"
            disabled={busy || !connected || (tab === 'file' ? !file : !magnet.trim())}
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={17} />}Add torrent
          </button>
        </footer>
      </form>
    </Modal>
  )
}
