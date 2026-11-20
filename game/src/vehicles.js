// Neon Bay Nights — vehicles: arcade driving, lane traffic, parked rows,
// stealing, car-to-car hits, damage and smoke.
import { CARS, CAR_COLORS, PALETTE as P, ROADS_X, ROADS_Y, WORLD, clamp, angleDelta, dist } from './config.js';
import { nearestNode, moveCircle, signalGreen, lineClear, isSolid, roadDistance } from './world.js';
import { missionEvent } from './missions.js';

let serial = 1;
const oceanDrive = [
    {id:0,i:7,j:0,x:2778,y:180,links:[1]},
    {id:1,i:7,j:6,x:2778,y:2670,links:[0]}
];

// One fresh car. Traffic and patrol cars start with a driver; parked cars
// and mission cars do not. `ambient` marks traffic the city may recycle.
export function makeCar(type, x, y, h, color, ai = 'parked') {
    return {
        id: serial++, type, x, y, h,
        color: type === 'taxi' ? P.taxi : color || (type === 'police' ? P.pearl : P.teal),
        ai, vx: 0, vy: 0, speed: 0, hp: CARS[type].hp, wreck: false,
        driver: ai === 'traffic' || ai === 'patrol', ambient: ai === 'traffic',
        stillTime: 0, throttle: 0, steer: 0, braking: false,
        impactCooldown: 0, smokeTimer: 0, route: null, stolen: false,
        evacuated: false, travel: 0
    };
}

// Fill the city: 50 moving traffic cars, a parked row along every avenue,
// two hand-placed rides, and two NBPD patrol cruisers.
export function populateVehicles(game) {
    serial = 1;
    const { rng, world } = game;
    const cars = [];
    for (let i = 0; i < 50; i++) {
        const from = rng.pick(world.nodes);
        const to = world.nodes[rng.pick(from.links)];
        const heading = Math.atan2(to.y - from.y, to.x - from.x);
        const along = rng.range(0.22, 0.78);
        const ox = -Math.sin(heading) * WORLD.lane;
        const oy = Math.cos(heading) * WORLD.lane;
        const type = rng.pick(['sedan', 'sedan', 'sports', 'taxi', 'van']);
        const car = makeCar(type, from.x + (to.x - from.x) * along + ox, from.y + (to.y - from.y) * along + oy, heading, rng.pick(CAR_COLORS), 'traffic');
        car.speed = rng.range(65, 105);
        car.route = { from: from.id, to: to.id };
        car.cruise = rng.range(82, 133);
        cars.push(car);
    }
    for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 7; i++) {
            const x = ROADS_X[i] + (j % 2 ? -46 : 46);
            const y = ROADS_Y[j] + 150;
            const type = rng.pick(['sedan', 'sedan', 'sports', 'taxi', 'van']);
            const paint = rng.pick(CAR_COLORS);
            const coastalColors = ['#acb6e3','#cf6f52','#688e88','#883f68'];
            const color = type === 'taxi' ? P.taxi : (i+j)%3 ? paint : coastalColors[(i+j)%4];
            cars.push(makeCar(type, x, y, j % 2 ? -Math.PI / 2 : Math.PI / 2, color));
        }
    }
    // Waterfront traffic uses the same two lanes and avoidance rules.
    for(const [type,y,north,paint] of [
        ['sedan',860,false,P.carMint],['taxi',1360,true,P.taxi],['van',410,false,P.carCoral]
    ]) {
        const c=makeCar(type,2778+(north?18:-18),y,north?-Math.PI/2:Math.PI/2,paint,'traffic');
        c.oceanDrive=true; c.route=north?{from:1,to:0}:{from:0,to:1}; c.cruise=72;
        cars.push(c);
    }
    // A marked cab waits by the diner even if the moving traffic is far away.
    cars.push(makeCar('taxi', 2606, 1478, -Math.PI/2, P.taxi));
    // A clear first ride parked outside Rosa's, so the first interaction is immediate.
    cars.push(makeCar('sports', 2508, 1370, 0, P.magenta));
    cars.push(makeCar('van', 1210, 2137, 0, P.carMint));
    for (const node of [world.nodes[17], world.nodes[32]]) {
        const dest = world.nodes[node.links[0]];
        const heading = Math.atan2(dest.y - node.y, dest.x - node.x);
        const cruiser = makeCar('police', node.x - Math.sin(heading) * WORLD.lane, node.y + Math.cos(heading) * WORLD.lane, heading, P.pearl, 'patrol');
        cruiser.route = { from: node.id, to: dest.id };
        cruiser.cruise = 92;
        cars.push(cruiser);
    }
    game.cars = cars;
}

// --- traffic drivers -------------------------------------------------------
// A traffic car follows its lane from one junction to the next, aiming at a
// look-ahead point so it stays in lane instead of cutting the diagonal.
// It slows for corners, red lights, the car ahead, and pedestrians on foot.

function lookAhead(game, c, from, to, heading) {
    const end = { x: to.x - Math.sin(heading) * WORLD.lane, y: to.y + Math.cos(heading) * WORLD.lane };
    const start = { x: from.x - Math.sin(heading) * WORLD.lane, y: from.y + Math.cos(heading) * WORLD.lane };
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    const length = dist(from, to);
    const progress = (c.x - start.x) * fx + (c.y - start.y) * fy;
    const look = clamp(progress + Math.max(48, Math.abs(c.speed) * 0.5), 0, length);
    return { target: { x: start.x + fx * look, y: start.y + fy * look }, remaining: dist(c, end) };
}

function steerTraffic(game, c, dt) {
    if (!c.route) {
        const n = nearestNode(game.world, c.x, c.y);
        c.route = { from: n.id, to: game.rng.pick(n.links) };
    }
    const nodes = c.oceanDrive ? oceanDrive : game.world.nodes;
    const from = nodes[c.route.from];
    const to = nodes[c.route.to];
    const heading = Math.atan2(to.y - from.y, to.x - from.x);
    const { target, remaining } = lookAhead(game, c, from, to, heading);
    if (remaining < 29) {
        const options = to.links.filter(id => id !== from.id);
        c.route = { from: to.id, to: game.rng.pick(options.length ? options : to.links) };
        return steerTraffic(game, c, dt);
    }
    let desired = c.cruise || 105;
    const angle = Math.atan2(target.y - c.y, target.x - c.x);
    const delta = angleDelta(c.h, angle);
    if (Math.abs(delta) > 0.25) desired *= 0.62;
    // Stop at a red light on the final approach to the junction.
    if (remaining < 139 && remaining > 78 && !signalGreen(game.time, to, Math.abs(to.x - from.x) > 0)) {
        desired = remaining < 112 ? 0 : 35;
    }
    const aheadX = Math.cos(c.h);
    const aheadY = Math.sin(c.h);
    for (const other of game.cars) {
        if (other === c) continue;
        const dx = other.x - c.x;
        const dy = other.y - c.y;
        const along = dx * aheadX + dy * aheadY;
        const side = Math.abs(dx * aheadY - dy * aheadX);
        if (along > 4 && along < 95 && side < (CARS[c.type].width + CARS[other.type].width) * 0.5 + 2) {
            desired = Math.min(desired, Math.max(0, (along - 39) * 1.8));
        }
    }
    if (!game.player.car) {
        const dx = game.player.x - c.x;
        const dy = game.player.y - c.y;
        const along = dx * aheadX + dy * aheadY;
        if (along > 0 && along < 75 && Math.abs(dx * aheadY - dy * aheadX) < 22) desired = 0;
    }
    c.throttle = c.speed < desired - 4 ? clamp((desired - c.speed) / 35, 0.1, 1) : 0;
    c.braking = c.speed > desired + 4;
    c.steer = clamp(delta * 3, -1, 1);
}

// --- per-frame update ------------------------------------------------------

export function updateVehicles(game, dt) {
    for (const c of game.cars) {
        c.stillTime = Math.abs(c.speed) < 6 ? c.stillTime + dt : 0;
        if (c.ambient && (c.stillTime > 18 || c.wreck) && dist(c, game.player) > 950) {
            respawnTraffic(game, c);
        }
        c.impactCooldown = Math.max(0, c.impactCooldown - dt);
        if (c.wreck) {
            const decay = Math.exp(-dt * 3);
            c.speed *= decay;
            c.vx *= decay;
            c.vy *= decay;
            c.smokeTimer -= dt;
            if (c.smokeTimer <= 0) {
                game.burst(c.x + 12, c.y, 'smoke', 1);
                c.smokeTimer = 0.3;
            }
            continue;
        }
        const driven = c === game.player.car;
        if(game.player.transition?.kind==='enter' && game.player.transition.car===c){
            c.throttle=0;c.braking=true;c.steer=0;
        } else if (driven) {
            const axis = game.input.axes();
            c.throttle = -axis.y;
            c.steer = axis.x;
            c.braking = axis.y > 0 && c.speed > 8;
            c.handbrake = game.input.down('ShiftLeft', 'ShiftRight');
        } else if (c.ai === 'traffic' || c.ai === 'patrol') {
            steerTraffic(game, c, dt);
        } else if (c.ai !== 'police') {
            c.throttle = 0;
            c.steer = 0;
            c.braking = true;
        }
        stepCar(game, c, dt, driven);
    }
    resolveCollisions(game);
    if (game.player.car) {
        game.player.x = game.player.car.x;
        game.player.y = game.player.car.y;
    }
}

// Symmetric impulses: ramming, traffic avoidance and wrecks all live in the
// same physical world, so both cars in a hit share the push.
function resolveCollisions(game) {
    for (let i = 0; i < game.cars.length; i++) {
        const a = game.cars[i];
        for (let j = i + 1; j < game.cars.length; j++) {
            const b = game.cars[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            if (Math.abs(dx) > 55 || Math.abs(dy) > 55) continue;
            const contact = overlapBoxes(a, b, dx, dy);
            if (!contact) continue;
            const { nx, ny, overlap } = contact;
            const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            moveCircle(game.world, a, -nx * overlap * 0.51, -ny * overlap * 0.51, 12);
            moveCircle(game.world, b, nx * overlap * 0.51, ny * overlap * 0.51, 12);
            if (relative > 0) {
                const impulse = relative * 0.55;
                a.vx -= nx * impulse;
                a.vy -= ny * impulse;
                b.vx += nx * impulse;
                b.vy += ny * impulse;
                a.speed = a.vx * Math.cos(a.h) + a.vy * Math.sin(a.h);
                b.speed = b.vx * Math.cos(b.h) + b.vy * Math.sin(b.h);
            }
            if (relative > 58 && a.impactCooldown === 0 && b.impactCooldown === 0) {
                damageCar(game, a, relative * 0.15);
                damageCar(game, b, relative * 0.15);
                a.impactCooldown = b.impactCooldown = 0.65;
                game.burst((a.x + b.x) / 2, (a.y + b.y) / 2, 'spark', 9);
                if (a === game.player.car || b === game.player.car) {
                    game.shake = Math.min(12, relative * 0.035);
                    game.audio.play('crash', clamp(relative / 180, 0.3, 1));
                    game.stats.crashes++;
                    if (a.type === 'police' || b.type === 'police') {
                        game.crime('ramming', 1.3, { x: a.x, y: a.y }, true);
                    }
                }
            }
        }
    }
}

// --- physics ---------------------------------------------------------------
// Arcade handling: speed follows throttle/brake, steering tightens at low
// speed, and velocity eases toward the heading (grip) so the car drifts
// instead of snapping sideways. The handbrake loosens the grip.

function stepCar(game, c, dt, driven) {
    const def = CARS[c.type];
    const oldSpeed = c.speed;
    if (c.braking) {
        c.speed = Math.max(0, c.speed - 340 * dt);
    } else if (c.throttle > 0) {
        c.speed += def.accel * c.throttle * dt;
    } else if (c.throttle < 0) {
        c.speed -= def.accel * 0.65 * dt;
    } else {
        c.speed *= Math.exp(-dt * (c.ai === 'parked' ? 1.6 : 0.6));
    }
    if (c.handbrake) c.speed *= Math.exp(-dt * 1.7);
    c.speed = clamp(c.speed, -95, def.max * (c.hp < def.hp * 0.2 ? 0.7 : 1));
    if (Math.abs(c.speed) > 3) {
        const turn = (2.65 * (0.24 + 0.76 * Math.min(Math.abs(c.speed) / 115, 1))) / (1 + Math.abs(c.speed) / 390);
        c.h += c.steer * turn * dt * Math.sign(c.speed);
    }
    const grip = c.handbrake ? 2.1 : def.grip;
    const blend = 1 - Math.exp(-grip * dt);
    c.vx += (Math.cos(c.h) * c.speed - c.vx) * blend;
    c.vy += (Math.sin(c.h) * c.speed - c.vy) * blend;
    if (moveCircle(game.world, c, c.vx * dt, c.vy * dt, def.width * 0.63)) {
        const force = Math.hypot(c.vx, c.vy);
        c.vx *= 0.28;
        c.vy *= 0.28;
        c.speed *= 0.25;
        if (force > 65 && c.impactCooldown === 0) {
            damageCar(game, c, force * 0.14);
            c.impactCooldown = 0.7;
            game.burst(c.x + Math.cos(c.h) * 20, c.y + Math.sin(c.h) * 20, 'spark', 10);
            if (driven) {
                game.audio.play('crash', clamp(force / 170, 0.25, 1));
                game.shake = Math.min(12, force * 0.035);
                game.player.health -= Math.max(0, force - 190) * 0.035;
            }
        }
    }
    c.travel+=c.speed*dt;
    leaveSkidMarks(game, c, dt, driven);
    if (driven) {
        game.stats.distance += Math.abs(c.speed) * dt;
        game.stats.topSpeed = Math.max(game.stats.topSpeed, Math.abs(c.speed) * 0.32);
        if (oldSpeed < 10 && c.speed > 10) missionEvent(game, 'drive', { car: c });
    }
    if (c.hp < def.hp * 0.45) {
        c.smokeTimer -= dt;
        if (c.smokeTimer <= 0) {
            game.burst(c.x + Math.cos(c.h) * 16, c.y + Math.sin(c.h) * 16, 'smoke', 1);
            c.smokeTimer = 0.12;
        }
    }
    if (c.type === 'police' && c.ai === 'patrol' && driven) c.ai = 'parked';
}

function leaveSkidMarks(game, c, dt, driven) {
    if (!driven || Math.abs(c.speed) <= 95) return;
    const slip = Math.abs(angleDelta(c.h, Math.atan2(c.vy, c.vx)));
    if (!(Math.abs(c.steer) > 0.65 || c.handbrake || slip > 0.35)) return;
    c.skidTimer = (c.skidTimer || 0) - dt;
    if (c.skidTimer > 0) return;
    c.skidTimer = 0.055;
    for (const side of [-1, 1]) {
        game.skids.push({
            x: c.x - Math.cos(c.h) * 14 - Math.sin(c.h) * side * 8,
            y: c.y - Math.sin(c.h) * 14 + Math.cos(c.h) * side * 8,
            h: c.h, life: 26
        });
    }
    if (c.handbrake) game.burst(c.x - Math.cos(c.h) * 18, c.y - Math.sin(c.h) * 18, 'smoke', 1);
    if (game.skids.length > 500) game.skids.splice(0, 10);
}

// --- damage, queries, recycling --------------------------------------------

export function damageCar(game, c, amount) {
    if (c.wreck) return;
    c.hp = Math.max(0, c.hp - amount);
    if (c.hp > 0) return;
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

export function nearestCar(game, radius = 53) {
    let best = null;
    let d = radius;
    for (const c of game.cars) {
        if (c.wreck || c === game.player.car) continue;
        const n = dist(c, game.player);
        if (n < d) {
            best = c;
            d = n;
        }
    }
    return best;
}

// Find a spot beside the car where Jax can step out: solid-free, visible
// from the car, clear of other cars, and not dead-centre on a road.
export function canExit(game, c) {
    for (const side of [1, -1]) {
        for (const offset of [27, 38, 50]) {
            const p = { x: c.x - Math.sin(c.h) * offset * side, y: c.y + Math.cos(c.h) * offset * side };
            const clear = !isSolid(game.world, p.x, p.y, 8) && lineClear(game.world, c, p)
                && !game.cars.some(v => v !== c && dist(v, p) < 22) && roadDistance(p.x, p.y) > 0;
            if (clear) return p;
        }
    }
    return null;
}

// Separating axes for the two oriented body rectangles. Side-by-side parked
// cars must not obstruct a traffic lane simply because their bounding
// circles overlap.
function overlapBoxes(a, b, dx, dy) {
    const af = { x: Math.cos(a.h), y: Math.sin(a.h) };
    const bf = { x: Math.cos(b.h), y: Math.sin(b.h) };
    const axes = [af, { x: -af.y, y: af.x }, bf, { x: -bf.y, y: bf.x }];
    let best = null;
    for (const n of axes) {
        const ra = Math.abs(n.x * af.x + n.y * af.y) * CARS[a.type].length * 0.5
            + Math.abs(-n.x * af.y + n.y * af.x) * CARS[a.type].width * 0.5;
        const rb = Math.abs(n.x * bf.x + n.y * bf.y) * CARS[b.type].length * 0.5
            + Math.abs(-n.x * bf.y + n.y * bf.x) * CARS[b.type].width * 0.5;
        const projection = dx * n.x + dy * n.y;
        const overlap = ra + rb - Math.abs(projection);
        if (overlap <= 0) return null;
        if (!best || overlap < best.overlap) {
            const sign = projection >= 0 ? 1 : -1;
            best = { nx: n.x * sign, ny: n.y * sign, overlap };
        }
    }
    return best;
}

// Only distant ambient traffic is recycled. Cars in view and every borrowed
// car retain their physical history; distant jams and wrecks do not empty
// the city.
function respawnTraffic(game, c) {
    for (let trial = 0; trial < 16; trial++) {
        const from = game.rng.pick(game.world.nodes);
        const to = game.world.nodes[game.rng.pick(from.links)];
        const heading = Math.atan2(to.y - from.y, to.x - from.x);
        const along = game.rng.range(0.25, 0.75);
        const p = {
            x: from.x + (to.x - from.x) * along - Math.sin(heading) * WORLD.lane,
            y: from.y + (to.y - from.y) * along + Math.cos(heading) * WORLD.lane
        };
        if (dist(p, game.player) < 1050 || game.cars.some(o => o !== c && dist(o, p) < 85) || isSolid(game.world, p.x, p.y, 16)) {
            continue;
        }
        Object.assign(c, p, {
            oceanDrive:false, h: heading, speed: 65, vx: Math.cos(heading) * 65, vy: Math.sin(heading) * 65,
            hp: CARS[c.type].hp, wreck: false, ai: 'traffic', driver: true,
            route: { from: from.id, to: to.id }, stillTime: 0
        });
        return;
    }
}
