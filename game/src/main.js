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
import { createMissionState, updateMissions, installMission, missionEvent } from './missions.js';
import { readSave, writeSave } from './save.js';
import { Renderer, updateCamera } from './render.js';
import { createShot } from './shots.js';
const canvas = document.querySelector('#game'), screen = document.querySelector('#screen');
const params = new URLSearchParams(location.search), seed = Number.isFinite(Number(params.get('seed'))) && params.has('seed') ? Number(params.get('seed')) : 1706;
const captureMode = ['cover', 'chase', 'mission', 'city'].includes(params.get('shot'));
const input = new Input(canvas), audio = new Audio(readSave()?.settings);
let game = createGame(seed, readSave()), renderer = new Renderer(canvas, game.world), shot = null, shotPaints = 0;
window.__shotReady = false;
export function createGame(seed, save = null) {
    const world = makeWorld(seed);
    const g = {
        seed, world, capture: captureMode, rng: createRandom(seed + 907), input, audio, mode: 'play', time: 0, clock: '17:10', dusk: .4, player: makePlayer(world, save), cars: [], peds: [], enemies: [], police: makePolice(), mission: createMissionState(save?.missions), unlockedCars: new Set(save?.unlockedCars || []), best: save?.best || 0, particles: [], skids: [], floats: [], bullets: [], camera: { x: world.spawn.x, y: world.spawn.y, zoom: 1.22 }, stats: {
            stolen: 0, shots: 0, crashes: 0, distance: 0, topSpeed: 0, earned: 0, escapes: 0, reputation: 0
        }, shake: 0, damageFlash: 0, toast: null, waypoint: null, mapOpen: false, lastSave: 0, saveError: false, manual: false,
        notify(title, sub = '', color = P.mango) {
            this.toast = {
                title, sub, color, until: this.time + 4.5
            };
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
        end(reason) {
            if (this.mode !== 'play') {
                return;
            }
            this.mode = 'over';
            this.reason = reason;
            this.input.clear();
            this.best = Math.max(this.best, this.stats.reputation);
            this.save();
            if (this === game) {
                showMenu('over');
            }
        },
        screenToWorld(x, y) {
            return { x: this.camera.x + (x - renderer.width / 2) / this.camera.zoom, y: this.camera.y + (y - renderer.height / 2) / this.camera.zoom };
        },
        floatText(x, y, str, color = P.mango) {
            this.floats.push({
                x, y, text: str, color, life: 1.6, max: 1.6
            });
        },
        burst(x, y, kind, count) {
            const colors = {
                spark: [P.mango, P.headlamp, P.carCoral], smoke: ['#6E6862', '#8D8D80', '#A8A299'], dust: ['#D8BE94', '#C6B197'], shell: [P.mango]
            };
            for (let i = 0; i < count; i++) {
                const a = this.rng.range(0, Math.PI * 2), v = this.rng.range(kind === 'smoke' ? 3 : 20, kind === 'smoke' ? 15 : 110), life = this.rng.range(kind === 'smoke' ? .8 : .15, kind === 'smoke' ? 1.8 : .5);
                this.particles.push({
                    x, y, kind, vx: Math.cos(a) * v, vy: Math.sin(a) * v - (kind === 'smoke' ? 17 : 0), life, max: life, size: this.rng.range(kind === 'smoke' ? 4 : 1, kind === 'smoke' ? 9 : 3), color: this.rng.pick(colors[kind] || colors.dust)
                });
            }
            if (this.particles.length > 500) {
                this.particles.splice(0, this.particles.length - 500);
            }
        }
    };
    populateVehicles(g);
    populatePeds(g);
    populateEnemies(g);
    return g;
}
export function updateGame(g, dt = 1 / 60) {
    if (g.mode !== 'play' || g.mapOpen) {
        return;
    }
    g.time += dt;
    const minutes = (1030 + g.time * .32) % 1440;
    g.clock = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
    g.dusk = minutes < 360 ? .9 : minutes < 480 ? clamp(1 - (minutes - 360) / 120, 0, 1) : clamp((minutes - 960) / 180, 0, 1);
    updatePlayer(g, dt);
    if (g.mode !== 'play') {
        return;
    }
    updatePolice(g, dt);
    if (g.mode !== 'play') {
        return;
    }
    updateVehicles(g, dt);
    updatePeds(g, dt);
    updateCombat(g, dt);
    updateMissions(g, dt);
    updateCamera(g, dt);
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
    for (const s of g.skids) {
        s.life -= dt;
    }
    g.skids = g.skids.filter(s => s.life > 0);
    for (const t of g.floats) {
        t.life -= dt;
    }
    g.floats = g.floats.filter(t => t.life > 0);
    if (g.waypoint && Math.hypot(g.player.x - g.waypoint.x, g.player.y - g.waypoint.y) < 50) {
        g.notify('WAYPOINT REACHED', g.waypoint.label || 'Take a look around.');
        g.waypoint = null;
    }
    if (g.time - g.lastSave > 15) {
        g.save();
    }
    missionEvent(g, 'tick', { dt });
}
function start(continued = false, recovery = null) {
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
    if (!captureMode) {
        audio.unlock();
    }
    game.mode = 'play';
    game.notify(recovery ? 'A NEW SUNSET' : continued ? 'WELCOME BACK, JAX' : 'YOUR CITY. YOUR CALL.', recovery ? 'The clinic patched you up. Take it easy out there.' : continued ? 'Your cash and progress are safe. Rosa kept your seat.' : 'Walk up to the magenta Mirage GT. Press E to drive.');
    game.save();
}
const controls = `<div class="controls"><div><kbd>WASD</kbd> / <kbd>↑↓←→</kbd> Move / drive</div><div><kbd>E</kbd> Enter, exit, steal / use shop</div><div><kbd>SHIFT</kbd> Sprint / handbrake · <kbd>R</kbd> Repair</div><div><kbd>SPACE</kbd> Fire · Mouse to aim & fire</div><div><kbd>F</kbd> Punch · <kbd>TAB</kbd> City map</div><div><kbd>ESC</kbd> / <kbd>P</kbd> Pause · <kbd>M</kbd> Mute</div></div>`;
function showMenu(mode) {
    screen.classList.remove('hidden');
    screen.style.background = mode === 'title' ? '' : '#142D3878';
    if (mode === 'title') {
        const saved = readSave();
        screen.innerHTML = `<div class="panel"><p class="eyebrow">AN ORIGINAL OPEN-WORLD CRIME GAME</p><h1 class="logo">NEON BAY<br><span>NIGHTS</span></h1><p class="tagline">GOOD WEATHER. BAD DECISIONS.</p><p class="story"><strong>You’re Jax Marlowe.</strong> A courier with a dream of his own garage, in a city that never gives anything away.<br>Find a ride. Make some trouble. Lose the heat.<br>The bay is yours tonight.</p><div class="actions"><button data-action="${saved ? 'continue' : 'new'}" class="primary">${saved ? 'CONTINUE  ↗' : 'HIT THE STREETS  ↗'}</button>${saved ? '<button data-action="new">NEW GAME</button>' : ''}</div>${controls}<p class="footer">CORAL MILE / GLASSWATER / MARLIN WHARF<br><br>100% ORIGINAL ART & SOUND · SAVES ON THIS DEVICE</p><p class="touch-note">Made for a keyboard and mouse.</p></div>`;
    }
    else if (mode === 'pause') {
        screen.innerHTML = `<div class="compact"><p class="eyebrow">TAKE A BREATHER</p><h1>BAY ON HOLD.</h1><p class="story">${money(game.player.cash)} in your pocket. A whole city outside.<br>${game.saveError ? 'Your browser could not save. Keep this tab open.' : 'Your progress has been saved on this device.'}</p><div class="actions"><button class="primary" data-action="resume">BACK TO THE BAY</button><button data-action="title">SAVE & TITLE</button><button data-action="music">MUSIC ${audio.musicEnabled ? 'ON' : 'OFF'}</button><button data-action="mute">SOUND ${audio.muted ? 'OFF' : 'ON'}</button></div>${controls}</div>`;
    }
    else {
        const busted = game.reason === 'busted', fine = busted ? 150 : 75;
        screen.innerHTML = `<div class="compact"><p class="eyebrow">${busted ? 'NEON BAY POLICE DEPARTMENT' : 'BAY CLINIC · EMERGENCY ROOM'}</p><h1 class="red">${busted ? 'BUSTED.' : 'WIPED OUT.'}</h1><p class="story">${busted ? 'They caught up with you, Jax. Rosa called in a favor.' : 'Even the bay has a way of knocking you down. Take a breath. There’s another sunset.'}<br>${money(Math.min(fine, game.player.cash))} ${busted ? 'impound fine' : 'hospital bill'} · Your progress stays with you.</p><p class="mini">${Math.floor(game.stats.distance)} m driven · ${Math.floor(game.stats.topSpeed)} mph top speed<br>${game.stats.stolen} rides borrowed · ${game.stats.escapes} pursuits escaped<br>REPUTATION ${game.stats.reputation} · BEST ${Math.max(game.best, game.stats.reputation)}</p><div class="actions"><button class="primary" data-action="recover">BACK ON YOUR FEET  ↗</button><button data-action="title">TITLE SCREEN</button></div></div>`;
    }
    screen.querySelector('.primary')?.focus({ preventScroll: true });
}
function pause() {
    if (game.mode !== 'play') {
        return;
    }
    game.mapOpen = false;
    game.mode = 'pause';
    input.clear();
    game.save();
    showMenu('pause');
}
function resume() {
    game.mode = 'play';
    screen.classList.add('hidden');
    input.clear();
    canvas.focus();
    audio.unlock();
}
function title() {
    game.save();
    game.mode = 'title';
    game.mapOpen = false;
    shot = null;
    input.clear();
    showMenu('title');
}
screen.addEventListener('click', e => {
    const action = e.target.closest('button')?.dataset.action;
    if (!action) {
        return;
    }
    if (action === 'new') {
        start();
    }
    if (action === 'continue') {
        start(true);
    }
    if (action === 'resume') {
        resume();
    }
    if (action === 'title') {
        title();
    }
    if (action === 'recover') {
        const p = game.player;
        start(false, {
            cash: Math.max(0, p.cash - (game.reason === 'busted' ? 150 : 75)), ammo: p.ammo, best: Math.max(game.best, game.stats.reputation), missions: game.mission.completed, cars: [...game.unlockedCars]
        });
    }
    if (action === 'music') {
        audio.musicEnabled = !audio.musicEnabled;
        game.save();
        showMenu('pause');
    }
    if (action === 'mute') {
        audio.toggle();
        game.save();
        showMenu('pause');
    }
});
canvas.addEventListener('pointerdown', e => {
    if (!game.mapOpen || !game.mapRect) {
        return;
    }
    const r = game.mapRect, x = e.clientX, y = e.clientY;
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        game.waypoint = { x: (x - r.x) / r.scale, y: (y - r.y) / r.scale, label: 'YOUR WAYPOINT' };
        game.mapOpen = false;
        input.clear();
    }
});
window.addEventListener('resize', () => renderer.resize());
window.addEventListener('blur', () => {
    if (!shot) {
        pause();
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && !shot) {
        pause();
    }
});
window.addEventListener('pagehide', () => {
    if (game.mode !== 'title') {
        game.save();
    }
});
game.mode = 'title';
showMenu('title');
if (captureMode) {
    start(false);
    shot = createShot(params.get('shot'), game);
    game.toast = null;
    game.lastSave = Infinity;
}
if (params.has('debug')) {
    window.__neon = {
        get game() {
            return game;
        }, start, step(count = 1) {
            game.manual = true;
            for (let i = 0; i < count; i++) {
                updateGame(game);
                input.endFrame();
            }
            renderer.render(game);
        }, resumeClock() {
            game.manual = false;
        }, installMission(m) {
            installMission(game, m);
        }, snapshot() {
            return {
                mode: game.mode, time: game.time, x: game.player.x, y: game.player.y, h: game.player.h, health: game.player.health, cash: game.player.cash, ammo: game.player.ammo, car: game.player.car?.type, carHP: game.player.car?.hp, stars: game.police.stars, heat: game.police.heat, police: game.police.units.length, officers: game.police.officers.length, peds: game.peds.length, cars: game.cars.length, particles: game.particles.length
            };
        }
    };
}
let previous = performance.now(), accumulator = 0;
function frame(now) {
    const elapsed = clamp((now - previous) / 1000, 0, .1);
    previous = now;
    if (input.tap('KeyM')) {
        audio.toggle();
        if (game.mode !== 'title') {
            game.save();
        }
    }
    if (input.tap('Escape') || input.tap('KeyP')) {
        if (game.mapOpen) {
            game.mapOpen = false;
            input.clear();
        }
        else if (game.mode === 'play') {
            pause();
        }
        else if (game.mode === 'pause') {
            resume();
        }
    }
    if (input.tap('Tab') && game.mode === 'play') {
        game.mapOpen = !game.mapOpen;
        input.mouse.down = false;
    }
    if (shot && !shot.ready) {
        for (let i = 0; i < 5 && !shot.ready; i++) {
            shot.beforeStep();
            updateGame(game);
            input.endFrame();
            shot.afterStep();
        }
    }
    else if (game.mode === 'play' && !game.manual && !shot) {
        accumulator += elapsed;
        while (accumulator >= 1 / 60) {
            updateGame(game);
            input.endFrame();
            accumulator -= 1 / 60;
        }
    }
    else if (game.mode === 'title') {
        // The title is a live view of the same city, with actual traffic and pedestrians.
        game.time += elapsed;
        updateVehicles(game, elapsed);
        updatePeds(game, elapsed);
    }
    if (game.mode !== 'play') {
        input.endFrame();
    }
    audio.update(game, elapsed, game.mode === 'play' && !game.mapOpen && !shot);
    renderer.render(game);
    if (shot?.ready) {
        shotPaints++;
        if (shotPaints >= 2) {
            window.__shotReady = true;
        }
    }
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
