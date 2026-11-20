// Neon Bay Nights — pedestrians: the people who make the sidewalks feel
// alive. Everyone walks the road graph on one side of the street or the
// other, the way real foot traffic does: along a block, across at the
// crosswalk when they feel like it, never through a building. A speeding
// car, a shove, or a gunshot turns a stroll into a sprint for cover.
import { PALETTE as P, SKINS, HAIR, TUNE, clamp } from './config.js';
import {makeGait,npcSpeed,finishNpcStep} from './locomotion.js';
import { nearestNode, moveCircle } from './world.js';

const MAX_PEDS = 130;
const SIDEWALK = 66;
const JACKETS = ['#0E7C86', '#C46B4A', '#7C9F87', '#E7746F', '#F0B429', '#243056', '#B7E4C7', '#E7E1D6'];
const TROUSERS = ['#2C3138', '#5A4A3A', '#3A4A5A', '#6B5A4A'];

// Appearance is derived from the stable walker ID and consumes no route or outfit RNG.
export function civilianLook(id) {
    const index = Math.floor(Math.max(0,id-2000)/2);
    const variants = id%2===0 ? 6 : JACKETS.length;
    const suit = index%variants;
    const group = Math.floor(index/variants);
    return {jacket:JACKETS[suit], skin:SKINS[(suit*3+group)%SKINS.length],
        trousers:TROUSERS[(suit+Math.floor(group/SKINS.length))%TROUSERS.length]};
}

// --- construction ----------------------------------------------------------

// Snap a fresh walker onto the nearest road segment, keeping whatever
// sidewalk side their starting point already sits on.
function snapToGraph(game, ped) {
    const world = game.world;
    const node = nearestNode(world, ped.x, ped.y);
    const link = node.links[Math.floor(game.rng() * node.links.length)];
    const target = world.nodes[link];
    const dx = target.x - node.x;
    const dy = target.y - node.y;
    const len = Math.hypot(dx, dy) || 1;
    const along = clamp(((ped.x - node.x) * dx + (ped.y - node.y) * dy) / (len * len), 0, 1);
    const px = node.x + dx * along;
    const py = node.y + dy * along;
    const side = (ped.x - px) * (-dy / len) + (ped.y - py) * (dx / len) >= 0 ? 1 : -1;
    ped.from = node.id;
    ped.to = link;
    ped.t = along;
    ped.side = side;
    const spot = graphPoint(world, ped);
    ped.x = spot.x;
    ped.y = spot.y;
    ped.h = Math.atan2(dy, dx);
    return ped;
}

function graphPoint(world, ped) {
    const from = world.nodes[ped.from];
    const to = world.nodes[ped.to];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    return {
        x: from.x + dx * ped.t + (-dy / len) * SIDEWALK * ped.side,
        y: from.y + dy * ped.t + (dx / len) * SIDEWALK * ped.side
    };
}

function dress(game) {
    return {
        skin: game.rng.pick(SKINS),
        hair: game.rng.pick(HAIR),
        jacket: game.rng.pick(JACKETS),
        trousers: game.rng.pick(TROUSERS)
    };
}

export function addPed(game, x, y, flee = false) {
    if (game.peds.length >= MAX_PEDS) return null;
    const id = game.nextPedId++;
    const ped = {
        id,
        x, y, h: 0,
        ...dress(game),
        speed: TUNE.walk, gait:makeGait(id),
        moving: true,
        scared: flee ? 2.5 : 0,
        fleeX: game.player.x,
        fleeY: game.player.y,
        dead: false,
        deadTime: 0,
        flash: 0,
        wait: 0,
        crossing: null,
        from: 0, to: 1, t: 0, side: 1
    };
    snapToGraph(game, ped);
    if(flee){ped.x=x;ped.y=y;}
    game.peds.push(ped);
    return ped;
}

// Return a passenger to the sidewalk graph at the stop where the fare ended.
export function leaveCab(game,ped,spot) {
    ped.hailing=false;
    if (!ped.inCab) return;
    ped.inCab=false;
    ped.crossing=null;
    ped.x=spot.x; ped.y=spot.y;
    snapToGraph(game,ped);
    ped.wait=1.5;
}

// Sixty-four walkers scattered across the grid, so every district has
// foot traffic from the first frame.
export function populatePeds(game) {
    game.peds = [];
    game.nextPedId = 2000;
    for (let i = 0; i < 64; i++) {
        const node = game.rng.pick(game.world.nodes);
        const link = game.rng.pick(node.links);
        const target = game.world.nodes[link];
        const t = game.rng.range(0.05, 0.95);
        const dx = target.x - node.x;
        const dy = target.y - node.y;
        const len = Math.hypot(dx, dy) || 1;
        const side = game.rng() < 0.5 ? -1 : 1;
        addPed(
            game,
            node.x + dx * t + (-dy / len) * SIDEWALK * side,
            node.y + dy * t + (dx / len) * SIDEWALK * side
        );
    }
}

// --- per-frame update ------------------------------------------------------

export function updatePeds(game, dt) {
    for (const ped of game.peds) {
        if(ped.dead){ped.deadTime+=dt;continue;}
        const x=ped.x,y=ped.y;
        ped.flash=Math.max(0,(ped.flash||0)-dt);
        if(ped.inCab || ped.hailing){
            npcSpeed(ped,0,dt);
        }else{
            if(ped.scared<=0)noticeDanger(game,ped);
            npcSpeed(ped,ped.scared>0?TUNE.run:ped.wait>0?0:TUNE.walk,dt);
            if(ped.scared>0)runAway(game,ped,dt);
            else if(ped.wait>0)ped.wait-=dt;
            else if(ped.crossing)crossStreet(game,ped,dt);
            else stroll(game,ped,dt);
        }
        finishNpcStep(ped,x,y,dt);
    }
    if (game.peds.some(p => p.dead && p.deadTime > 25)) {
        game.peds = game.peds.filter(p => !p.dead || p.deadTime <= 25);
    }
}

// A fast car bearing down on a walker — or Jax's car, if he is the one
// speeding — sends them running.
function noticeDanger(game, ped) {
    for (const car of game.cars) {
        if (car.wreck || Math.abs(car.speed) <= 55) continue;
        const dx = car.x - ped.x, dy = car.y - ped.y;
        if (dx*dx + dy*dy < 46*46) {
            ped.scared = 2;
            ped.fleeX = car.x;
            ped.fleeY = car.y;
            return;
        }
    }
    const p = game.player;
    if (p.car) {
        const d = Math.hypot(p.x - ped.x, p.y - ped.y);
        if (d < 46 && Math.abs(p.car.speed) > 55) {
            ped.scared = 2;
            ped.fleeX = p.x;
            ped.fleeY = p.y;
        }
    }
}

function runAway(game, ped, dt) {
    ped.scared -= dt;
    const angle = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
    ped.h = angle;
    ped.moving = true;
    moveCircle(game.world, ped, Math.cos(angle) * ped.speed * dt, Math.sin(angle) * ped.speed * dt, 7);
    if (ped.scared <= 0) {
        ped.scared = 0;
        snapToGraph(game, ped);
    }
}

// Crossing the street at the junction: a straight walk from one sidewalk
// to the other, so the move reads as a crosswalk crossing.
function crossStreet(game, ped, dt) {
    const c = ped.crossing;
    c.k += ped.speed*dt / Math.max(1,Math.hypot(c.tx-c.fx,c.ty-c.fy));
    ped.moving = true;
    if (c.k >= 1) {
        ped.x = c.tx;
        ped.y = c.ty;
        ped.crossing=null;
        if(!c.join){ped.side=-ped.side;pickNextLeg(game,ped);}
        return;
    }
    ped.x = c.fx + (c.tx - c.fx) * c.k;
    ped.y = c.fy + (c.ty - c.fy) * c.k;
    ped.h = Math.atan2(c.ty - c.fy, c.tx - c.fx);
}

// Walk the current block. At the junction, usually carry on down a new
// street, sometimes stop to look around, sometimes cross over.
function stroll(game, ped, dt) {
    const world = game.world;
    const from = world.nodes[ped.from];
    const to = world.nodes[ped.to];
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    ped.t += (ped.speed * dt) / len;
    if (ped.t >= 1) {
        ped.t = 1;
        const spot = graphPoint(world, ped);
        ped.x = spot.x;
        ped.y = spot.y;
        arriveAtJunction(game, ped);
        return;
    }
    const spot = graphPoint(world, ped);
    ped.h = Math.atan2(to.y - from.y, to.x - from.x);
    ped.x = spot.x;
    ped.y = spot.y;
    ped.moving = true;
}

function arriveAtJunction(game, ped) {
    const roll = game.rng();
    if (roll < 0.15) {
        ped.wait = game.rng.range(1, 3);
        ped.moving = false;
        pickNextLeg(game, ped, true);
        return;
    }
    if (roll < 0.42) {
        const world = game.world;
        const node = world.nodes[ped.to];
        const from = world.nodes[ped.from];
        const dx = node.x - from.x;
        const dy = node.y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        const ox = (-dy / len) * SIDEWALK * ped.side;
        const oy = (dx / len) * SIDEWALK * ped.side;
        ped.crossing = {
            fx: node.x + ox, fy: node.y + oy,
            tx: node.x - ox, ty: node.y - oy,
            k: 0
        };
        return;
    }
    pickNextLeg(game, ped);
}

function pickNextLeg(game, ped, stay = false) {
    const world = game.world;
    const node = world.nodes[ped.to];
    const options = node.links.filter(id => id !== ped.from);
    const next = options.length && !stay
        ? options[Math.floor(game.rng() * options.length)]
        : game.rng.pick(node.links);
    ped.from = ped.to;
    ped.to = next;
    ped.t = 0;
    const spot=graphPoint(world,ped);
    if(Math.hypot(spot.x-ped.x,spot.y-ped.y)>1)
        ped.crossing={fx:ped.x,fy:ped.y,tx:spot.x,ty:spot.y,k:0,join:true};
}
