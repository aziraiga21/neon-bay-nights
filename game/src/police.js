// Neon Bay Nights — Neon Bay PD: wanted heat, cruiser pursuit,
// foot officers, the bust meter, and losing the tail.
//
// Heat is the real number; stars are just the face it wears. Heat rises
// when a crime is seen and bleeds away only after the cops have lost
// sight of Jax for a while. Cruisers unlock at two stars, officers do
// the arresting on foot, and a fresh car the department has never seen
// buys Jax his clean getaway.
import { PALETTE as P, TUNE, clamp, angleDelta, dist } from './config.js';
import { nearestNode, route, lineClear, moveCircle, isSolid } from './world.js';
import {npcSpeed,finishNpcStep} from './locomotion.js';
import { makeCar } from './vehicles.js';

const SIGHT_CAR = 520;
const SIGHT_FOOT = 300;
const WITNESS_CAR = 320;
const WITNESS_FOOT = 260;
const MAX_UNITS = 5;
const OFFICER_SPEED = TUNE.run;
const BUST_RATE = 0.55;
const BUST_COOL = 0.25;
const HEAT_CREEP = 0.1;
const HEAT_BLEED = 0.5;
const SPAWN_FAR = 500;
const SPAWN_NEAR = 900;
const CHASE_DIRECT = 460;
const STOP_NEAR_FOOT = 120;
const DEPLOY_NEAR = 170;
const BUST_REACH = 24;
const MAX_HEAT = TUNE.heatThresholds[5] + 0.6;

// --- construction --------------------------------------------------------

export function makePolice() {
    return {
        stars: 0, heat: 0, seen: false, knownCar: -1,
        units: [], officers: [], spawnTimer: 0, bust: 0,
        unseen: 0, lastStars: 0
    };
}

function starsFor(heat) {
    let stars = 0;
    for (let i = 0; i < TUNE.heatThresholds.length; i++) {
        if (heat >= TUNE.heatThresholds[i]) stars = i;
    }
    return Math.min(5, stars);
}

// --- raising the heat ----------------------------------------------------

export function setWanted(game, stars) {
    const pol = game.police;
    const n = clamp(Math.round(stars) || 0, 0, 5);
    pol.heat = n === 0 ? 0 : TUNE.heatThresholds[n] + 0.05;
    pol.stars = n;
    pol.lastStars = n;
    pol.unseen = 0;
    pol.knownCar = game.player.car ? game.player.car.id : -1;
    if (n > 0) pol.spawnTimer = Math.min(pol.spawnTimer, 0.8);
}

// A crime only counts when the department can pin it on Jax: reported
// crimes always count, the rest need a cruiser or an officer with a
// clear line of sight to the scene.
export function reportCrime(game, type, amount, point, reported = false) {
    const pol = game.police;
    if (!pol || game.mode !== 'play') return;
    if (!reported && !witnessSeen(game, point || game.player)) return;
    pol.heat = Math.min(MAX_HEAT, pol.heat + amount);
    if (game.player.car) pol.knownCar = game.player.car.id;
    pol.seen = true;
    pol.unseen = 0;
    pol.spawnTimer = Math.min(pol.spawnTimer, 0.6);
    const next = starsFor(pol.heat);
    if (next > pol.stars) {
        pol.stars = next;
        pol.lastStars = next;
        game.audio.play('wanted');
        game.notify(`WANTED LEVEL ${next}`, crimeLine(type), P.policeRed);
    }
}

function crimeLine(type) {
    if (type === 'theft') return 'A cruiser saw the boost. Lose them.';
    if (type === 'gunfire') return 'Shots reported. NBPD is rolling.';
    if (type === 'officer down') return 'An officer is down. Every unit is coming.';
    if (type === 'ramming') return 'You rammed a cruiser. That was noticed.';
    return 'NBPD has your description.';
}

function witnessSeen(game, point) {
    for (const car of game.cars) {
        if (car.type !== 'police' || car === game.player.car || car.wreck) continue;
        if (dist(car, point) < WITNESS_CAR && lineClear(game.world, car, point)) return true;
    }
    for (const officer of game.police.officers) {
        if (officer.dead) continue;
        if (dist(officer, point) < WITNESS_FOOT && lineClear(game.world, officer, point)) return true;
    }
    return false;
}

// --- per-frame update ----------------------------------------------------

export function updatePolice(game, dt) {
    const pol = game.police;
    if (!pol || game.mode !== 'play') return;
    pol.seen = canSpotJax(game);
    trackHeat(game, dt);
    if (game.mode !== 'play') return;
    runDispatch(game, dt);
    steerUnits(game, dt);
    if (game.mode !== 'play') return;
    marchOfficers(game, dt);
}

// Can any cop actually see Jax right now? On foot he is always
// recognisable; behind the wheel only when the department knows the
// car he is driving.
function canSpotJax(game) {
    const pol = game.police;
    const p = game.player;
    const recognised = !p.car || pol.knownCar === p.car.id;
    if (!recognised) return false;
    for (const car of game.cars) {
        if (car.type !== 'police' || car === p.car || car.wreck) continue;
        if (dist(car, p) < SIGHT_CAR && lineClear(game.world, car, p)) return true;
    }
    for (const officer of pol.officers) {
        if (officer.dead) continue;
        if (dist(officer, p) < SIGHT_FOOT && lineClear(game.world, officer, p)) return true;
    }
    return false;
}

function trackHeat(game, dt) {
    const pol = game.police;
    if (pol.stars > 0 && pol.seen) {
        pol.unseen = 0;
        pol.heat = Math.min(MAX_HEAT, pol.heat + HEAT_CREEP * dt);
    } else {
        pol.unseen += dt;
        if (pol.unseen > TUNE.loseSight && pol.heat > 0) {
            pol.heat = Math.max(0, pol.heat - HEAT_BLEED * dt);
        }
    }
    const next = starsFor(pol.heat);
    if (next < pol.stars) pol.stars = next;
    if (pol.stars === 0 && pol.lastStars > 0) {
        game.stats.escapes += 1;
        game.audio.play('escape');
        game.notify('YOU LOST THEM', 'The stars went dark. Breathe, Jax.', P.mango);
    }
    pol.lastStars = pol.stars;
}

// --- dispatch ------------------------------------------------------------

function runDispatch(game, dt) {
    const pol = game.police;
    if (pol.stars <= 0) return;
    pol.spawnTimer -= dt;
    if (pol.spawnTimer > 0) return;
    if (pol.stars >= 2 && pol.units.length < Math.min(pol.stars, MAX_UNITS)) {
        sendCruiser(game);
        pol.spawnTimer = 4;
    } else if (pol.stars === 1 && !game.player.car
        && pol.officers.filter(o => !o.dead).length < 2) {
        sendOfficer(game);
        pol.spawnTimer = 6;
    } else {
        pol.spawnTimer = 3;
    }
}

function sendCruiser(game) {
    const p = game.player;
    let spot = null;
    let best = Infinity;
    for (const node of game.world.nodes) {
        const d = dist(node, p);
        if (d >= SPAWN_FAR && d <= SPAWN_NEAR && d < best
            && !game.cars.some(c => dist(c,node)<48)) {
            spot = node;
            best = d;
        }
    }
    if (!spot) {
        for (const node of game.world.nodes) {
            const d = dist(node, p);
            if (d > 400 && d < best && !game.cars.some(c => dist(c,node)<48)) {
                spot = node;
                best = d;
            }
        }
    }
    if (!spot) return;
    const heading = Math.atan2(p.y - spot.y, p.x - spot.x);
    const car = makeCar('police', spot.x, spot.y, heading, P.pearl, 'police');
    car.driver = true;
    game.cars.push(car);
    game.police.units.push({ car, path: [], repath: 0, deployed: false, retire: 0, officer: null });
}

function sendOfficer(game) {
    const p = game.player;
    for (let i = 0; i < 8; i++) {
        const a = game.rng.range(0, Math.PI * 2);
        const spot = { x: p.x + Math.cos(a) * 240, y: p.y + Math.sin(a) * 240 };
        if (isSolid(game.world, spot.x, spot.y, 8)) continue;
        game.police.officers.push({
            id: 3000 + game.police.officers.length,
            x: spot.x, y: spot.y, h: Math.atan2(p.y - spot.y, p.x - spot.x),
            hp: 90, dead: false, role: 'officer', jacket: P.navy,
            skin: '#C48A62', hair: P.ink, cooldown: 0, moving: true, flash: 0, punch: 0
        });
        return;
    }
}

// --- cruiser pursuit -----------------------------------------------------

function steerUnits(game, dt) {
    const pol = game.police;
    const p = game.player;
    for (let i = pol.units.length - 1; i >= 0; i--) {
        const unit = pol.units[i];
        const car = unit.car;
        if (car === p.car || car.wreck) {
            pol.units.splice(i, 1);
            continue;
        }
        if (pol.stars === 0) {
            unit.retire += dt;
            if ((unit.retire > 2.5 && dist(car, p) > 350) || unit.retire > 7) {
                game.cars = game.cars.filter(c => c !== car);
                pol.units.splice(i, 1);
            }
            continue;
        }
        unit.retire = 0;
        if (unit.officer && unit.officer.dead) {
            unit.officer = null;
            unit.deployed = false;
        }
        const d = dist(car, p);
        if (!p.car && d < STOP_NEAR_FOOT) {
            car.throttle = 0;
            car.braking = true;
            car.steer = 0;
            if (!unit.deployed) dropOfficer(game, unit);
            continue;
        }
        unit.repath -= dt;
        if (unit.repath <= 0 || unit.path.length === 0) {
            unit.path = route(game.world, nearestNode(game.world, car.x, car.y).id,
                nearestNode(game.world, p.x, p.y).id);
            unit.repath = 0.9;
        }
        // Drop junctions the cruiser has already rolled past, so it never
        // turns back toward a junction behind it on a straight chase.
        while (unit.path.length > 1) {
            const a = unit.path[0], b = unit.path[1];
            const abx = b.x - a.x, aby = b.y - a.y;
            const along = ((car.x - a.x) * abx + (car.y - a.y) * aby) / (abx * abx + aby * aby || 1);
            if (along > 0.15 || dist(car, a) < 42) unit.path.shift();
            else break;
        }
        const direct = d < CHASE_DIRECT && lineClear(game.world, car, p);
        const target = direct || unit.path.length === 0 ? p : unit.path[0];
        const delta = angleDelta(car.h, Math.atan2(target.y - car.y, target.x - car.x));
        car.steer = clamp(delta * 2.6, -1, 1);
        car.throttle = Math.abs(delta) < 1.4 ? 1 : 0.45;
        car.braking = Math.abs(delta) > 2.4 && Math.abs(car.speed) > 60;
    }
}

function dropOfficer(game, unit) {
    const car = unit.car;
    const officer = {
        id: 3000 + game.police.officers.length,
        x: car.x + 16, y: car.y + 10, h: Math.atan2(game.player.y - car.y, game.player.x - car.x),
        hp: 90, dead: false, role: 'officer', jacket: P.navy,
        skin: '#C48A62', hair: P.ink, cooldown: 0, moving: true, flash: 0, punch: 0
    };
    game.police.officers.push(officer);
    unit.officer = officer;
    unit.deployed = true;
}

// --- officers on foot ----------------------------------------------------

function marchOfficers(game, dt) {
    const pol = game.police;
    const p = game.player;
    let closing = false;
    for (let i = pol.officers.length - 1; i >= 0; i--) {
        const officer = pol.officers[i];
        if (officer.dead) continue;
        const x=officer.x,y=officer.y;
        if (pol.stars === 0) {
            officer.leaving = (officer.leaving || 0) + dt;
            const away = Math.atan2(officer.y - p.y, officer.x - p.x);
            officer.h = away;
            const step=npcSpeed(officer,TUNE.walk,dt)*dt;
            moveCircle(game.world,officer,Math.cos(away)*step,Math.sin(away)*step,7);
            finishNpcStep(officer,x,y,dt);
            if (officer.leaving > 5 || dist(officer, p) > 800) pol.officers.splice(i, 1);
            continue;
        }
        const angle = Math.atan2(p.y - officer.y, p.x - officer.x);
        officer.h = angle;
        const remaining = dist(officer,p);
        const speed = npcSpeed(officer, remaining > 1 ? OFFICER_SPEED : 0, dt);
        const step = Math.min(remaining, speed*dt);
        moveCircle(game.world,officer,Math.cos(angle)*step,Math.sin(angle)*step,7);
        finishNpcStep(officer,x,y,dt);
        const d = dist(officer, p);
        if (!p.car && d < BUST_REACH) {
            closing = true;
            pol.bust = Math.min(1, pol.bust + BUST_RATE * dt);
            if (pol.bust >= 1) {
                game.end('busted');
                return;
            }
        }
    }
    if (!closing) pol.bust = Math.max(0, pol.bust - BUST_COOL * dt);
}
