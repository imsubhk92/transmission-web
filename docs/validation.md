# Validation record

Verified locally on 22 November 2026.

| Check | Result | Scope |
| --- | --- | --- |
| Backend tests | 40 passed, warnings treated as errors | API behavior, RPC negotiation and challenge, authentication, origin checks, body limits, byte ranges, missing pieces, stable IDs, file containment, `.part` files, separate shared incomplete storage |
| Python checks | Passed | Ruff checks and formatting for the backend |
| Frontend production build | Passed | TypeScript and Vite |
| Browser tests | 6 passed | Chrome desktop and Chromium with iPhone 13 viewport/touch emulation |
| Native media playback | Passed | Generated H.264/AAC fast-start MP4; browser ready state and advancing playback time |
| Real daemon smoke | Passed | Transmission 4.1.4; exact range/suffix bytes, HEAD, 416, pause/resume, sequential prepare, SSE |
| Actual incomplete transfer | Passed | Original local MP4 with a valid padding atom, downloaded via a throttled local HTTP webseed; requested playback bytes matched the source before completion; completed tail matched |
| Production Docker image | Built | Node 24 frontend stage and non-root Python 3.13 API runtime |
| Full Compose stack | Healthy and connected | Isolated local network, private RPC, shared named volume; API reported `/downloads` and connected Transmission 4.1.4 |

Browser flows included file details, duplicate `.torrent` upload, search, filters, media navigation, pause/resume, bandwidth setting persistence and restoration, and the removal confirmation's default to preserve files. No public torrent swarm was needed. The generated samples and transfer artifacts are in ignored `data/`.

Screenshots:

- [Downloads, desktop](downloads-desktop.png)
- [Downloads, mobile](downloads-mobile.png)
- [Player, desktop](player-desktop.png)
- [Player, mobile](player-mobile.png)

The mobile checks emulate a device in Chromium; they do not validate Safari on an actual iPhone. The legacy RPC path is covered with a mocked transport, rather than a running older daemon. Codec support beyond the test MP4, public swarm performance, remote deployment, HTTPS termination, and multiple simultaneous viewing sessions were not validated by these checks.
