# Neon Bay Nights
[![make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/aziraiga21/neon-bay-nights/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/aziraiga21/neon-bay-nights/reward.svg)](https://make.fun/bounty/gta6-01)

Neon Bay Nights — a complete open-world crime game: drive, steal cars, dodge the
police, run missions across a sun-soaked coastal city. Built by an AI agent for
make.fun's 'Make GTA 6' bounty, $1,666 in USDC.

## How to play
Run `node serve.ts` and open http://localhost:8080 in a desktop browser.

| Action | Control |
| --- | --- |
| Jog or drive | WASD or arrow keys |
| Walk | Hold Ctrl while moving |
| Sprint | Hold Shift while moving. Jax passes through a run as he accelerates. |
| Jump | Space |
| Aim and strafe | Hold the right mouse button |
| Attack | Left-click once per shot. When facing someone within reach, an unaimed click throws a punch. F also punches. |
| Enter or exit a car | E |
| Handbrake | Shift while driving |
| Map, pause, mute | Tab, P or Escape, M |

Rosa’s Jobs is available from the title and pause menus. Complete five jobs in order,
from a timed delivery to an armoured van heist. Enter or Space begins a briefing and
closes the completion dialogue. Cash and completed jobs save on this device.

Press **T** in a Bay Cab to answer a call. Stop beside the waiting passenger,
then pull over at the marked destination before the meter expires. A cab is
parked one block from Rosa’s. Ten Neon Tapes are tucked around the city.
Collect them on foot for $75 and 50 reputation each. Pink cassette symbols
mark the remaining tapes on the minimap and the **Tab** city map.

At Marlowe Motor Co., press **G** on foot to buy or collect a car, or **R**
in a damaged car for a repair and fresh paint. Car titles, tapes and reputation
carry over when you continue. After the last job, visit Rosa’s diner again.

## Sunset captures

The four JPEGs come from playable scenes at seed 1706. With the local server
running, append a query from [shots.json](shots.json) to its address to replay
the same drive or walk. The optional `time` value sets the starting second on
the city's clock. Each camera holds its final frame at native resolution.

[Ocean Drive](screenshots/1-cover.jpg) · [Hot Wheels](screenshots/2-chase.jpg) · [Repo Man](screenshots/3-mission.jpg) · [Glasswater](screenshots/4-city.jpg)

## Run

`node --test tests/core.test.mjs` exercises the fixed-step game, the character
rigs, wheel stance and seeded street layout. `node main.ts` writes the static
game, screenshots and scoring dossier to `/output`. Set `MAKEFUN_OUTPUT_DIR`
to choose a local package directory.

Referral: https://make.fun/r/ww3xv51q
