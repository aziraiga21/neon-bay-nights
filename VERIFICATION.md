# Phase 2 verification

The five Rosa missions, ordered unlocks, dialogue, objective markers, retry flow,
armoured van finale, rewards, and saved cash/progress are implemented. The core
city, physics, traffic, combat, police, and procedural art/audio remain in use.

`node tests/core.test.mjs` runs 24 checks, including the existing core regression
checks, real combat and wanted decay, mission transitions, failure/retry, all four
capture autopilots, and URL startup waiting for two final paints. These use a small
DOM/Canvas host; they are not a Chromium performance measurement.

`MAKEFUN_OUTPUT_DIR=out node main.ts` and the equivalent run into `out2` produced
identical bytes (`diff -r out out2`). The game has 18 plain files, no symlinks, no
external resource references or bare imports. Every JavaScript module parses.
`vendor/makefun-game.ts` matches the previous commit exactly. Root LICENSE and
`.makefun/owner.json` are present.

## Browser handoff

Chromium was deliberately not launched inside this sandbox, following the session
constraint. The four JPEGs currently in `screenshots/` are **provisional renderer
previews**: actual fixed-step game scenes drawn through a CPU Canvas-to-SVG host,
then rasterised with the system SVG renderer. They were viewed and checked at
1280×800, each under 256 KiB. They replace the unrelated starter screenshots, but
are not claimed to be browser captures.

Outside the sandbox, from this repository, run:

```sh
node /tmp/shots/take-shots.mjs "$PWD"
```

The Playwright script is ready at that absolute path, outside the repository as
requested. It starts `node serve.ts` if needed, loads all four `shots.json` URLs,
waits for `window.__shotReady`, captures and verifies complete JPEG files, checks
console/page/HTTP errors and external requests, exercises mission selection,
car theft, driving, pause, delivery and escaping wanted, and reports browser frame
pacing over 240 frames. It replaces the previews only after the capture and smoke
checks succeed, and writes `/tmp/shots/report.json`.

The actual Chromium screenshots, browser console audit, and 60 fps measurement
remain for that outside-sandbox run. View the resulting four images and rerun the
package command afterward so the dossier contains the final captures. No push has
been made.

## Git handoff

The sandbox mounts this repository’s `.git` read-only. The requested normal commit
failed when Git tried to create `.git/index.lock`. A Phase 2 commit is instead
prepared in writable temporary Git metadata and exported, with the original HEAD
as its parent, to `/tmp/shots/neon-bay-phase2.bundle`.

Outside the sandbox, while this checkout still contains these Phase 2 files, import
that commit without changing the working files:

```sh
git fetch /tmp/shots/neon-bay-phase2.bundle phase2
git reset --mixed FETCH_HEAD
```

This records the prepared commit and updates the index to match it. The repository
HEAD in this sandbox remains unchanged; no push was attempted.
