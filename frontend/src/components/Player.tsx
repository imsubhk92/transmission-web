import { useEffect, useRef, useState } from 'react'
import { CircleHelp, Download, Film, LoaderCircle, RefreshCw, Signal } from 'lucide-react'
import { api, bytes } from '../lib/api'
import type { Torrent, TorrentFile } from '../lib/types'
import { Modal } from './Modal'

export function Player({
  torrent,
  file,
  onClose,
}: {
  torrent: Torrent
  file: TorrentFile
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  const [message, setMessage] = useState('Preparing your stream…')
  const [error, setError] = useState('')
  const [buffering, setBuffering] = useState(false)
  const [retry, setRetry] = useState(0)
  const player = useRef<HTMLVideoElement>(null)
  const savedTime = useRef(0)
  useEffect(() => {
    let active = true
    setError('')
    setUrl('')
    void api<{ url: string; message: string }>(
      `/torrents/${torrent.hash_string}/files/${file.index}/prepare`,
      { method: 'POST' },
    )
      .then((result) => {
        if (active) {
          setUrl(`${result.url}?attempt=${retry}`)
          setMessage(result.message)
        }
      })
      .catch((err) => {
        if (active) setError(err.message)
      })
    return () => {
      active = false
    }
  }, [torrent.hash_string, file.index, retry])
  const percent = file.length ? Math.min(100, (file.bytes_completed / file.length) * 100) : 0
  return (
    <Modal
      title={file.name.split('/').pop() || 'Now playing'}
      subtitle={torrent.name}
      onClose={onClose}
      wide
    >
      <div className="video-container">
        {url ? (
          <video
            ref={player}
            src={url}
            controls
            autoPlay
            playsInline
            preload="metadata"
            aria-label="Media player"
            onTimeUpdate={() => {
              savedTime.current = player.current?.currentTime || 0
            }}
            onLoadedMetadata={() => {
              if (player.current && savedTime.current > 0)
                player.current.currentTime = savedTime.current
            }}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
            onError={() => {
              setBuffering(false)
              setError(
                'Playback could not start. The next pieces may still be downloading, or this browser may not support the media codec.',
              )
            }}
          />
        ) : (
          <div className="player-placeholder">
            <Film size={42} />
            <span>Getting everything ready</span>
            <LoaderCircle size={22} className="spin" />
          </div>
        )}
        {buffering && !error && (
          <div className="buffering">
            <LoaderCircle size={18} className="spin" />
            Buffering downloaded pieces…
          </div>
        )}
      </div>
      <div className="player-info">
        <span className="badge green">
          <Signal size={13} />
          Direct stream
        </span>
        <span>
          {bytes(file.bytes_completed)} / {bytes(file.length)}
        </span>
        <span>{percent.toFixed(1)}% downloaded</span>
      </div>
      <div className="progress-track">
        <div style={{ width: `${percent}%` }} />
      </div>
      {error ? (
        <div className="player-notice">
          <CircleHelp size={18} />
          <div>
            <strong>Waiting for a playable stream</strong>
            <p>{error}</p>
            <button
              className="button secondary small"
              onClick={() => setRetry((value) => value + 1)}
            >
              <RefreshCw size={14} />
              Retry playback
            </button>
          </div>
        </div>
      ) : (
        <p className="stream-note">{message}</p>
      )}
      <footer className="player-footer">
        <p>Playback depends on available pieces and your browser’s codec support.</p>
        <a
          className="button secondary small"
          href={`/api/torrents/${torrent.hash_string}/files/${file.index}/stream?download=1`}
          download
        >
          <Download size={15} />
          Download file
        </a>
      </footer>
    </Modal>
  )
}
