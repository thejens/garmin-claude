# Garmin Tracker Setup Skill

Trigger phrases (any of these in a user message):
- "install the claude code activity tracker"
- "install the tracker"
- "set up the garmin tracker"
- "pair my watch"
- "build the tracker app"
- "rebuild the tracker"
- "deploy tracker to my watch"
- "diagnose claude code tracker" → jump to [Doctor mode](#doctor-mode)

---

## Orchestrator flow

Work through these steps in order. At each step, run the relevant script via
Bash, check its output, and tell the user what happened before moving on.
If a step fails, diagnose it before continuing — do not skip steps silently.

### Step 0 — Detect state

```bash
bash .claude/skills/garmin-tracker-setup/scripts/detect-os.sh
```

- If OS is native Windows: tell the user WSL2 is required and stop.
- If macOS or Linux: continue.

Check for an existing daemon config:

```bash
cat ~/.config/claude-code-tracker/config.json 2>/dev/null || echo "NONE"
```

- **No config** → fresh install, run all steps.
- **Config present** → ask the user:
  > Found an existing config. What would you like to do?
  > 1. Rebuild & redeploy the watch app (tunnel URL may have changed)
  > 2. Pair a new watch / generate a new bearer key
  > 3. Diagnose issues
  >
  > Reply with 1, 2, or 3.
  
  Then jump to the relevant step.

---

### Step 1 — Prerequisites

#### 1a. Node.js

```bash
node --version 2>/dev/null || echo "MISSING"
```

If missing or < v20: tell the user to install Node 20+ (via volta, nvm, or
https://nodejs.org) and wait for them to confirm before continuing.

#### 1b. Java (required by Connect IQ SDK)

```bash
java -version 2>&1 | head -1 || echo "MISSING"
```

If missing:
- macOS: `brew install --cask temurin`
- Linux: `sudo apt install default-jre` (or distro equivalent)

#### 1c. Connect IQ SDK

```bash
bash .claude/skills/garmin-tracker-setup/scripts/detect-sdk.sh
```

If not found, walk the user through:
1. Open https://developer.garmin.com/connect-iq/sdk/ (run `open` on macOS)
2. Sign in / register a free Garmin developer account
3. Download the SDK Manager for their OS
4. Use SDK Manager to install the latest stable SDK
5. Add `<sdk>/bin` to PATH (offer to append to `~/.zshrc` or `~/.bashrc`)
6. Re-run `detect-sdk.sh` to confirm

#### 1d. cloudflared

```bash
cloudflared --version 2>/dev/null || echo "MISSING"
```

If missing:
- macOS: `brew install cloudflared`
- Linux: `curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared`

#### 1e. libmtp (required for MTP-mode deployment)

```bash
mtp-detect 2>/dev/null | head -2 || echo "MISSING"
```

If missing:
- macOS: `brew install libmtp`
- Linux: `sudo apt install libmtp-dev mtp-tools` (or distro equivalent)

libmtp lets the deploy script copy the `.prg` directly to the watch in MTP
mode without needing OpenMTP or Android File Transfer. On macOS, MTP devices
do **not** mount as a filesystem volume — libmtp is the only command-line path.

---

### Step 2 — Developer signing key

```bash
bash .claude/skills/garmin-tracker-setup/scripts/generate-dev-key.sh
```

Prints "exists" or "created". Either is fine.

---

### Step 3 — Install daemon npm deps

```bash
cd daemon && npm install --silent
```

---

### Step 3.5 — Named tunnel setup (Path 2 only — skip for quick tunnel)

Ask the user which tunnel path they want **before** proceeding:

> **Which tunnel setup do you want?**
>
> **1. Quick tunnel** — no Cloudflare account required. URL changes every time
>    the daemon restarts; you'll need to rebuild the watch app each time.
>    Good for a first try.
>
> **2. Named tunnel (cfargotunnel.com)** — free Cloudflare account required.
>    Stable URL that never changes. Rebuild once; works forever.
>
> **3. Named tunnel (custom domain)** — same as 2, plus your own domain name
>    (e.g. `tracker.you.com`). Domain must be on Cloudflare DNS.
>
> Reply 1, 2, or 3.

**If the user chooses 2 or 3:**

Check Cloudflare login:
```bash
cloudflared tunnel list 2>&1
```

If the output mentions `cert.pem` or a login error, tell the user:
> Please run `cloudflared tunnel login` in your terminal — it will open a
> browser. Tell me when you've completed the login.

Wait for their confirmation, then re-run the list check to confirm.

Run the upgrade wizard:
```bash
# Path 2 — cfargotunnel.com URL
npx --prefix daemon tsx daemon/src/index.ts upgrade-tunnel

# Path 3 — custom domain (ask user for their domain first)
npx --prefix daemon tsx daemon/src/index.ts upgrade-tunnel --domain tracker.yourdomain.com
```

Print the tunnel URL from the command output — it's now stable and saved in
the daemon config. Skip the wait-for-tunnel script in step 4 (URL is already
known).

---

### Step 4 — Pair and start the daemon

Generate a bearer key for the watch:

```bash
npx --prefix daemon tsx daemon/src/index.ts pair --label "my-watch"
```

Capture the printed key. Then start the daemon:

```bash
npx --prefix daemon tsx daemon/src/index.ts start &
```

The daemon auto-discovers all `~/.claude*/projects/` directories, so it works
for standard, XDG, and multi-profile setups without extra config.

**Quick tunnel (Path 1):** wait up to 45 s for the tunnel URL:
```bash
bash .claude/skills/garmin-tracker-setup/scripts/wait-for-tunnel.sh
```

**Named tunnel (Path 2 or 3):** URL is already known — just confirm health:
```bash
URL=$(python3 -c "import json; print(json.load(open(\"$HOME/.config/claude-code-tracker/config.json\"))['tunnel']['last_known_url'])")
curl -s --max-time 10 "$URL/health" && echo "OK"
```

If the quick tunnel URL does not appear within 45 s:
- Run `cloudflared --version` to confirm it is installed.
- Check if port 7842 is free: `lsof -i :7842`.
- Tell the user and offer to continue with a local-only URL for now.

---

### Step 5 — Identify the watch model

**Do not proceed to step 6 until you have an explicit, confirmed device ID.**

#### 5a. Try auto-detection (mass storage mode only)

```bash
DETECT=$(bash .claude/skills/garmin-tracker-setup/scripts/detect-watch-mount.sh)
EXIT=$?
```

If `EXIT=0` (watch is in mass storage mode), try reading the device model:

```bash
MOUNT=$(echo "$DETECT" | awk '{print $2}')
bash .claude/skills/garmin-tracker-setup/scripts/detect-device.sh "$MOUNT"
```

If this prints a device ID (e.g. `fr265`), tell the user what was detected
and **ask them to confirm**:

> I detected your watch as a **Forerunner® 265** (`fr265`). Is that correct?
> Reply Y to confirm, or give me the correct model if it is wrong.

If `EXIT=2` (MTP mode) or `EXIT=1` (not connected), or if `detect-device.sh`
prints `UNKNOWN`, auto-detection is not possible — go to 5b.

#### 5b. Ask the user directly

Present the supported models:

> Which watch do you have? Reply with the ID or number:
>
> | # | ID             | Display name                          |
> |---|----------------|---------------------------------------|
> | 1 | `fr965`        | Forerunner® 965                       |
> | 2 | `fr645m`       | Forerunner® 645 Music                 |
> | 3 | `fr265`        | Forerunner® 265                       |
> | 4 | `fr265s`       | Forerunner® 265s                      |
> | 5 | `fr255`        | Forerunner® 255                       |
> | 6 | `fr955`        | Forerunner® 955 / Solar               |
> | 7 | `fenix7`       | fēnix® 7 / quatix® 7                  |
> | 8 | `fenix7s`      | fēnix® 7S                             |
> | 9 | `fenix7x`      | fēnix® 7X / Enduro™ 2                 |
> |10 | `epix2`        | epix™ (Gen 2)                         |
> |11 | `venu3`        | Venu® 3                               |

#### 5c. Validate before continuing

Run this **before moving to step 6** — it verifies the chosen ID is in
`manifest.xml` and will actually compile:

```bash
bash .claude/skills/garmin-tracker-setup/scripts/validate-device.sh <device>
```

- Exit 0 → confirmed, safe to proceed.
- Exit 1 → device not in manifest; show the supported list and ask again.
- Exit 2 → manifest.xml missing (wrong working directory?).

Do not proceed to step 6 until this exits 0.

---

### Step 6 — Write Config.mc and build

Get the build config JSON from the daemon:

```bash
npx --prefix daemon tsx daemon/src/index.ts print-build-config
```

Parse `DAEMON_URL` and `BEARER_KEY` from the JSON output. Then write
`watch/source/Config.mc` from the template:

```bash
bash .claude/skills/garmin-tracker-setup/scripts/write-config.sh \
  "<DAEMON_URL>" "<BEARER_KEY>" "<device>"
```

**Announce the target before building** — say:
> Building tracker-`<device>`.prg for `<DisplayName>` …

Then build:

```bash
make watch-build DEVICE=<device>
```

If the build fails, show the full compiler output and diagnose the error
before asking the user to try again.

---

### Step 7 — Deploy to watch

Run the deploy script directly — it handles detection and copy strategy:

```bash
bash .claude/skills/garmin-tracker-setup/scripts/deploy-to-watch.sh <device>
```

**Interpret the exit code:**

- **Exit 0** — copied automatically via USB mass storage. Tell the user to safely eject and unplug.

- **Exit 2 (MTP, libmtp succeeded)** — copied automatically via libmtp. Tell the user to eject.

- **Exit 3 (MTP, manual copy required)** — the script has printed instructions for
  OpenMTP / Android File Transfer. Wait for the user to confirm they have copied
  the file, then continue.

- **Exit 1 (not connected)** — tell the user:
  > Please connect the watch via USB. When the watch asks which connection mode
  > to use, choose **USB Storage**, **File Transfer**, or **Garmin Drive** —
  > whichever your model offers. If you only see an MTP option, that works too
  > (you'll copy via OpenMTP). Quit Garmin Express first if it is running.
  
  Then re-run the deploy script.

**Why MTP doesn't auto-mount:** On macOS, MTP devices (Media Transfer Protocol)
do not create a filesystem mount in `/Volumes/`. OpenMTP accesses the watch
directly via USB without mounting it, so the shell cannot copy files to it
without libmtp tools. USB mass storage mode (`/Volumes/GARMIN`) is the
simplest path for automatic deployment.

---

### Step 8 — Verify

```bash
npx --prefix daemon tsx daemon/src/index.ts doctor
```

Also curl the tunnel's `/health`:

```bash
URL=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.config/claude-code-tracker/config.json')))['tunnel']['last_known_url'] or '')")
curl -s --max-time 5 "$URL/health"
```

Tell the user:
> The daemon is running and the tunnel is healthy.
> On your watch: open the **Claude Code Tracker** app and press **START**.
> You should see the tok/s counter update within ~3 seconds.

---

## Doctor mode

When the user says "diagnose claude code tracker":

```bash
npx --prefix daemon tsx daemon/src/index.ts doctor
```

Then curl the tunnel `/health` if a URL is configured, and check whether the
`.prg` is present on the mounted watch (if any).

Print a summary table and suggest next steps for any failing checks.

---

## Idempotency rules

- **Never overwrite `watch/source/Config.mc`** without first asking if the
  user wants to rebuild. If the existing config has the same URL and key as
  the daemon reports, say so and skip the rebuild unless they ask.
- **Never overwrite `watch/developer_key`** if it already exists.
- **Never silently kill an already-running daemon** — check the PID file and
  ask first.
- When watch model differs from the last build target, ask before switching.
