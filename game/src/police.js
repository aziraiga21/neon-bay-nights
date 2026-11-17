import { PALETTE as P, TUNE, clamp, angleDelta, dist } from './config.js';
import { nearestNode, route, lineClear, moveCircle } from './world.js';
import { makeCar } from './vehicles.js';
import { missionEvent } from './missions.js';
export function makePolice() {
    return {
        heat: 0, stars: 0, units: [], officers: [], lastSeen: null, seen: false, hiddenFor: 0, bust: 0, spawnTimer: 3, crimeCooldown: {}, knownCar: null, peak: 0, searching: false
    };
}
function witnesses(game, point) {
    const cars = game.cars.filter(c => c.type === 'police' && !c.wreck && c !== game.player.car);
    for (const c of cars) {
        const d = dist(c, point);
        if (d < 450 && lineClear(game.world, c, point)) {
            return true;
        }
    }
    return game.police.officers.some(o => !o.dead && dist(o, point) < 330 && lineClear(game.world, o, point));
}
export function reportCrime(game, type, amount, point, reported) {
    const pol = game.police, now = game.time;
    if ((pol.crimeCooldown[type] || 0) > now) {
        return;
    }
    if (!reported && !witnesses(game, point)) {
        return;
    }
    pol.crimeCooldown[type] = now + (type === 'gunfire' ? 1.4 : type === 'hit and run' ? 1 : 2);
    pol.heat = clamp(pol.heat + amount, 0, 22);
    pol.hiddenFor = 0;
    pol.lastSeen = { x: point.x, y: point.y };
    pol.knownCar = game.player.car?.id ?? null;
    const old = pol.stars;
    pol.stars = heatStars(pol.heat);
    if (pol.stars > old) {
        game.audio.play('wanted');
        game.notify('NEON BAY PD · DISPATCH', `${pol.stars}-star alert. Break their line of sight.`, P.policeRed);
        pol.spawnTimer = Math.min(.6, pol.spawnTimer);
    }
    pol.peak = Math.max(pol.peak, pol.stars);
    missionEvent(game, 'crime', { crime: type, stars: pol.stars });
}
function heatStars(heat) {
    let stars = 0;
    for (let i = 1; i < TUNE.heatThresholds.length; i++) {
        if (heat >= TUNE.heatThresholds[i]) {
            stars = i;
        }
    }
    return stars;
}
function spawnUnit(game) {
    const p = game.player, rng = game.rng;
    const candidates = game.world.nodes.filter(n => dist(n, p) > 620 && dist(n, p) < 1150);
    if (!candidates.length) {
        return;
    }
    const inRoad = candidates.filter(n => Math.abs(n.x - p.x) < 80 || Math.abs(n.y - p.y) < 80);
    const n = rng.pick(inRoad.length ? inRoad : candidates);
    const h = Math.atan2(p.y - n.y, p.x - n.x);
    const c = makeCar('police', n.x, n.y + 21, h, P.pearl, 'police');
    c.driver = true;
    c.speed = 90;
    const unit = {
        car: c, path: [], repath: 0, deployed: false, retire: 0
    };
    game.cars.push(c);
    game.police.units.push(unit);
}
export function updatePolice(game, dt) {
    const pol = game.police, p = game.player;
    if (pol.stars === 0 && pol.heat > 0) {
        pol.heat = Math.max(0, pol.heat - dt * .12);
    }
    let visible = false;
    const officers = pol.officers.filter(o => !o.dead);
    for (const c of game.cars) {
        if (c.type !== 'police' || c === p.car || c.wreck || (!c.driver && c.ai === 'parked')) {
            continue;
        }
        let range = c.ai === 'police' ? 490 : 360;
        if (pol.stars > 0 && p.car && p.car.id !== pol.knownCar) {
            range = 145;
        }
        if (dist(c, p) < range && lineClear(game.world, c, p)) {
            visible = true;
        }
        if (p.car && Math.abs(p.car.speed) > 300 && dist(c, p) < 240 && lineClear(game.world, c, p)) {
            reportCrime(game, 'reckless driving', 1.1, p, true);
        }
    }
    for (const o of officers) {
        if (dist(o, p) < 330 && lineClear(game.world, o, p)) {
            visible = true;
        }
    }
    pol.seen = pol.stars > 0 && visible;
    if (pol.stars > 0) {
        if (visible) {
            pol.lastSeen = { x: p.x, y: p.y };
            pol.hiddenFor = 0;
            pol.knownCar = p.car?.id ?? null;
        }
        else {
            pol.hiddenFor += dt;
            if (pol.hiddenFor > TUNE.loseSight) {
                pol.heat = Math.max(0, pol.heat - dt * (.6 + pol.hiddenFor * .025));
                const next = heatStars(pol.heat);
                if (next < pol.stars) {
                    pol.stars = next;
                    if (next === 0) {
                        pol.heat = 0;
                        game.audio.play('escape');
                        game.notify('YOU LOST THEM', `+${pol.peak * 120} reputation · Keep a low profile.`, P.teal);
                        game.stats.reputation += pol.peak * 120;
                        game.stats.escapes++;
                        missionEvent(game, 'wantedCleared', { peak: pol.peak });
                        pol.peak = 0;
                        game.save();
                    }
                }
            }
        }
        pol.searching = !visible;
        pol.spawnTimer -= dt;
        const max = Math.min(6, pol.stars + 1);
        if (pol.spawnTimer <= 0 && pol.units.filter(u => !u.car.wreck).length < max) {
            spawnUnit(game);
            pol.spawnTimer = Math.max(2.8, 7 - pol.stars);
        }
    }
    else {
        pol.searching = false;
        pol.hiddenFor = 0;
    }
    for (const u of pol.units) {
        const c = u.car;
        if (c === p.car) {
            continue;
        }
        if (c.wreck) {
            continue;
        }
        if (pol.stars === 0) {
            if (c.ai !== 'patrol') {
                c.ai = 'patrol';
                c.cruise = 94;
                c.route = null;
            }
            u.retire += dt;
            continue;
        }
        c.ai = 'police';
        const goal = pol.lastSeen || p;
        const d = dist(c, p);
        let target = goal;
        const clear = lineClear(game.world, c, goal);
        if (!clear) {
            u.repath -= dt;
            if (u.repath <= 0 || !u.path.length) {
                const start = nearestNode(game.world, c.x, c.y), end = nearestNode(game.world, goal.x, goal.y);
                u.path = route(game.world, start.id, end.id);
                if (dist(c, start) < 85) {
                    u.path.shift();
                }
                u.repath = 1.5;
            }
            if (u.path.length) {
                target = u.path[0];
                if (dist(c, target) < 48) {
                    u.path.shift();
                    target = u.path[0] || goal;
                }
            }
        }
        else {
            u.path = [];
        }
        const lead = visible && p.car ? Math.min(.45, d / 800) : 0;
        const tx = target.x + (target === goal ? (p.car?.vx || 0) * lead : 0), ty = target.y + (target === goal ? (p.car?.vy || 0) * lead : 0);
        const wantedAngle = Math.atan2(ty - c.y, tx - c.x), delta = angleDelta(c.h, wantedAngle);
        c.steer = clamp(delta * 2.6, -1, 1);
        const desired = d < 90 && !p.car ? 15 : Math.abs(delta) > 1 ? 85 : Math.abs(delta) > .5 ? 150 : 245 + pol.stars * 17;
        c.throttle = c.speed < desired ? 1 : 0;
        c.braking = c.speed > desired + 15;
        c.handbrake = false;
        // Back out physically when a ram or a tight corner leaves the cruiser stuck.
        u.stuck = Math.abs(c.speed) < 10 && c.throttle > 0 ? (u.stuck || 0) + dt : 0;
        if (u.stuck > 1.4) {
            u.reverse = .8;
            u.stuck = 0;
            u.repath = 0;
        }
        u.reverse = Math.max(0, (u.reverse || 0) - dt);
        if (u.reverse > 0) {
            c.throttle = -1;
            c.braking = false;
            c.steer = -Math.sign(delta || 1);
        }
        if (!p.car && d < 150 && clear && !u.deployed && pol.officers.filter(o => !o.dead).length < 6) {
            u.deployed = true;
            const x = c.x - Math.sin(c.h) * 30, y = c.y + Math.cos(c.h) * 30;
            if (!game.world.buildings.some(b => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h)) {
                pol.officers.push({
                    id: 800 + c.id, x, y, h: c.h, hp: 90, role: 'officer', skin: '#C48A62', hair: P.ink, jacket: P.navy, dead: false, armed: true, cooldown: 1.4, moving: true, flash: 0
                });
            }
        }
    }
    for (const o of officers) {
        if (pol.stars === 0) {
            o.moving = false;
            continue;
        }
        const target = pol.lastSeen || p, dx = target.x - o.x, dy = target.y - o.y, d = Math.hypot(dx, dy);
        o.h = Math.atan2(dy, dx);
        o.moving = d > 19;
        if (d > 19) {
            moveCircle(game.world, o, dx / d * (pol.stars >= 3 ? 100 : 92) * dt, dy / d * (pol.stars >= 3 ? 100 : 92) * dt, 7);
        }
    }
    let busting = false;
    if (pol.stars > 0 && !p.car) {
        for (const o of officers) {
            if (dist(o, p) < 33 && lineClear(game.world, o, p)) {
                busting = true;
            }
        }
    }
    if (pol.stars > 0 && p.car && Math.abs(p.car.speed) < 18) {
        for (const c of game.cars) {
            if (c.type === 'police' && c !== p.car && !c.wreck && dist(c, p) < 55) {
                busting = true;
            }
        }
    }
    pol.bust = clamp(pol.bust + (busting ? .43 : -.5) * dt, 0, 1);
    if (pol.bust >= 1) {
        game.end('busted');
    }
    // Retire distant completed patrols so long sessions stay bounded.
    const retired = pol.units.filter(u => (u.retire > 18 || u.car.wreck) && dist(u.car, p) > 1100);
    if (retired.length) {
        const ids = new Set(retired.map(u => u.car.id));
        pol.units = pol.units.filter(u => !ids.has(u.car.id));
        game.cars = game.cars.filter(c => !ids.has(c.id));
    }
    if (pol.officers.length > 12) {
        pol.officers = pol.officers.filter(o => !o.dead && dist(o, p) < 1100);
    }
}
export function setWanted(game, stars) {
    game.police.heat = TUNE.heatThresholds[clamp(stars, 0, 5)] + .2;
    game.police.stars = stars;
    game.police.peak = stars;
    game.police.lastSeen = { x: game.player.x, y: game.player.y };
    game.police.knownCar = game.player.car?.id ?? null;
    game.police.spawnTimer = .1;
}
