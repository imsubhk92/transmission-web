export interface TorrentFile {
  name: string
  index: number
  length: number
  bytes_completed: number
  playable: boolean
  media_type: 'video' | 'audio' | 'file'
  mime_type: string
  wanted: boolean
  priority: -1 | 0 | 1
}

export interface Torrent {
  id: number
  hash_string: string
  name: string
  status: number
  total_size: number
  size_when_done: number
  percent_done: number
  rate_download: number
  rate_upload: number
  eta: number
  peers_connected: number
  upload_ratio: number
  added_date: number
  error: number
  error_string: string
  metadata_percent_complete: number
  uploaded_ever: number
  downloaded_ever: number
  files: TorrentFile[]
  labels: string[]
  tracker_stats?: {
    host: string
    last_announce_result: string
    seeder_count: number
    leecher_count: number
  }[]
  comment?: string
}

export interface Session {
  version?: string
  download_dir?: string
  speed_limit_down?: number
  speed_limit_down_enabled?: boolean
  speed_limit_up?: number
  speed_limit_up_enabled?: boolean
  download_queue_size?: number
  download_queue_enabled?: boolean
}

export interface Snapshot {
  connected: boolean
  torrents: Torrent[]
  stats: {
    download_speed?: number
    upload_speed?: number
    active_torrent_count?: number
    torrent_count?: number
    cumulative_stats?: { downloaded_bytes: number; uploaded_bytes: number }
  }
  session: Session
  sequential_supported?: boolean
  error?: string
  updated_at?: number
}

export type Page = 'downloads' | 'media' | 'settings'
