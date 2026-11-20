# Neon Bay Nights rebuild

## Feature inventory recorded before implementation

| System | Existing behavior to preserve |
| --- | --- |
| Rosa’s story | Five ordered jobs with briefings, objective markers, rewards, failure, retry and completion dialogue. First Delivery has a 90-second hotel deadline. Hot Wheels requires an actual two-star escape. Repo Man requires the specific magenta Mirage. Diner Defense tracks four Copper Kings. The Big Score requires stealing the armoured van, escaping three stars and delivering it intact. Rosa’s after-hours diner visit persists after the finale. |
| City | Seeded 49-junction road network across Glasswater, Coral Mile and Marlin Wharf, Ocean Drive, beach, pier, parks, solid buildings and containers, district signs, four accessible services, line-of-sight checks and pathfinding. |
| Driving | Six vehicle classes, parked cars, 50 grid traffic cars, waterfront traffic and patrols. Lane following, signals, avoidance, distant traffic recycling, theft and escaping drivers, acceleration, reversing, grip, handbrake, skid marks, impacts, damage, wrecks and smoke. |
| People | 64 starting pedestrians with rigged Mixamo and Quaternius GLB characters, seeded outfits, sidewalk routes, pauses, crossings, fleeing, casualties and cab passengers. Four roaming rivals plus story actors. |
| Police | Witnessed and reported crimes, heat thresholds for zero to five stars, recognition by car, sight loss and heat decay, foot dispatch, bounded cruisers, pursuit routing, officer deployment and retirement, bust meter, escape and clinic recovery. |
| Combat and economy | Pistol, fists, hostile fire, damage protection, defeat, cash drops, reputation, health and ammo pickups. Food, clinic, ammunition, garage repairs and repaint. Buy and retrieve titled cars at Marlowe. |
| Side activities | Timed cab calls, a physical waiting passenger, boarding, drop-off, payout and cancellation. Ten persistent Neon Tapes, each paying $75 and 50 reputation once. |
| Presentation | Live title orbit, chase camera, day/night clock, weathered streets, animated bay, smoke, lights, tracers, damage feedback. HUD for health, cash, ammo, engine, speed, reputation, tapes, wanted, time, district, jobs and bust progress. Minimap, full city map and click-to-place waypoints. Synthesized music, engine, sirens and event sounds, mute and music settings. |
| Screens and storage | New game, Continue, pause, jobs, garage, defeat, retry, recovery and ending. Version-one local saves, legacy defaults, autosave, denied-storage handling and capture-mode isolation. |
| Distribution | Static offline browser modules, vendored Three.js r160, fixed simulation ticks, four seeded live capture scenarios, local server and deterministic make.fun packaging. |

## Visual polish baseline at f65d7be

On 20 November 2026 the polish pass shipped the dusk reflection map, revised car silhouettes and wheels, recessed storefronts, balconies, setbacks, signals, puddles and seeded street clutter. The core suite passed all 40 tests. Two seed-1706 runs produced identical 7,200-tick dumps. The Chromium smoke run exercised the four gears, jump, aim, fire, vehicle transitions and First Delivery.

At 1280 × 800 with a 320 × 200 SwiftShader buffer, the synchronized 12-frame sample in `out/verify/polish-profile.log` measured 288.35 ms for the original scene (36 draws, 73,377 triangles) and 153.65 ms with the basic material. The target is 40 ms.

| Polish capture, seed 1706 | JPEG bytes | Draws | Triangles |
| --- | ---: | ---: | ---: |
| [Ocean Drive](screenshots/1-cover.jpg) | 172,552 | 40 | 44,740 |
| [Hot Wheels](screenshots/2-chase.jpg) | 196,397 | 52 | 78,067 |
| [Repo Man](screenshots/3-mission.jpg) | 182,464 | 83 | 119,156 |
| [Glasswater](screenshots/4-city.jpg) | 203,560 | 57 | 96,901 |

## Rigged-character recording 01a1f8c3-a26e-7cb1-b895-c77173331aa9

The published three@0.160.0 npm tarball downloaded in this session has SHA-256 `1ee2f935c4f555814b388e87b5ef78a44856bd2e9d0feb88643a6e193fb42856`. Reapplying the existing canvas creation, two lighting diagnostic messages and network-loader adaptations to its minified build reproduced the checked-in engine byte for byte (SHA-256 `80caf61f7bb77652c1f616fd81506e25be12bc1a59f556ed752818de413b7104`). The bundled copy adds the dated provenance comment.

Finish recording `01a1f9da-c61e-7c13-8531-340a3cb2be8e` measured the two GLBs in `game/assets/glb/`. Both ship with local `.bytes.js` loaders.

| Asset | GLB bytes | Skinned triangles | Head / height | Animation clips |
| --- | ---: | ---: | ---: | --- |
| Mixamo Jax | 841,272 | 2,479 | 0.150492 (1/6.645) | Idle, Walk, Run, Jump, Punch, PistolIdle, PistolAim, PistolShoot, Sitting |
| Quaternius female | 529,324 | 2,315 | 0.130522 (1/7.662) | Walk_Carry, Walk, Victory, SwordSlash, StandUp, SitDown, Shoot_OneHanded, Run_Carry, Run, Roll, RecieveHit, Punch, PickUp, Jump, Idle, Defeat, Death |

The proportion check reads vertex positions and skin weights from the GLB accessors. It measures crown to lowest head-dominated vertex (excluding hanging hair for the chin) divided by crown to floor. Uniform character scaling preserves this fraction. Both meshes fall within the specified 1/8.5–1/6.5 band. Clip names above preserve the source spelling.

All four seed-1706 JPEGs were recaptured from the final assets with `out/verify/browser.mjs`, copied into `screenshots/` and visually inspected. The original rigged cover was byte-identical to the polish cover. All four final files differ from f65d7be.

| Capture | JPEG bytes | Draws | Triangles | Visual inspection |
| --- | ---: | ---: | ---: | --- |
| [Ocean Drive](screenshots/1-cover.jpg) | 172,548 | 39 | 42,520 | Rear chase framing, beach, wheel and sunset intact. |
| [Hot Wheels](screenshots/2-chase.jpg) | 196,650 | 53 | 75,411 | Sidewalk figures have distinct outfits. Pursuit, lights and job HUD are visible. |
| [Repo Man](screenshots/3-mission.jpg) | 183,374 | 83 | 112,242 | Jax has a readable running stride, bent elbows and visible shoes beside the marked Mirage. |
| [Glasswater](screenshots/4-city.jpg) | 204,490 | 57 | 86,420 | Jax crosses the intersection with distinct pedestrians behind the taxi and on the sidewalk. |

No visible T-pose, missing limb or foot-grounding defect appeared in the final captures.

The complete rigged SwiftShader profile in `out/verify/rig-submission-profile.log` measured 370.35 ms original and 160.90 ms basic, above the polish medians of 288.35 and 153.65 ms. This finish recording ran `out/verify/profile.mjs` again. It recorded 206.40 ms original (35 draws, 49,992 triangles) and 202.60 ms in cache mode before termination with status 143. This run has no basic-material measurement. The 40 ms target remains unmet.

The final syntax check passed for all 19 changed or added JavaScript modules, including the test module. `node --test tests/core.test.mjs` exited successfully. Running the file directly reported 43 passed, zero failed and zero skipped. Two independent runs of seed 1706 through 7,200 ticks produced byte-identical dumps with SHA-256 `c4bb07e576317974104165027ecece52908b66a8dcbe9d731df7d9af571ba6c1`. A binary-inclusive search of the entire `game/` tree found zero occurrences of the four forbidden network patterns.

Against f65d7be, the four required authorship paths all have content changes. The verification record adds the polish and rig measurements. The remaining three entries in the authorship diff stat are `game/vendor/RoundedBoxGeometry.js` (34 changed lines), `game/vendor/THREE-LICENSE.txt` (21) and `game/vendor/three.module.min.js` (1).
