import { PALETTE as P, TUNE, CARS, clamp, dist, money } from './config.js';
import { moveCircle, isSolid } from './world.js';
import { nearestCar, canExit } from './vehicles.js';
import { missionEvent } from './missions.js';
export function makePlayer(world, save) {
    return {
        ...world.spawn, isPlayer: true, role: 'player', skin: '#C48A62', hair: P.ink, jacket: P.jacket, health: 100, cash: save?.cash ?? 350, ammo: save?.ammo ?? 36, car: null, moving: false, invincible: 1, flash: 0, punch: 0, shotCooldown: 0, punchCooldown: 0, carCooldown: 0, stamina: 1, armed: false
    };
}
export function updatePlayer(game, dt) {
    const p = game.player;
    p.invincible = Math.max(0, p.invincible - dt);
    p.carCooldown = Math.max(0, p.carCooldown - dt);
    p.flash = Math.max(0, p.flash - dt);
    p.punch = Math.max(0, p.punch - dt);
    if (!p.car) {
        const a = game.input.axes(), len = Math.hypot(a.x, a.y);
        const sprint = game.input.down('ShiftLeft', 'ShiftRight') && p.stamina > .05 && len > 0;
        p.stamina = clamp(p.stamina + (sprint ? -.23 : .2) * dt, 0, 1);
        const speed = sprint ? TUNE.sprint : TUNE.walk;
        p.moving = len > 0;
        if (len > 0) {
            const dx = a.x / len, dy = a.y / len;
            moveCircle(game.world, p, dx * speed * dt, dy * speed * dt, TUNE.playerRadius);
            if (!game.input.mouse.down && !game.input.down('Space')) {
                p.h = Math.atan2(dy, dx);
            }
        }
        if (game.input.mouse.aim && (game.input.mouse.down || p.armed)) {
            const aim = game.screenToWorld(game.input.mouse.x, game.input.mouse.y);
            p.h = Math.atan2(aim.y - p.y, aim.x - p.x);
        }
        // Cars are physical threats on foot, with a grace period after leaving a vehicle.
        for (const c of game.cars) {
            if (dist(c, p) < 21 && Math.abs(c.speed) > 48 && p.invincible === 0) {
                hurtPlayer(game, clamp(Math.abs(c.speed) * .16, 9, 44));
                const a = Math.atan2(p.y - c.y, p.x - c.x);
                moveCircle(game.world, p, Math.cos(a) * 24, Math.sin(a) * 24, 7);
                c.speed *= .72;
                game.burst(p.x, p.y, 'dust', 5);
                game.audio.play('crash', .4);
            }
        }
    }
    else {
        p.moving = false;
        p.h = p.car.h;
        p.x = p.car.x;
        p.y = p.car.y;
    }
    if (game.input.tap('KeyE') && p.carCooldown === 0) {
        interact(game);
    }
    if (game.input.tap('KeyR') && p.car) {
        const garage = game.world.services.find(s => s.kind === 'garage' && dist(s, p) < 80);
        if (garage) {
            useService(game, garage);
        }
    }
    for (const item of game.world.pickups) {
        if (!item.active) {
            item.respawn -= dt;
            if (item.respawn <= 0) {
                item.active = true;
            }
            continue;
        }
        if (dist(item, p) < (p.car ? 25 : 19)) {
            if (item.kind === 'health' && p.health >= 100) {
                continue;
            }
            if (item.kind === 'ammo' && p.ammo >= TUNE.maxAmmo) {
                continue;
            }
            if (item.kind === 'health') {
                p.health = Math.min(100, p.health + 30);
            }
            if (item.kind === 'ammo') {
                p.ammo = Math.min(TUNE.maxAmmo, p.ammo + 18);
            }
            if (item.kind === 'cash') {
                p.cash += item.amount || 75;
                game.stats.earned += item.amount || 75;
            }
            item.active = false;
            item.respawn = item.drop ? 99999 : 65;
            game.audio.play('pickup');
            game.floatText(item.x, item.y, item.kind === 'health' ? '+30 HEALTH' : item.kind === 'ammo' ? '+18 AMMO' : `+${money(item.amount || 75)}`, P.mango);
            missionEvent(game, 'pickup', { item });
        }
    }
    if (p.health <= 0) {
        game.end('wasted');
    }
}
export function interact(game) {
    const p = game.player;
    if (p.car) {
        const c = p.car;
        if (Math.abs(c.speed) > 110) {
            game.notify('SLOW DOWN', 'Get below 35 mph to step out.');
            return;
        }
        const exit = canExit(game, c);
        if (!exit || isSolid(game.world, exit.x, exit.y, 8)) {
            game.notify('DOOR BLOCKED', 'Move somewhere with room to get out.');
            return;
        }
        c.ai = 'parked';
        c.driver = false;
        c.throttle = 0;
        c.steer = 0;
        c.braking = true;
        p.car = null;
        p.x = exit.x;
        p.y = exit.y;
        p.invincible = 1.5;
        p.carCooldown = .55;
        game.audio.play('enter');
        missionEvent(game, 'exitCar', { car: c });
        return;
    }
    const s = game.world.services.find(s => dist(s, p) < 43);
    if (s) {
        useService(game, s);
        return;
    }
    const c = nearestCar(game, TUNE.enterDistance);
    if (!c) {
        game.notify('NEON BAY IS YOURS', 'Approach a car or a marked shop and press E.');
        return;
    }
    if (Math.abs(c.speed) > 135) {
        game.notify('TOO FAST TO GRAB', 'Catch a car at a red light.');
        return;
    }
    const occupied = c.driver || c.ai === 'police';
    if (c.type === 'police' && game.police.stars < 2 && occupied) {
        game.notify('CRUISER LOCKED', 'An active interceptor needs a two-star distraction.', P.policeRed);
        return;
    }
    if (occupied) {
        game.addPed(c.x - Math.sin(c.h) * 30, c.y + Math.cos(c.h) * 30, true);
    }
    c.driver = false;
    c.ambient = false;
    c.ai = 'parked';
    c.route = null;
    c.steer = 0;
    c.throttle = 0;
    c.handbrake = false;
    c.stolen = true;
    p.car = c;
    p.x = c.x;
    p.y = c.y;
    p.h = c.h;
    p.carCooldown = .6;
    p.armed = false;
    game.police.units = game.police.units.filter(u => u.car !== c);
    game.unlockedCars.add(c.type);
    game.stats.stolen++;
    game.stats.reputation += 25;
    game.audio.play('enter');
    game.crime('theft', c.type === 'police' ? 3.4 : 1.4, c, false);
    if (c.type === 'police' && game.police.stars >= 2) {
        game.crime('police theft', 3, c, true);
    }
    game.notify(occupied ? 'NEW RIDE. UNHAPPY OWNER.' : CARS[c.type].name.toUpperCase(), occupied ? 'Keep moving. Someone may have seen that.' : 'W / S accelerate & brake · A / D steer · E exit', P.mango);
    missionEvent(game, 'enterCar', { car: c, stolen: true });
}
export function useService(game, s) {
    const p = game.player;
    if (game.police.stars > 0) {
        game.notify('TOO MUCH HEAT', 'Lose the police before using a shop.', P.policeRed);
        return;
    }
    if (s.kind === 'garage') {
        if (!p.car) {
            game.notify(s.short, 'Bring a car here for a repair and fresh paint. $100.');
            return;
        }
        if (p.car.wreck) {
            game.notify('TOW REQUIRED', 'This engine is gone. Find another ride.');
            return;
        }
        if (p.cash < s.price) {
            game.notify('NEED ' + money(s.price), 'Cruise the city or clear a Copper Kings corner.');
            return;
        }
        p.cash -= s.price;
        p.car.hp = CARS[p.car.type].hp;
        p.car.color = game.rng.pick([P.carCoral, P.teal, P.magenta, P.carMint, P.mango]);
        game.audio.play('complete');
        game.notify('FRESH PAINT. FRESH START.', 'Vehicle repaired. You look good out there.', P.teal);
    }
    else if (s.kind === 'ammo') {
        if (p.ammo >= TUNE.maxAmmo) {
            game.notify('FULLY STOCKED', 'Your ammo bag is full.');
            return;
        }
        if (p.cash < s.price) {
            game.notify('NEED ' + money(s.price), 'An ammo refill costs $45.');
            return;
        }
        p.cash -= s.price;
        p.ammo = Math.min(TUNE.maxAmmo, p.ammo + 48);
        game.audio.play('pickup');
        game.notify('RESTOCKED', '+48 pistol rounds.');
    }
    else {
        if (p.health >= 100) {
            game.notify(s.short, s.kind === 'food' ? 'Rosa says: “Stay sharp, Jax. The bay has eyes.”' : 'You’re already in good shape.');
            return;
        }
        if (p.cash < s.price) {
            game.notify('NEED ' + money(s.price), 'Pick up a first-aid kit for free recovery.');
            return;
        }
        p.cash -= s.price;
        p.health = 100;
        game.audio.play('pickup');
        game.notify('BACK ON YOUR FEET', s.kind === 'food' ? 'A hot meal and some advice from Rosa.' : 'Patched up. Try to keep it that way.');
    }
    game.save();
    missionEvent(game, 'service', { service: s });
}
export function hurtPlayer(game, amount) {
    const p = game.player;
    if (p.invincible > 0 || p.health <= 0) {
        return;
    }
    p.health = Math.max(0, p.health - amount);
    p.invincible = .4;
    game.damageFlash = .28;
    game.shake = Math.max(game.shake, 3);
}
