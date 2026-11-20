# Neon Bay Nights rebuild

## Feature inventory recorded before implementation

| System | Existing behavior to preserve |
| --- | --- |
| Rosa’s story | Five ordered jobs with briefings, objective markers, rewards, failure, retry and completion dialogue. First Delivery has a 90-second hotel deadline. Hot Wheels requires an actual two-star escape. Repo Man requires the specific magenta Mirage. Diner Defense tracks four Copper Kings. The Big Score requires stealing the armoured van, escaping three stars and delivering it intact. Rosa’s after-hours diner visit persists after the finale. |
| City | Seeded 49-junction road network across Glasswater, Coral Mile and Marlin Wharf, Ocean Drive, beach, pier, parks, solid buildings and containers, district signs, four accessible services, line-of-sight checks and pathfinding. |
| Driving | Six vehicle classes, parked cars, 50 grid traffic cars, waterfront traffic and patrols. Lane following, signals, avoidance, distant traffic recycling, theft and escaping drivers, acceleration, reversing, grip, handbrake, skid marks, impacts, damage, wrecks and smoke. |
| People | 64 starting walkers, seeded outfits, sidewalk routes, pauses, crossings, fleeing, casualties and cab passengers. Four roaming rivals plus story actors. |
| Police | Witnessed and reported crimes, heat thresholds for zero to five stars, recognition by car, sight loss and heat decay, foot dispatch, bounded cruisers, pursuit routing, officer deployment and retirement, bust meter, escape and clinic recovery. |
| Combat and economy | Pistol, fists, hostile fire, damage protection, defeat, cash drops, reputation, health and ammo pickups. Food, clinic, ammunition, garage repairs and repaint. Buy and retrieve titled cars at Marlowe. |
| Side activities | Timed cab calls, a physical waiting passenger, boarding, drop-off, payout and cancellation. Ten persistent Neon Tapes, each paying $75 and 50 reputation once. |
| Presentation | Live title orbit, chase camera, day/night clock, weathered streets, animated bay, smoke, lights, tracers, damage feedback. HUD for health, cash, ammo, engine, speed, reputation, tapes, wanted, time, district, jobs and bust progress. Minimap, full city map and click-to-place waypoints. Synthesized music, engine, sirens and event sounds, mute and music settings. |
| Screens and storage | New game, Continue, pause, jobs, garage, defeat, retry, recovery and ending. Version-one local saves, legacy defaults, autosave, denied-storage handling and capture-mode isolation. |
| Distribution | Static offline browser modules, vendored Three.js r160, fixed simulation ticks, four seeded live capture scenarios, local server and deterministic make.fun packaging. |

## Resume from 6b5b460, 20 November 2026

Jax, the pedestrians, rivals and officers share a 14-unit hip-to-ankle chain (7.5 thigh, 6.5 shin). Jax stands 27.98 units high with a 3.76-unit chin-to-crown height. The neck follows the chest. The hair, face, sunglasses and officer cap follow the head. The stance solver uses the same leg lengths as the skinned model and accounts for knee flexion during landing and at the car door.

The proportions test measures posed mesh vertices and joint positions at both detail levels for Jax, two civilian hairstyles and a uniformed officer. It checks standing height, shoe contact, head and leg fractions, and shoe contact during the door crouch. A 32-phase sample of the walk put the lowest shoe between −0.12 and +0.12 world units from the road.

### Software-renderer measurements

Headless Chromium, ANGLE SwiftShader, seed 1706, 1280 × 800 CSS viewport, 320 × 200 WebGL buffer. The six modes in the local `out/verify/profile.mjs` are cumulative diagnostic changes on a fixed simulation tick. Each cell is a median frame interval in milliseconds. The harness reads one pixel per frame to wait for GPU completion, discards six warm-up frames, and measures twelve. Disabling individual effects below was confined to the profiler.

| Profiler mode | Before renderer changes | Fitted and cached shadows | Indexed meshes, projected detail and sky depth | Palm batching and masonry culling |
| --- | ---: | ---: | ---: | ---: |
| Original scene | 601.6 | 393.4 | 379.5 | 349.6 |
| Cache shadow map | 411.9 | 393.6 | 351.4 | 309.0 |
| Disable glows and beams | 405.5 | 398.6 | 349.2 | 413.0 |
| Shorten far plane | 330.2 | 323.6 | 282.7 | 301.7 |
| Isolate static geometry and player | 300.5 | 283.4 | 270.8 | 288.2 |
| Override with basic material | 135.3 | 138.7 | 106.6 | 104.9 |

The unmodified profiler initially reported 15.3 ms for the full scene and 452.6 ms with shadow updates disabled. Queued frames made those timings unsuitable for estimating completed-frame throughput. The synchronized full-scene run reduced draw calls from 118 to 89, triangles from 143,576 to 88,870, and the median interval by 42%. It still exceeded the 40 ms budget for 25 fps. Small differences between runs include scheduler and compositor variance.

The sun follows the player. Native-resolution captures use a 2048² shadow map, and gameplay sizes the map to the drawing buffer. Repeated paints of the same scene reuse the map. Static batches retain mesh indices and UV seams. Palms share draw calls by projected size and shadow visibility. The renderer uses building bounds for culling and paints the sky behind opaque surfaces. The simulation continues to update the entire city.

### Offline provenance

All four Three.js vendor files were regenerated from the official three@0.160.0 release archive and byte-compared to the existing offline copies. The MIT license is verbatim. The addons import the local module. The existing core adaptations use HTML canvas creation, omit external diagnostic links and disable network loaders. All models, clothing, facades, signs and street surfaces use the game's procedural geometry and textures.

### Gameplay and determinism

- All 22 production JS modules, the core suite and the local profile script passed `node --check`.
- `node --test tests/core.test.mjs` passed. Running with `--test-isolation=none` on this Node 24 host listed all 38 tests individually, with 38 passes and zero failures or skips.
- Two separate processes advanced seed 1706 for 7,200 fixed ticks each, including driving, exiting, jumping and police dispatch. The 90,295-byte state dumps were identical. Both SHA-256 digests were `5720db1ebb67b4f0ac079ddbc7e65d66a91773c49e42dec9d8ec6c9747f281ae`.
- The byte scan of every file under `game/` found zero literal HTTP URLs, HTTPS URLs, fetch calls or XMLHttpRequest references.
- The Chromium smoke run used real keyboard, mouse and menu events to enter, drive and exit the Mirage, walk, jog, pass through run into sprint, jump and land, hold aim, fire once and start First Delivery. Space preserved ammunition. External requests, HTTP errors, browser console errors and page exceptions all remained at zero.
- The live smoke run measured a 343.7 ms median and a 348.5 ms mean across its final 60 frame intervals, typically 2.9 fps on this VM's SwiftShader. The adaptive WebGL buffer reached 256 × 160 with the HUD at 1280 × 800. The last frame submitted 41 draw calls and 50,670 triangles.

### Full-resolution captures

Each scenario ran from `shots.json` at seed 1706. The capture waited for the two final paints and saved a 1280 × 800 JPEG. Each reviewed file in `out/verify/` was copied byte-for-byte into the packaged `screenshots/` directory.

| Capture | Local verification path | Packaged image | Bytes | Visual check |
| --- | --- | --- | ---: | --- |
| Cover | `out/verify/1-cover.jpg` | [Ocean Drive](screenshots/1-cover.jpg) | 166,628 | Rounded magenta Mirage, reflective paint, bay, sailboats and pier wheel under a pink sky. |
| Chase | `out/verify/2-chase.jpg` | [Hot Wheels](screenshots/2-chase.jpg) | 189,042 | Mirage in front of two marked cruisers, flashing bars, three wanted stars and distinct palm shadows across the road. |
| Mission | `out/verify/3-mission.jpg` | [Repo Man](screenshots/3-mission.jpg) | 193,368 | Jax in stride beside the target car. Head, shoulders and both legs are visible against the street. |
| City | `out/verify/4-city.jpg` | [Glasswater](screenshots/4-city.jpg) | 205,447 | Three-quarter rear view shows the bent trailing leg, raised heel and long cast shadow. Pedestrians and a crossing Bay Cab frame the intersection. |

The procedural Three.js assets are the shipped path. The optional Blender generation pass was deferred while the software-renderer frame budget remains open.
