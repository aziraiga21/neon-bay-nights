// Neon Bay Nights — Jax on foot: walking, sprinting, stealing rides,
// shops, pickups, and taking a hit.
//
// Jax is a plain object on the game: position, heading, health, cash,
// ammo, and whichever car he is sitting in (null on foot). Everything
// else in the game reads those fields directly, so this module is the
// one place that moves them.
import { PALETTE as P, CARS, TUNE, clamp, dist } from './config.js';
import { isSolid, moveCircle, lineClear } from './world.js';
import { nearestCar, canExit } from './vehicles.js';
import { missionEvent } from './missions.js';

const START_CASH = 350;
const START_AMMO = 36;
const START_HEALTH = 100;
const AMMO_BOX = 48;
const PICKUP_REACH = 24;
const SERVICE_REACH = 85;
const REPAIR_REACH = 100;
const EXIT_COOLDOWN = 0.6;
const STAMINA_DRAIN = 0.22;
const STAMINA_REGEN = 0.16;
const HEALTH_SNACK = 40;
const AMMO_LOOSE = 24;

// --- construction --------------------------------------------------------

export function makePlayer(world, save = null) {
    const spawn = world.spawn;
    return {
        id: 1, isPlayer: true,
        x: spawn.x, y: spawn.y, h: spawn.h,
        health: START_HEALTH,
        cash: save && Number.isFinite(save.cash) ? save.cash : START_CASH,
        ammo: save && Number.isFinite(save.ammo) ? save.ammo : START_AMMO,
        car: null, carCooldown: 0, invincible: 0, stamina: 1,
        moving: false, armed: false, punch: 0, punchCooldown: 0,
        shotCooldown: 0, flash: 0, fireHeading: 0,
        jacket: P.jacket, skin: '#C48A62', hair: P.ink, trousers: P.trousers
    };
}

// --- per-frame update ----------------------------------------------------

export function updatePlayer(game, dt) {
    const p = game.player;
    p.invincible = Math.max(0, p.invincible - dt);
    p.carCooldown = Math.max(0, p.carCooldown - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.punch = Math.max(0, p.punch - dt);
    p.armed = p.ammo > 0 && game.input.mouse.aim;
    if (p.car) {
        driveSeat(game, dt);
    } else {
        walkStep(game, dt);
        collectPickups(game, dt);
    }
    if (p.health <= 0 && game.mode === 'play') {
        p.health = 0;
        game.end('dead');
    }
}

// In a car Jax goes where the car goes. E steps out, R pays the garage
// for a fix when one is close enough to matter.
function driveSeat(game, dt) {
    const p = game.player;
    const car = p.car;
    p.x = car.x;
    p.y = car.y;
    p.h = car.h;
    p.moving = Math.abs(car.speed) > 12;
    if (game.input.tap('KeyE') && p.carCooldown <= 0) stepOut(game);
    if (game.input.tap('KeyR')) tryGarageFix(game);
}

function walkStep(game, dt) {
    const p = game.player;
    const axis = game.input.axes();
    const sprinting = game.input.down('ShiftLeft', 'ShiftRight') && p.stamina > 0.02
        && (axis.x !== 0 || axis.y !== 0);
    if (sprinting) p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
    else p.stamina = Math.min(1, p.stamina + STAMINA_REGEN * dt);
    const speed = sprinting ? TUNE.sprint : TUNE.walk;
    const len = Math.hypot(axis.x, axis.y);
    p.moving = len > 0;
    if (len > 0) {
        const nx = axis.x / len;
        const ny = axis.y / len;
        p.h = Math.atan2(ny, nx);
        moveCircle(game.world, p, nx * speed * dt, ny * speed * dt, TUNE.playerRadius);
    }
    if (game.input.tap('KeyE') && p.carCooldown <= 0) interact(game);
}

// --- getting in and out --------------------------------------------------

// The on-foot interaction: a shop counter beats a car door when both are
// in reach, otherwise take the nearest usable ride.
export function interact(game) {
    const p = game.player;
    if (p.car) return false;
    if (useService(game)) return true;
    const car = nearestCar(game, TUNE.enterDistance);
    if (!car) return false;
    return climbIn(game, car);
}

function climbIn(game, car) {
    const p = game.player;
    if (car.wreck) {
        game.notify('WRECKED', 'That engine is done. Find another ride.', P.carCoral);
        return false;
    }
    if (car.type === 'police' && game.police.stars < 2) {
        game.notify('NBPD INTERCEPTOR', 'Locked down until the heat is on. Come back at two stars.', P.policeRed);
        game.audio.play('empty');
        return false;
    }
    if (car.driver) {
        car.driver = false;
        const runner = game.addPed(car.x, car.y, true);
        if (runner) runner.scared = 3;
    }
    car.ai = 'parked';
    car.stolen = true;
    p.car = car;
    p.x = car.x;
    p.y = car.y;
    p.h = car.h;
    p.carCooldown = EXIT_COOLDOWN;
    p.moving = false;
    game.stats.stolen += 1;
    game.unlockedCars.add(car.type);
    game.audio.play('enter');
    game.crime('theft', 1.4, { x: p.x, y: p.y }, false);
    missionEvent(game, 'enterCar', { car });
    return true;
}

function stepOut(game) {
    const p = game.player;
    const car = p.car;
    if (!car) return false;
    const spot = canExit(game, car) || huntExitSpot(game, car);
    if (!spot) {
        game.notify('NO WAY OUT', 'No clear ground beside this car.', P.carCoral);
        return false;
    }
    p.car = null;
    p.x = spot.x;
    p.y = spot.y;
    p.carCooldown = EXIT_COOLDOWN;
    p.moving = false;
    game.audio.play('enter');
    return true;
}

// canExit already tries both flanks; this is the last resort, a slow
// spiral of candidate spots around the car until solid-free ground shows.
function huntExitSpot(game, car) {
    for (let radius = 34; radius <= 90; radius += 14) {
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const spot = { x: car.x + Math.cos(a) * radius, y: car.y + Math.sin(a) * radius };
            if (!isSolid(game.world, spot.x, spot.y, 8) && lineClear(game.world, car, spot)
                && !game.cars.some(v => v !== car && dist(v, spot) < 22)) {
                return spot;
            }
        }
    }
    return null;
}

// --- shops and the garage ------------------------------------------------

function tryGarageFix(game) {
    const p = game.player;
    if (!p.car) return false;
    const shop = nearestService(game, REPAIR_REACH);
    if (!shop || shop.kind !== 'garage') return false;
    return useService(game, shop);
}

// Pay at the nearest counter: a meal or a clinic visit patches Jax up,
// a box of shells tops the pistol off, the garage rebuilds the car.
// Nothing happens when the till is short or nothing needs fixing.
export function useService(game, service = null) {
    const p = game.player;
    const shop = service || nearestService(game, SERVICE_REACH);
    if (!shop) return false;
    if (p.cash < shop.price) {
        game.notify('SHORT ON CASH', `${shop.name} asks ${shop.price}.`, P.carCoral);
        return false;
    }
    if (shop.kind === 'garage') {
        if (!p.car || p.car.hp >= CARS[p.car.type].hp) return false;
        p.car.hp = CARS[p.car.type].hp;
        p.cash -= shop.price;
        game.notify('ENGINE REBUILT', `${shop.name} · -$${shop.price}`, P.mango);
    } else if (shop.kind === 'food' || shop.kind === 'clinic') {
        if (p.health >= START_HEALTH) return false;
        p.health = START_HEALTH;
        p.cash -= shop.price;
        game.notify(shop.kind === 'food' ? 'FED AND WATERED' : 'PATCHED UP', `${shop.name} · -$${shop.price}`, P.mango);
    } else if (shop.kind === 'ammo') {
        if (p.ammo >= TUNE.maxAmmo) return false;
        p.ammo = Math.min(TUNE.maxAmmo, p.ammo + AMMO_BOX);
        p.cash -= shop.price;
        game.notify('AMMO RESTOCKED', `${shop.name} · -$${shop.price}`, P.mango);
    } else {
        return false;
    }
    game.audio.play('pickup');
    game.floatText(p.x, p.y - 16, `-$${shop.price}`, P.carCoral);
    return true;
}

function nearestService(game, reach) {
    let best = null;
    let d = reach;
    for (const s of game.world.services || []) {
        const n = dist(s, game.player);
        if (n < d) {
            best = s;
            d = n;
        }
    }
    return best;
}

// --- pickups -------------------------------------------------------------

function collectPickups(game, dt) {
    const p = game.player;
    for (const item of game.world.pickups) {
        if (!item.active) {
            if (!item.drop && item.respawn > 0) {
                item.respawn -= dt;
                if (item.respawn <= 0) item.active = true;
            }
            continue;
        }
        if (dist(item, p) > PICKUP_REACH) continue;
        if (item.kind === 'cash') {
            const amount = item.amount || 40;
            p.cash += amount;
            game.floatText(item.x, item.y - 14, `+$${amount}`, P.mango);
        } else if (item.kind === 'health') {
            if (p.health >= START_HEALTH) continue;
            p.health = Math.min(START_HEALTH, p.health + HEALTH_SNACK);
            game.floatText(item.x, item.y - 14, '+HEALTH', P.carCoral);
        } else if (item.kind === 'ammo') {
            if (p.ammo >= TUNE.maxAmmo) continue;
            p.ammo = Math.min(TUNE.maxAmmo, p.ammo + AMMO_LOOSE);
            game.floatText(item.x, item.y - 14, '+AMMO', P.mango);
        } else {
            continue;
        }
        item.active = false;
        item.respawn = item.drop ? 99999 : 25;
        game.audio.play('pickup');
    }
}

// --- taking damage -------------------------------------------------------

export function hurtPlayer(game, amount) {
    const p = game.player;
    if (game.mode !== 'play' || p.invincible > 0 || amount <= 0) return;
    p.health = Math.max(0, p.health - amount);
    p.invincible = 0.45;
    game.damageFlash = Math.min(1, game.damageFlash + 0.55);
    game.shake = Math.min(9, game.shake + 3);
    if (p.health <= 0) game.end('dead');
}
