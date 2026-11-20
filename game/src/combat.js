// Neon Bay Nights — combat: Jax's pistol and fists, rival crew behaviour,
// flying lead, and the cash a fallen rival leaves behind.
//
// The pistol is a short-range street tool, not a sniper rifle: a fast
// tracer, a hard kick of muzzle flash, and a quarter-second between shots.
// Rivals are cowards at heart — they hold their ground near home until
// Jax gets close or gets loud, then they chase, swing, and shoot back.
import { PALETTE as P, TUNE, clamp, angleDelta, dist } from './config.js';
import { isSolid, lineClear, moveCircle } from './world.js';
import { damageCar } from './vehicles.js';
import {npcSpeed,finishNpcStep} from './locomotion.js';
import { hurtPlayer } from './player.js';
import { missionEvent } from './missions.js';

const PISTOL_DAMAGE = 25;
const PISTOL_SPEED = 780;
const PISTOL_RANGE_SECONDS = 1.15;
const FIST_DAMAGE = 25;
const FIST_REACH = 34;
const FIST_SWING_SECONDS = 0.35;
const RIVAL_BOUNTY = 100;
const OFFICER_BOUNTY = 50;
const CHASE_SPEED = TUNE.run;
const STROLL_SPEED = TUNE.walk;
const SIGHT_RANGE = 300;
const SHOOT_MIN = 70;
const SHOOT_MAX = 360;

// Four Copper Kings loiter around their Marlin Wharf corners at the start
// of every session, waiting for trouble to walk past.
export function populateEnemies(game) {
    const corners = game.world.gangSpawns || [];
    const jackets = ['#AD7046', '#B2673F', '#8A5A3B', '#C07A4E'];
    game.enemies = corners.slice(0, 4).map((spot, i) => ({
        id: 600 + i,
        x: spot.x,
        y: spot.y,
        h: game.rng.range(0, Math.PI * 2),
        hp: 70,
        maxHp: 70,
        dead: false,
        role: 'rival',
        home: { x: spot.x, y: spot.y },
        jacket: jackets[i % jackets.length],
        skin: '#8D5A3C',
        hair: P.ink,
        armed: true,
        moving: false,
        flash: 0,
        punch: 0,
        cooldown: game.rng.range(0.6, 2.2),
        aggro: 0,
        wanderT: game.rng.range(1, 4),
        tx: spot.x,
        ty: spot.y
    }));
}

export function updateCombat(game, dt) {
    const p = game.player;
    p.shotCooldown = Math.max(0, (p.shotCooldown || 0) - dt);
    p.punchCooldown = Math.max(0, (p.punchCooldown || 0) - dt);
    handlePlayerAttack(game);
    stepBullets(game, dt);
    stepRivals(game, dt);
}

// --- Jax's own attacks -----------------------------------------------------

function handlePlayerAttack(game) {
    const p = game.player;
    const click=game.input.tap('MouseLeft');
    const fist=game.input.tap('KeyF');
    if(p.z>0 || p.transition || p.health<=0)return;
    if(!click && !fist)return;
    const close=click && !p.car && !p.armed && (nearestFoe(game,p) || nearbyWalker(game,p));
    if(!p.car && (fist || (click && (!p.ammo || close)))){
        if(p.punchCooldown<=0 && p.shotCooldown<=0)swingFist(game);
    }else if(click && p.shotCooldown<=0 && p.punchCooldown<=0)firePistol(game);

}

function firePistol(game) {
    const p = game.player;
    if (p.ammo <= 0) {
        p.shotCooldown = 0.3;
        game.audio.play('empty');
        return;
    }
    p.ammo -= 1;
    p.shotCooldown = TUNE.shotInterval;
    game.stats.shots += 1;
    const angle=p.armed?p.fireHeading:p.h;
    const reach = p.car ? 26 : 20;
    const mx = p.x + Math.cos(angle) * reach;
    const my = p.y + Math.sin(angle) * reach;
    p.flash = 0.09;p.recoil=.08;
    p.fireHeading = angle;
    game.bullets.push({
        x: mx, y: my,
        vx: Math.cos(angle) * PISTOL_SPEED,
        vy: Math.sin(angle) * PISTOL_SPEED,
        faction: 'player',
        damage: PISTOL_DAMAGE,
        life: PISTOL_RANGE_SECONDS
    });
    game.burst(mx, my, 'spark', 2);
    game.audio.play('shot');
    game.crime('gunfire', 1.2, p, false);
    missionEvent(game, 'shot', {});
}

function swingFist(game) {
    const p = game.player;
    p.punchLeft=!p.punchLeft;
    p.punch = FIST_SWING_SECONDS;
    p.punchCooldown = FIST_SWING_SECONDS;
    game.audio.play('punch');
    const victim = nearestFoe(game, p);
    if (victim) {
        p.hitStop=.06;
        hurtFoe(game, victim, FIST_DAMAGE, p);
        return;
    }
    const bystander=nearbyWalker(game,p);
    if (bystander) {
        p.hitStop=.06;
        bystander.scared = 3;
        bystander.fleeX = p.x;
        bystander.fleeY = p.y;
    }
}

function nearbyWalker(game,p){
    return game.peds.find(ped=>!ped.dead && !ped.inCab && dist(ped,p)<FIST_REACH &&
        Math.abs(angleDelta(p.h,Math.atan2(ped.y-p.y,ped.x-p.x)))<1.15);
}

function nearestFoe(game, p) {
    let best = null;
    let bestD = FIST_REACH;
    for (const foe of [...game.enemies, ...game.police.officers]) {
        if (foe.dead) continue;
        const d = dist(foe, p);
        const facing = Math.abs(angleDelta(p.h, Math.atan2(foe.y - p.y, foe.x - p.x)));
        if (d < bestD && (facing < 1.15 || d < 20)) {
            best = foe;
            bestD = d;
        }
    }
    return best;
}

// --- bullets in flight -----------------------------------------------------

function stepBullets(game, dt) {
    const p = game.player;
    for (const b of game.bullets) {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.life <= 0 || b.x < 30 || b.y < 30 || b.x > game.world.width || b.y > game.world.height) {
            b.spent = true;
            continue;
        }
        if (isSolid(game.world, b.x, b.y, 0)) {
            game.burst(b.x, b.y, 'spark', 4);
            b.spent = true;
            continue;
        }
        if (b.faction === 'player') {
            if (strikeTarget(game, b, game.enemies) || strikeTarget(game, b, game.police.officers)) continue;
            if (strikePed(game, b)) continue;
        } else if (!p.car && dist(b, p) < 11) {
            hurtPlayer(game, b.damage);
            game.burst(p.x, p.y, 'spark', 3);
            b.spent = true;
        } else if (p.car && dist(b, p) < 15) {
            damageCar(game, p.car, 3);
            game.burst(b.x, b.y, 'spark', 3);
            b.spent = true;
        }
    }
    game.bullets = game.bullets.filter(b => !b.spent);
}

function strikeTarget(game, b, list) {
    for (const foe of list) {
        if (foe.dead) continue;
        if (dist(b, foe) < 14) {
            hurtFoe(game, foe, b.damage, game.player);
            game.burst(b.x, b.y, 'spark', 5);
            b.spent = true;
            return true;
        }
    }
    return false;
}

function strikePed(game, b) {
    for (const ped of game.peds) {
        if (ped.dead || ped.inCab) continue;
        if (dist(b, ped) < 11) {
            ped.dead = true;
            ped.moving = false;
            game.burst(b.x, b.y, 'spark', 4);
            game.crime('hit and run', 1.6, ped, false);
            b.spent = true;
            return true;
        }
    }
    return false;
}

// --- damage and death ------------------------------------------------------

function hurtFoe(game, foe, amount, attacker) {
    if (foe.dead) return;
    foe.hp = Math.max(0, foe.hp - amount);
    foe.flash = 0.12;
    foe.aggro = 1;
    if (foe.hp > 0) return;
    foe.dead = true;
    foe.moving = false;
    foe.punch = 0;
    if (foe.role === 'rival') {
        game.stats.reputation += RIVAL_BOUNTY;
        const amount = 60 + Math.floor(game.rng.range(0, 40));
        game.world.pickups.push({
            id: 5000 + game.world.pickups.length,
            x: foe.x,
            y: foe.y,
            kind: 'cash',
            amount,
            active: true,
            respawn: 99999,
            drop: true,
            phase: game.rng.range(0, 6)
        });
        // The cash popup belongs to collection, when the wallet actually changes.
        missionEvent(game, 'rivalDown', { enemy: foe });
    } else {
        game.stats.reputation += OFFICER_BOUNTY;
        game.crime('officer down', 2.5, foe, true);
    }
}

// --- rival behaviour -------------------------------------------------------
// A rival holds his corner, drifts around it, and only turns violent when
// Jax comes into view or lands a hit. Up close he swings; at pistol range
// he shoots; too far away and he wanders home.

function stepRivals(game, dt) {
    const p = game.player;
    for (const e of game.enemies) {
        if (e.dead) continue;
        e.flash = Math.max(0, (e.flash || 0) - dt);
        e.punch = Math.max(0, (e.punch || 0) - dt);
        e.cooldown = Math.max(0, (e.cooldown || 0) - dt);
        if (e.wanderT === undefined) {
            e.wanderT = 2;
            e.tx = e.home.x;
            e.ty = e.home.y;
        }
        const d = dist(e, p);
        if (d < SIGHT_RANGE && lineClear(game.world, e, p)) e.aggro = 1;
        else if (d > 430) e.aggro = 0;
        e.moving = false;
        const x=e.x,y=e.y;
        if (!e.aggro) {
            strollHome(game, e, dt);
            finishNpcStep(e,x,y,dt);
            continue;
        }
        e.h = Math.atan2(p.y - e.y, p.x - e.x);
        if (d > 30) {
            const stride=npcSpeed(e,CHASE_SPEED,dt)*dt;
            moveCircle(game.world,e,Math.cos(e.h)*stride,Math.sin(e.h)*stride,7);
            e.moving = true;
        } else if (e.cooldown <= 0) {
            e.punchLeft=!e.punchLeft;
            e.punch = 0.3;
            e.cooldown = 0.9;
            hurtPlayer(game, 9);
            game.audio.play('punch', 0.7);
        }
        finishNpcStep(e,x,y,dt);
        if (e.armed && d > SHOOT_MIN && d < SHOOT_MAX && e.cooldown <= 0 && lineClear(game.world, e, p)) {
            const angle = Math.atan2(p.y - e.y, p.x - e.x) + game.rng.range(-0.06, 0.06);
            game.bullets.push({
                x: e.x + Math.cos(angle) * 16,
                y: e.y + Math.sin(angle) * 16,
                vx: Math.cos(angle) * 620,
                vy: Math.sin(angle) * 620,
                faction: 'enemy',
                damage: 8,
                life: 1.1
            });
            e.flash = 0.08;
            e.cooldown = 1.6 + game.rng.range(0, 0.9);
            game.audio.play('enemyShot');
        }
    }
}

function strollHome(game, e, dt) {
    const stride=npcSpeed(e,STROLL_SPEED,dt)*dt;
    const homeD = dist(e, e.home);
    if (homeD > 60) {
        const angle = Math.atan2(e.home.y - e.y, e.home.x - e.x);
        e.h = angle;
        moveCircle(game.world, e, Math.cos(angle) * stride, Math.sin(angle) * stride, 7);
        e.moving = true;
        return;
    }
    e.wanderT -= dt;
    if (e.wanderT <= 0) {
        e.wanderT = game.rng.range(2, 5);
        e.tx = clamp(e.home.x + game.rng.range(-90, 90), 60, game.world.width - 60);
        e.ty = clamp(e.home.y + game.rng.range(-90, 90), 60, game.world.height - 60);
    }
    const d = Math.hypot(e.tx - e.x, e.ty - e.y);
    if (d > 12) {
        const angle = Math.atan2(e.ty - e.y, e.tx - e.x);
        e.h = angle;
        moveCircle(game.world, e, Math.cos(angle) * stride, Math.sin(angle) * stride, 7);
        e.moving = true;
    }
}
