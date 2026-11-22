import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clapperboard,
  Download,
  Ellipsis,
  Film,
  FolderDown,
  FolderOpen,
  Grid2X2,
  HardDrive,
  Headphones,
  Layers,
  Link2,
  List,
  LoaderCircle,
  Menu,
  Pause,
  Play,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from 'lucide-react'
import { api, bytes, duration, status } from './lib/api'
import { useLiveState } from './lib/useLiveState'
import type { Page, Torrent, TorrentFile } from './lib/types'
import { AddTorrent } from './components/AddTorrent'
import { Details } from './components/Details'
import { Modal } from './components/Modal'
import { Player } from './components/Player'
import { Settings } from './components/Settings'

const pages = {
  downloads: { title: 'Your downloads', subtitle: 'A little less waiting. A lot more watching.' },
  media: {
    title: 'Your media library',
    subtitle: 'Everything you love, ready for a little screen time.',
  },
  settings: {
    title: 'Make yourself at home',
    subtitle: 'A few preferences for a smoother stream.',
  },
}
type Filter = 'all' | 'downloading' | 'completed' | 'paused'

function SignalArt({ small = false, variant = 0 }: { small?: boolean; variant?: number }) {
  return (
    <div
      className={`signal-art ${small ? 'signal-small' : ''} art-${variant % 4}`}
      aria-hidden="true"
    >
      <div className="orb orb-one" />
      <div className="orb orb-two" />
      <div className="signal-orbit orbit-one" />
      <div className="signal-orbit orbit-two" />
      <div className="signal-orbit orbit-three" />
      <div className="signal-orbit orbit-four" />
      <div className="signal-orbit orbit-five" />
      <div className="signal-orbit orbit-six" />
      <div className="signal-core">
        <Play size={small ? 25 : 33} fill="currentColor" strokeWidth={1.2} />
      </div>
      <div className="art-grain" />
    </div>
  )
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <main className="login-screen">
      <div className="login-art">
        <SignalArt />
        <div>
          <span className="eyebrow">YOUR OWN LITTLE CORNER OF THE INTERNET</span>
          <h1>
            Your downloads.
            <br />
            Your stream.
          </h1>
          <p>Good things are worth streaming.</p>
        </div>
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError('')
          try {
            await api('/auth/login', { method: 'POST', body: JSON.stringify({ password }) })
            onLogin()
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        <span className="brand">
          <span className="brand-mark">
            <Radio size={23} />
          </span>
          streamline<span className="brand-period">.</span>
        </span>
        <h2>Welcome back.</h2>
        <p>Your personal stream is right here.</p>
        <label className="field-label">
          Workspace password
          <input
            autoFocus
            required
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}Open
          workspace
        </button>
      </form>
    </main>
  )
}

export default function App() {
  const [auth, setAuth] = useState<{ authenticated: boolean; required: boolean } | null>(null)
  const [authError, setAuthError] = useState(false)
  const [page, setPage] = useState<Page>('downloads')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('date')
  const [layout, setLayout] = useState<'list' | 'grid'>('list')
  const [sidebar, setSidebar] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Torrent | null>(null)
  const [deleteData, setDeleteData] = useState(false)
  const [player, setPlayer] = useState<{ torrent: Torrent; file: TorrentFile } | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState('')
  const [speedHistory, setSpeedHistory] = useState<number[]>([])
  const unauthorized = useCallback(
    () => setAuth((current) => (current ? { ...current, authenticated: false } : null)),
    [],
  )
  const { state, loading, live } = useLiveState(!!auth?.authenticated, unauthorized)
  const connected = state.connected && live
  useEffect(() => {
    if (connected)
      setSpeedHistory((history) => [...history.slice(-23), state.stats.download_speed || 0])
  }, [state.updated_at, state.stats.download_speed, connected])
  const notify = useCallback((message: string) => setToast(message), [])
  const closeAdd = useCallback(() => setAddOpen(false), [])
  const closeDetails = useCallback(() => setSelected(null), [])
  const closePlayer = useCallback(() => setPlayer(null), [])
  const closeGuide = useCallback(() => setGuideOpen(false), [])
  const closeRemove = useCallback(() => {
    setRemoving(null)
    setDeleteData(false)
  }, [])
  const refreshAuth = useCallback(() => {
    setAuthError(false)
    void api<{ authenticated: boolean; required: boolean }>('/auth')
      .then(setAuth)
      .catch(() => setAuthError(true))
  }, [])
  useEffect(refreshAuth, [refreshAuth])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(timer)
  }, [toast])
  const torrents = state.torrents
  const counts = useMemo(
    () => ({
      all: torrents.length,
      downloading: torrents.filter((t) => [3, 4].includes(t.status)).length,
      completed: torrents.filter((t) => t.percent_done >= 1).length,
      paused: torrents.filter((t) => t.status === 0).length,
    }),
    [torrents],
  )
  const visible = useMemo(
    () =>
      torrents
        .filter((t) => {
          if (
            search &&
            !t.name.toLowerCase().includes(search.toLowerCase()) &&
            !t.files.some((f) => f.name.toLowerCase().includes(search.toLowerCase()))
          )
            return false
          if (page === 'media')
            return t.files.some((f) => f.media_type === 'video' || f.media_type === 'audio')
          return (
            filter === 'all' ||
            (filter === 'downloading' && [3, 4].includes(t.status)) ||
            (filter === 'completed' && t.percent_done >= 1) ||
            (filter === 'paused' && t.status === 0)
          )
        })
        .sort((a, b) =>
          sort === 'name'
            ? a.name.localeCompare(b.name)
            : sort === 'progress'
              ? b.percent_done - a.percent_done
              : b.added_date - a.added_date,
        ),
    [torrents, search, filter, page, sort],
  )
  const selectedTorrent = torrents.find((t) => t.hash_string === selected)
  const currentPlayer = player
    ? torrents.find((t) => t.hash_string === player.torrent.hash_string)
    : undefined
  const totalBytes = torrents.reduce(
    (total, t) => total + t.files.reduce((sum, f) => sum + f.bytes_completed, 0),
    0,
  )

  function navigate(next: Page) {
    setPage(next)
    setSearch('')
    setFilter('all')
    setSidebar(false)
  }
  function openPlayer(torrent: Torrent, file?: TorrentFile) {
    const playable = file || torrent.files.find((f) => f.playable)
    if (playable) {
      setSelected(null)
      setPlayer({ torrent, file: playable })
    } else {
      setSelected(torrent.hash_string)
      notify('Select a supported media file. MP4 and WebM work best in a browser.')
    }
  }
  async function action(torrent: Torrent, value: string) {
    setBusy((current) => new Set(current).add(torrent.hash_string))
    try {
      await api(`/torrents/${torrent.hash_string}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: value }),
      })
      notify(
        value === 'pause'
          ? 'Torrent paused.'
          : value === 'verify'
            ? 'Checking downloaded pieces.'
            : 'Torrent resumed.',
      )
    } catch (err) {
      notify((err as Error).message)
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(torrent.hash_string)
        return next
      })
    }
  }
  async function remove() {
    if (!removing) return
    setBusy((current) => new Set(current).add(removing.hash_string))
    try {
      await api(`/torrents/${removing.hash_string}?delete_data=${deleteData}`, { method: 'DELETE' })
      setSelected(null)
      closeRemove()
      notify(
        deleteData
          ? 'Torrent and downloaded files removed.'
          : 'Torrent removed. Downloaded files are kept.',
      )
    } catch (err) {
      notify((err as Error).message)
    } finally {
      setBusy(new Set())
    }
  }

  if (authError)
    return (
      <main className="connection-screen">
        <WifiOff size={36} />
        <h1>Let’s reconnect.</h1>
        <p>The Streamline server isn’t responding. Make sure FastAPI is running.</p>
        <button className="button primary" onClick={refreshAuth}>
          Try again
        </button>
      </main>
    )
  if (!auth)
    return (
      <main className="connection-screen">
        <LoaderCircle className="spin" size={30} />
        <p>Opening your workspace…</p>
      </main>
    )
  if (!auth.authenticated) return <Login onLogin={refreshAuth} />

  function torrentActions(torrent: Torrent) {
    const canPlay = torrent.files.some((f) => f.playable)
    return (
      <div className="torrent-actions">
        {canPlay && (
          <button
            className="play-button"
            title="Stream media"
            aria-label={`Stream ${torrent.name}`}
            disabled={!connected}
            onClick={() => openPlayer(torrent)}
          >
            <Play size={15} fill="currentColor" />
            <span>Stream</span>
          </button>
        )}
        <button
          className="icon-button"
          disabled={!connected || busy.has(torrent.hash_string)}
          onClick={() => void action(torrent, torrent.status === 0 ? 'start' : 'pause')}
          aria-label={`${torrent.status === 0 ? 'Resume' : 'Pause'} ${torrent.name}`}
        >
          {busy.has(torrent.hash_string) ? (
            <LoaderCircle size={17} className="spin" />
          ) : torrent.status === 0 ? (
            <Play size={17} />
          ) : (
            <Pause size={17} />
          )}
        </button>
        <button
          className="icon-button"
          onClick={() => setSelected(torrent.hash_string)}
          aria-label={`Details for ${torrent.name}`}
        >
          <Ellipsis size={20} />
        </button>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside className={`sidebar ${sidebar ? 'is-open' : ''}`}>
        <button
          className="brand"
          onClick={() => navigate('downloads')}
          aria-label="Streamline home"
        >
          <span className="brand-mark">
            <Radio size={23} />
          </span>
          streamline<span className="brand-period">.</span>
        </button>
        <div className="workspace-label">
          <span className="workspace-avatar">P</span>
          <div>
            <strong>Personal workspace</strong>
            <span>Just for you</span>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          <button
            className={page === 'downloads' ? 'active' : ''}
            onClick={() => navigate('downloads')}
          >
            <FolderDown size={19} />
            <span>Downloads</span>
            <span className="nav-count">{torrents.length}</span>
          </button>
          <button className={page === 'media' ? 'active' : ''} onClick={() => navigate('media')}>
            <Clapperboard size={19} />
            <span>Media library</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="connection-card">
            <div className="connection-icon">
              <Layers size={20} />
            </div>
            <h3>Powered by Transmission</h3>
            <p>
              Your files. Your connection.
              <br />
              Always in your control.
            </p>
            <span className={`connection-label ${connected ? 'online' : ''}`}>
              <span className="status-dot" />
              {connected
                ? `Connected · ${state.session.version || 'Transmission'}`
                : loading
                  ? 'Connecting…'
                  : 'Daemon offline'}
            </span>
          </div>
          <nav aria-label="Workspace tools">
            <button
              className={page === 'settings' ? 'active' : ''}
              onClick={() => navigate('settings')}
            >
              <Settings2 size={18} />
              <span>Settings</span>
            </button>
            <button onClick={() => setGuideOpen(true)}>
              <CircleHelp size={18} />
              <span>A little help</span>
              <ChevronRight size={14} />
            </button>
          </nav>
          <div className="sidebar-footer">
            <span className="tiny-mark">
              <Radio size={14} />
            </span>
            <span>Made for a smoother flow.</span>
          </div>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setSidebar(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>
              {page === 'downloads' ? 'Downloads' : page === 'media' ? 'Media library' : 'Settings'}
            </strong>
          </div>
          <div className="topbar-right">
            <span className={`live-label ${connected ? 'is-live' : ''}`}>
              {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
              {connected ? 'Live connection' : 'Reconnecting'}
            </span>
            <span className="topbar-divider" />
            <button
              className="avatar-button"
              title="Personal workspace settings"
              aria-label="Workspace settings"
              onClick={() => navigate('settings')}
            >
              P
            </button>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                YOUR PERSONAL STREAMING SPACE
              </div>
              <h1>
                {pages[page].title}
                <span className="heading-period">.</span>
              </h1>
              <p>{pages[page].subtitle}</p>
            </div>
            {page !== 'settings' && (
              <button className="button primary" onClick={() => setAddOpen(true)}>
                <Plus size={18} />
                Add torrent
              </button>
            )}
          </div>
          {!state.connected && !loading && (
            <div className="offline-banner" role="status">
              <WifiOff size={19} />
              <div>
                <strong>Transmission is taking a moment.</strong>
                <p>{state.error || 'Checking the connection to your download server…'}</p>
              </div>
              <button className="button secondary small" onClick={() => navigate('settings')}>
                Connection details
              </button>
            </div>
          )}
          {page === 'settings' ? (
            <Settings
              session={state.session}
              connected={connected}
              notify={notify}
              authRequired={auth.required}
              onLogout={() => {
                void api('/auth/logout', { method: 'POST' })
                  .then(unauthorized)
                  .catch((err) => notify(err.message))
              }}
            />
          ) : (
            <>
              <section className="stats-grid" aria-label="Download statistics">
                <div className="stat-card">
                  <div className="stat-title">
                    <span className="stat-icon green">
                      <ArrowDown size={17} />
                    </span>
                    Download speed
                    <span className="stat-live">{connected ? 'LIVE' : 'OFFLINE'}</span>
                  </div>
                  <div className="stat-value">
                    {bytes(connected ? state.stats.download_speed : 0)}
                    <span>/s</span>
                    <svg className="sparkline" viewBox="0 0 100 35" aria-hidden="true">
                      <path
                        d={speedHistory
                          .map(
                            (speed, i) =>
                              `${i ? 'L' : 'M'}${(i * 100) / Math.max(1, speedHistory.length - 1)},${30 - (speed / Math.max(1, ...speedHistory)) * 25}`,
                          )
                          .join(' ')}
                      />
                    </svg>
                  </div>
                  <p>
                    {counts.downloading} {counts.downloading === 1 ? 'torrent' : 'torrents'}{' '}
                    downloading
                  </p>
                </div>
                <div className="stat-card">
                  <div className="stat-title">
                    <span className="stat-icon blue">
                      <ArrowUp size={17} />
                    </span>
                    Upload speed
                  </div>
                  <div className="stat-value">
                    {bytes(connected ? state.stats.upload_speed : 0)}
                    <span>/s</span>
                    <span className="stat-decoration">
                      <Activity size={35} />
                    </span>
                  </div>
                  <p>Good things are better shared</p>
                </div>
                <div className="stat-card">
                  <div className="stat-title">
                    <span className="stat-icon neutral">
                      <HardDrive size={17} />
                    </span>
                    Your collection
                  </div>
                  <div className="stat-value">
                    {bytes(totalBytes)}
                    <span className="collection-unit">downloaded</span>
                    <span className="stat-decoration">
                      <Layers size={33} />
                    </span>
                  </div>
                  <p>
                    {counts.completed} completed · {torrents.length} total{' '}
                    {torrents.length === 1 ? 'torrent' : 'torrents'}
                  </p>
                </div>
              </section>
              <section className="feature-banner">
                <div className="feature-content">
                  <span className="feature-tag">
                    <Sparkles size={13} />
                    LESS WAITING, MORE WATCHING
                  </span>
                  <h2>Press play. Keep downloading.</h2>
                  <p>
                    Your next movie night doesn’t need a progress bar.
                    <br className="desktop-break" /> Stream supported videos as the pieces come
                    together.
                  </p>
                  <button
                    onClick={() => {
                      if (page === 'media') setAddOpen(true)
                      else navigate('media')
                    }}
                    className="feature-link"
                  >
                    {page === 'media' ? 'Add something to watch' : 'Explore your media library'}
                    <span className="feature-link-icon">
                      <Play size={11} fill="currentColor" />
                    </span>
                  </button>
                </div>
                <SignalArt />
                <span className="banner-caption">
                  <ShieldCheck size={13} />
                  Direct from your own downloads
                </span>
              </section>
              <section className="download-section" aria-labelledby="collection-title">
                <div className="collection-heading">
                  <div>
                    <h2 id="collection-title">
                      {page === 'media' ? 'In your library' : 'All transfers'}{' '}
                      <span>{page === 'media' ? visible.length : torrents.length}</span>
                    </h2>
                    <p>
                      {page === 'media'
                        ? 'Your own on-demand collection.'
                        : 'A home for everything in motion.'}
                    </p>
                  </div>
                  <div className="view-controls">
                    <label className="sort-control">
                      <span className="sr-only">Sort torrents</span>
                      <select value={sort} onChange={(e) => setSort(e.target.value)}>
                        <option value="date">Recently added</option>
                        <option value="name">Name</option>
                        <option value="progress">Progress</option>
                      </select>
                      <ChevronDown size={13} />
                    </label>
                    <div className="view-toggle">
                      <button
                        aria-label="List view"
                        aria-pressed={layout === 'list'}
                        className={layout === 'list' ? 'selected' : ''}
                        onClick={() => setLayout('list')}
                      >
                        <List size={17} />
                      </button>
                      <button
                        aria-label="Grid view"
                        aria-pressed={layout === 'grid'}
                        className={layout === 'grid' ? 'selected' : ''}
                        onClick={() => setLayout('grid')}
                      >
                        <Grid2X2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="collection-toolbar">
                  {page === 'downloads' ? (
                    <div className="filter-tabs" role="tablist" aria-label="Filter transfers">
                      {(['all', 'downloading', 'completed', 'paused'] as Filter[]).map((item) => (
                        <button
                          key={item}
                          role="tab"
                          aria-selected={filter === item}
                          className={filter === item ? 'active' : ''}
                          onClick={() => setFilter(item)}
                        >
                          {
                            {
                              all: 'All downloads',
                              downloading: 'Downloading',
                              completed: 'Completed',
                              paused: 'Paused',
                            }[item]
                          }
                          <span>{counts[item]}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="media-label">
                      <Film size={16} />
                      Video & audio
                    </span>
                  )}
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="Search downloads"
                      placeholder={page === 'media' ? 'Search your library…' : 'Search downloads…'}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    {search && (
                      <button aria-label="Clear search" onClick={() => setSearch('')}>
                        <X size={14} />
                      </button>
                    )}
                  </label>
                </div>
                {loading ? (
                  <div className="empty-state">
                    <LoaderCircle size={28} className="spin" />
                    <h3>Bringing your downloads together…</h3>
                  </div>
                ) : !visible.length ? (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <div className="empty-ring" />
                      <div className="empty-file">
                        <FolderOpen size={38} strokeWidth={1.2} />
                        <span>
                          <Plus size={13} />
                        </span>
                      </div>
                      <span className="empty-spark spark-one" />
                      <span className="empty-spark spark-two" />
                    </div>
                    <h3>
                      {search
                        ? 'Nothing by that name. Yet.'
                        : torrents.length && page === 'downloads'
                          ? 'All clear here.'
                          : page === 'media'
                            ? 'Your next movie night starts here.'
                            : 'Make room for something good.'}
                    </h3>
                    <p>
                      {search
                        ? 'Try a different name or clear your search.'
                        : torrents.length && page === 'downloads'
                          ? 'Your downloads in this category will show up here.'
                          : page === 'media'
                            ? 'Add a torrent with video or audio to start your personal library.'
                            : 'Drop in a magnet link or a torrent file. We’ll take it from here.'}
                    </p>
                    {search ? (
                      <button className="button secondary" onClick={() => setSearch('')}>
                        Clear search
                      </button>
                    ) : (
                      <button className="button secondary" onClick={() => setAddOpen(true)}>
                        <Plus size={16} />
                        Add your first {page === 'media' ? 'video' : 'torrent'}
                      </button>
                    )}
                    <span className="empty-note">
                      <Link2 size={13} />
                      Magnet links & .torrent files welcome
                    </span>
                  </div>
                ) : layout === 'grid' || page === 'media' ? (
                  <div className="torrent-grid">
                    {visible.map((torrent, i) => {
                      const info = status(torrent)
                      return (
                        <article className="torrent-card" key={torrent.hash_string}>
                          <button
                            className="card-art"
                            aria-label={`Open ${torrent.name}`}
                            onClick={() =>
                              page === 'media'
                                ? openPlayer(torrent)
                                : setSelected(torrent.hash_string)
                            }
                          >
                            <SignalArt small variant={i} />
                            <span className="card-format">
                              {torrent.files.some((f) => f.media_type === 'video') ? (
                                <Film size={12} />
                              ) : (
                                <Headphones size={12} />
                              )}
                              {torrent.files
                                .find((f) => f.playable)
                                ?.name.split('.')
                                .pop()
                                ?.toUpperCase() || 'TORRENT'}
                            </span>
                          </button>
                          <div className="card-body">
                            <span className={`badge ${info.tone}`}>{info.label}</span>
                            <button
                              className="torrent-name"
                              onClick={() => setSelected(torrent.hash_string)}
                            >
                              {torrent.name}
                            </button>
                            <p>
                              {bytes(torrent.total_size)}
                              <span>·</span>
                              {torrent.files.length} {torrent.files.length === 1 ? 'file' : 'files'}
                            </p>
                            <div className="progress-track">
                              <div style={{ width: `${torrent.percent_done * 100}%` }} />
                            </div>
                            <div className="card-bottom">
                              <span>{(torrent.percent_done * 100).toFixed(0)}%</span>
                              {torrentActions(torrent)}
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (
                  <div className="torrent-table">
                    <div className="table-head">
                      <span>Name</span>
                      <span>Progress</span>
                      <span>Speed / peers</span>
                      <span>Actions</span>
                    </div>
                    {visible.map((torrent) => {
                      const info = status(torrent)
                      const video = torrent.files.some((f) => f.media_type === 'video')
                      return (
                        <article className="torrent-row" key={torrent.hash_string}>
                          <div className="torrent-primary">
                            <span className={`torrent-type ${video ? 'video-type' : ''}`}>
                              {video ? <Film size={23} /> : <FolderDown size={23} />}
                            </span>
                            <div>
                              <button
                                className="torrent-name"
                                onClick={() => setSelected(torrent.hash_string)}
                              >
                                {torrent.name}
                              </button>
                              <p>
                                {bytes(torrent.total_size)}
                                <span>·</span>
                                {torrent.files.length}{' '}
                                {torrent.files.length === 1 ? 'file' : 'files'}
                                <span>·</span>
                                <span className={`status-text ${info.tone}`}>{info.label}</span>
                              </p>
                            </div>
                          </div>
                          <div className="torrent-progress">
                            <div>
                              <span>{(torrent.percent_done * 100).toFixed(1)}%</span>
                              <span>
                                {torrent.percent_done >= 1 ? (
                                  <Check size={13} />
                                ) : torrent.status === 4 ? (
                                  duration(torrent.eta)
                                ) : (
                                  '—'
                                )}
                              </span>
                            </div>
                            <div
                              className={`progress-track ${torrent.status === 0 ? 'paused' : ''}`}
                            >
                              <div style={{ width: `${torrent.percent_done * 100}%` }} />
                            </div>
                          </div>
                          <div className="torrent-speed">
                            <strong>
                              {torrent.status === 6 ? (
                                <ArrowUp size={12} />
                              ) : (
                                <ArrowDown size={12} />
                              )}
                              {bytes(
                                connected
                                  ? torrent.status === 6
                                    ? torrent.rate_upload
                                    : torrent.rate_download
                                  : 0,
                              )}
                              /s
                            </strong>
                            <span>{torrent.peers_connected} peers connected</span>
                          </div>
                          {torrentActions(torrent)}
                        </article>
                      )
                    })}
                  </div>
                )}
                <footer className="collection-footer">
                  <span>
                    <ShieldCheck size={14} />
                    Your downloads stay on your server.
                  </span>
                  <span>
                    {visible.length} {visible.length === 1 ? 'torrent' : 'torrents'}
                    {search || filter !== 'all' ? ` of ${torrents.length}` : ''}
                  </span>
                </footer>
              </section>
              <div className="bottom-note">
                <span className="bottom-note-icon">
                  <Zap size={15} />
                </span>
                <p>
                  <strong>A smoother way to stream.</strong> Prioritize a file, press play, and let
                  the rest catch up.
                </p>
                <button onClick={() => setGuideOpen(true)}>
                  How it works
                  <CircleHelp size={14} />
                </button>
              </div>
            </>
          )}
          <footer className="page-footer">
            <span>Built around your flow.</span>
            <span>
              FastAPI <span>+</span> React <span>+</span> Transmission
            </span>
            <span className="version-label">STREAMLINE v0.1</span>
          </footer>
        </main>
        <div className="statusbar">
          <span>
            <span className={`status-dot ${connected ? 'online' : ''}`} />
            {connected ? 'Everything is connected' : 'Waiting for connection'}
          </span>
          <div>
            <span>
              <ArrowDownToLine size={12} />
              {bytes(connected ? state.stats.download_speed : 0)}/s
            </span>
            <span>
              <ArrowUp size={12} />
              {bytes(connected ? state.stats.upload_speed : 0)}/s
            </span>
          </div>
        </div>
      </div>
      {addOpen && <AddTorrent onClose={closeAdd} onAdded={notify} connected={connected} />}
      {selectedTorrent && !removing && (
        <Details
          torrent={selectedTorrent}
          onClose={closeDetails}
          onPlay={openPlayer}
          onRemove={(torrent) => {
            setRemoving(torrent)
            setDeleteData(false)
          }}
          onAction={(torrent, value) => void action(torrent, value)}
          notify={notify}
          connected={connected}
        />
      )}
      {player && (
        <Player
          torrent={currentPlayer || player.torrent}
          file={currentPlayer?.files.find((f) => f.index === player.file.index) || player.file}
          onClose={closePlayer}
        />
      )}
      {removing && (
        <Modal title="Remove this torrent?" subtitle={removing.name} onClose={closeRemove}>
          <p className="remove-explanation">
            This will remove the torrent from Transmission and your library.
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={deleteData}
              onChange={(e) => setDeleteData(e.target.checked)}
            />
            Also permanently delete downloaded files
          </label>
          <p className="field-help">
            {deleteData
              ? 'The downloaded files will be deleted from disk.'
              : 'Downloaded files will be kept on your server.'}
          </p>
          <footer className="modal-footer">
            <button className="button secondary" onClick={closeRemove}>
              Keep torrent
            </button>
            <button
              className="button danger"
              disabled={!connected || busy.has(removing.hash_string)}
              onClick={() => void remove()}
            >
              <Trash2 size={16} />
              Remove torrent
            </button>
          </footer>
        </Modal>
      )}
      {guideOpen && (
        <Modal
          title="Find your flow."
          subtitle="Three small steps. A whole lot to watch."
          onClose={closeGuide}
        >
          <div className="guide-steps">
            <div>
              <span>
                <Plus size={20} />
              </span>
              <div>
                <h3>Add something good</h3>
                <p>
                  Paste a magnet link or upload a .torrent file. Transmission handles downloading
                  and sharing.
                </p>
              </div>
            </div>
            <div>
              <span>
                <Download size={20} />
              </span>
              <div>
                <h3>Make it your own</h3>
                <p>
                  Pause, resume, pick files, and set priorities. Watch your progress update live
                  across your devices.
                </p>
              </div>
            </div>
            <div>
              <span>
                <Play size={20} />
              </span>
              <div>
                <h3>Settle in and press play</h3>
                <p>
                  Open a supported MP4, WebM, or audio file. Transmission 4.1+ downloads
                  sequentially; playback waits for verified pieces. Some codecs and MP4 files need
                  the full download.
                </p>
              </div>
            </div>
          </div>
          <p className="guide-note">
            <ShieldCheck size={16} />
            Your media stays on your server. Streamline plays it directly in your browser.
          </p>
          <footer className="modal-footer">
            <button
              className="button primary"
              onClick={() => {
                closeGuide()
                setAddOpen(true)
              }}
            >
              Let’s get started
              <Plus size={16} />
            </button>
          </footer>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
