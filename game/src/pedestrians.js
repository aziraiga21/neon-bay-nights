import { PALETTE as P, SKINS, HAIR, clamp, angleDelta, dist } from './config.js';
import { moveCircle, nearestNode, signalGreen, isSolid } from './world.js';
const COATS = [P.carCoral, P.mango, P.teal, P.navy, P.carMint, '#AA6B98', '#E2CBB0', '#688D98'];
let pid = 1;
function corner(world, x, y) {
    const n = nearestNode(world, x, y);
    return { node: n.id, sx: x < n.x ? -1 : 1, sy: y < n.y ? -1 : 1 };
}
function position(world, c) {
    const n = world.nodes[c.node];
    return { x: n.x + c.sx * 66, y: n.y + c.sy * 66 };
}
function nextTarget(game, p) {
    const at = p.corner, n = game.world.nodes[at.node], choices = [{ ...at, sx: -at.sx, cross: 'x' }, { ...at, sy: -at.sy, cross: 'y' }];
    const horiz = n.links.map(id => game.world.nodes[id]).find(v => v.j === n.j && Math.sign(v.x - n.x) === at.sx);
    const vert = n.links.map(id => game.world.nodes[id]).find(v => v.i === n.i && Math.sign(v.y - n.y) === at.sy);
    if (horiz) {
        choices.push({ node: horiz.id, sx: -at.sx, sy: at.sy });
    }
    if (vert) {
        choices.push({ node: vert.id, sx: at.sx, sy: -at.sy });
    }
    const target = game.rng.pick(choices);
    p.target = { ...position(game.world, target), corner: target, cross: target.cross };
}
export function addPed(game, x, y, flee = false) {
    const p = {
        id: pid++, x, y, h: game.rng.range(0, 6.28), jacket: game.rng.pick(COATS), skin: game.rng.pick(SKINS), hair: game.rng.pick(HAIR), hp: 40, dead: false, deathTime: 0, speed: game.rng.range(25, 43), moving: true, scared: flee ? 5 : 0, fleeX: x - 30, fleeY: y - 30, corner: corner(game.world, x, y), target: null, role: 'civilian'
    };
    const pos = position(game.world, p.corner);
    if (!flee) {
        p.x = pos.x + game.rng.range(-7, 7);
        p.y = pos.y + game.rng.range(-7, 7);
        nextTarget(game, p);
    }
    else {
        p.target = pos;
    }
    game.peds.push(p);
    return p;
}
export function populatePeds(game) {
    pid = 1;
    game.peds = [];
    for (let i = 0; i < 100; i++) {
        const n = game.rng.pick(game.world.nodes);
        addPed(game, n.x + game.rng.pick([-1, 1]) * 66, n.y + game.rng.pick([-1, 1]) * 66);
    }
}
export function scarePeds(game, x, y, radius = 260) {
    for (const p of game.peds) {
        if (!p.dead && Math.hypot(p.x - x, p.y - y) < radius) {
            p.scared = game.rng.range(3, 6);
            p.fleeX = x;
            p.fleeY = y;
        }
    }
}
export function updatePeds(game, dt) {
    for (const p of game.peds) {
        if (p.dead) {
            p.deathTime += dt;
            if (p.deathTime > 28 && dist(p, game.player) > 550) {
                const c = corner(game.world, p.x, p.y);
                Object.assign(p, position(game.world, c), {
                    corner: c, dead: false, hp: 40, scared: 0
                });
                nextTarget(game, p);
            }
            continue;
        }
        p.scared = Math.max(0, p.scared - dt);
        p.flash = Math.max(0, (p.flash || 0) - dt);
        for (const c of game.cars) {
            const d = dist(c, p);
            if (Math.abs(c.speed) > 70 && d < 110) {
                const dx = p.x - c.x, dy = p.y - c.y;
                if (dx * Math.cos(c.h) + dy * Math.sin(c.h) > 0 && Math.abs(dx * Math.sin(c.h) - dy * Math.cos(c.h)) < 30) {
                    p.scared = Math.max(p.scared, 1.1);
                    p.fleeX = c.x;
                    p.fleeY = c.y;
                }
            }
            if (d < 19 && Math.abs(c.speed) > 55) {
                p.hp -= Math.abs(c.speed) * .7;
                c.speed *= .87;
                game.burst(p.x, p.y, 'dust', 5);
                p.scared = 4;
                p.fleeX = c.x;
                p.fleeY = c.y;
                if (c === game.player.car) {
                    game.crime('hit and run', 2.8, p, true);
                    game.audio.play('crash', .35);
                    game.shake = 4;
                }
                if (p.hp <= 0) {
                    p.dead = true;
                    p.moving = false;
                    p.deathTime = 0;
                }
            }
        }
        if (p.dead) {
            continue;
        }
        let tx, ty, speed = p.speed;
        if (p.scared > 0) {
            let a = Math.atan2(p.y - p.fleeY, p.x - p.fleeX);
            tx = p.x + Math.cos(a) * 50;
            ty = p.y + Math.sin(a) * 50;
            speed = 105;
            if (isSolid(game.world, tx, ty, 8)) {
                a += Math.PI / 2;
                tx = p.x + Math.cos(a) * 45;
                ty = p.y + Math.sin(a) * 45;
            }
            p.returning = true;
        }
        else {
            if (p.returning) {
                p.corner = corner(game.world, p.x, p.y);
                p.target = { ...position(game.world, p.corner), corner: p.corner };
                p.returning = false;
            }
            if (!p.target) {
                nextTarget(game, p);
            }
            if (dist(p, p.target) < 7) {
                p.corner = p.target.corner || corner(game.world, p.x, p.y);
                nextTarget(game, p);
            }
            if (p.target.cross && dist(p, p.target) > 103) {
                const n = game.world.nodes[p.corner.node];
                if (!signalGreen(game.time, n, p.target.cross === 'x')) {
                    p.moving = false;
                    continue;
                }
            }
            tx = p.target.x;
            ty = p.target.y;
        }
        const a = Math.atan2(ty - p.y, tx - p.x);
        p.h += angleDelta(p.h, a) * Math.min(1, dt * 9);
        p.moving = true;
        moveCircle(game.world, p, Math.cos(a) * speed * dt, Math.sin(a) * speed * dt, 6);
    }
    if (game.peds.length > 130) {
        game.peds = game.peds.sort((a, b) => dist(a, game.player) - dist(b, game.player)).slice(0, 130);
    }
}
