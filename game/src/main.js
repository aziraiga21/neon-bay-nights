// Neon Bay Nights — boot, fixed-step loop, screen state machine.
// This module owns the single live game: title / play / pause / missions /
// mission-failed / ending / over, plus the ?shot= capture flow and the
// window.__neon debug handle the screenshot script drives.
import { PALETTE as P, clamp, money } from './config.js';
import { createRandom } from './random.js';
import { makeWorld } from './world.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { makePlayer, updatePlayer } from './player.js';
import { populateVehicles, updateVehicles } from './vehicles.js';
import { populatePeds, updatePeds, addPed } from './pedestrians.js';
import { makePolice, updatePolice, reportCrime } from './police.js';
import { populateEnemies, updateCombat } from './combat.js';
import { createMissionState, updateMissions, installMission, missionEvent, MISSIONS, isUnlocked, startMission, advanceDialogue, failMission } from './missions.js';
import { readSave, writeSave } from './save.js';
import { Renderer, updateCamera } from './render.js';
import { createShot } from './shots.js';

const canvas = document.querySelector('#game');
const screen = document.querySelector('#screen');
const params = new URLSearchParams(location.search);
const seed = Number.isFinite(Number(params.get('seed'))) && params.has('seed') ? Number(params.get('seed')) : 1706;
const captureMode = ['cover', 'chase', 'mission', 'city'].includes(params.get('shot'));
const input = new Input(canvas);
const audio = new Audio(readSave()?.settings);
let game = createGame(seed, readSave());
let renderer = new Renderer(canvas, game.world);
let shot = null;
let shotPaints = 0;
window.__shotReady = false;

// --- the game object -------------------------------------------------------
// Everything the simulation touches lives on this one object: the world,
// the actors, the mission state, particles, the camera, stats, and the
// small verbs (notify / crime / burst / floatText) the other modules call.

export function createGame(seed, save = null) {
    const world = makeWorld(seed);
    const g = {
        seed, world, capture: captureMode, rng: createRandom(seed + 907), input, audio,
        mode: 'play', time: 0, clock: '17:10', dusk: 0.4,
        player: makePlayer(world, save), cars: [], peds: [], enemies: [],
        police: makePolice(), mission: createMissionState(save?.missions),
        unlockedCars: new Set(save?.unlockedCars || []), best: save?.best || 0,
        particles: [], skids: [], floats: [], bullets: [],
        camera: { x: world.spawn.x, y: world.spawn.y, zoom: 1.22 },
        stats: { stolen: 0, shots: 0, crashes: 0, distance: 0, topSpeed: 0, earned: 0, escapes: 0, reputation: 0 },
        shake: 0, damageFlash: 0, toast: null, waypoint: null, mapOpen: false,
        lastSave: 0, saveError: false, manual: false,
        notify(title, sub = '', color = P.mango) {
            this.toast = { title, sub, color, until: this.time + 4.5 };
        },
        crime(type, amount, point = this.player, reported = false) {
            reportCrime(this, type, amount, point, reported);
        },
        addPed(x, y, flee) {
            return addPed(this, x, y, flee);
        },
        save() {
            return writeSave(this);
        },
        onMissionScreen(mode) {
            if (this === game) paintMenu(mode);
        },
        end(reason) {
            if (this.mode !== 'play') return;
            if (this.mission.active?.phase === 'active') {
                failMission(this, reason === 'busted'
                    ? 'Neon Bay PD caught you. Rosa is ready for another attempt.'
                    : 'Jax went down. Take a breath and try the job again.');
                return;
            }
            this.mode = 'over';
            this.reason = reason;
            this.input.clear();
            this.best = Math.max(this.best, this.stats.reputation);
            this.save();
            if (this === game) paintMenu('over');
        },
        screenToWorld(x, y) {
            return {
                x: this.camera.x + (x - renderer.width / 2) / this.camera.zoom,
                y: this.camera.y + (y - renderer.height / 2) / this.camera.zoom
            };
        },
        floatText(x, y, str, color = P.mango) {
            this.floats.push({ x, y, text: str, color, life: 1.6, max: 1.6 });
        },
        burst(x, y, kind, count) {
            const colors = {
                spark: [P.mango, P.headlamp, P.carCoral],
                smoke: ['#6E6862', '#8D8D80', '#A8A299'],
                dust: ['#D8BE94', '#C6B197'],
                shell: [P.mango]
            };
            for (let i = 0; i < count; i++) {
                const a = this.rng.range(0, Math.PI * 2);
                const v = this.rng.range(kind === 'smoke' ? 3 : 20, kind === 'smoke' ? 15 : 110);
                const life = this.rng.range(kind === 'smoke' ? 0.8 : 0.15, kind === 'smoke' ? 1.8 : 0.5);
                this.particles.push({
                    x, y, kind, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (kind === 'smoke' ? 17 : 0),
                    life, max: life,
                    size: this.rng.range(kind === 'smoke' ? 4 : 1, kind === 'smoke' ? 9 : 3),
                    color: this.rng.pick(colors[kind] || colors.dust)
                });
            }
            if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
        }
    };
    populateVehicles(g);
    populatePeds(g);
    populateEnemies(g);
    return g;
}

// --- one fixed tick --------------------------------------------------------
// One 1/60s step. The clock starts at 17:10 and runs slowly toward dusk;
// dialogue freezes the world until the player advances it.

function advanceClock(g, dt) {
    const minutes = (1030 + g.time * 0.32) % 1440;
    g.clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
    g.dusk = minutes < 360 ? 0.9 : minutes < 480 ? clamp(1 - (minutes - 360) / 120, 0, 1) : clamp((minutes - 960) / 180, 0, 1);
}

function decayEffects(g, dt) {
    g.shake = Math.max(0, g.shake - dt * 15);
    g.damageFlash = Math.max(0, g.damageFlash - dt);
    for (const p of g.particles) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= Math.exp(-dt * 1.8);
        p.vy *= Math.exp(-dt * 1.1);
    }
    g.particles = g.particles.filter(p => p.life > 0);
    for (const s of g.skids) s.life -= dt;
    g.skids = g.skids.filter(s => s.life > 0);
    for (const t of g.floats) t.life -= dt;
    g.floats = g.floats.filter(t => t.life > 0);
}

export function updateGame(g, dt = 1 / 60) {
    if (g.mode !== 'play' || g.mapOpen) return;
    if (g.mission.dialogue) {
        if (g.input.tap('Enter') || g.input.tap('Space') || g.input.tap('KeyE')) advanceDialogue(g);
        return;
    }
    g.time += dt;
    advanceClock(g, dt);
    updatePlayer(g, dt);
    if (g.mode !== 'play') return;
    updatePolice(g, dt);
    if (g.mode !== 'play') return;
    updateVehicles(g, dt);
    updatePeds(g, dt);
    if (g.mode !== 'play') return;
    updateCombat(g, dt);
    if (g.mode !== 'play') return;
    updateMissions(g, dt);
    updateCamera(g, dt);
    decayEffects(g, dt);
    if (g.waypoint && Math.hypot(g.player.x - g.waypoint.x, g.player.y - g.waypoint.y) < 50) {
        g.notify('WAYPOINT REACHED', g.waypoint.label || 'Take a look around.');
        g.waypoint = null;
    }
    if (g.time - g.lastSave > 15) g.save();
    missionEvent(g, 'tick', { dt });
}

// --- starting, recovering, launching jobs ----------------------------------
// A fresh start rebuilds the world; recovery keeps cash/ammo/progress and
// drops Jax at the clinic, patched up after a bust or a wipe-out.

function snapshotProgress() {
    return {
        cash: game.player.cash, ammo: game.player.ammo, best: game.best,
        missions: [...game.mission.completed], cars: [...game.unlockedCars]
    };
}

function begin(continued = false, recovery = null) {
    const save = continued ? readSave() : null;
    game = createGame(seed, save);
    if (recovery) {
        game.player.cash = recovery.cash;
        game.player.ammo = Math.max(24, recovery.ammo);
        game.best = recovery.best;
        game.mission.completed = recovery.missions;
        game.unlockedCars = new Set(recovery.cars);
        game.player.x = 440;
        game.player.y = 968;
        game.camera.x = 440;
        game.camera.y = 968;
    }
    renderer.setWorld(game.world);
    screen.classList.add('hidden');
    canvas.focus();
    input.clear();
    if (!captureMode) audio.unlock();
    game.mode = 'play';
    game.notify(
        recovery ? 'A NEW SUNSET' : continued ? 'WELCOME BACK, JAX' : 'YOUR CITY. YOUR CALL.',
        recovery ? 'The clinic patched you up. Take it easy out there.'
            : continued ? 'Your cash and progress are safe. Rosa kept your seat.'
            : 'Walk up to the magenta Mirage GT. Press E to drive.'
    );
    game.save();
}

function beginJob(id) {
    const progress = snapshotProgress();
    begin(false, progress);
    startMission(game, id);
    game.save();
}

// --- menus -----------------------------------------------------------------

let jobsReturn = 'title';

function openJobs() {
    if (game.mode === 'title') {
        jobsReturn = 'title';
        const saved = readSave();
        if (saved) game = createGame(seed, saved);
    } else {
        jobsReturn = 'pause';
        game.save();
    }
    game.mode = 'missions';
    input.clear();
    paintMenu('missions');
}

const controls = `<div class="controls"><div><kbd>WASD</kbd> / <kbd>↑↓←→</kbd> Move / drive</div><div><kbd>E</kbd> Enter, exit, steal / use shop</div><div><kbd>SHIFT</kbd> Sprint / handbrake · <kbd>R</kbd> Repair</div><div><kbd>SPACE</kbd> Fire · Mouse to aim & fire</div><div><kbd>F</kbd> Punch · <kbd>TAB</kbd> City map</div><div><kbd>ESC</kbd> / <kbd>P</kbd> Pause · <kbd>M</kbd> Mute</div></div>`;

function titleMarkup() {
    const saved = readSave();
    return `<div class="panel"><p class="eyebrow">AN ORIGINAL OPEN-WORLD CRIME GAME</p><h1 class="logo">NEON BAY<br><span>NIGHTS</span></h1><p class="tagline">GOOD WEATHER. BAD DECISIONS.</p><p class="story"><strong>You’re Jax Marlowe.</strong> A courier with a dream of his own garage, in a city that never gives anything away.<br>Find a ride. Make some trouble. Lose the heat.<br>The bay is yours tonight.</p><div class="actions"><button data-action="${saved ? 'continue' : 'new'}" class="primary">${saved ? 'CONTINUE  ↗' : 'HIT THE STREETS  ↗'}</button>${saved ? '<button data-action="new">NEW GAME</button>' : ''}<button data-action="missions">ROSA’S JOBS</button></div>${controls}<p class="footer">CORAL MILE / GLASSWATER / MARLIN WHARF<br><br>100% ORIGINAL ART & SOUND · SAVES ON THIS DEVICE</p><p class="touch-note">Made for a keyboard and mouse.</p></div>`;
}

function pauseMarkup() {
    const saveNote = game.saveError
        ? 'Your browser could not save. Keep this tab open.'
        : 'Your progress has been saved on this device.';
    return `<div class="compact"><p class="eyebrow">TAKE A BREATHER</p><h1>BAY ON HOLD.</h1><p class="story">${money(game.player.cash)} in your pocket. A whole city outside.<br>${saveNote}</p><div class="actions"><button class="primary" data-action="resume">BACK TO THE BAY</button><button data-action="missions">ROSA’S JOBS</button><button data-action="title">SAVE & TITLE</button><button data-action="music">MUSIC ${audio.musicEnabled ? 'ON' : 'OFF'}</button><button data-action="mute">SOUND ${audio.muted ? 'OFF' : 'ON'}</button></div>${controls}</div>`;
}

function jobsMarkup() {
    const completed = game.mission.completed;
    const doneCount = completed.filter(id => MISSIONS.some(m => m.id === id)).length;
    const rows = MISSIONS.map((m, i) => {
        const unlocked = isUnlocked(completed, m.id);
        const done = completed.includes(m.id);
        const state = unlocked ? money(m.reward) : 'LOCKED';
        const note = done ? '✓ COMPLETE' : unlocked ? 'AVAILABLE' : 'FINISH PREVIOUS';
        return `<button data-action="job-${m.id}" ${unlocked ? '' : 'disabled'}><span class="job-number">0${i + 1}</span><span><strong>${m.title}</strong><small>${m.summary}</small></span><span class="job-reward">${state}<small>${note}</small></span></button>`;
    }).join('');
    return `<div class="compact jobs"><p class="eyebrow">MAMA ROSA · BEACHFRONT FIXER</p><h1>ROSA’S JOBS.</h1><p class="mini">${doneCount} / 5 complete · ${money(game.player.cash)}<br>Choose an unlocked job. Replays pay the same reward.</p><div class="job-list">${rows}</div><div class="actions"><button class="primary" data-action="jobs-back">BACK</button></div><p class="mini">Each job starts at its meeting point with a fresh ride and full health.<br>Cash and completed jobs stay with you. Free roam is always available.</p></div>`;
}

function failedMarkup() {
    const result = game.mission.result;
    return `<div class="compact"><p class="eyebrow">ROSA’S JOBS · ${game.mission.active.title.toUpperCase()}</p><h1 class="red">JOB FAILED.</h1><p class="story">${result.reason}</p><p class="mini">Your completed jobs and cash are saved.</p><div class="actions"><button class="primary" data-action="retry-job">RETRY JOB ↗</button><button data-action="missions">ROSA’S JOBS</button><button data-action="free-roam">FREE ROAM</button></div></div>`;
}

function endingMarkup() {
    return `<div class="compact ending"><p class="eyebrow">FIVE JOBS. ONE UNFORGETTABLE NIGHT.</p><h1>NEON BAY<br><span class="gold">LEGEND.</span></h1><p class="story">Jax Marlowe. Courier, driver, and the name the Copper Kings wish they’d never heard.<br>Rosa’s lights are still on. Your garage is open. The bay belongs to you tonight.</p><p class="mini">THE BIG SCORE · +$2,000<br>All five jobs complete · ${money(game.player.cash)} in your pocket</p><div class="actions"><button class="primary" data-action="free-roam">KEEP THE NIGHT GOING ↗</button><button data-action="missions">REPLAY JOBS</button><button data-action="title">TITLE SCREEN</button></div></div>`;
}

function overMarkup() {
    const busted = game.reason === 'busted';
    const fine = busted ? 150 : 75;
    const headline = busted ? 'BUSTED.' : 'WIPED OUT.';
    const eyebrow = busted ? 'NEON BAY POLICE DEPARTMENT' : 'BAY CLINIC · EMERGENCY ROOM';
    const story = busted
        ? 'They caught up with you, Jax. Rosa called in a favor.'
        : 'Even the bay has a way of knocking you down. Take a breath. There’s another sunset.';
    const charge = busted ? 'impound fine' : 'hospital bill';
    return `<div class="compact"><p class="eyebrow">${eyebrow}</p><h1 class="red">${headline}</h1><p class="story">${story}<br>${money(Math.min(fine, game.player.cash))} ${charge} · Your progress stays with you.</p><p class="mini">${Math.floor(game.stats.distance)} m driven · ${Math.floor(game.stats.topSpeed)} mph top speed<br>${game.stats.stolen} rides borrowed · ${game.stats.escapes} pursuits escaped<br>REPUTATION ${game.stats.reputation} · BEST ${Math.max(game.best, game.stats.reputation)}</p><div class="actions"><button class="primary" data-action="recover">BACK ON YOUR FEET  ↗</button><button data-action="title">TITLE SCREEN</button></div></div>`;
}

function paintMenu(mode) {
    screen.classList.remove('hidden');
    screen.style.background = mode === 'title' ? '' : '#142D3878';
    if (mode === 'title') screen.innerHTML = titleMarkup();
    else if (mode === 'pause') screen.innerHTML = pauseMarkup();
    else if (mode === 'missions') screen.innerHTML = jobsMarkup();
    else if (mode === 'mission-failed') screen.innerHTML = failedMarkup();
    else if (mode === 'ending') screen.innerHTML = endingMarkup();
    else screen.innerHTML = overMarkup();
    screen.querySelector('.primary')?.focus({ preventScroll: true });
}

function pauseGame() {
    if (game.mode !== 'play') return;
    game.mapOpen = false;
    game.mode = 'pause';
    input.clear();
    game.save();
    paintMenu('pause');
}

function resumeGame() {
    game.mode = 'play';
    screen.classList.add('hidden');
    input.clear();
    canvas.focus();
    audio.unlock();
}

function goTitle() {
    game.save();
    game.mode = 'title';
    game.mapOpen = false;
    shot = null;
    input.clear();
    paintMenu('title');
}

function exitJobs() {
    if (jobsReturn === 'title') {
        game.mode = 'title';
        paintMenu('title');
    } else {
        game.mode = game.mission.active?.phase === 'failed' ? 'mission-failed' : 'pause';
        paintMenu(game.mode);
    }
}

// --- menu clicks and map clicks --------------------------------------------

screen.addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action) return;
    if (action === 'missions') openJobs();
    if (action?.startsWith('job-')) {
        const id = action.slice(4);
        if (isUnlocked(game.mission.completed, id)) beginJob(id);
    }
    if (action === 'retry-job') beginJob(game.mission.active.id);
    if (action === 'free-roam') begin(false, snapshotProgress());
    if (action === 'jobs-back') exitJobs();
    if (action === 'new') begin();
    if (action === 'continue') begin(true);
    if (action === 'resume') resumeGame();
    if (action === 'title') goTitle();
    if (action === 'recover') {
        const p = game.player;
        begin(false, {
            cash: Math.max(0, p.cash - (game.reason === 'busted' ? 150 : 75)),
            ammo: p.ammo, best: Math.max(game.best, game.stats.reputation),
            missions: game.mission.completed, cars: [...game.unlockedCars]
        });
    }
    if (action === 'music') {
        audio.musicEnabled = !audio.musicEnabled;
        game.save();
        paintMenu('pause');
    }
    if (action === 'mute') {
        audio.toggle();
        game.save();
        paintMenu('pause');
    }
});

canvas.addEventListener('pointerdown', e => {
    if (!game.mapOpen || !game.mapRect) return;
    const r = game.mapRect;
    const x = e.clientX;
    const y = e.clientY;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        game.waypoint = { x: (x - r.x) / r.scale, y: (y - r.y) / r.scale, label: 'YOUR WAYPOINT' };
        game.mapOpen = false;
        input.clear();
    }
});

window.addEventListener('resize', () => renderer.resize());
window.addEventListener('blur', () => {
    if (!shot) pauseGame();
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !shot) pauseGame();
});
window.addEventListener('pagehide', () => {
    if (game.mode !== 'title') game.save();
});

// --- boot ------------------------------------------------------------------

game.mode = 'title';
paintMenu('title');
if (captureMode) {
    begin(false);
    shot = createShot(params.get('shot'), game);
    game.toast = null;
    game.lastSave = Infinity;
}

// Debug handle: the screenshot script and the test suite drive the game
// through this. `step` runs fixed ticks by hand; `resumeClock` hands the
// loop back to real time.
if (params.has('debug')) {
    window.__neon = {
        get game() {
            return game;
        },
        start: begin,
        step(count = 1) {
            game.manual = true;
            for (let i = 0; i < count; i++) {
                updateGame(game);
                input.endFrame();
            }
            renderer.render(game);
        },
        resumeClock() {
            game.manual = false;
        },
        startMission(id) {
            return startMission(game, id);
        },
        advanceDialogue() {
            advanceDialogue(game);
        },
        installMission(m) {
            installMission(game, m);
        },
        snapshot() {
            return {
                mission: game.mission.active?.id, phase: game.mission.active?.phase,
                objective: game.mission.objective, completed: [...game.mission.completed],
                mode: game.mode, time: game.time, x: game.player.x, y: game.player.y,
                h: game.player.h, health: game.player.health, cash: game.player.cash,
                ammo: game.player.ammo, car: game.player.car?.type, carHP: game.player.car?.hp,
                stars: game.police.stars, heat: game.police.heat,
                police: game.police.units.length, officers: game.police.officers.length,
                peds: game.peds.length, cars: game.cars.length, particles: game.particles.length
            };
        }
    };
}

// --- frame loop ------------------------------------------------------------
// Fixed 1/60s steps behind an accumulator. Capture shots advance five steps
// per frame instead; the title screen keeps the city alive in the background.

let previous = performance.now();
let accumulator = 0;

function handleGlobalKeys() {
    if (input.tap('KeyM')) {
        audio.toggle();
        if (game.mode !== 'title') game.save();
    }
    if (input.tap('Escape') || input.tap('KeyP')) {
        if (game.mapOpen) {
            game.mapOpen = false;
            input.clear();
        } else if (game.mode === 'play') {
            pauseGame();
        } else if (game.mode === 'pause') {
            resumeGame();
        } else if (game.mode === 'missions') {
            exitJobs();
        }
    }
    if (input.tap('Tab') && game.mode === 'play') {
        game.mapOpen = !game.mapOpen;
        input.mouse.down = false;
    }
}

function frame(now) {
    const elapsed = clamp((now - previous) / 1000, 0, 0.1);
    previous = now;
    handleGlobalKeys();
    if (shot && !shot.ready) {
        for (let i = 0; i < 5 && !shot.ready; i++) {
            shot.beforeStep();
            updateGame(game);
            input.endFrame();
            shot.afterStep();
        }
    } else if (game.mode === 'play' && !game.manual && !shot) {
        accumulator += elapsed;
        while (accumulator >= 1 / 60) {
            updateGame(game);
            input.endFrame();
            accumulator -= 1 / 60;
        }
    } else if (game.mode === 'title') {
        // The title is a live view of the same city, with actual traffic and pedestrians.
        game.time += elapsed;
        updateVehicles(game, elapsed);
        updatePeds(game, elapsed);
    }
    if (game.mode !== 'play') input.endFrame();
    audio.update(game, elapsed, game.mode === 'play' && !game.mapOpen && !shot);
    renderer.render(game);
    if (shot?.ready) {
        shotPaints++;
        if (shotPaints >= 2) window.__shotReady = true;
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
