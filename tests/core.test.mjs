// Run with: node --test tests/core.test.mjs
// A small canvas/DOM stand-in lets the real ES modules run with no browser
// and no network. The fakes below only swallow drawing and events; every
// simulation under test is the production code.
import test from 'node:test';
import assert from 'node:assert/strict';

const noop = () => {};

// Give an object a listener registry: handlers added with addEventListener
// can be triggered later with fire(type, event).
function giveEvents(target) {
    const listeners = new Map();
    target.addEventListener = (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
    };
    target.fire = (type, event = {}) => {
        for (const fn of listeners.get(type) || []) fn(event);
    };
    return target;
}

// A 2D context that accepts every call the renderer makes and forgets it.
const fakeCtx = new Proxy(
    {
        measureText: s => ({ width: String(s).length * 6 }),
        createLinearGradient: () => ({ addColorStop: noop }),
        createRadialGradient: () => ({ addColorStop: noop })
    },
    { get: (o, k) => (k in o ? o[k] : noop), set: (o, k, v) => ((o[k] = v), true) }
);

const stubCanvas = () =>
    giveEvents({
        width: 1280,
        height: 800,
        getContext: () => fakeCtx,
        addEventListener: noop,
        focus: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0 })
    });

const canvas = stubCanvas();
const screen = giveEvents({
    style: {},
    classList: { add: noop, remove: noop },
    addEventListener: noop,
    querySelector: () => ({ focus: noop }),
    innerHTML: ''
});

const store = new Map();
globalThis.localStorage = {
    getItem: k => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
};
globalThis.location = { search: '?debug=1' };
globalThis.document = {
    querySelector: q => (q === '#game' ? canvas : screen),
    createElement: stubCanvas,
    addEventListener: noop
};
globalThis.window = giveEvents({
    innerWidth: 1280,
    innerHeight: 800,
    devicePixelRatio: 1,
    addEventListener: noop
});
let pendingFrame;
globalThis.requestAnimationFrame = fn => {
    pendingFrame = fn;
};

const { createGame, updateGame } = await import('../game/src/main.js');
const { isSolid, lineClear, moveCircle, route } = await import('../game/src/world.js');
const { makeCar, damageCar } = await import('../game/src/vehicles.js');
const { interact, useService } = await import('../game/src/player.js');
const { setWanted } = await import('../game/src/police.js');
const { installMission, MISSIONS, JOB_POINTS, startMission, advanceDialogue, isUnlocked } = await import('../game/src/missions.js');
const { readSave } = await import('../game/src/save.js');
const { Renderer } = await import('../game/src/render.js');
const { CARS, PALETTE: P } = await import('../game/src/config.js');

// --- scenario helpers ------------------------------------------------------

function makeGame(seed = 1706) {
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

function holdKey(g, key, n) {
    g.input.keys.add(key);
    step(g, n);
    g.input.keys.delete(key);
}

function pressKey(g, key) {
    g.input.pressed.add(key);
    step(g);
}

function useCarDoor(g) {
    pressKey(g,'KeyE');
    const tr=g.player.transition;
    assert.ok(tr,'E should start the door interaction');
    step(g,tr.kind==='enter'?48:36);
    assert.equal(g.player.transition,null);
}

// Strip the world down to the player so one mechanic can be measured alone.
function clearActors(g) {
    g.cars = [];
    g.peds = [];
    g.enemies = [];
    g.police.units = [];
    g.police.officers = [];
    g.world.pickups = [];
}

function farCorner(g) {
    g.player.x = 2900;
    g.player.y = 1500;
    return g;
}

test('deterministic, connected city; all important positions are accessible', () => {
    const a = makeGame();
    const b = makeGame();
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
    const a = makeGame();
    clearActors(a);
    Object.assign(a.player,{x:2778,y:1650,h:-Math.PI/2});
    a.input.keys.add('ControlLeft');
    holdKey(a,'KeyW',90);
    assert.ok(Math.abs(a.player.speed-34)<.1);
    assert.ok(a.player.y<1620 && a.player.y>1599);
    const b = makeGame();
    clearActors(b);
    Object.assign(b.player,{x:2778,y:1650,h:-Math.PI/2});
    b.input.keys.add('ShiftLeft');
    holdKey(b,'KeyW',90);
    assert.ok(Math.abs(b.player.speed-172)<.3);
    assert.ok(b.player.y<a.player.y-150);
    assert.ok(b.player.stamina<1);
    const block = a.world.buildings[0];
    a.player.x = block.x - 9;
    a.player.y = block.y + 30;
    holdKey(a, 'KeyD', 60);
    assert.equal(isSolid(a.world, a.player.x, a.player.y, 7), false);
    assert.ok(a.player.x < block.x);
});

test('first car is reachable, drives, brakes, reverses, steers, exits safely', () => {
    const g = makeGame();
    useCarDoor(g);
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
    holdKey(g, 'KeyW', 45);
    assert.ok(c.x > 2330);
    assert.ok(c.speed > 130);
    const h = c.h;
    g.input.keys.add('KeyW');
    holdKey(g, 'KeyD', 24);
    g.input.keys.delete('KeyW');
    assert.ok(c.h > h + 0.2);
    holdKey(g, 'KeyS', 150);
    assert.ok(c.speed < 0);
    assert.ok(c.speed >= -95);
    c.speed = c.vx = c.vy = 0;
    g.player.carCooldown = 0;
    useCarDoor(g);
    assert.equal(g.player.car, null);
    assert.ok(Math.hypot(g.player.x - c.x, g.player.y - c.y) > 20);
    assert.equal(isSolid(g.world, g.player.x, g.player.y, 7), false);
});

test('lane traffic passes parked cars without phantom collisions and stops for red', () => {
    const g = makeGame();
    clearActors(g);
    farCorner(g);
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
    const h = makeGame();
    clearActors(h);
    farCorner(h);
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
    const g = makeGame();
    clearActors(g);
    const c = makeCar('taxi', g.player.x + 25, g.player.y, 0, P.taxi, 'traffic');
    c.speed = 30;
    g.cars = [c];
    useCarDoor(g);
    assert.equal(g.player.car, c);
    assert.equal(c.driver, false);
    assert.equal(g.peds.length, 1);
    assert.ok(g.peds[0].scared > 0);
});

test('theft only creates wanted heat when witnessed; cruiser unlock at two stars', () => {
    const g = makeGame();
    clearActors(g);
    const c = makeCar('sedan', g.player.x + 25, g.player.y, 0, P.teal);
    g.cars = [c];
    useCarDoor(g);
    assert.equal(g.police.stars, 0);
    const h = makeGame();
    clearActors(h);
    const s = makeCar('sedan', h.player.x + 24, h.player.y, 0, P.teal);
    const cop = makeCar('police', h.player.x + 90, h.player.y, Math.PI, P.pearl, 'patrol');
    h.cars = [s, cop];
    useCarDoor(h);
    assert.ok(h.police.stars >= 1);
    const j = makeGame();
    clearActors(j);
    const cruiser = makeCar('police', j.player.x + 25, j.player.y, 0, P.pearl, 'police');
    j.cars = [cruiser];
    interact(j);
    assert.equal(j.player.car, null);
    setWanted(j, 2);
    interact(j);
    step(j,48);
    assert.equal(j.player.car, cruiser);
});

test('police dispatch, foot pursuit, arrest meter and recovery state', () => {
    const g = makeGame();
    clearActors(g);
    setWanted(g, 3);
    step(g, 90);
    assert.ok(g.police.units.length > 0);
    assert.equal(g.police.units[0].car.ai, 'police');
    clearActors(g);
    g.police.officers = [
        { id: 1, x: g.player.x + 20, y: g.player.y, h: 0, hp: 90, dead: false, role: 'officer', jacket: P.navy, cooldown: 100 }
    ];
    g.player.invincible = 100;
    step(g, 180);
    assert.equal(g.mode, 'over');
    assert.equal(g.reason, 'busted');
    assert.equal(g.police.bust, 1);
});

test('a pursuing cruiser closes a clear road instead of turning back toward a junction', () => {
    const g = makeGame();
    clearActors(g);
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
    const g = makeGame();
    clearActors(g);
    setWanted(g, 2);
    g.police.spawnTimer = 10000;
    step(g, 2400);
    assert.equal(g.police.stars, 0);
    assert.equal(g.police.heat, 0);
    assert.equal(g.stats.escapes, 1);
    const h = makeGame();
    clearActors(h);
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
    const g = makeGame();
    clearActors(g);
    g.player.x = 2370;
    g.player.y = 1429;
    g.player.h = 0;
    g.enemies = [
        { id: 500, x: 2460, y: 1429, h: Math.PI, hp: 50, maxHp: 50, dead: false, role: 'rival', home: { x: 2460, y: 1429 }, cooldown: 100, aggro: 0, flash: 0 }
    ];
    g.police.spawnTimer = 10000;
    pressKey(g,'MouseLeft');
    step(g,19);
    assert.equal(g.stats.shots,1);
    pressKey(g,'MouseLeft');
    step(g,35);
    assert.ok(g.player.ammo < 36);
    assert.equal(g.enemies[0].dead, true);
    assert.ok(g.world.pickups.some(p => p.kind === 'cash'));
    assert.ok(g.stats.reputation >= 100);
    const h = makeGame();
    clearActors(h);
    h.player.x = 2370;
    h.player.y = 1429;
    h.player.h = 0;
    h.enemies = [
        { id: 501, x: 2394, y: 1429, h: 0, hp: 25, maxHp: 25, role: 'rival', dead: false, flash: 0, cooldown: 100, home: { x: 2394, y: 1429 } }
    ];
    pressKey(h, 'KeyF');
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
    const g = makeGame();
    clearActors(g);
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
    const g = makeGame();
    clearActors(g);
    const s = g.world.services.find(s => s.kind === 'garage');
    const c = makeCar('sports', s.x, s.y, 0, P.magenta);
    g.cars = [c];
    g.player.car = c;
    g.player.x = s.x;
    g.player.y = s.y;
    c.hp = 20;
    pressKey(g, 'KeyR');
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
    const g = makeGame();
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
    const g = makeGame();
    const events = [];
    installMission(g, {
        objective: 'Drive to the garage.',
        marker: { x: 1214, y: 2060 },
        onEvent: e => events.push(e.type),
        update(dt, game) {
            this.objective = 'Keep rolling.';
        }
    });
    useCarDoor(g);
    assert.ok(events.includes('enterCar'));
    assert.ok(events.includes('tick'));
    assert.equal(g.mission.objective, 'Keep rolling.');
    assert.equal(g.mission.marker.x, 1214);
});

test('render paths execute for on foot, driving, police, map, dusk and defeat', () => {
    const g = makeGame();
    const r = new Renderer(canvas, g.world);
    r.render(g);
    useCarDoor(g);
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
    const menu = action => screen.fire('click', { target: { closest: () => ({ dataset: { action } }) } });
    let timestamp = performance.now();
    const key = code => {
        window.fire('keydown', { code, preventDefault: noop });
        pendingFrame(timestamp += 20);
        window.fire('keyup', { code });
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
    canvas.fire('mousedown', { button: 0, clientX: r.x + r.w / 2, clientY: r.y + r.h / 2 });
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
        setValueAtTime(value) {
            assert.ok(Number.isFinite(value));
            this.value = value;
        }
        exponentialRampToValueAtTime(value) {
            assert.ok(value > 0 && Number.isFinite(value));
            this.value = value;
        }
        setTargetAtTime(value) {
            assert.ok(Number.isFinite(value));
            this.value = value;
        }
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
        createBuffer(channels, size) {
            const data = new Float32Array(size);
            return { getChannelData: () => data };
        }
    };
    try {
        const a = new Audio();
        const g = makeGame();
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
        for (let i = 0; i < 80; i++) {
            a.ctx.currentTime += 0.1;
            a.update(g, 0.1, true);
        }
        assert.ok(a.beat > 24);
        a.toggle();
        assert.equal(a.master.gain.value, 0);
        a.update(g, 0.1, false);
        assert.equal(a.engineGain.gain.value, 0);
        assert.equal(a.sirenGain.gain.value, 0);
    } finally {
        delete window.AudioContext;
    }
});

test('two minutes of city simulation remain finite, bounded and deterministic', () => {
    function run() {
        const g = makeGame(92);
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
        return {cars:g.cars, peds:g.peds, enemies:g.enemies, player:g.player,
            police:g.police, stats:g.stats, pickups:g.world.pickups, clock:g.clock};
    }
    assert.deepEqual(run(), run());
});

test('story progression, briefings, timer failure, retry and saved rewards', () => {
    const g = makeGame();
    assert.equal(startMission(g, 'm3'), false);
    assert.ok(startMission(g, 'm1'));
    const cash = g.player.cash;
    step(g, 120);
    assert.equal(g.mission.active.remaining, 90, 'briefing freezes the deadline');
    advanceDialogue(g);
    useCarDoor(g);
    assert.equal(g.player.car, g.mission.active.target);
    holdKey(g, 'KeyW', 20);
    assert.ok(g.stats.distance > 0);
    g.mission.active.elapsed = 90;
    step(g);
    assert.equal(g.mode, 'mission-failed');
    assert.equal(g.player.cash, cash);
    assert.ok(startMission(g, 'm1'));
    advanceDialogue(g);
    useCarDoor(g);
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
    const g = makeGame();
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
    const g = makeGame();
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
        for (let i = 0; i < 3; i++) {
            Object.assign(g.player, { x: e.x - 24, y: e.y, h: 0 });
            pressKey(g, 'KeyF');
            step(g, 28);
        }
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
    useCarDoor(g);
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
    const menu = action => screen.fire('click', { target: { closest: () => ({ dataset: { action } }) } });
    const g = makeGame();
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
        const g = makeGame();
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
        let ticks = 0;
        let now = performance.now();
        while (!window.__shotReady && ticks++ < 100) pendingFrame(now += 1000 / 60);
        assert.ok(window.__shotReady, name);
        assert.equal(window.__neon.game.capture, true);
        assert.equal(window.__neon.game.mode, 'play');
        assert.equal(window.__neon.game.saveError, false);
    }
});

test('cab dispatch boards a real waiting pedestrian, pauses on the map and pays one fare', () => {
    const g = makeGame();
    const passenger = g.peds.find(p => !p.dead);
    g.peds = [passenger];
    const cab = makeCar('taxi', passenger.x + 70, passenger.y, 0, P.taxi);
    g.cars = [cab];
    g.player.car = cab;
    const cash = g.player.cash;
    pressKey(g, 'KeyT');
    const fare = g.fare;
    assert.equal(fare.passenger, passenger);
    assert.equal(g.mission.marker, passenger);
    assert.equal(passenger.hailing, true);
    g.mapOpen = true;
    const remaining = fare.remaining;
    step(g, 120);
    assert.equal(fare.remaining, remaining);
    g.mapOpen = false;
    Object.assign(cab, { x: passenger.x + 5, y: passenger.y });
    step(g);
    assert.equal(passenger.inCab, true);
    assert.equal(g.mission.marker, fare.stop);
    assert.equal(fare.stage, 'dropoff');
    Object.assign(cab, { x: fare.stop.x, y: fare.stop.y });
    step(g, 2);
    assert.equal(g.fare, null);
    assert.equal(g.mission.marker, null);
    assert.equal(passenger.inCab, false);
    assert.equal(g.player.cash, cash + fare.payout);
    assert.equal(g.stats.reputation, 25);
    assert.equal(readSave().cash, g.player.cash);
});

test('a cab timeout, abandoned cab or story job releases the passenger without payment', () => {
    for (const reason of ['timeout', 'exit', 'job']) {
        const g = makeGame();
        const ped = g.peds[0];
        const cab = makeCar('taxi', ped.x, ped.y, 0, P.taxi);
        g.cars = [cab]; g.player.car = cab; g.peds = [ped];
        pressKey(g, 'KeyT');
        const fare = g.fare;
        assert.ok(fare);
        const cash = g.player.cash;
        if (reason === 'timeout') fare.remaining = 0;
        if (reason === 'exit') useCarDoor(g);
        if (reason === 'job') startMission(g, 'm1');
        step(g);
        assert.equal(g.fare, null);
        assert.equal(!!ped.inCab, false);
        assert.equal(ped.hailing, false);
        assert.equal(g.player.cash, cash);
        if (reason === 'job') assert.equal(g.mission.active.id, 'm1');
    }
});

test('ten accessible Neon Tapes pay cash and reputation once, persist, and load from legacy saves', () => {
    const g = makeGame(92);
    g.cars = []; g.peds = []; g.enemies = [];
    const tapes = g.world.pickups.filter(p => p.kind === 'tape');
    assert.equal(tapes.length, 10);
    assert.equal(new Set(tapes.map(t => t.id)).size, 10);
    const cash = g.player.cash;
    for (const tape of tapes) {
        assert.equal(isSolid(g.world, tape.x, tape.y, 7), false);
        Object.assign(g.player, { x: tape.x, y: tape.y });
        step(g, 2);
        assert.equal(tape.active, false);
    }
    const save = readSave();
    assert.equal(save.cash, cash + 750);
    assert.equal(save.reputation, 500);
    const restored = createGame(1706, save);
    assert.equal(restored.tapes.size, 10);
    assert.ok(restored.world.pickups.filter(p => p.kind === 'tape').every(t => !t.active));
    const legacy = { version: 1, cash: 123, unlockedCars: ['sports'] };
    store.set('neon-bay-nights.v1', JSON.stringify(legacy));
    const old = createGame(1706, readSave());
    assert.equal(old.tapes.size, 0);
    assert.ok(old.unlockedCars.has('sports'));
    assert.equal(old.stats.reputation, 0);
});

test('garage charges once, keeps previous titles, and retrieves a single car safely', async () => {
    const { collectGarageCar } = await import('../game/src/player.js');
    const g = makeGame();
    clearActors(g);
    Object.assign(g.player, JOB_POINTS.garage);
    pressKey(g, 'KeyG');
    assert.equal(g.mode, 'garage');
    assert.equal(collectGarageCar(g, 'sports'), false);
    assert.equal(g.player.cash, 350);
    assert.equal(collectGarageCar(g, 'sedan'), true);
    assert.equal(g.player.cash, 50);
    const car = g.player.car;
    assert.ok(car.owned);
    assert.ok(readSave().unlockedCars.includes('sedan'));
    g.player.car = null;
    assert.equal(collectGarageCar(g, 'sedan'), true);
    assert.equal(g.player.car, car);
    assert.equal(g.cars.length, 1);
    assert.equal(g.player.cash, 50);
    assert.equal(isSolid(g.world, car.x, car.y, 17), false);
});

test('four and five stars dispatch bounded reinforcements and retire them after an escape', () => {
    for (const stars of [4, 5]) {
        const g = makeGame();
        clearActors(g);
        const car = makeCar('sports', 2560, 1408, 0, P.magenta);
        g.cars = [car]; g.player.car = car;
        setWanted(g, stars);
        step(g, 60 * 22);
        assert.equal(g.police.units.length, stars);
        for(const unit of g.police.units) assert.ok(Number.isFinite(unit.car.h));
        setWanted(g, 0);
        step(g, 60 * 8);
        assert.equal(g.police.units.length, 0);
    }
});

test('Rosa’s after-hours visit follows the fifth job and survives Continue', () => {
    const g = makeGame();
    g.mission.completed = MISSIONS.map(m => m.id);
    step(g);
    assert.equal(g.mission.marker, JOB_POINTS.diner);
    Object.assign(g.player, JOB_POINTS.diner, {health: 60});
    step(g);
    assert.equal(g.player.health, 100);
    assert.equal(g.rosaVisit, true);
    assert.equal(g.mission.marker, null);
    const restored = createGame(1706, readSave());
    step(restored);
    assert.equal(restored.mission.marker, null);
    assert.equal(restored.rosaVisit, true);
});

test('distance-driven gait covers one stride per cycle at each gear for ten seconds', async () => {
    const {makeGait, updateGait} = await import('../game/src/locomotion.js');
    for (const speed of [34, 64, 107, 172]) {
        const gait = makeGait();
        const cadence = (62 * Math.sqrt(speed / 16) + 24) / 60;
        const stride = 2 * speed / cadence;
        for (let i = 0; i < 600; i++) updateGait(gait, {speed, distance:speed/60}, 1/60);
        const cycles = gait.phase / (2 * Math.PI);
        assert.ok(Math.abs((10 * speed / cycles) / stride - 1) < .05);
        assert.ok(Math.abs(gait.phase / 10 / (Math.PI * cadence) - 1) < .05);
        if (speed === 34) assert.ok(Math.abs(9 / (Math.PI * cadence) - 1) > .5);
        const phase = gait.phase;
        updateGait(gait, {speed, distance:0}, 1/60);
        assert.equal(gait.phase, phase, 'pushing against a wall cannot advance a stride');
    }
});

test('jump preserves horizontal momentum, freezes phase, and lands after 39 ticks', () => {
    const g=makeGame();clearActors(g);
    const p=g.player;
    Object.assign(p,{x:2778,y:1800,h:-Math.PI/2});
    holdKey(g,'KeyW',100);
    const phase=p.gait.phase, ammo=p.ammo, speed=p.speed;
    pressKey(g,'Space');
    assert.ok(p.z>0);
    g.input.pressed.add('MouseLeft');
    g.input.keys.add('KeyS');
    step(g,18);
    assert.ok(Math.abs(p.z-20)<.1);
    assert.ok(Math.abs(p.speed-speed*.9)<.01);
    assert.equal(p.gait.phase,phase);
    assert.equal(p.ammo,ammo);
    step(g,20);
    assert.equal(p.z,0);assert.equal(p.vz,0);
    assert.ok(p.landing>0);
    assert.ok(g.particles.some(effect=>effect.kind==='dust'));
});

test('door timing commits theft once and a wreck during entry cancels it', () => {
    const g=makeGame();const c=g.cars.find(c=>c.type==='sports'&&Math.hypot(c.x-g.player.x,c.y-g.player.y)<52);
    pressKey(g,'KeyE');step(g,28);
    assert.equal(g.player.car,null);assert.equal(g.stats.stolen,0);
    assert.equal(g.player.transition.car,c);
    damageCar(g,c,200);step(g);
    assert.equal(g.player.transition,null);assert.equal(g.stats.stolen,0);
    const h=makeGame();
    pressKey(h,'KeyE');step(h,47);
    assert.equal(h.player.car,null);
    step(h);assert.equal(h.player.car?.type,'sports');
    assert.equal(h.stats.stolen,1);
    step(h,37);pressKey(h,'KeyE');step(h,35);
    assert.equal(h.player.transition.kind,'exit');step(h);
    assert.equal(h.player.transition,null);assert.equal(h.player.car,null);
});

test('right button holds aim, movement strafes, and a fast left click survives mouseup', () => {
    const g=makeGame();clearActors(g);
    Object.assign(g.player,{x:2778,y:1800,h:0});
    g.screenToWorld=()=>({x:g.player.x+100,y:g.player.y});
    canvas.fire('pointermove',{clientX:200,clientY:150});step(g);assert.equal(g.player.armed,false);
    canvas.fire('mousedown',{button:2,clientX:200,clientY:150});
    g.input.keys.add('ShiftLeft');holdKey(g,'KeyA',120);
    assert.ok(Math.abs(g.player.speed-64*.55*.8)<.01);
    assert.equal(g.player.stamina,1);assert.equal(g.player.h,0);
    canvas.fire('mousedown',{button:0,clientX:200,clientY:150});
    window.fire('mouseup',{button:0});step(g);
    assert.equal(g.stats.shots,1);assert.ok(g.player.recoil>0);assert.ok(g.player.armed);
    window.fire('mouseup',{button:2});step(g);assert.equal(g.player.armed,false);
});

test('close-range click alternates fists and freezes translation during hit-stop', () => {
    const g=makeGame();clearActors(g);
    const p=g.player;Object.assign(p,{x:2778,y:1800,h:0});
    g.enemies=[{id:501,x:2800,y:1800,h:0,hp:75,role:'rival',cooldown:100,home:{x:2800,y:1800}}];
    g.input.pressed.add('MouseLeft');step(g);
    assert.equal(g.enemies[0].hp,50);assert.equal(p.hitStop,.06);assert.equal(p.punchLeft,true);
    const x=p.x;holdKey(g,'KeyD',3);assert.equal(p.x,x);assert.equal(p.ammo,36);
    step(g,25);g.input.pressed.add('MouseLeft');step(g);
    assert.equal(p.punchLeft,false);assert.equal(g.enemies[0].hp,25);
});

test('stamina exhaustion holds the jog cap until thirty percent recovery', () => {
    const g=makeGame();clearActors(g);
    const p=g.player;Object.assign(p,{x:2778,y:2550,h:-Math.PI/2});
    g.input.keys.add('ShiftLeft');holdKey(g,'KeyW',753);
    assert.ok(p.exhausted);assert.ok(p.stamina<.02);
    holdKey(g,'KeyW',100);
    assert.ok(p.exhausted);assert.ok(p.speed<65);assert.ok(p.stamina<.30);
    holdKey(g,'KeyW',90);
    assert.equal(p.exhausted,false);assert.ok(p.speed>160);
});

test('the articulated player and crowd rigs pose independent joints and share outfit geometry', async () => {
    const {buildPersonRig,poseRig}=await import('../game/src/rig.js');
    const {makeGait,updateGait,solvePose}=await import('../game/src/locomotion.js');
    const opts={player:true},model=buildPersonRig(opts),other=buildPersonRig(opts);
    assert.equal(model.userData.mesh.geometry,other.userData.mesh.geometry);
    assert.notEqual(model.userData.bones.kneeL,other.userData.bones.kneeL);
    const gait=makeGait();
    for(let i=0;i<120;i++)updateGait(gait,{speed:172,distance:172/60,turn:.6},1/60);
    gait.phase=Math.PI*1.5;
    const pose=solvePose(gait);poseRig(model,pose);
    const b=model.userData.bones;
    assert.ok(Math.abs(b.kneeL.rotation.z-b.kneeR.rotation.z)>1.4);
    assert.ok(b.torso.rotation.z<-.2);
    assert.ok(b.head.rotation.y<0);
    assert.equal(b.kneeL.parent,b.thighL);
    assert.equal(b.ankleR.parent,b.kneeR);
    assert.ok(model.userData.mesh.geometry.attributes.position.array.every(Number.isFinite));
    assert.equal(other.userData.bones.kneeL.rotation.z,0);
    const crowd=buildPersonRig({officer:true}),seed=makeGait(3001);
    poseRig(crowd,solvePose(seed,{armed:true}),true);
    assert.equal(crowd.userData.gun.visible,true);
    assert.equal(crowd.userData.mesh.geometry,crowd.userData.lod);
    assert.notEqual(makeGait(3002).phase,seed.phase);
});

test('standing player, civilians and officers share adult proportions at both detail levels', async () => {
    const {buildPersonRig, poseRig} = await import('../game/src/rig.js');
    const {makeGait, solvePose} = await import('../game/src/locomotion.js');
    const {Vector3} = await import('../game/vendor/three.module.min.js');
    for (const options of [{player:true}, {style:1}, {style:2}, {officer:true}]) {
        const rig = buildPersonRig(options);
        const {bones, mesh} = rig.userData;
        const headIndex = mesh.skeleton.bones.indexOf(bones.head);
        for (const distant of [false, true]) {
            poseRig(rig, solvePose(makeGait()), distant);
            rig.updateMatrixWorld(true);
            let floor = Infinity, crown = -Infinity, chin = Infinity;
            const vertex = new Vector3();
            const {position, skinIndex} = mesh.geometry.attributes;
            for (let i = 0; i < position.count; i++) {
                mesh.getVertexPosition(i, vertex);
                floor = Math.min(floor, vertex.y);
                crown = Math.max(crown, vertex.y);
                if (skinIndex.getX(i) === headIndex) chin = Math.min(chin, vertex.y);
            }
            const height = crown - floor;
            const head = (crown - chin) / height;
            const leg = (bones.thighL.matrixWorld.elements[13] - bones.ankleL.matrixWorld.elements[13]) / height;
            assert.ok(Math.abs(floor) < .11 && Math.abs(height - 28) < .5, `floor ${floor}, height ${height}`);
            assert.ok(head >= 1/8.5 && head <= 1/6.5, `head/height ${head}`);
            assert.ok(leg >= .45 && leg <= .55, `leg/height ${leg}`);

            // At full knee flexion the foot beside the car must still touch the road.
            poseRig(rig, solvePose(makeGait(), {transition:{kind:'exit', time:.05}}), distant);
            rig.updateMatrixWorld(true);
            let crouchingFloor = Infinity;
            for (let i = 0; i < position.count; i++) {
                crouchingFloor = Math.min(crouchingFloor, mesh.getVertexPosition(i, vertex).y);
            }
            assert.ok(Math.abs(crouchingFloor) < .11, `door crouch floor ${crouchingFloor}`);
        }
    }
});

test('all six wheel sets sit on the road and roll by their configured circumference', async () => {
    const {buildCar, poseCar} = await import('../game/src/art.js');
    const {CARS} = await import('../game/src/config.js');
    for (const [type, spec] of Object.entries(CARS)) {
        const car = buildCar(type, '#ec4892');
        const {radius, tyres, model} = car.userData;
        assert.equal(radius, spec.wheelRadius);
        assert.equal(radius, type === 'sports' ? 5 : 5.6);
        poseCar(car, {type, color:'#ec4892', travel:Math.PI*radius, steer:0}, 0, true);
        for (const tyre of tyres) {
            assert.equal(tyre.position.y, radius);
            assert.ok(Math.abs(Math.abs(tyre.rotation.z)-Math.PI)<1e-8);
            assert.ok(Math.abs(tyre.position.z)+1.17>spec.width/2);
        }
        for (const geometry of [model.medium, model.distant]) {
            geometry.computeBoundingBox();
            assert.ok(Math.abs(geometry.boundingBox.min.y)<1e-4);
        }
    }
});

test('seeded streets have varied parking, curb puddles and distinct neighboring rooflines', () => {
    const game=makeGame(), world=game.world;
    const storefronts=world.buildings.filter(b=>b.kind==='shop' && b.height>=44);
    const homes=world.buildings.filter(b=>b.kind==='hotel'||b.kind==='shop' && b.district!=='Marlin Wharf');
    const share=(list,key)=>list.filter(b=>b[key]).length/list.length;
    assert.ok(share(storefronts,'setback')>=.15 && share(storefronts,'setback')<=.25);
    assert.ok(share(homes,'balconies')>=.2 && share(homes,'balconies')<=.3);
    for(const b of world.buildings)for(const other of world.buildings.slice(0,b.id)){
        const dx=Math.max(b.x-other.x-other.w,other.x-b.x-b.w,0);
        const dy=Math.max(b.y-other.y-other.h,other.y-b.y-b.h,0);
        if(Math.hypot(dx,dy)<210)assert.notEqual(b.height,other.height);
    }
    assert.equal(world.props.filter(p=>p.kind==='puddle').length,24);
    for(const n of world.nodes.filter(n=>n.j===0))for(const side of [-46,46]){
        const curb=game.cars.filter(c=>c.ai==='parked' && c.x===n.x+side).sort((a,b)=>a.y-b.y);
        for(let i=1;i<curb.length;i++)assert.notEqual(curb[i].color,curb[i-1].color);
    }
    for(const n of world.nodes.filter(n=>n.j<6)){
        const row=game.cars.filter(c=>c.ai==='parked' && Math.abs(c.x-n.x)===46 &&
            [103,150,219,278].includes(c.y-n.y));
        assert.equal(row.length,4);
        assert.equal(new Set(row.map(c=>c.color)).size,4);
        assert.ok(new Set(row.map(c=>c.type)).size>=3);
    }
});
