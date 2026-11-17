import { PALETTE as P, TUNE, clamp, dist, angleDelta } from './config.js';
import { isSolid, lineClear, moveCircle } from './world.js';
import { damageCar } from './vehicles.js';
import { hurtPlayer } from './player.js';
import { scarePeds } from './pedestrians.js';
import { missionEvent } from './missions.js';
export function populateEnemies(game) {
    game.enemies = game.world.gangSpawns.map((p, i) => ({
        ...p, home: { ...p }, id: 500 + i, role: 'rival', hp: 70, maxHp: 70, h: Math.PI / 2, jacket: i % 2 ? '#AD7046' : '#B2673F', skin: '#8D5A3C', hair: P.ink, dead: false, armed: true, moving: false, flash: 0, cooldown: game.rng.range(.7, 1.8), aggro: 0, punch: 0
    }));
    game.cornerRewarded = false;
}
function fire(game, source, heading, faction) {
    const car = source.car, start = car ? 21 : 13, x = source.x + Math.cos(heading) * start, y = source.y + Math.sin(heading) * start;
    game.bullets.push({
        x, y, px: x, py: y, vx: Math.cos(heading) * 780, vy: Math.sin(heading) * 780, life: .7, faction, source, damage: faction === 'player' ? 29 : 8
    });
    source.flash = .085;
    source.fireHeading = heading;
    game.audio.play(faction === 'player' ? 'shot' : 'enemyShot');
    game.burst(x, y, 'shell', 1);
    if (faction === 'player') {
        scarePeds(game, x, y);
        game.crime('gunfire', 1.1, source, true);
        game.stats.shots++;
        missionEvent(game, 'shoot', { x, y });
    }
}
function killActor(game, a) {
    if (a.dead) {
        return;
    }
    a.dead = true;
    a.deathTime = 0;
    a.moving = false;
    a.armed = false;
    game.burst(a.x, a.y, 'dust', 5);
    if (a.role === 'rival') {
        game.stats.reputation += 100;
        game.world.pickups.push({
            x: a.x + 9, y: a.y, kind: 'cash', amount: 75, active: true, drop: true, phase: 0
        }, {
            x: a.x - 9, y: a.y, kind: 'ammo', active: true, drop: true, phase: 2
        });
        missionEvent(game, 'enemyDefeated', { enemy: a });
    }
    else if (a.role === 'officer') {
        game.crime('officer down', 4, a, true);
    }
    else {
        game.crime('assault', 2.6, a, true);
    }
}
export function updateCombat(game, dt) {
    const p = game.player;
    p.shotCooldown = Math.max(0, p.shotCooldown - dt);
    p.punchCooldown = Math.max(0, p.punchCooldown - dt);
    const shooting = game.input.down('Space') || game.input.mouse.down;
    if (shooting) {
        p.armed = true;
        let heading = p.h;
        if (game.input.mouse.aim) {
            const target = game.screenToWorld(game.input.mouse.x, game.input.mouse.y);
            heading = Math.atan2(target.y - p.y, target.x - p.x);
            if (!p.car) {
                p.h = heading;
            }
        }
        if (p.shotCooldown === 0) {
            p.shotCooldown = TUNE.shotInterval;
            if (p.ammo > 0) {
                p.ammo--;
                fire(game, p, heading, 'player');
            }
            else {
                game.audio.play('empty');
                game.notify('OUT OF AMMO', 'Look for gold pickups or Dockside Supplies.', P.mango);
                p.shotCooldown = .8;
            }
        }
    }
    if (game.input.tap('KeyF') && !p.car && p.punchCooldown === 0) {
        p.punch = .18;
        p.punchCooldown = .45;
        p.armed = false;
        game.audio.play('punch');
        scarePeds(game, p.x, p.y, 95);
        const targets = [...game.enemies, ...game.police.officers, ...game.peds];
        for (const a of targets) {
            if (!a.dead && dist(a, p) < 36 && Math.abs(angleDelta(p.h, Math.atan2(a.y - p.y, a.x - p.x))) < 1.4) {
                a.hp -= 30;
                a.aggro = 10;
                a.scared = 6;
                a.fleeX = p.x;
                a.fleeY = p.y;
                moveCircle(game.world, a, Math.cos(p.h) * 12, Math.sin(p.h) * 12, 7);
                game.burst(a.x, a.y, 'spark', 3);
                if (a.hp <= 0) {
                    killActor(game, a);
                }
                game.crime('assault', .9, a, false);
                break;
            }
        }
        missionEvent(game, 'punch', {});
    }
    for (const e of game.enemies) {
        e.flash = Math.max(0, e.flash - dt);
        if (e.dead) {
            continue;
        }
        const d = dist(e, p);
        e.aggro = Math.max(0, e.aggro - dt);
        if ((d < 165 || e.aggro > 0) && d < 420 && lineClear(game.world, e, p)) {
            e.h = Math.atan2(p.y - e.y, p.x - e.x);
            e.aggro = 8;
            e.cooldown -= dt;
            if (d > 115) {
                e.moving = true;
                moveCircle(game.world, e, Math.cos(e.h) * 43 * dt, Math.sin(e.h) * 43 * dt, 7);
            }
            else {
                e.moving = false;
            }
            if (e.cooldown <= 0 && d < 310) {
                fire(game, e, e.h + game.rng.range(-.16, .16), 'rival');
                e.cooldown = game.rng.range(.9, 1.6);
            }
        }
        else {
            e.moving = false;
            e.h += Math.sin(game.time * .6 + e.id) * dt * .2;
        }
        if (p.car && !e.dead && dist(e, p.car) < 25 && Math.abs(p.car.speed) > 65) {
            e.hp -= 120;
            e.dead = true;
            e.moving = false;
            killActorAfterRam(game, e);
            game.crime('ramming', 1.5, e, true);
        }
    }
    if (game.enemies.length && !game.cornerRewarded && game.enemies.every(e => e.dead)) {
        game.cornerRewarded = true;
        p.cash += 250;
        game.stats.earned += 250;
        game.stats.reputation += 250;
        game.audio.play('complete');
        game.notify('COPPER KINGS SCATTERED', '+$250 · Dockside is quiet. For now.', P.mango);
        game.save();
    }
    for (const o of game.police.officers) {
        o.flash = Math.max(0, (o.flash || 0) - dt);
        if (o.dead) {
            continue;
        }
        if (game.police.stars >= 3 && dist(o, p) > 80 && dist(o, p) < 300 && lineClear(game.world, o, p)) {
            o.cooldown -= dt;
            if (o.cooldown <= 0) {
                fire(game, o, o.h + game.rng.range(-.21, .21), 'police');
                o.cooldown = game.rng.range(1.2, 2.2);
            }
        }
    }
    const live = [];
    for (const b of game.bullets) {
        b.life -= dt;
        if (b.life <= 0) {
            continue;
        }
        const ox = b.x, oy = b.y;
        b.px = ox;
        b.py = oy;
        let hit = false;
        const steps = Math.ceil(Math.hypot(b.vx, b.vy) * dt / 5);
        for (let i = 0; i < steps && !hit; i++) {
            b.x += b.vx * dt / steps;
            b.y += b.vy * dt / steps;
            if (isSolid(game.world, b.x, b.y, 0)) {
                game.burst(b.x, b.y, 'spark', 3);
                hit = true;
                break;
            }
            for (const c of game.cars) {
                if (c === b.source.car) {
                    continue;
                }
                if (Math.hypot(c.x - b.x, c.y - b.y) < 19) {
                    damageCar(game, c, b.damage * .48);
                    if (c === p.car && b.faction !== 'player') {
                        hurtPlayer(game, 3);
                    }
                    game.burst(b.x, b.y, 'spark', 3);
                    hit = true;
                    break;
                }
            }
            if (hit) {
                break;
            }
            const targets = b.faction === 'player' ? [...game.enemies, ...game.police.officers, ...game.peds] : p.car ? [] : [p];
            for (const a of targets) {
                if (a.dead || Math.hypot(a.x - b.x, a.y - b.y) > 10) {
                    continue;
                }
                if (a === p) {
                    hurtPlayer(game, b.damage);
                }
                else {
                    a.hp -= b.damage;
                    a.aggro = 12;
                    a.scared = 5;
                    a.fleeX = ox;
                    a.fleeY = oy;
                    if (a.hp <= 0) {
                        killActor(game, a);
                    }
                    else if (a.role === 'civilian') {
                        game.crime('assault', 1.7, a, true);
                    }
                }
                game.burst(b.x, b.y, 'spark', 4);
                hit = true;
                break;
            }
        }
        if (!hit) {
            live.push(b);
        }
    }
    game.bullets = live;
}
function killActorAfterRam(game, e) {
    e.dead = false;
    killActor(game, e);
}
export function shootOfficer(game, o, heading) {
    fire(game, o, heading, 'police');
}
