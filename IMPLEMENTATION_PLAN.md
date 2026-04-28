# Claude Code Activity Tracker for Garmin — Implementation Plan

A Garmin Connect IQ app that records Claude Code sessions as activities, with a local laptop daemon as the data source and a Cloudflare Tunnel as the gateway. Distributed as source code; users build and sideload their own `.prg` with config baked in. Setup is driven by a Claude Code skill in this repo.

---

## 1. Product summary

**What it is.** A Connect IQ activity-tracker app for Garmin watches (Forerunner / Fenix / Venu families). While running, it records a coding session as a real Garmin "activity" — timer, laps, FIT file, sync to Garmin Connect — capturing both **real watch sensor data** (wrist heart rate, temperature, etc.) and **custom code-metrics** (tokens/sec, tool calls/min, cumulative tokens, lines added/removed, current file, model) via `FitContributor`. Per-lap structure means each user turn shows up as a lap in the activity summary. The Garmin Connect activity page renders the standard HR graph next to the custom code-metric graphs.

**What it explicitly is not.** A fake-health-data app. It does **not** write synthetic values to physiological fields like `HEART_RATE`, `CALORIES`, `DISTANCE`, `SPEED`, `CADENCE`, `POWER`, or `ELEVATION`. Real values from real sensors are fine and intentional; fabricated values are not. It does not use real GPS. Sport type is `SPORT_GENERIC` with `SUB_SPORT_GENERIC` so it does not pollute VO2 max, training load (meaningfully), or Strava run/ride totals.

**Audience.** Developers using Claude Code who own a Connect IQ-capable Garmin watch. Comfortable with a CLI; willing to sideload an app over USB.

**Distribution.** Open-source GitHub repo. Users clone it, open in Claude Code, and ask Claude to install — a skill in `.claude/skills/` orchestrates the entire build + sideload + pair flow. Not distributed via the Connect IQ Store.

**Constraints driving the design.**
- No Anthropic credentials anywhere in our system. The laptop daemon observes Claude Code locally; nothing about the Anthropic API is proxied.
- No accounts, no auth provider, no user database, no recurring infrastructure cost on our side.
- Free for users on the basic path (no domain or Cloudflare account required).
- Must not contaminate Garmin's health analytics or Strava run/ride totals.
- Must support both an ephemeral-tunnel "5-minute path" and a stable-URL "daily-driver path."
- Must survive Garmin firmware variation across at least the most popular recent Forerunner / Fenix / Venu models.

---

## 2. High-level architecture

```
┌────────────────────────────────────────────┐
│ Laptop                                     │
│                                            │
│  Claude Code session                       │
│       │                                    │
│       │ (SDK hooks / JSONL tail)           │
│       ▼                                    │
│  Daemon (Node)                             │
│   ├─ Local HTTP server :7842               │
│   │   GET /poll, POST /ack, etc.           │
│   ├─ Metric extractor                      │
│   └─ cloudflared subprocess                │
│                          │                 │
│                          ▼                 │
│                  Cloudflare Tunnel         │
└──────────────────────────┬─────────────────┘
                           │
                           ▼
                 https://<tunnel>.trycloudflare.com   (Path 1)
                  or https://<sub>.cfargotunnel.com   (Path 2-NoDomain)
                  or https://tracker.yourdomain.com   (Path 2-WithDomain)
                           │
                           ▼
┌──────────────────────────────────────────────┐
│ Garmin watch                                 │
│                                              │
│  Connect IQ app (Monkey C)                   │
│   ├─ Polls daemon every ~2s                  │
│   ├─ ActivityRecording session active        │
│   ├─ Real sensor data recorded by default    │
│   ├─ Writes custom FitContributor fields     │
│   └─ Stops session → FIT file → Garmin sync  │
└──────────────────────────────────────────────┘
```

**Data flow.** Claude Code emits events on the laptop → daemon derives metrics → watch polls daemon over the tunnel → watch writes samples into the live activity alongside its own sensor data → on stop, FIT file syncs to Garmin Connect.

**Trust model.** Watch and daemon share a per-device bearer key, baked into the `.prg` at build time. Tunnel URL is also baked in. The daemon's HTTP server rejects everything without a valid key with a 404 (not 401, to avoid confirming the URL is "real"). No data ever leaves the laptop except to the user's own watch via the user's own tunnel.

---

## 3. Repository layout

```
claude-code-tracker/
├── README.md
├── LICENSE                                # MIT
├── .gitignore                             # Config.mc, dev keys, build artifacts
├── IMPLEMENTATION_PLAN.md                 # this file
│
├── .claude/
│   └── skills/
│       └── garmin-tracker-setup/
│           ├── SKILL.md                   # orchestrator entry point
│           ├── paths/
│           │   ├── quick-tunnel.md
│           │   ├── named-tunnel-no-domain.md
│           │   ├── named-tunnel-with-domain.md
│           │   └── cloudflare-access.md
│           ├── scripts/
│           │   ├── detect-os.sh
│           │   ├── install-sdk.sh
│           │   ├── install-cloudflared.sh
│           │   ├── generate-dev-key.sh
│           │   ├── start-daemon.sh
│           │   ├── print-build-config.sh
│           │   ├── build-prg.sh
│           │   ├── detect-watch-mount.sh
│           │   ├── deploy-to-watch.sh
│           │   └── troubleshoot.sh
│           └── templates/
│               └── Config.mc.template
│
├── docs/
│   ├── quick-tunnel.md                    # path 1 manual install
│   ├── named-tunnel.md                    # path 2 manual install
│   ├── cloudflare-access.md               # optional auth upgrade
│   ├── architecture.md
│   ├── metrics.md                         # what each custom field means
│   ├── supported-devices.md               # build targets matrix
│   ├── troubleshooting.md
│   └── privacy.md                         # contamination analysis + opt-outs
│
├── watch/                                 # Connect IQ app source
│   ├── manifest.xml
│   ├── monkey.jungle
│   ├── source/
│   │   ├── App.mc
│   │   ├── MainView.mc
│   │   ├── MainDelegate.mc
│   │   ├── PollService.mc
│   │   ├── ActivityService.mc
│   │   ├── MetricsState.mc
│   │   └── Config.mc.example              # real Config.mc is gitignored, generated
│   ├── resources/
│   │   ├── strings/strings.xml
│   │   ├── layouts/layout.xml
│   │   ├── menus/main_menu.xml
│   │   └── drawables/launcher_icon.xml
│   └── README.md                          # manual build instructions
│
├── daemon/                                # Node daemon
│   ├── package.json
│   ├── README.md
│   ├── src/
│   │   ├── index.ts                       # CLI entry
│   │   ├── server.ts                      # HTTP server
│   │   ├── tunnel.ts                      # cloudflared subprocess
│   │   ├── config.ts                      # ~/.config/.../config.json
│   │   ├── metrics/
│   │   │   ├── source.ts                  # interface
│   │   │   ├── jsonl-tail.ts              # default impl
│   │   │   └── derive.ts                  # tokens/sec, tools/min, etc.
│   │   ├── ringbuffer.ts                  # in-memory sample store
│   │   ├── auth.ts                        # bearer key checks
│   │   └── commands/
│   │       ├── start.ts
│   │       ├── stop.ts
│   │       ├── status.ts
│   │       ├── pair.ts                    # add new device key
│   │       ├── unpair.ts
│   │       ├── print-build-config.ts
│   │       ├── upgrade-tunnel.ts          # quick → named
│   │       └── doctor.ts                  # diagnostics
│   └── test/
│       └── ...
│
└── scripts/                               # repo-level helpers
    ├── release.sh                         # tag + changelog
    └── ...
```

---

## 4. The watch app (Connect IQ / Monkey C)

### 4.1. Target devices

Ship build targets for, at minimum:

- `fr255` — Forerunner 255
- `fr265` — Forerunner 265
- `fr955` — Forerunner 955
- `fr965` — Forerunner 965
- `fenix7` — Fenix 7 (and `fenix7s`, `fenix7x`)
- `fenix8` — Fenix 8
- `venu3` — Venu 3
- `epix2`

Define these in `monkey.jungle`. The build skill picks one based on user input. Document the matrix in `docs/supported-devices.md`. Adding more is one line in the jungle file.

### 4.2. Permissions (manifest.xml)

```
<iq:permissions>
  <iq:uses-permission id="Communications"/>
  <iq:uses-permission id="FitContributor"/>
  <iq:uses-permission id="Sensor"/>
  <iq:uses-permission id="HeartRate"/>
</iq:permissions>
```

`Sensor` and `HeartRate` allow the activity to record real wrist-sensor values. No `Background`, no `UserProfile`, no `PersonalityInjection`. Minimum surface area.

### 4.3. App lifecycle

- `App.mc` → extends `Application.AppBase`. `onStart` initializes `MetricsState`, `PollService`, and `ActivityService` (but does **not** start the activity yet — user does that from the menu). `onStop` stops the polling timer and ensures any open session is finalized.
- `MainView.mc` → extends `WatchUi.View`. Renders four lines: model name, tokens/sec (current), tools/min (current), elapsed activity time. Plus the standard activity HUD elements (HR, timer) that the device draws automatically when an activity is active.
- `MainDelegate.mc` → extends `WatchUi.BehaviorDelegate`. Maps the start/stop button to `ActivityService.toggle()` and the menu button to a small menu (start, stop, lap, settings).
- `PollService.mc` → owns a `Timer.Timer` that fires every `Config.POLL_INTERVAL_MS` (default 2000 ms). Each tick calls `Communications.makeWebRequest` against `Config.DAEMON_URL + "/poll?cursor=" + lastCursor`, with bearer key in headers. On response, hands samples to `MetricsState.applySamples()` and `ActivityService.recordSamples()`.
- `ActivityService.mc` → wraps `ActivityRecording.createSession`. Owns the `FitContributor.Field` handles and the lap-boundary logic.
- `MetricsState.mc` → singleton holding latest sample (for live display) and the cursor (for resumption across app restart, persisted to `Application.Storage`).

### 4.4. ActivityRecording session

```monkey
session = ActivityRecording.createSession({
    :name => "Coding",
    :sport => Activity.SPORT_GENERIC,
    :subSport => Activity.SUB_SPORT_GENERIC
});
```

Real sensor data (HR, optionally temperature, barometric pressure, step count) is recorded by default — no extra code required. We do **not** disable any of these. We do **not** call any setter that would synthesize a sensor value.

When `Config.INCLUDE_PHYSIOLOGY` is `false` (opt-out for the cautious user), the session is created with options that suppress HR sampling where the SDK allows. On devices/firmwares where this isn't possible programmatically, `docs/privacy.md` documents the post-upload "Don't include in stats" toggle in Garmin Connect as the universal escape hatch.

### 4.5. Custom FIT fields

Defined once at session creation via `session.createField(name, fieldId, type, options)`:

| Field ID | Name              | Type   | Unit      | MesgType        | Notes |
|----------|-------------------|--------|-----------|-----------------|-------|
| 0        | tokens_per_sec    | FLOAT  | tok/s     | RECORD          | Per-second sample |
| 1        | tools_per_min     | FLOAT  | tools/min | RECORD          | EWMA from daemon |
| 2        | cum_tokens        | UINT32 | tokens    | RECORD          | Monotonic |
| 3        | lines_added       | UINT32 | lines     | RECORD          | Cumulative |
| 4        | lines_removed     | UINT32 | lines     | RECORD          | Cumulative |
| 5        | current_file_hash | UINT32 | (hash)    | RECORD          | First 32 bits of SHA-256 of file path; never the path itself |
| 6        | model_id          | UINT8  | enum      | RECORD          | Lookup table in `docs/metrics.md` |
| 7        | watts_estimate    | FLOAT  | W         | RECORD          | tokens_per_sec × J/token for the active model (server-side estimate, not measured) |
| 100      | total_tokens      | UINT32 | tokens    | SESSION         | Final total |
| 101      | total_tool_calls  | UINT32 | calls     | SESSION         | Final total |
| 102      | net_loc           | SINT32 | lines     | SESSION         | added − removed |
| 200      | turn_tokens       | UINT32 | tokens    | LAP             | Per-lap total |
| 201      | turn_tool_calls   | UINT32 | calls     | LAP             | Per-lap total |
| 202      | turn_duration_ms  | UINT32 | ms        | LAP             | |

Field IDs are **frozen forever** after first release — Garmin Connect keys graphs by `(developer_data_id, field_id)`. New metrics get new IDs; never repurpose an old one. Reserve IDs 7–99 for future RECORD fields, 103–199 for SESSION, 203–299 for LAP.

### 4.6. Lap-on-turn

The daemon sends a `lap: "new"` flag on the first sample of each user turn. When the watch sees it, `ActivityService.recordSamples` calls `session.addLap()` before recording the sample. This produces one Garmin lap per Claude Code turn, with the per-lap custom fields summarizing that turn.

### 4.7. Storage

`Application.Storage` keys:
- `cursor` (Number) — last processed cursor from daemon
- `session_id` (String) — current daemon-side session, for resumption
- `paired_at` (Number) — unix timestamp, for diagnostics
- `physiology_opt_out` (Boolean) — UI toggle, mirrors `Config.INCLUDE_PHYSIOLOGY` default

Bearer key and tunnel URL come from compiled-in `Config` constants, **not** storage. They are part of the build artifact.

### 4.8. HTTP behavior

- `Communications.makeWebRequest` with `Communications.HTTP_REQUEST_METHOD_GET`.
- Headers: `Authorization: Bearer <Config.BEARER_KEY>`, `User-Agent: claude-code-tracker/<version>`.
- Response handler: on HTTP 2xx, parse JSON; on 4xx, log and stop polling for 30s; on 5xx or network error, exponential backoff capped at 30s.
- Garmin's `makeWebRequest` payload cap is ~16KB — the daemon must keep individual `/poll` responses well under this. The ringbuffer chunking in §5.5 handles this.
- Some Garmin firmwares are picky about cert chains. Cloudflare Tunnel certs are universally accepted, so this only matters if the user routes through Path 2-WithDomain on a cert that's somehow non-standard. Documented as a possible failure in `docs/troubleshooting.md`.

### 4.9. UI

Three views:
1. **Pre-activity** — "Press START to begin tracking." Shows last connection status (✓ or ✗ with last-seen timestamp). One-screen.
2. **In-activity** — large `tokens/sec`, smaller `tools/min`, `cum_tokens`, elapsed time, current file hash (last 4 chars, just for "something changed" feedback). Real HR shown by the watch's standard activity overlay.
3. **Settings** (from menu) — toggle physiology recording, view daemon URL (for debugging), show pairing key fingerprint (last 4 chars).

No in-app pairing screen is required: tunnel URL and bearer key are baked in at build. If the user wants a different pairing, they rebuild and redeploy.

### 4.10. Polling cadence

`POLL_INTERVAL_MS` is configurable; default 2000 ms. Faster polling burns watch battery and BLE radio time aggressively. Slower polling is fine — graphs will just be coarser. The daemon's ringbuffer keeps ~5 minutes of samples so a watch that polled every 30s would still get a full graph, just less smoothly.

### 4.11. Build

Standard `monkeyc` invocation:

```
monkeyc \
  -d <device> \
  -f watch/monkey.jungle \
  -o build/tracker-<device>.prg \
  -y <developer_key>
```

The build skill writes `watch/source/Config.mc` from the template just before invoking `monkeyc`, then deletes it afterward (to avoid stale config bleeding into a future build). `Config.mc` is gitignored.

---

## 5. The daemon (Node, TypeScript)

### 5.1. Distribution

Published to npm as `claude-code-tracker`. Users invoke via `npx claude-code-tracker <command>` (no install) or `npm i -g claude-code-tracker`. Either works; the skill prefers `npx` for first-run.

### 5.2. Subcommands

```
npx claude-code-tracker start                 # start server + tunnel
npx claude-code-tracker stop
npx claude-code-tracker status                # is it running, tunnel up, etc.
npx claude-code-tracker pair                  # mint a new device key, print it
npx claude-code-tracker unpair <key-prefix>
npx claude-code-tracker print-build-config    # JSON for skill consumption
npx claude-code-tracker upgrade-tunnel        # quick → named, interactive
npx claude-code-tracker doctor                # diagnostics
npx claude-code-tracker logs [--follow]
```

### 5.3. Config file

`~/.config/claude-code-tracker/config.json`:

```json
{
  "version": 1,
  "bearer_keys": [
    { "key": "ck_a8f3...", "label": "fr965-jens", "created": "2026-04-26T12:00:00Z" }
  ],
  "tunnel": {
    "mode": "quick",
    "name": null,
    "last_known_url": "https://shaped-marker-pottery-helena.trycloudflare.com",
    "url_observed_at": "2026-04-26T12:01:33Z"
  },
  "metrics": {
    "source": "jsonl-tail",
    "jsonl_path": null
  },
  "server": {
    "port": 7842,
    "bind": "127.0.0.1"
  }
}
```

`tunnel.mode` is `"quick"` or `"named"`. In named mode, `name` is the cloudflared tunnel name and the URL is constant.

Permissions on this file: 0600. The daemon refuses to start if the file is world-readable.

### 5.4. HTTP server

Local, bound to 127.0.0.1:7842 by default. Cloudflared is what exposes it to the internet — there is **never** a 0.0.0.0 listener. Routes:

- `GET /health` — `{ ok: true }`, no auth, for tunnel health checks.
- `GET /poll?cursor=N&max=200` — main watch endpoint. Returns `{ cursor, samples: [...], status, session_id }`. Auth required.
- `POST /ack` — optional, watch can post `{ cursor: N }` to free older samples; otherwise samples age out by ringbuffer size.
- `POST /control/lap` — internal, daemon-side; posted by the metric extractor when a new turn begins.
- `GET /control/status` — for the CLI's `status` command. Auth via local socket only (Unix socket on macOS/Linux, named pipe on Windows), not via the bearer key.

All authenticated routes:
- 200 with valid `Authorization: Bearer <key>` matching one of `bearer_keys`.
- **404** otherwise (not 401), with body `Not found`. Indistinguishable from a wrong path.
- Rate-limit: 10 req/sec per key. Excess → 404 (still no information leak).

### 5.5. Sample ringbuffer

In-memory, capped at 600 samples (~5 minutes at 2 Hz, or ~10 minutes at 1 Hz). Each sample is:

```ts
{
  cursor: number,                // monotonic, daemon-assigned
  t: number,                     // unix ms
  tokens_per_sec: number,
  tools_per_min: number,
  cum_tokens: number,
  lines_added: number,
  lines_removed: number,
  current_file_hash: number,     // 32-bit
  model_id: number,
  lap?: "new",                   // present on first sample of new turn
  session_id: string
}
```

`/poll` returns up to `max` samples with `cursor > clientCursor`, plus a `cursor` field equal to the largest cursor in the response. Watch advances `lastCursor` to that value. If the watch's cursor is older than the buffer, the daemon returns `{ resync: true, cursor: oldest_cursor }` and the watch starts fresh from that point — graph has a gap, no crash.

### 5.6. Tunnel management

Module `tunnel.ts` spawns `cloudflared` as a child process, restarts it on exit (with backoff), and exposes the current URL via an event.

**Quick mode:**

```
cloudflared tunnel --url http://127.0.0.1:7842 --no-autoupdate
```

The URL appears in stderr. The pattern to match is:

```
/https:\/\/[a-z0-9-]+\.trycloudflare\.com/
```

Because cloudflared has tweaked its log format historically, `tunnel.ts` accepts any HTTPS URL on a `*.trycloudflare.com` domain. On match, it writes the URL into config and emits a `url` event.

**Named mode:**

```
cloudflared tunnel run <name>
```

URL is determined at config time (either `<uuid>.cfargotunnel.com` or the configured custom domain) and stored in config. The tunnel subprocess just maintains the connection.

Cloudflared binary is auto-installed on first `start` if not on PATH. Per-OS install logic in `install-cloudflared.sh`:

- macOS: `brew install cloudflared` if Homebrew present, else direct download to `~/.local/bin/cloudflared`.
- Linux: package manager if root-friendly path detected, else direct download.
- Windows: direct download to `%LOCALAPPDATA%\claude-code-tracker\cloudflared.exe`.

### 5.7. Metric extraction

Module `metrics/source.ts` defines:

```ts
interface MetricSource {
  start(emit: (sample: PartialSample) => void): Promise<void>;
  stop(): Promise<void>;
}
```

Default implementation `metrics/jsonl-tail.ts`: tails Claude Code's local session JSONL files (typically under `~/.config/claude/projects/<project>/...jsonl` or `~/.claude/...`; daemon auto-detects). Each line in the JSONL is a typed event (user message, assistant message, tool use, tool result). `derive.ts` converts these into the sample shape:

- `tokens_per_sec` = exponential moving average over a 5-second window of output token deltas.
- `tools_per_min` = EWMA over a 60-second window of `tool_use` events.
- `cum_tokens` = monotonic running sum of input + output tokens.
- `lines_added`/`lines_removed` = derived from `Edit` and `Write` tool inputs by diffing old vs new content.
- `current_file_hash` = `crc32` (or first 4 bytes of SHA-256) of the most recent file path touched.
- `model_id` = small lookup table (claude-opus-4 → 1, claude-sonnet-4 → 2, etc.; defined in `docs/metrics.md`).
- `lap: "new"` = set on the first sample after a new user message arrives.

Alternative metric sources (Claude Code SDK hook, if/when one exists, or a stdin-fed mode for tests) plug in via the same interface. Default is JSONL tail because it works without any Claude Code config changes.

### 5.8. Privacy in metric extraction

The daemon hashes file paths to a 32-bit value before storing or transmitting them. The plaintext path is **never** stored in the ringbuffer, **never** logged, and **never** sent to the watch. The hash is only useful as a "current file changed" indicator — no path recovery is possible.

Logs are off by default. `--verbose` enables structured logs to `~/.config/claude-code-tracker/logs/daemon.log` with hashed paths and redacted tool inputs. `logs --follow` streams them. Log retention: 7 days, rotated daily.

### 5.9. Lap detection

When the JSONL tail emits a new user message, `derive.ts` sets `lap: "new"` on the next outgoing sample. This is the watch's signal to call `session.addLap()` before recording the sample.

### 5.10. Graceful shutdown

On SIGINT/SIGTERM: stop accepting new HTTP connections, flush any pending lap markers, send the cloudflared subprocess a SIGTERM, wait up to 5s for it to exit, then exit. Watch sees connection-refused on next poll and goes into reconnect-backoff state.

### 5.11. Doctor command

`npx claude-code-tracker doctor` runs:
1. Config file present and valid.
2. Cloudflared binary on PATH or in our managed dir.
3. Cloudflared version recent enough.
4. Server port available.
5. Tunnel currently up (HTTP GET `/health` via the tunnel URL).
6. At least one bearer key configured.
7. JSONL source: at least one Claude Code project directory found.
8. Permissions on config file (0600).

Each check prints ✓ or ✗ with a remediation hint.

---

## 6. The Cloudflare Tunnel paths

### 6.1. Path 1 — Quick tunnel (5-minute path)

No Cloudflare account required. `cloudflared tunnel --url http://127.0.0.1:7842` produces a `*.trycloudflare.com` URL that lasts until the daemon stops. URL changes on every restart. Re-pairing is trivial because pairing data lives in the `.prg` itself — user runs the build skill again, redeploys, done. Skill takes ~30 seconds for a rebuild after the first install.

Caveats documented in `docs/quick-tunnel.md`:
- URL changes on daemon restart → rebuild + redeploy.
- Cloudflare may rate-limit aggressive quick-tunnel creation (~10+ in a short window).
- No SLA. Brief reconnects are normal; the watch handles them with retry/backoff.
- Shared `*.trycloudflare.com` infrastructure; Cloudflare could change terms unilaterally.

### 6.2. Path 2-NoDomain — Named tunnel on `cfargotunnel.com`

One-time setup (~10 min):

```
cloudflared tunnel login                          # browser, free CF account
cloudflared tunnel create claude-code-tracker     # creates UUID + creds file
```

Hostname is `<uuid>.cfargotunnel.com`. Stable forever. No domain needed.

`~/.cloudflared/config.yml`:

```yaml
tunnel: <uuid>
credentials-file: /home/jens/.cloudflared/<uuid>.json
ingress:
  - service: http://127.0.0.1:7842
```

(For cfargotunnel, no `hostname:` line is needed — the tunnel UUID is the hostname.)

Daemon runs `cloudflared tunnel run claude-code-tracker`. URL is constant.

### 6.3. Path 2-WithDomain — Named tunnel on a user-owned domain

Same as 2-NoDomain plus:

```
cloudflared tunnel route dns claude-code-tracker tracker.yourname.com
```

Adds a CNAME from `tracker.yourname.com` to the tunnel. Requires the domain to be on Cloudflare DNS (free).

`config.yml` ingress block:

```yaml
ingress:
  - hostname: tracker.yourname.com
    service: http://127.0.0.1:7842
  - service: http_status:404
```

The trailing 404 catch-all is required by cloudflared.

### 6.4. Optional — Cloudflare Access

Strong machine-to-machine auth on top of the tunnel. Free up to 50 users.

Setup, walked through in `docs/cloudflare-access.md`:
1. In CF dashboard → Zero Trust → Access → Service Auth → Service Tokens → Create.
2. Get `CF-Access-Client-Id` + `CF-Access-Client-Secret`.
3. Apply an Access Application policy to the tunnel hostname requiring this service token.
4. Bake the two values into `Config.mc` (build skill prompts for them if `INCLUDE_CF_ACCESS = true`).
5. Watch sends both as headers on every request.

This is layered on top of the bearer-key check — both must pass. Documented as opt-in for users who want defense in depth.

### 6.5. `upgrade-tunnel` command

Migrates a Path 1 setup to Path 2 in place:

1. Confirm cloudflared is logged in (run `tunnel login` if not).
2. Create a named tunnel.
3. Optionally route a DNS hostname (prompt).
4. Write `config.yml`.
5. Update `~/.config/claude-code-tracker/config.json` to `mode: "named"`.
6. Stop the quick tunnel, start the named tunnel.
7. Tell the user: rebuild and redeploy the watch app (skill handles it).

Bearer keys carry over unchanged — only the URL changes.

---

## 7. The Claude Code skill

### 7.1. Skill metadata

`.claude/skills/garmin-tracker-setup/SKILL.md` frontmatter triggers on phrases like:
- "install the claude code activity tracker"
- "set up the garmin tracker"
- "pair my watch"
- "build the tracker app"
- "rebuild the tracker"
- "deploy tracker to my watch"

### 7.2. Orchestrator flow

```
1. Detect OS (macOS, Linux, WSL2, native Windows).
   - Native Windows: tell the user to use WSL2 or refuse with a clear message.

2. Detect existing install state by reading ~/.config/claude-code-tracker/config.json (if any).
   - Fresh install: full flow.
   - Existing config: ask "rebuild & redeploy" / "re-pair new watch" / "upgrade tunnel" / "diagnose".

3. (Fresh install) Ask the user which path:
   - Quick tunnel (5 min, no account, URL changes on restart)
   - Named tunnel + cfargotunnel hostname (10 min, free CF account)
   - Named tunnel + custom domain (15 min, free CF account, requires domain on CF)

4. Install prerequisites:
   - Node (via volta/asdf/system) — verify version.
   - Connect IQ SDK — see §7.3.
   - cloudflared — invoke install-cloudflared.sh.
   - Java JRE (Connect IQ SDK requires it) — install if absent via OS package manager.

5. Generate a Connect IQ developer key if absent (~/.config/claude-code-tracker/developer_key).

6. (Named tunnel paths) Walk through cloudflared login, tunnel create, optional DNS route, config.yml.

7. Run `npx claude-code-tracker pair` to generate a fresh bearer key for this watch.
   Run `npx claude-code-tracker start` to bring up the daemon and tunnel.
   Wait up to 30s for the URL to be observed; abort with diagnostics if not.

8. Run `npx claude-code-tracker print-build-config` and capture the JSON.

9. Ask the user which watch model they have. Cross-reference with watch/monkey.jungle.
   Optionally: try to detect from /Volumes/GARMIN or /run/media/$USER/GARMIN by reading
   GARMIN/GARMIN/Devices/*/Device.fit headers.

10. Write watch/source/Config.mc from templates/Config.mc.template, substituting:
    - DAEMON_URL
    - BEARER_KEY
    - INCLUDE_PHYSIOLOGY (default true; ask if user wants opt-out)
    - INCLUDE_CF_ACCESS (default false; only true if path included Access)
    - CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET (only if above)
    - POLL_INTERVAL_MS (default 2000)

11. Run monkeyc to build build/tracker-<device>.prg.

12. Detect watch USB mount path:
    - macOS: /Volumes/GARMIN
    - Linux: /run/media/$USER/GARMIN or /media/$USER/GARMIN
    - WSL2: refuse and instruct user to use OpenMTP or native Windows file copy
    On failure, display a clear message about plugging in the watch and unlocking it.

13. Copy the .prg to GARMIN/APPS/. Verify size matches.

14. Tell the user to safely eject and unplug. Wait for confirmation.

15. Print pairing summary and a sanity check:
    - curl https://<tunnel-url>/health   (should return 200)
    - On watch: open the app, hit START, expect the live counter to update within ~3s.

16. Tell user to rerun the skill any time they want to rebuild (e.g., after daemon restart on
    Path 1, or after a config change).
```

### 7.3. Connect IQ SDK install

Free download. Garmin requires an account but no payment. The skill walks the user through:

1. Open `https://developer.garmin.com/connect-iq/sdk/` in a browser (skill `open`s the URL on macOS/Linux).
2. Sign in / register a free Garmin developer account.
3. Download the SDK Manager for their OS.
4. Use SDK Manager to install the latest stable Connect IQ SDK.
5. Add `<sdk>/bin` to PATH (skill writes a shell snippet to `~/.zshrc` / `~/.bashrc` if user consents).
6. Verify with `monkeyc --version`.

This step is one-time per machine. If `monkeyc` is on PATH, the skill skips it.

### 7.4. Idempotency

Re-running the skill detects existing artifacts and offers actions:
- "Daemon config exists. Rebuild and redeploy with current config? [y/n]"
- "Tunnel URL has changed since last build. Rebuild required. Continue? [y/n]"
- "Watch model differs from last build. Switch target? [y/n]"

Never silently overwrite. Always confirm.

### 7.5. Doctor mode

`SKILL.md` includes a path "diagnose claude code tracker" that:
1. Runs `npx claude-code-tracker doctor`.
2. Curls the tunnel URL's `/health`.
3. Checks watch mount path is reachable and the `.prg` is present and size-matches the local build.
4. Prints a status table.

Most support questions resolve here without ever reaching the maintainer.

---

## 8. Privacy and data hygiene

A first-class concern; documented in `docs/privacy.md`.

### 8.1. What is collected

On the laptop (in the daemon's ringbuffer and any logs the user enables):
- Numeric metrics (counts, rates).
- 32-bit hashes of file paths.
- Model identifiers (numeric IDs).
- Session and lap boundaries.
- Bearer keys (in config file at 0600).

On the watch (in `Application.Storage` and the FIT file):
- Same numeric metrics.
- Same hashes.
- Real wrist-sensor data during the activity (HR primarily; possibly temp/pressure depending on device).

### 8.2. What is NOT collected anywhere

- File paths (only hashes).
- File contents.
- Prompts or assistant responses.
- Tool inputs/outputs.
- Anthropic API keys, OAuth tokens, or any other Anthropic credentials.
- Repository names or remote URLs.
- User identity (no email, no GitHub username, no Garmin account ID).

### 8.3. What leaves the laptop

Only via the user's own Cloudflare Tunnel, only to the user's own watch, authenticated by a key that the user generated. The Cloudflare edge sees encrypted TLS traffic (and request metadata to that tunnel hostname). No third party sees the metric stream content.

### 8.4. Health-data contamination analysis

`SPORT_GENERIC` + `SUB_SPORT_GENERIC` activity with **real** HR and **no synthetic** physiological fields:

| Metric                        | Affected? | Why |
|-------------------------------|-----------|-----|
| VO2 max                       | No        | Computed only from `RUNNING`/`CYCLING` with GPS. |
| Resting HR                    | No        | From 24/7 sensor data, not activities. |
| Max HR                        | Only if peak HR during coding exceeds current max. While sitting at a desk, won't trigger. |
| HR zones / lactate threshold  | No        | Same source as VO2. |
| Body Battery / Stress         | No        | Continuous HRV, not activity HR. |
| Training load                 | Slightly  | `SPORT_GENERIC` with low HR contributes minimal load — single-digit points, swamped by any real workout. |
| Recovery time                 | Slightly  | Same as above. |
| Strava run/ride totals        | No        | `SPORT_GENERIC` maps to "Workout" on Strava, segregated. |
| Strava fitness/freshness      | Slightly  | Workouts contribute to Strava's training load model unless the user excludes "Workout" type. Document the toggle. |

Two safety valves:
1. **Build-time:** `Config.INCLUDE_PHYSIOLOGY = false` disables HR recording on the activity entirely. Pure custom-fields activity. Default is `true` because the HR graph next to the tokens/sec graph is genuinely the point.
2. **Per-activity:** Garmin Connect's "Don't include in stats" toggle, applied post-upload, removes the activity from all rollups while preserving its graphs and FIT file. Bulletproof escape hatch documented in `docs/privacy.md`.

### 8.5. Strava sync

Garmin Connect → Strava sync respects the activity type. `SPORT_GENERIC` becomes "Workout" on Strava, which does not contribute to run/ride totals or segments. Users who want zero Strava exposure can disable Garmin → Strava sync for "Workout" activities specifically — documented in `docs/privacy.md`.

### 8.6. Garmin Connect rendering of custom fields

Numeric custom fields automatically appear as graphs on the activity detail page. String fields (model id) appear in summary metadata. Lap-scoped fields appear in the per-lap breakdown. This works because we declare the fields with `nativeNum` types and proper `unit` strings. No server-side configuration required.

---

## 9. Security model (full)

### 9.1. Threat surfaces

1. **Internet → tunnel URL.** Cloudflare terminates TLS; only requests with a valid bearer key reach the daemon, and unauthenticated requests get a 404. Tunnel URLs are not enumerable.
2. **Tunnel URL → daemon.** Cloudflared connects outbound; no inbound port on the laptop. The daemon binds 127.0.0.1 only.
3. **Daemon → Claude Code.** Read-only — the daemon tails JSONL files. It never writes to Claude's state.
4. **Watch → tunnel.** Bearer key in `Authorization` header; HTTPS; UA includes app version for diagnostics.
5. **Watch storage.** Bearer key is **not** in `Application.Storage` — it's compiled into the `.prg`. A factory-reset watch loses the key with the binary.

### 9.2. Key generation

`pair` command generates 32 random bytes, encodes as `ck_<base64url>`, stores in config with a label and timestamp. Each watch gets its own. Easy revocation: `unpair <key-prefix>` removes it; the next poll from that watch returns 404 forever (rebuild needed).

### 9.3. Rate limiting

Per-key: 10 req/sec, 5000 req/hour. Excess → 404. In practice, 2-second polling = 0.5 req/sec, well under the limit. The cap exists so a misbehaving or compromised watch app can't drain the daemon.

### 9.4. Cloudflare Access (optional)

For users who want strong M2M auth on top, see §6.4. Adds two static headers on every request, validated at the Cloudflare edge before the request even reaches the tunnel.

### 9.5. Logging

Off by default. With `--verbose`, structured logs to a 0600 file, paths hashed, tool inputs/outputs not logged. 7-day rotation, capped at 50 MB.

### 9.6. Updates

The daemon is on npm. Watch app updates require rebuild + redeploy (the skill handles it). No auto-update on the watch — Connect IQ doesn't support it for sideloaded apps. Document a `git pull && (rerun the skill)` workflow.

---

## 10. Documentation

### 10.1. README.md

Top-level. ~150 lines. Sections:
1. What it is (1 paragraph + 1 screenshot of the Garmin Connect activity page).
2. Why it doesn't pollute your health data (1 paragraph, link to `docs/privacy.md`).
3. Quick start: "Open this repo in Claude Code and say 'install the tracker'."
4. Manual install pointer (link to `docs/quick-tunnel.md`).
5. Supported watches.
6. License (MIT) and contributing pointer.

### 10.2. `docs/quick-tunnel.md`

Step-by-step install for Path 1 with no Claude assist. ~250 lines. Covers SDK install, dev key, daemon, build, deploy, pair, troubleshoot.

### 10.3. `docs/named-tunnel.md`

Path 2-NoDomain and Path 2-WithDomain in one doc, with a clear branching point near the top. ~300 lines.

### 10.4. `docs/cloudflare-access.md`

Optional security upgrade. ~100 lines.

### 10.5. `docs/architecture.md`

One ASCII diagram (the one in §2 above), one paragraph per box. Targeted at potential contributors.

### 10.6. `docs/metrics.md`

The custom-field table (the one in §4.5), plus the model_id lookup table, plus the rationale for each metric. Targeted at users who look at their FIT files.

### 10.7. `docs/supported-devices.md`

List of build targets, firmware versions tested, known issues per device family. Maintained over time.

### 10.8. `docs/troubleshooting.md`

Common failure modes:
- "App crashes on launch" → usually a Config.mc that wasn't regenerated; rebuild.
- "Watch can't reach tunnel" → curl `/health` from the laptop; if that works, check Cloudflare status; if it fails, restart the daemon.
- "OpenMTP shows the watch but APPS folder is missing" → unplug, replug, try a different cable.
- "monkeyc not found" → SDK install or PATH.
- "Cloudflared rate-limited" → Path 1 only; switch to Path 2.
- "Watch app says 'connection refused'" → daemon stopped; `npx claude-code-tracker status`.

### 10.9. `docs/privacy.md`

Full contamination analysis (table from §8.4), what is and isn't collected (§8.1–8.3), Strava sync notes (§8.5), and the per-activity opt-out instructions for Garmin Connect.

---

## 11. Build, release, and versioning

### 11.1. Versioning

SemVer for the daemon (npm package version). Each release tagged in git. The watch app version comes from `manifest.xml` and is embedded in `User-Agent` so the daemon can log it.

API version (the JSON shape of `/poll`) is independently versioned via a `v` field in every payload. Daemon supports current and previous version. Watch sends `Accept-Version: 1` header. Bumping `v` is a coordinated release.

### 11.2. Release flow

1. Bump version in `daemon/package.json` and `watch/manifest.xml`.
2. Update CHANGELOG.md.
3. `npm publish` from `daemon/`.
4. `git tag v<x.y.z> && git push --tags`.
5. GitHub Release notes summarize user-visible changes; install and upgrade instructions linked.

No pre-built `.prg` artifacts in releases — the whole point is users build their own.

### 11.3. CI

GitHub Actions:
- Lint (eslint, prettier) for daemon.
- Type-check daemon.
- Run daemon test suite.
- `monkeyc` build for each declared target (using the Connect IQ SDK in CI; sign with a CI-only key) — purely to catch compile errors. Output is discarded.
- No publishing from CI in v0; manual `npm publish` only.

---

## 12. Testing strategy

### 12.1. Daemon

Unit tests (vitest):
- Ringbuffer: insert, query by cursor, eviction, resync semantics.
- Auth: bearer match, mismatch → 404, rate limit.
- JSONL tail: synthetic JSONL fixture → expected sample stream.
- Derive: known sequence of events → known EWMA values within tolerance.
- Tunnel parser: regression tests for several historical cloudflared output formats.
- Config: load, validate, refuse on bad permissions.

Integration tests:
- Spawn a real daemon against a fake JSONL file, hit `/poll` with a test key, assert sample shape.
- Optionally: spawn `cloudflared --url` against the test daemon in a dedicated CI job (gated behind a flag because it requires network).

### 12.2. Watch app

Connect IQ simulator:
- A `monkey-doc.yml` test config that runs MainView with a mock PollService backed by canned sample data.
- Snapshot tests of the rendered view at various states.

The simulator's network behavior differs meaningfully from real devices. Document a manual-test checklist that a maintainer runs before each release on actual hardware (at least one Forerunner and one Fenix).

### 12.3. End-to-end

A `e2e/` script that:
1. Starts daemon in Path 1 mode.
2. Generates synthetic Claude Code JSONL.
3. Polls the tunnel URL via curl.
4. Asserts shape of returned samples.

This catches integration regressions without needing a watch in CI.

---

## 13. Roadmap

### v0.1 — minimum viable

- Path 1 (quick tunnel) only.
- Daemon: `start`, `stop`, `status`, `pair`, `print-build-config`, `doctor`. No upgrade-tunnel, no Cloudflare Access.
- Watch app for one device (`fr965`).
- Custom fields: `tokens_per_sec`, `tools_per_min`, `cum_tokens`. No lines, no model_id.
- Real HR included.
- Skill: full Path 1 install flow.
- Docs: README, quick-tunnel.md, privacy.md.
- Goal: end-to-end "I sit down to code, my watch records the activity, I open Garmin Connect and see graphs."

### v0.2 — daily-driver path

- Path 2-NoDomain support in skill and daemon.
- `upgrade-tunnel` command.
- Add `lines_added`/`lines_removed`/`current_file_hash`/`model_id` custom fields.
- Lap-on-turn.
- Three additional watch targets (`fr255`, `fr955`, `fenix7`).
- Docs: named-tunnel.md, troubleshooting.md, supported-devices.md, metrics.md.

### v0.3 — polish

- Path 2-WithDomain support.
- Cloudflare Access (optional).
- All v0 watch targets shipped.
- `INCLUDE_PHYSIOLOGY = false` opt-out in `Config.mc`.
- Idempotent skill (rebuild detection, watch-model switch).

### v1.0 — stable

- All declared targets supported.
- API version bumping mechanism exercised.
- CI runs `monkeyc` build per target.
- Polished error messages everywhere.
- Privacy doc reviewed by a second pair of eyes.

---

## 14. Out of scope (for now)

- Connect IQ Store distribution. Sideload only.
- Multi-tenant gateway, accounts, OAuth, billing.
- Anthropic API proxying, prompts on the watch, "ask Claude from your wrist."
- Web dashboard for viewing sessions outside Garmin Connect.
- Mobile companion app.
- Live-streaming Claude tokens to the watch (no WebSocket on Connect IQ).
- Multi-watch per daemon coordination beyond "each watch has its own bearer key."
- Windows-native (non-WSL) install.
- Synthetic GPS / "code-as-map" idea — fun, but adds an immediate Strava-route problem.

---

## 15. First implementation slice

To bootstrap, build in this order:

1. **Daemon scaffold.** `package.json`, TS config, `start` command that just runs an HTTP server with a hardcoded sample stream. Verify with curl.
2. **Tunnel module.** Spawn cloudflared in quick mode, parse URL, write to config. Verify tunnel URL is reachable from outside.
3. **Bearer auth + ringbuffer.** Add `pair`, plumb through to the HTTP server. Verify 404-on-bad-key.
4. **Watch app scaffold.** `manifest.xml`, `monkey.jungle`, `App.mc`, `MainView.mc` that just shows a hardcoded counter. Build for `fr965`, sideload, verify it appears.
5. **Watch HTTP poll.** `PollService.mc` calling the tunnel URL with the bearer key. Display latest `tokens_per_sec` from response. Sample stream still hardcoded server-side.
6. **ActivityRecording.** Wire up start/stop, no custom fields yet. Verify a `SPORT_GENERIC` activity records and syncs to Garmin Connect with real HR.
7. **First custom field.** Add `tokens_per_sec` via `FitContributor`. Verify it shows up as a graph in Garmin Connect.
8. **JSONL tail.** Replace hardcoded sample stream with derived metrics from a real Claude Code session.
9. **Skill, Path 1 only.** Glue all of the above into a single Claude-driven install flow.
10. **First real coding session recorded.** Iterate from there.

Each step is independently testable. Steps 1–3 happen on the laptop alone. Step 4 introduces hardware. Step 6 is the first "is this idea actually fun" gate — once a `SPORT_GENERIC` activity with real HR shows up in Garmin Connect alongside whatever placeholder graph from step 7, the rest is filling in metrics and polish.
