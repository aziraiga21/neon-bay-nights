import { CARS, CAR_COLORS, PALETTE as P, ROADS_X, ROADS_Y, WORLD, clamp, angleDelta, dist } from './config.js';
import { nearestNode, moveCircle, signalGreen, lineClear, isSolid, roadDistance } from './world.js';
import { missionEvent } from './missions.js';
let nextId = 1;
export function makeCar(type, x, y, h, color, ai = 'parked') {
    return {
        id: nextId++, type, x, y, h, color: color || (type === 'police' ? P.pearl : type === 'taxi' ? P.taxi : P.teal), ai, vx: 0, vy: 0, speed: 0, hp: CARS[type].hp, wreck: false, driver: ai === 'traffic' || ai === 'patrol', ambient: ai === 'traffic', stillTime: 0, throttle: 0, steer: 0, braking: false, impactCooldown: 0, smokeTimer: 0, route: null, stolen: false, evacuated: false, travel: 0
    };
}
export function populateVehicles(game) {
    nextId = 1;
    const { rng, world } = game, cars = [];
    for (let i = 0; i < 50; i++) {
        const n = rng.pick(world.nodes), dest = world.nodes[rng.pick(n.links)];
        const h = Math.atan2(dest.y - n.y, dest.x - n.x), t = rng.range(.22, .78), nx = -Math.sin(h) * WORLD.lane, ny = Math.cos(h) * WORLD.lane;
        const type = rng.pick(['sedan', 'sedan', 'sports', 'taxi', 'van']);
        const c = makeCar(type, n.x + (dest.x - n.x) * t + nx, n.y + (dest.y - n.y) * t + ny, h, rng.pick(CAR_COLORS), 'traffic');
        c.speed = rng.range(65, 105);
        c.route = { from: n.id, to: dest.id };
        c.cruise = rng.range(82, 133);
        cars.push(c);
    }
    for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 7; i++) {
            const x = ROADS_X[i] + (j % 2 ? -46 : 46), y = ROADS_Y[j] + 150;
            const type = rng.pick(['sedan', 'sedan', 'sports', 'taxi', 'van']);
            const c = makeCar(type, x, y, j % 2 ? -Math.PI / 2 : Math.PI / 2, rng.pick(CAR_COLORS));
            cars.push(c);
        }
    }
    // A clear first ride, parked outside Rosa’s, makes the first interaction immediate.
    cars.push(makeCar('sports', 2508, 1370, 0, P.magenta));
    cars.push(makeCar('van', 1210, 2137, 0, P.carMint));
    for (const n of [world.nodes[17], world.nodes[32]]) {
        const dest = world.nodes[n.links[0]], h = Math.atan2(dest.y - n.y, dest.x - n.x);
        const c = makeCar('police', n.x - Math.sin(h) * WORLD.lane, n.y + Math.cos(h) * WORLD.lane, h, P.pearl, 'patrol');
        c.route = { from: n.id, to: dest.id };
        c.cruise = 92;
        cars.push(c);
    }
    game.cars = cars;
}
function trafficControl(game, c, dt) {
    if (!c.route) {
        const n = nearestNode(game.world, c.x, c.y);
        c.route = { from: n.id, to: game.rng.pick(n.links) };
    }
    let from = game.world.nodes[c.route.from], to = game.world.nodes[c.route.to];
    const h = Math.atan2(to.y - from.y, to.x - from.x);
    const end = { x: to.x - Math.sin(h) * WORLD.lane, y: to.y + Math.cos(h) * WORLD.lane };
    const start = { x: from.x - Math.sin(h) * WORLD.lane, y: from.y + Math.cos(h) * WORLD.lane };
    const fx = Math.cos(h), fy = Math.sin(h), length = dist(from, to);
    const progress = (c.x - start.x) * fx + (c.y - start.y) * fy;
    // Follow a point just ahead on the lane, rather than cutting diagonally toward
    // the next distant junction. This also guides a displaced car back into lane.
    const look = clamp(progress + Math.max(48, Math.abs(c.speed) * .5), 0, length);
    const target = { x: start.x + fx * look, y: start.y + fy * look };
    const remaining = dist(c, end);
    if (remaining < 29) {
        const choices = to.links.filter(id => id !== from.id), next = game.rng.pick(choices.length ? choices : to.links);
        c.route = { from: to.id, to: next };
        return trafficControl(game, c, dt);
    }
    let desired = c.cruise || 105;
    const angle = Math.atan2(target.y - c.y, target.x - c.x), delta = angleDelta(c.h, angle);
    if (Math.abs(delta) > .25) {
        desired *= .62;
    }
    if (remaining < 139 && remaining > 78 && !signalGreen(game.time, to, Math.abs(to.x - from.x) > 0)) {
        desired = remaining < 112 ? 0 : 35;
    }
    const aheadX = Math.cos(c.h), aheadY = Math.sin(c.h);
    for (const other of game.cars) {
        if (other === c) {
            continue;
        }
        const dx = other.x - c.x, dy = other.y - c.y, along = dx * aheadX + dy * aheadY, side = Math.abs(dx * aheadY - dy * aheadX);
        if (along > 4 && along < 95 && side < (CARS[c.type].width + CARS[other.type].width) * .5 + 2) {
            desired = Math.min(desired, Math.max(0, (along - 39) * 1.8));
        }
    }
    if (!game.player.car) {
        const dx = game.player.x - c.x, dy = game.player.y - c.y;
        if (dx * aheadX + dy * aheadY > 0 && dx * aheadX + dy * aheadY < 75 && Math.abs(dx * aheadY - dy * aheadX) < 22) {
            desired = 0;
        }
    }
    c.throttle = c.speed < desired - 4 ? clamp((desired - c.speed) / 35, .1, 1) : 0;
    c.braking = c.speed > desired + 4;
    c.steer = clamp(delta * 3, -1, 1);
}
export function updateVehicles(game, dt) {
    for (const c of game.cars) {
        c.stillTime = Math.abs(c.speed) < 6 ? c.stillTime + dt : 0;
        if (c.ambient && (c.stillTime > 18 || c.wreck) && dist(c, game.player) > 950) {
            recycleTraffic(game, c);
        }
        c.impactCooldown = Math.max(0, c.impactCooldown - dt);
        if (c.wreck) {
            c.speed *= Math.exp(-dt * 3);
            c.vx *= Math.exp(-dt * 3);
            c.vy *= Math.exp(-dt * 3);
            c.smokeTimer -= dt;
            if (c.smokeTimer <= 0) {
                game.burst(c.x + 12, c.y, 'smoke', 1);
                c.smokeTimer = .3;
            }
            continue;
        }
        const controlled = c === game.player.car;
        if (controlled) {
            const axis = game.input.axes();
            c.throttle = -axis.y;
            c.steer = axis.x;
            c.braking = axis.y > 0 && c.speed > 8;
            c.handbrake = game.input.down('ShiftLeft', 'ShiftRight');
        }
        else if (c.ai === 'traffic' || c.ai === 'patrol') {
            trafficControl(game, c, dt);
        }
        else if (c.ai !== 'police') {
            c.throttle = 0;
            c.steer = 0;
            c.braking = true;
        }
        physics(game, c, dt, controlled);
    }
    // Symmetric impulses keep ramming, traffic avoidance and wrecks in the same physical world.
    for (let i = 0; i < game.cars.length; i++) {
        for (let j = i + 1; j < game.cars.length; j++) {
            const a = game.cars[i], b = game.cars[j];
            const dx = b.x - a.x, dy = b.y - a.y;
            if (Math.abs(dx) > 55 || Math.abs(dy) > 55) {
                continue;
            }
            const contact = carContact(a, b, dx, dy);
            if (!contact) {
                continue;
            }
            const { nx, ny, overlap } = contact, relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            moveCircle(game.world, a, -nx * overlap * .51, -ny * overlap * .51, 12);
            moveCircle(game.world, b, nx * overlap * .51, ny * overlap * .51, 12);
            if (relative > 0) {
                const impulse = relative * .55;
                a.vx -= nx * impulse;
                a.vy -= ny * impulse;
                b.vx += nx * impulse;
                b.vy += ny * impulse;
                a.speed = a.vx * Math.cos(a.h) + a.vy * Math.sin(a.h);
                b.speed = b.vx * Math.cos(b.h) + b.vy * Math.sin(b.h);
            }
            if (relative > 58 && a.impactCooldown === 0 && b.impactCooldown === 0) {
                damageCar(game, a, relative * .15);
                damageCar(game, b, relative * .15);
                a.impactCooldown = b.impactCooldown = .65;
                game.burst((a.x + b.x) / 2, (a.y + b.y) / 2, 'spark', 9);
                if (a === game.player.car || b === game.player.car) {
                    game.shake = Math.min(12, relative * .035);
                    game.audio.play('crash', clamp(relative / 180, .3, 1));
                    game.stats.crashes++;
                    if ((a.type === 'police' || b.type === 'police')) {
                        game.crime('ramming', 1.3, { x: a.x, y: a.y }, true);
                    }
                }
            }
        }
    }
    if (game.player.car) {
        game.player.x = game.player.car.x;
        game.player.y = game.player.car.y;
    }
}
function physics(game, c, dt, controlled) {
    const def = CARS[c.type], oldSpeed = c.speed;
    if (c.braking) {
        c.speed = Math.max(0, c.speed - 340 * dt);
    }
    else if (c.throttle > 0) {
        c.speed += def.accel * c.throttle * dt;
    }
    else if (c.throttle < 0) {
        c.speed -= def.accel * .65 * dt;
    }
    else {
        c.speed *= Math.exp(-dt * (c.ai === 'parked' ? 1.6 : .6));
    }
    if (c.handbrake) {
        c.speed *= Math.exp(-dt * 1.7);
    }
    c.speed = clamp(c.speed, -95, def.max * (c.hp < def.hp * .2 ? .7 : 1));
    if (Math.abs(c.speed) > 3) {
        const turn = 2.65 * (.24 + .76 * Math.min(Math.abs(c.speed) / 115, 1)) / (1 + Math.abs(c.speed) / 390);
        c.h += c.steer * turn * dt * Math.sign(c.speed);
    }
    const grip = c.handbrake ? 2.1 : def.grip, blend = 1 - Math.exp(-grip * dt);
    c.vx += (Math.cos(c.h) * c.speed - c.vx) * blend;
    c.vy += (Math.sin(c.h) * c.speed - c.vy) * blend;
    if (moveCircle(game.world, c, c.vx * dt, c.vy * dt, def.width * .63)) {
        const force = Math.hypot(c.vx, c.vy);
        c.vx *= .28;
        c.vy *= .28;
        c.speed *= .25;
        if (force > 65 && c.impactCooldown === 0) {
            damageCar(game, c, force * .14);
            c.impactCooldown = .7;
            game.burst(c.x + Math.cos(c.h) * 20, c.y + Math.sin(c.h) * 20, 'spark', 10);
            if (controlled) {
                game.audio.play('crash', clamp(force / 170, .25, 1));
                game.shake = Math.min(12, force * .035);
                game.player.health -= Math.max(0, force - 190) * .035;
            }
        }
    }
    const slip = Math.abs(angleDelta(c.h, Math.atan2(c.vy, c.vx)));
    if (controlled && Math.abs(c.speed) > 95 && (Math.abs(c.steer) > .65 || c.handbrake || slip > .35)) {
        c.skidTimer = (c.skidTimer || 0) - dt;
        if (c.skidTimer <= 0) {
            c.skidTimer = .055;
            for (const side of [-1, 1]) {
                const x = c.x - Math.cos(c.h) * 14 - Math.sin(c.h) * side * 8, y = c.y - Math.sin(c.h) * 14 + Math.cos(c.h) * side * 8;
                game.skids.push({
                    x, y, h: c.h, life: 26
                });
            }
            if (game.skids.length > 500) {
                game.skids.splice(0, 10);
            }
        }
    }
    if (controlled) {
        game.stats.distance += Math.abs(c.speed) * dt;
        game.stats.topSpeed = Math.max(game.stats.topSpeed, Math.abs(c.speed) * .32);
        if (oldSpeed < 10 && c.speed > 10) {
            missionEvent(game, 'drive', { car: c });
        }
    }
    if (c.hp < def.hp * .45) {
        c.smokeTimer -= dt;
        if (c.smokeTimer <= 0) {
            game.burst(c.x + Math.cos(c.h) * 16, c.y + Math.sin(c.h) * 16, 'smoke', 1);
            c.smokeTimer = .12;
        }
    }
    if (c.type === 'police' && c.ai === 'patrol' && controlled) {
        c.ai = 'parked';
    }
}
export function damageCar(game, c, amount) {
    if (c.wreck) {
        return;
    }
    c.hp = Math.max(0, c.hp - amount);
    if (c.hp <= 0) {
        c.wreck = true;
        c.driver = false;
        c.ai = 'parked';
        c.throttle = 0;
        game.burst(c.x, c.y, 'smoke', 14);
        game.burst(c.x, c.y, 'spark', 18);
        missionEvent(game, 'vehicleWrecked', { car: c });
        if (c === game.player.car) {
            game.notify('ENGINE DESTROYED', 'Press E to get out.', P.carCoral);
            game.player.health -= 12;
            game.shake = 12;
        }
    }
}
export function nearestCar(game, radius = 53) {
    let best = null, d = radius;
    for (const c of game.cars) {
        if (c.wreck || c === game.player.car) {
            continue;
        }
        const n = dist(c, game.player);
        if (n < d) {
            best = c;
            d = n;
        }
    }
    return best;
}
export function canExit(game, c) {
    for (const side of [1, -1]) {
        for (const offset of [27, 38, 50]) {
            const p = { x: c.x - Math.sin(c.h) * offset * side, y: c.y + Math.cos(c.h) * offset * side };
            if (!isSolid(game.world, p.x, p.y, 8) && lineClear(game.world, c, p) && !game.cars.some(v => v !== c && dist(v, p) < 22) && roadDistance(p.x, p.y) > 0) {
                return p;
            }
        }
    }
    return null;
}
// Separating axes for the two oriented body rectangles. Side-by-side parked cars
// must not obstruct a traffic lane simply because their bounding circles overlap.
function carContact(a, b, dx, dy) {
    const af = { x: Math.cos(a.h), y: Math.sin(a.h) }, bf = { x: Math.cos(b.h), y: Math.sin(b.h) };
    const axes = [af, { x: -af.y, y: af.x }, bf, { x: -bf.y, y: bf.x }];
    let best = null;
    for (const n of axes) {
        const ra = Math.abs(n.x * af.x + n.y * af.y) * CARS[a.type].length * .5 + Math.abs(-n.x * af.y + n.y * af.x) * CARS[a.type].width * .5;
        const rb = Math.abs(n.x * bf.x + n.y * bf.y) * CARS[b.type].length * .5 + Math.abs(-n.x * bf.y + n.y * bf.x) * CARS[b.type].width * .5;
        const projection = dx * n.x + dy * n.y, overlap = ra + rb - Math.abs(projection);
        if (overlap <= 0) {
            return null;
        }
        if (!best || overlap < best.overlap) {
            const sign = projection >= 0 ? 1 : -1;
            best = { nx: n.x * sign, ny: n.y * sign, overlap };
        }
    }
    return best;
}
// Only distant ambient traffic is recycled. Cars in view and every borrowed car
// retain their physical history; distant jams and wrecks do not empty the city.
function recycleTraffic(game, c) {
    for (let trial = 0; trial < 16; trial++) {
        const from = game.rng.pick(game.world.nodes), to = game.world.nodes[game.rng.pick(from.links)];
        const h = Math.atan2(to.y - from.y, to.x - from.x), t = game.rng.range(.25, .75);
        const p = { x: from.x + (to.x - from.x) * t - Math.sin(h) * WORLD.lane, y: from.y + (to.y - from.y) * t + Math.cos(h) * WORLD.lane };
        if (dist(p, game.player) < 1050 || game.cars.some(o => o !== c && dist(o, p) < 85) || isSolid(game.world, p.x, p.y, 16)) {
            continue;
        }
        Object.assign(c, p, {
            h, speed: 65, vx: Math.cos(h) * 65, vy: Math.sin(h) * 65, hp: CARS[c.type].hp, wreck: false, ai: 'traffic', driver: true, route: { from: from.id, to: to.id }, stillTime: 0
        });
        return;
    }
}
