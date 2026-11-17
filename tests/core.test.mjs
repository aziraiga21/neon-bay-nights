// Run with: node --test tests/core.test.mjs
// A minimal canvas/DOM host lets the real ES modules run without network or browser dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
const noop = () => {
};
function events(target) {
    const listeners = new Map();
    target.addEventListener = (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
    };
    target.emit = (type, event = {}) => {
        for (const fn of listeners.get(type) || []) fn(event);
    };
    return target;
}
const context = new Proxy({ measureText: s => ({ width: String(s).length * 6 }), createLinearGradient: () => ({ addColorStop: noop }), createRadialGradient: () => ({ addColorStop: noop }) }, { get: (o, k) => k in o ? o[k] : noop, set: (o, k, v) => (o[k] = v, true) });
const makeCanvas = () => events({
    width: 1280, height: 800, getContext: () => context, addEventListener: noop, focus: noop, getBoundingClientRect: () => ({ left: 0, top: 0 })
});
const canvas = makeCanvas(), screen = events({
    style: {}, classList: { add: noop, remove: noop }, addEventListener: noop, querySelector: () => ({ focus: noop }), innerHTML: ''
});
const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
globalThis.location = { search: '?debug=1' };
globalThis.document = { querySelector: q => q === '#game' ? canvas : screen, createElement: makeCanvas, addEventListener: noop };
globalThis.window = events({
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, addEventListener: noop
});
let pendingFrame;
globalThis.requestAnimationFrame = fn => { pendingFrame = fn; };
const { createGame, updateGame } = await import('../game/src/main.js');
const { isSolid, lineClear, moveCircle, route } = await import('../game/src/world.js');
const { makeCar, damageCar } = await import('../game/src/vehicles.js');
const { interact, useService } = await import('../game/src/player.js');
const { setWanted } = await import('../game/src/police.js');
const { installMission, MISSIONS, JOB_POINTS, startMission, advanceDialogue, isUnlocked } = await import('../game/src/missions.js');
const { readSave } = await import('../game/src/save.js');
const { Renderer } = await import('../game/src/render.js');
const { CARS, PALETTE: P } = await import('../game/src/config.js');
function fresh(seed = 1706) {
    const g = createGame(seed);
    g.input.clear();
    g.input.mouse.aim = false;
    g.lastSave = Infinity;
    return g;
}
function step(g, n = 1) {
    for (let i = 0; i < n; i++) {
        updateGame(g);
        g.input.endFrame();
    }
}
function hold(g, key, n) {
    g.input.keys.add(key);
    step(g, n);
    g.input.keys.delete(key);
}
function tap(g, key) {
    g.input.pressed.add(key);
    step(g);
}
function empty(g) {
    g.cars = [];
    g.peds = [];
    g.enemies = [];
    g.police.units = [];
    g.police.officers = [];
    g.world.pickups = [];
}
test('deterministic, connected city; all important positions are accessible', () => {
    const a = fresh(), b = fresh();
    assert.deepEqual(a.world.buildings, b.world.buildings);
    assert.deepEqual(a.cars, b.cars);
    assert.equal(a.world.nodes.length, 49);
    for (const p of [a.world.spawn, ...a.world.services, ...a.world.gangSpawns]) {
        assert.equal(isSolid(a.world, p.x, p.y, 8), false, JSON.stringify(p));
    }
    for (const n of a.world.nodes) {
        assert.ok(route(a.world, 0, n.id).length >= 1);
    }
});
test('walking, sprinting and solid buildings', () => {
    const a = fresh();
    empty(a);
    const x = a.player.x;
    hold(a, 'KeyA', 30);
    assert.ok(a.player.x < x - 45);
    assert.ok(a.player.x > x - 58);
    const b = fresh();
    empty(b);
    b.input.keys.add('ShiftLeft');
    hold(b, 'KeyA', 30);
    assert.ok(b.player.x < a.player.x - 25);
    assert.ok(b.player.stamina < 1);
    const block = a.world.buildings[0];
    a.player.x = block.x - 9;
    a.player.y = block.y + 30;
    hold(a, 'KeyD', 60);
    assert.equal(isSolid(a.world, a.player.x, a.player.y, 7), false);
    assert.ok(a.player.x < block.x);
});
test('first car is reachable, drives, brakes, reverses, steers, exits safely', () => {
    const g = fresh();
    tap(g, 'KeyE');
    assert.equal(g.player.car?.type, 'sports');
    assert.equal(g.stats.stolen, 1);
    const c = g.player.car;
    g.cars = [c];
    g.peds = [];
    g.enemies = [];
    g.world.pickups = [];
    c.x = 2290;
    c.y = 1429;
    c.h = 0;
    c.vx = c.vy = c.speed = 0;
    hold(g, 'KeyW', 45);
    assert.ok(c.x > 2330);
    assert.ok(c.speed > 130);
    const h = c.h;
    g.input.keys.add('KeyW');
    hold(g, 'KeyD', 24);
    g.input.keys.delete('KeyW');
    assert.ok(c.h > h + .2);
    hold(g, 'KeyS', 150);
    assert.ok(c.speed < 0);
    assert.ok(c.speed >= -95);
    c.speed = c.vx = c.vy = 0;
    g.player.carCooldown = 0;
    tap(g, 'KeyE');
    assert.equal(g.player.car, null);
    assert.ok(Math.hypot(g.player.x - c.x, g.player.y - c.y) > 20);
    assert.equal(isSolid(g.world, g.player.x, g.player.y, 7), false);
});
test('lane traffic passes parked cars without phantom collisions and stops for red', () => {
    const g = fresh();
    empty(g);
    g.player.x = 2900;
    g.player.y = 1500;
    const c = makeCar('sedan', 1390, 1900, Math.PI / 2, P.teal, 'traffic');
    const parked = makeCar('van', 1362, 1930, Math.PI / 2, P.carMint);
    c.route = { from: 31, to: 38 };
    c.speed = 100;
    c.vy = 100;
    c.cruise = 110;
    g.cars = [c, parked];
    step(g, 60);
    assert.ok(c.y > 1980);
    assert.ok(Math.abs(c.x - 1390) < 2);
    assert.equal(c.hp, CARS.sedan.hp);
    const h = fresh();
    empty(h);
    h.player.x = 2900;
    h.player.y = 1500;
    h.time = -11.4;
    const car = makeCar('sedan', 1390, 2020, Math.PI / 2, P.teal, 'traffic');
    car.route = { from: 31, to: 38 };
    car.speed = 100;
    car.vy = 100;
    car.cruise = 110;
    h.cars = [car];
    step(h, 120);
    assert.ok(car.y < 2100);
    assert.ok(car.speed < 6);
    const stop = car.y;
    h.time = -4.4;
    step(h, 120);
    assert.ok(car.y > stop + 70);
});
test('traffic cars can be stolen; moving drivers flee', () => {
    const g = fresh();
    empty(g);
    const c = makeCar('taxi', g.player.x + 25, g.player.y, 0, P.taxi, 'traffic');
    c.speed = 30;
    g.cars = [c];
    tap(g, 'KeyE');
    assert.equal(g.player.car, c);
    assert.equal(c.driver, false);
    assert.equal(g.peds.length, 1);
    assert.ok(g.peds[0].scared > 0);
});
test('theft only creates wanted heat when witnessed; cruiser unlock at two stars', () => {
    const g = fresh();
    empty(g);
    const c = makeCar('sedan', g.player.x + 25, g.player.y, 0, P.teal);
    g.cars = [c];
    tap(g, 'KeyE');
    assert.equal(g.police.stars, 0);
    const h = fresh();
    empty(h);
    const s = makeCar('sedan', h.player.x + 24, h.player.y, 0, P.teal), cop = makeCar('police', h.player.x + 90, h.player.y, Math.PI, P.pearl, 'patrol');
    h.cars = [s, cop];
    tap(h, 'KeyE');
    assert.ok(h.police.stars >= 1);
    const j = fresh();
    empty(j);
    const cruiser = makeCar('police', j.player.x + 25, j.player.y, 0, P.pearl, 'police');
    j.cars = [cruiser];
    interact(j);
    assert.equal(j.player.car, null);
    setWanted(j, 2);
    interact(j);
    assert.equal(j.player.car, cruiser);
});
test('police dispatch, foot pursuit, arrest meter and recovery state', () => {
    const g = fresh();
    empty(g);
    setWanted(g, 3);
    step(g, 90);
    assert.ok(g.police.units.length > 0);
    assert.equal(g.police.units[0].car.ai, 'police');
    empty(g);
    g.police.officers = [{
            id: 1, x: g.player.x + 20, y: g.player.y, h: 0, hp: 90, dead: false, role: 'officer', jacket: P.navy, cooldown: 100
        }];
    g.player.invincible = 100;
    step(g, 180);
    assert.equal(g.mode, 'over');
    assert.equal(g.reason, 'busted');
    assert.equal(g.police.bust, 1);
});
test('a pursuing cruiser closes a clear road instead of turning back toward a junction', () => {
    const g = fresh();
    empty(g);
    Object.assign(g.player, { x: 2500, y: 1429, invincible: 100 });
    const car = makeCar('police', 1880, 1429, 0, P.pearl, 'police');
    g.cars = [car];
    g.police.units = [{ car, path: [], repath: 0, deployed: false, retire: 0 }];
    setWanted(g, 2);
    g.police.spawnTimer = 10000;
    step(g, 180);
    assert.ok(Math.hypot(car.x - g.player.x, car.y - g.player.y) < 150);
    assert.ok(g.police.officers.length > 0);
});
test('wanted clears after hiding; a different car reduces recognition range', () => {
    const g = fresh();
    empty(g);
    setWanted(g, 2);
    g.police.spawnTimer = 10000;
    step(g, 2400);
    assert.equal(g.police.stars, 0);
    assert.equal(g.police.heat, 0);
    assert.equal(g.stats.escapes, 1);
    const h = fresh();
    empty(h);
    setWanted(h, 2);
    h.police.spawnTimer = 10000;
    const c = makeCar('sports', 2400, 1429, 0, P.magenta);
    h.player.car = c;
    h.player.x = c.x;
    h.player.y = c.y;
    h.police.knownCar = -1;
    const cop = makeCar('police', 2150, 1429, 0, P.pearl, 'patrol');
    h.cars = [c, cop];
    step(h);
    assert.equal(h.police.seen, false);
    h.police.knownCar = c.id;
    step(h);
    assert.equal(h.police.seen, true);
});
test('combat uses ammo; shots hit rivals, punch works, drops can be collected', () => {
    const g = fresh();
    empty(g);
    g.player.x = 2370;
    g.player.y = 1429;
    g.player.h = 0;
    g.enemies = [{
            id: 500, x: 2460, y: 1429, h: Math.PI, hp: 50, maxHp: 50, dead: false, role: 'rival', home: { x: 2460, y: 1429 }, cooldown: 100, aggro: 0, flash: 0
        }];
    g.police.spawnTimer = 10000;
    hold(g, 'Space', 55);
    assert.ok(g.player.ammo < 36);
    assert.equal(g.enemies[0].dead, true);
    assert.ok(g.world.pickups.some(p => p.kind === 'cash'));
    assert.ok(g.stats.reputation >= 100);
    const h = fresh();
    empty(h);
    h.player.x = 2370;
    h.player.y = 1429;
    h.player.h = 0;
    h.enemies = [{
            id: 501, x: 2394, y: 1429, h: 0, hp: 25, maxHp: 25, role: 'rival', dead: false, flash: 0, cooldown: 100, home: { x: 2394, y: 1429 }
        }];
    tap(h, 'KeyF');
    assert.equal(h.enemies[0].dead, true);
    assert.ok(h.player.punch > 0);
    const drops = h.world.pickups;
    h.player.x = drops[0].x;
    h.player.y = drops[0].y;
    const cash = h.player.cash;
    step(h);
    assert.ok(h.player.cash > cash);
});
test('crashes damage cars; wrecks are unusable and still smoke', () => {
    const g = fresh();
    empty(g);
    const c = makeCar('sports', 2300, 1429, 0, P.magenta);
    g.cars = [c];
    g.player.car = c;
    damageCar(g, c, 101);
    assert.equal(c.wreck, true);
    step(g, 60);
    assert.ok(g.particles.some(p => p.kind === 'smoke'));
    assert.equal(c.hp, 0);
});
test('shop interactions repair, repaint, refill ammo and restore health', () => {
    const g = fresh();
    empty(g);
    const s = g.world.services.find(s => s.kind === 'garage'), c = makeCar('sports', s.x, s.y, 0, P.magenta);
    g.cars = [c];
    g.player.car = c;
    g.player.x = s.x;
    g.player.y = s.y;
    c.hp = 20;
    tap(g, 'KeyR');
    assert.equal(c.hp, CARS.sports.hp);
    assert.equal(g.player.cash, 250);
    g.player.car = null;
    const ammo = g.world.services.find(s => s.kind === 'ammo');
    Object.assign(g.player, { x: ammo.x, y: ammo.y, ammo: 1 });
    interact(g);
    assert.equal(g.player.ammo, 49);
    assert.equal(g.player.cash, 205);
    const diner = g.world.services[0];
    Object.assign(g.player, { x: diner.x, y: diner.y, health: 25 });
    interact(g);
    assert.equal(g.player.health, 100);
    assert.equal(g.player.cash, 165);
});
test('save round-trips persistent state; invalid and denied storage are handled', () => {
    const g = fresh();
    g.player.cash = 1234;
    g.player.ammo = 22;
    g.stats.reputation = 540;
    g.mission.completed = ['future-mission'];
    g.unlockedCars.add('sports');
    assert.ok(g.save());
    const d = readSave();
    assert.equal(d.cash, 1234);
    assert.equal(d.best, 540);
    assert.deepEqual(d.missions, ['future-mission']);
    assert.ok(d.unlockedCars.includes('sports'));
    const h = createGame(1706, d);
    assert.equal(h.player.cash, 1234);
    assert.equal(h.player.ammo, 22);
    const set = localStorage.setItem;
    localStorage.setItem = () => {
        throw new Error('denied');
    };
    assert.equal(g.save(), false);
    assert.equal(g.saveError, true);
    localStorage.setItem = set;
    g.player.ammo = 0;
    g.save();
    assert.equal(readSave().ammo, 0);
    const saved = store.get('neon-bay-nights.v1');
    g.capture = true;
    g.player.cash = 9999;
    g.save();
    assert.equal(store.get('neon-bay-nights.v1'), saved);
    store.set('neon-bay-nights.v1', 'bad json');
    assert.equal(readSave(), null);
});
test('mission hook receives real core events and updates marker/objective', () => {
    const g = fresh();
    const events = [];
    installMission(g, {
        objective: 'Drive to the garage.', marker: { x: 1214, y: 2060 }, onEvent: e => events.push(e.type), update(dt, game) {
            this.objective = 'Keep rolling.';
        }
    });
    tap(g, 'KeyE');
    assert.ok(events.includes('enterCar'));
    assert.ok(events.includes('tick'));
    assert.equal(g.mission.objective, 'Keep rolling.');
    assert.equal(g.mission.marker.x, 1214);
});
test('render paths execute for on foot, driving, police, map, dusk and defeat', () => {
    const g = fresh(), r = new Renderer(canvas, g.world);
    r.render(g);
    tap(g, 'KeyE');
    r.render(g);
    setWanted(g, 5);
    step(g, 120);
    r.render(g);
    g.mapOpen = true;
    r.render(g);
    g.mapOpen = false;
    g.dusk = 1;
    r.render(g);
    g.mode = 'over';
    r.render(g);
    assert.ok(g.mapRect.w > 0);
});
test('title, start, pause, map, mute, defeat, recovery and Continue use the real screen state machine', () => {
    const menu = action => screen.emit('click', { target: { closest: () => ({ dataset: { action } }) } });
    let timestamp = performance.now();
    const key = code => {
        window.emit('keydown', { code, preventDefault: noop });
        pendingFrame(timestamp += 20);
        window.emit('keyup', { code });
    };
    menu('new');
    assert.equal(window.__neon.game.mode, 'play');
    key('Escape');
    assert.equal(window.__neon.game.mode, 'pause');
    assert.match(screen.innerHTML, /BAY ON HOLD/);
    menu('resume');
    const muted = window.__neon.game.audio.muted;
    key('KeyM');
    assert.equal(window.__neon.game.audio.muted, !muted);
    key('Tab');
    const g = window.__neon.game;
    assert.equal(g.mapOpen, true);
    const r = g.mapRect;
    canvas.emit('pointerdown', { button: 0, clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 });
    assert.equal(g.mapOpen, false);
    assert.ok(Number.isFinite(g.waypoint.x));
    g.player.cash = 500;
    g.end('busted');
    assert.equal(g.mode, 'over');
    assert.match(screen.innerHTML, /BUSTED/);
    menu('recover');
    assert.equal(window.__neon.game.mode, 'play');
    assert.equal(window.__neon.game.player.cash, 350);
    assert.equal(window.__neon.game.player.health, 100);
    key('Escape');
    menu('title');
    assert.match(screen.innerHTML, /CONTINUE/);
    menu('continue');
    assert.equal(window.__neon.game.player.cash, 350);
    assert.equal(window.__neon.game.mode, 'play');
});
test('procedural sound schedules valid notes, responds to speed and sirens, and mutes', async () => {
    const { Audio } = await import('../game/src/audio.js');
    class Param {
        value = 0;
        setValueAtTime(value) { assert.ok(Number.isFinite(value)); this.value = value; }
        exponentialRampToValueAtTime(value) { assert.ok(value > 0 && Number.isFinite(value)); this.value = value; }
        setTargetAtTime(value) { assert.ok(Number.isFinite(value)); this.value = value; }
    }
    const node = () => ({ gain: new Param(), frequency: new Param(), connect: noop, start: noop, stop: noop });
    window.AudioContext = class {
        currentTime = 0;
        sampleRate = 8000;
        destination = {};
        state = 'running';
        createGain = node;
        createOscillator = node;
        createBiquadFilter = node;
        createBufferSource = node;
        createBuffer(channels, size) { const data = new Float32Array(size); return { getChannelData: () => data }; }
    };
    try {
        const a = new Audio(), g = fresh();
        a.unlock();
        g.player.car = makeCar('sports', g.player.x, g.player.y, 0, P.magenta);
        g.player.car.speed = 200;
        g.police.stars = 3;
        g.police.units = [{ car: makeCar('police', g.player.x + 100, g.player.y, 0, P.pearl, 'police') }];
        a.update(g, 1 / 60, true);
        assert.ok(a.engine.frequency.value > 70);
        assert.ok(a.engineGain.gain.value > 0);
        assert.ok(a.sirenGain.gain.value > 0);
        for (const sound of ['shot', 'enemyShot', 'crash', 'punch', 'pickup', 'enter', 'empty', 'wanted', 'escape', 'complete']) a.play(sound);
        for (let i = 0; i < 80; i++) { a.ctx.currentTime += .1; a.update(g, .1, true); }
        assert.ok(a.beat > 24);
        a.toggle();
        assert.equal(a.master.gain.value, 0);
        a.update(g, .1, false);
        assert.equal(a.engineGain.gain.value, 0);
        assert.equal(a.sirenGain.gain.value, 0);
    } finally {
        delete window.AudioContext;
    }
});
test('two minutes of city simulation remain finite, bounded and deterministic', () => {
    function run() {
        const g = fresh(92);
        g.player.x = 2900;
        g.player.y = 1500;
        g.player.invincible = 1000;
        step(g, 7200);
        for (const c of g.cars) {
            assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y) && Number.isFinite(c.h));
            assert.ok(c.x >= 40 && c.x < g.world.width);
            assert.ok(c.hp >= 0);
        }
        assert.ok(g.peds.length <= 130);
        assert.ok(g.particles.length <= 500);
        return g.cars.map(c => [c.x, c.y, c.h, c.hp]);
    }
    assert.deepEqual(run(), run());
});


test('story progression, briefings, timer failure, retry and saved rewards', () => {
    const g = fresh();
    assert.equal(startMission(g, 'm3'), false);
    assert.ok(startMission(g, 'm1'));
    const cash = g.player.cash;
    step(g, 120);
    assert.equal(g.mission.active.remaining, 90, 'briefing freezes the deadline');
    advanceDialogue(g);
    tap(g, 'KeyE');
    assert.equal(g.player.car, g.mission.active.target);
    hold(g, 'KeyW', 20);
    assert.ok(g.stats.distance > 0);
    g.mission.active.elapsed = 90;
    step(g);
    assert.equal(g.mode, 'mission-failed');
    assert.equal(g.player.cash, cash);
    assert.ok(startMission(g, 'm1'));
    advanceDialogue(g);
    tap(g, 'KeyE');
    Object.assign(g.player.car, JOB_POINTS.hotel, { speed: 0, vx: 0, vy: 0 });
    step(g);
    assert.equal(g.mission.active.phase, 'outro');
    assert.equal(g.player.cash, cash + 250);
    step(g, 60);
    assert.equal(g.player.cash, cash + 250, 'reward cannot be paid twice by the update loop');
    assert.ok(isUnlocked(g.mission.completed, 'm2'));
    assert.equal(isUnlocked(g.mission.completed, 'm3'), false);
    assert.equal(readSave().cash, g.player.cash);
    assert.deepEqual(readSave().missions, ['m1']);
    advanceDialogue(g);
    assert.equal(g.mission.active, null);
});
test('Hot Wheels finishes through real wanted decay; Repo Man requires the exact car', () => {
    const g = fresh();
    g.mission.completed = ['m1'];
    startMission(g, 'm2');
    advanceDialogue(g);
    assert.equal(g.police.stars, 2);
    g.cars = [g.player.car];
    g.peds = [];
    g.police.spawnTimer = 10000;
    step(g, 2400);
    assert.equal(g.police.stars, 0);
    assert.equal(g.mission.active.phase, 'outro');
    assert.equal(g.stats.escapes, 1);
    advanceDialogue(g);
    startMission(g, 'm3');
    advanceDialogue(g);
    const target = g.mission.active.target;
    assert.equal(target.color, P.magenta);
    const wrong = makeCar('sports', JOB_POINTS.garage.x, JOB_POINTS.garage.y, 0, P.magenta);
    g.cars.push(wrong);
    g.player.car = wrong;
    step(g);
    assert.equal(g.mission.active.phase, 'active');
    g.player.car = target;
    Object.assign(target, JOB_POINTS.garage, { speed: 0, vx: 0, vy: 0 });
    step(g);
    assert.equal(g.mission.active.phase, 'outro');
    assert.ok(g.mission.completed.includes('m3'));
});
test('Diner Defense uses real combat and the van finale enforces all three stages', () => {
    const g = fresh();
    g.mission.completed = ['m1', 'm2', 'm3'];
    startMission(g, 'm4');
    advanceDialogue(g);
    const foes = g.mission.active.foes;
    assert.equal(foes.length, 4);
    assert.ok(foes.every(e => !isSolid(g.world, e.x, e.y, 8)));
    g.player.invincible = 1000;
    g.police.spawnTimer = 10000;
    g.cars = [];
    g.peds = [];
    g.enemies = foes;
    for (const e of foes) e.cooldown = 1000;
    for (const e of foes) {
        Object.assign(g.player, { x: e.x - 24, y: e.y, h: 0 });
        for (let i = 0; i < 3; i++) { Object.assign(g.player, { x: e.x - 24, y: e.y, h: 0 }); tap(g, 'KeyF'); step(g, 28); }
        assert.equal(e.dead, true);
    }
    assert.equal(g.mission.active.phase, 'outro');
    advanceDialogue(g);
    startMission(g, 'm5');
    advanceDialogue(g);
    const van = g.mission.active.target;
    assert.equal(van.type, 'armored');
    assert.equal(isSolid(g.world, van.x, van.y, 20), false);
    Object.assign(g.player, { x: van.x + 25, y: van.y });
    tap(g, 'KeyE');
    assert.equal(g.player.car, van);
    assert.equal(g.police.stars, 3);
    assert.equal(g.mission.active.stage, 'chase');
    Object.assign(van, JOB_POINTS.garage, { speed: 0, vx: 0, vy: 0 });
    step(g);
    assert.equal(g.mission.active.phase, 'active', 'cannot deliver with three stars');
    g.police.units = [];
    g.police.officers = [];
    g.police.spawnTimer = 10000;
    g.cars = [van];
    step(g, 3000);
    assert.equal(g.police.stars, 0);
    assert.equal(g.mission.active.phase, 'outro');
    assert.deepEqual(g.mission.completed, MISSIONS.map(m => m.id));
    advanceDialogue(g);
    assert.equal(g.mode, 'ending');
});
test('mission death and target wrecks fail without paying, and menus launch/retry jobs', () => {
    const menu = action => screen.emit('click', { target: { closest: () => ({ dataset: { action } }) } });
    const g = fresh();
    g.mission.completed = ['m1', 'm2'];
    startMission(g, 'm3');
    advanceDialogue(g);
    const cash = g.player.cash;
    damageCar(g, g.mission.active.target, 1000);
    assert.equal(g.mode, 'mission-failed');
    assert.equal(g.player.cash, cash);
    window.__neon.start();
    menu('missions');
    assert.match(screen.innerHTML, /First Delivery/);
    assert.match(screen.innerHTML, /LOCKED/);
    menu('job-m1');
    const active = window.__neon.game;
    assert.equal(active.mission.active.id, 'm1');
    advanceDialogue(active);
    active.end('busted');
    assert.equal(active.mode, 'mission-failed');
    assert.match(screen.innerHTML, /RETRY JOB/);
    menu('retry-job');
    assert.equal(window.__neon.game.mission.active.phase, 'briefing');
});
test('all four capture autopilots advance real actors and preserve usable scenes', async () => {
    const { createShot } = await import('../game/src/shots.js');
    for (const name of ['cover', 'chase', 'mission', 'city']) {
        const g = fresh();
        g.capture = true;
        const shot = createShot(name, g);
        for (let i = 0; i < 900 && !shot.ready; i++) {
            shot.beforeStep();
            step(g);
            shot.afterStep();
        }
        assert.ok(shot.ready, name);
        assert.equal(g.mode, 'play', name);
        assert.ok(g.player.health > 0, name);
        assert.ok(g.peds.filter(p => !p.dead && Math.hypot(p.x - g.player.x, p.y - g.player.y) < 500).length >= 4, name);
        if (name === 'cover' || name === 'chase') {
            assert.equal(g.player.car?.type, 'sports', name);
            assert.ok(g.player.car.speed > 80, `${name} speed ${g.player.car.speed}`);
            assert.equal(g.player.car.wreck, false);
            assert.ok(g.police.stars > 0, name);
        }
        if (name === 'chase') {
            assert.equal(g.police.stars, 3);
            assert.ok(g.police.units.filter(u => Math.hypot(u.car.x - g.player.x, u.car.y - g.player.y) < 450).length >= 2);
            assert.ok(g.skids.length > 5, `skids: ${g.skids.length}`);
        }
        if (name === 'mission') {
            assert.equal(g.mission.active.id, 'm3');
            assert.equal(g.player.car, null);
            assert.ok(Math.hypot(g.player.x - g.mission.active.target.x, g.player.y - g.mission.active.target.y) < 75);
        }
        const r = new Renderer(canvas, g.world);
        r.render(g);
        r.render(g);
    }
});

test('shot URL bootstrapping signals ready only after two final paints', async () => {
    for (const name of ['cover', 'chase', 'mission', 'city']) {
        location.search = `?shot=${name}&seed=1706&debug=1`;
        await import(`../game/src/main.js?capture-test=${name}`);
        let ticks = 0, now = performance.now();
        while (!window.__shotReady && ticks++ < 100) pendingFrame(now += 1000 / 60);
        assert.ok(window.__shotReady, name);
        assert.equal(window.__neon.game.capture, true);
        assert.equal(window.__neon.game.mode, 'play');
        assert.equal(window.__neon.game.saveError, false);
    }
});
