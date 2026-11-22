import { useEffect, useState } from 'react'
import {
  Check,
  Download,
  File as FileIcon,
  Film,
  LoaderCircle,
  Music2,
  Play,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { api, bytes, status } from '../lib/api'
import type { Torrent, TorrentFile } from '../lib/types'
import { Modal } from './Modal'

export function Details({
  torrent,
  onClose,
  onPlay,
  onRemove,
  onAction,
  notify,
  connected,
}: {
  torrent: Torrent
  onClose: () => void
  onPlay: (torrent: Torrent, file: TorrentFile) => void
  onRemove: (torrent: Torrent) => void
  onAction: (torrent: Torrent, action: string) => void
  notify: (message: string) => void
  connected: boolean
}) {
  const [tab, setTab] = useState<'files' | 'info'>('files')
  const [detail, setDetail] = useState<Torrent | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)
  useEffect(() => {
    let active = true
    void api<Torrent>(`/torrents/${torrent.hash_string}`)
      .then((data) => {
        if (active) setDetail(data)
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
    return () => {
      active = false
    }
  }, [torrent.hash_string])
  async function select(file: TorrentFile, values: object) {
    setBusy(file.index)
    try {
      await api(`/torrents/${torrent.hash_string}/files/${file.index}`, {
        method: 'PATCH',
        body: JSON.stringify(values),
      })
      notify('File preferences updated.')
    } catch (err) {
      notify((err as Error).message)
    } finally {
      setBusy(null)
    }
  }
  const state = status(torrent)
  return (
    <Modal
      title={torrent.name}
      subtitle={`${bytes(torrent.total_size)} · ${torrent.files.length} ${torrent.files.length === 1 ? 'file' : 'files'}`}
      onClose={onClose}
      wide
    >
      <div className="detail-overview">
        <span className={`badge ${state.tone}`}>{state.label}</span>
        <strong>{(torrent.percent_done * 100).toFixed(1)}%</strong>
        <span>{torrent.peers_connected} peers</span>
        <span>Ratio {Math.max(0, torrent.upload_ratio).toFixed(2)}</span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${torrent.percent_done * 100}%` }} />
      </div>
      <div className="detail-tabs">
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
          Files <span>{torrent.files.length}</span>
        </button>
        <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>
          Information
        </button>
      </div>
      {tab === 'files' ? (
        <div className="file-list">
          {torrent.files.map((file) => (
            <div className="file-row" key={file.index}>
              <input
                aria-label={`Download ${file.name}`}
                type="checkbox"
                checked={file.wanted}
                disabled={!connected || busy === file.index}
                onChange={(e) => void select(file, { wanted: e.target.checked })}
              />
              <span className="file-icon">
                {file.media_type === 'video' ? (
                  <Film size={21} />
                ) : file.media_type === 'audio' ? (
                  <Music2 size={21} />
                ) : (
                  <FileIcon size={21} />
                )}
              </span>
              <div className="file-name">
                <strong>{file.name.split('/').pop()}</strong>
                <span>
                  {bytes(file.length)} ·{' '}
                  {file.length ? ((file.bytes_completed / file.length) * 100).toFixed(0) : '100'}%
                  downloaded
                </span>
              </div>
              <select
                aria-label={`Priority for ${file.name}`}
                value={file.priority}
                disabled={!connected || busy === file.index}
                onChange={(e) => void select(file, { priority: Number(e.target.value) })}
              >
                <option value={-1}>Low priority</option>
                <option value={0}>Normal priority</option>
                <option value={1}>High priority</option>
              </select>
              {busy === file.index ? (
                <LoaderCircle size={17} className="spin" />
              ) : file.playable ? (
                <button
                  className="icon-button play-file"
                  disabled={!connected}
                  onClick={() => onPlay(torrent, file)}
                  aria-label={`Play ${file.name}`}
                >
                  <Play size={17} />
                </button>
              ) : file.bytes_completed >= file.length ? (
                <a
                  className="icon-button"
                  href={`/api/torrents/${torrent.hash_string}/files/${file.index}/stream?download=1`}
                  download
                  aria-label={`Save ${file.name}`}
                >
                  <Download size={17} />
                </a>
              ) : (
                <span className="icon-button inactive">
                  <Check size={16} />
                </span>
              )}
            </div>
          ))}
          {!torrent.files.length && (
            <p className="muted">Files will appear when the torrent metadata arrives.</p>
          )}
        </div>
      ) : (
        <div className="torrent-information">
          <dl>
            <dt>Info hash</dt>
            <dd className="mono">{torrent.hash_string}</dd>
            <dt>Added</dt>
            <dd>{new Date(torrent.added_date * 1000).toLocaleString()}</dd>
            <dt>Downloaded</dt>
            <dd>{bytes(torrent.downloaded_ever)}</dd>
            <dt>Uploaded</dt>
            <dd>{bytes(torrent.uploaded_ever)}</dd>
          </dl>
          <h3>Trackers</h3>
          {error && <p className="inline-error">{error}</p>}
          {!detail && !error && <LoaderCircle size={18} className="spin" />}
          {detail?.tracker_stats?.length
            ? detail.tracker_stats.map((tracker, i) => (
                <div className="tracker" key={i}>
                  <strong>{tracker.host}</strong>
                  <span>{tracker.last_announce_result || 'Waiting for announcement'}</span>
                </div>
              ))
            : detail && (
                <p className="muted">No trackers. Peer discovery may use DHT or local peers.</p>
              )}
        </div>
      )}
      {torrent.error_string && <p className="inline-error">{torrent.error_string}</p>}
      <footer className="modal-footer spread">
        <button
          className="button danger-ghost small"
          disabled={!connected}
          onClick={() => onRemove(torrent)}
        >
          <Trash2 size={15} />
          Remove torrent
        </button>
        <button
          className="button secondary small"
          disabled={!connected}
          onClick={() => onAction(torrent, 'verify')}
        >
          <RotateCcw size={15} />
          Verify files
        </button>
      </footer>
    </Modal>
  )
}
