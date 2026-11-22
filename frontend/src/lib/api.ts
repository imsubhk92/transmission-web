export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function api<T = { ok: boolean }>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message =
      typeof data.detail === 'string'
        ? data.detail
        : data.detail?.[0]?.msg || `Request failed (${response.status})`
    throw new ApiError(message, response.status)
  }
  return data as T
}

export function bytes(value = 0, decimals = 1): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)))
  return `${(value / 1024 ** unit).toFixed(unit ? decimals : 0)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`
}

export function duration(seconds: number): string {
  if (seconds < 0 || !Number.isFinite(seconds)) return 'Calculating…'
  if (seconds < 60) return `${Math.ceil(seconds)} sec`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)} days`
}

export function status(torrent: {
  status: number
  error: number
  percent_done: number
  metadata_percent_complete: number
}): { label: string; tone: string } {
  if (torrent.error) return { label: 'Needs attention', tone: 'error' }
  if (torrent.metadata_percent_complete < 1) return { label: 'Fetching metadata', tone: 'muted' }
  if (torrent.status === 0) return { label: 'Paused', tone: 'muted' }
  if (torrent.status === 1 || torrent.status === 2) return { label: 'Verifying', tone: 'amber' }
  if (torrent.status === 3) return { label: 'Queued', tone: 'muted' }
  if (torrent.status === 4) return { label: 'Downloading', tone: 'green' }
  if (torrent.status === 6) return { label: 'Seeding', tone: 'blue' }
  return { label: torrent.percent_done >= 1 ? 'Completed' : 'Queued', tone: 'blue' }
}
