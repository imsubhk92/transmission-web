import { test, expect } from '@playwright/test'

test('live downloads, file details, search, media playback, and settings', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your downloads.' })).toBeVisible()
  await expect(page.getByText('Live connection', { exact: true })).toBeVisible({ timeout: 20_000 })
  const name = 'Welcome to Streamline.mp4'
  const torrentName = page.getByRole('button', { name, exact: true })
  await expect(torrentName).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: `../docs/downloads-${testInfo.project.name}.png`, fullPage: true })
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()

  await page.getByRole('textbox', { name: 'Search downloads' }).fill('no-match-for-this-search')
  await expect(page.getByRole('heading', { name: 'Nothing by that name. Yet.' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search', exact: true }).first().click()
  await torrentName.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: `Download ${name}` })).toBeChecked()
  await dialog.getByRole('button', { name: 'Information', exact: true }).click()
  await expect(dialog.getByText('Info hash', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()

  await page.getByRole('button', { name: `Stream ${name}`, exact: true }).click()
  await expect(page.getByLabel('Media player')).toBeVisible()
  await expect
    .poll(
      () =>
        page
          .getByLabel('Media player')
          .evaluate((video: HTMLVideoElement) => ({
            ready: video.readyState >= 2,
            time: video.currentTime > 0,
          })),
      { timeout: 20_000 },
    )
    .toEqual({ ready: true, time: true })
  await page.screenshot({ path: `../docs/player-${testInfo.project.name}.png`, fullPage: true })
  await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click()

  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Media library', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your media library.' })).toBeVisible()
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bandwidth & queue' })).toBeVisible()
  await expect(
    page.getByRole('spinbutton', { name: 'Download speed limit', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy()
  expect(errors).toEqual([])
})

test('add torrent dialog and removal confirmation keep data by default', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Live connection', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Add torrent', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Add a torrent' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Torrent file', exact: true }).click()
  await expect(dialog.getByRole('button', { name: /Drop your .torrent file here/ })).toBeVisible()
  await dialog.locator('input[type=file]').setInputFiles('../data/fixtures/welcome.torrent')
  await dialog.getByRole('button', { name: 'Add torrent', exact: true }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'This torrent is already in your downloads.' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Welcome to Streamline.mp4', exact: true }).click()
  await dialog.getByRole('button', { name: 'Remove torrent', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Remove this torrent?' })).toBeVisible()
  await expect(
    dialog.getByRole('checkbox', { name: 'Also permanently delete downloaded files' }),
  ).not.toBeChecked()
  await dialog.getByRole('button', { name: 'Keep torrent' }).click()
  await expect(
    page.getByRole('button', { name: 'Welcome to Streamline.mp4', exact: true }),
  ).toBeVisible()
})

test('pause, resume, and save bandwidth preferences through the real server', async ({
  page,
  request,
}, testInfo) => {
  const original = (await (await request.get('/api/state')).json()).session
  await page.goto('/')
  await expect(page.getByText('Live connection', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Pause Welcome to Streamline.mp4', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Resume Welcome to Streamline.mp4', exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: /Paused/ }).click()
  await expect(
    page.getByRole('button', { name: 'Welcome to Streamline.mp4', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Resume Welcome to Streamline.mp4', exact: true }).click()
  await page.getByRole('tab', { name: /All downloads/ }).click()
  await expect(
    page.getByRole('button', { name: 'Pause Welcome to Streamline.mp4', exact: true }),
  ).toBeVisible()
  if (testInfo.project.name === 'mobile')
    await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('spinbutton', { name: 'Download speed limit', exact: true }).fill('128')
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click()
  await expect
    .poll(async () => (await (await request.get('/api/state')).json()).session.speed_limit_down)
    .toBe(128)
  await request.patch('/api/session', { data: { speed_limit_down: original.speed_limit_down } })
})
