// Neon Bay Nights — Jax on foot: walking, sprinting, stealing rides,
// shops, pickups, and taking a hit.
//
// Jax is a plain object on the game: position, heading, health, cash,
// ammo, and whichever car he is sitting in (null on foot). Everything
// else in the game reads those fields directly, so this module is the
// one place that moves them.
import { PALETTE as P, CARS, GARAGE_PRICES, TAPE_COUNT, CAR_COLORS, TUNE, JUMP, gearValue, angleDelta, lerp, clamp, dist } from './config.js';
import { isSolid, moveCircle, lineClear } from './world.js';
import { makeCar, nearestCar, canExit } from './vehicles.js';
import {makeGait,updateGait,approach} from './locomotion.js';
import { missionEvent } from './missions.js';

const START_CASH = 350;
const START_AMMO = 36;
const START_HEALTH = 100;
const AMMO_BOX = 48;
const PICKUP_REACH = 24;
const SERVICE_REACH = 85;
const REPAIR_REACH = 100;
const EXIT_COOLDOWN = 0.6;
const STAMINA_DRAIN = 0.08;
const STAMINA_REGEN = 0.12;
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
        gait:makeGait(), speed:0, phase:0, z:0, vz:0, travelHeading:spawn.h, exhausted:false,
        transition:null, landing:0, hitStop:0, flinch:0, recoil:0, punchLeft:false,
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
    p.flinch=Math.max(0,p.flinch-dt);p.recoil=Math.max(0,p.recoil-dt);
    p.landing=Math.max(0,p.landing-dt);
    p.armed=p.ammo>0 && game.input.mouse.aim && !p.transition && !p.z;
    if(p.armed){
        const spot=game.screenToWorld(game.input.mouse.x,game.input.mouse.y);
        if(dist(spot,p)>.01)p.fireHeading=Math.atan2(spot.y-p.y,spot.x-p.x);
        else p.fireHeading=p.h;
    }
    if(p.transition) advanceTransition(game,dt);
    else if (p.car) {
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
    const len=Math.hypot(axis.x,axis.y);
    const oldX=p.x,oldY=p.y,oldH=p.h,launchSpeed=p.speed;
    const direction=len?Math.atan2(axis.y,axis.x):p.travelHeading;
    const walk=game.input.down('ControlLeft','ControlRight');
    if(p.exhausted && p.stamina>.30) p.exhausted=false;
    const sprint=len && !walk && !p.armed && !p.exhausted && game.input.down('ShiftLeft','ShiftRight');
    p.stamina=clamp(p.stamina+(sprint?-STAMINA_DRAIN:STAMINA_REGEN)*dt,0,1);
    if(!p.stamina)p.exhausted=true;
    let target=len?(walk?TUNE.walk:sprint?TUNE.sprint:TUNE.jog):0;
    if (game.input.tap('KeyG') && nearestService(game,REPAIR_REACH)?.kind==='garage') {
        game.mode='garage'; game.input.clear(); game.onMissionScreen?.('garage'); return;
    }
    const air=p.z>0;
    const jumpPressed=game.input.tap('Space');
    if(!air){
        const heading=p.armed?p.fireHeading:direction;
        const delta=angleDelta(p.h,heading);
        if(p.armed){
            target*=.55;
            if(Math.cos(direction-heading)<-.15)target*=.8;
            p.h=heading;
        }else if(len){
            if(Math.abs(delta)>2*Math.PI/3 && p.speed>TUNE.walk)target=Math.min(target,p.speed*.3);
            const limit=gearValue(p.speed,'turn')*dt;
            p.h+=clamp(delta*(1-Math.exp(-12*dt)),-limit,limit);
        }
        if(len)p.travelHeading=p.armed?direction:p.h;
        p.speed=approach(p.speed,target,target>p.speed?4.5:len?5.5:6.5,dt);
        if(p.speed<.05 && !len)p.speed=0;
        if(jumpPressed && !p.punch && !p.hitStop){
            p.vz=JUMP.takeoff;p.speed=launchSpeed*.9;p.armed=false;
        }
    }else if(len){
        const limit=.1*gearValue(p.speed,'turn')*dt;
        p.travelHeading+=clamp(angleDelta(p.travelHeading,direction),-limit,limit);
    }
    const airborne=air||p.vz>0;
    if(airborne){
        p.z+=p.vz*dt-.5*JUMP.gravity*dt*dt;p.vz-=JUMP.gravity*dt;
        if(p.z<=1e-7){p.z=p.vz=0;p.landing=.33;game.burst(p.x,p.y,'dust',5);}
    }
    const stride=p.speed*(p.punch>0?.5:1)*(p.flinch>.03?.6:1)*Math.max(0,dt-p.hitStop);
    p.hitStop=Math.max(0,p.hitStop-dt);
    moveCircle(game.world,p,Math.cos(p.travelHeading)*stride,Math.sin(p.travelHeading)*stride,TUNE.playerRadius);
    const distance=Math.hypot(p.x-oldX,p.y-oldY);
    p.moving=distance/dt>4;
    updateGait(p.gait,{speed:distance/dt,distance,turn:angleDelta(oldH,p.h)/dt,braking:!len,airborne},dt);
    p.phase=p.gait.phase;
    if(game.input.tap('KeyE') && p.carCooldown<=0 && !airborne) interact(game);

}

// --- getting in and out --------------------------------------------------

// The on-foot interaction: a shop counter beats a car door when both are
// in reach, otherwise take the nearest usable ride.
export function interact(game) {
    const p = game.player;
    if (p.car || p.transition || p.z>0) return false;
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
    if (car.type === 'police' && !car.owned && game.police.stars < 2) {
        game.notify('NBPD INTERCEPTOR', 'Locked down until the heat is on. Come back at two stars.', P.policeRed);
        game.audio.play('empty');
        return false;
    }
    const side=CARS[car.type].width*.5+5;
    const doors=[-1,1].map(sign=>({x:car.x-Math.sin(car.h)*side*sign,
        y:car.y+Math.cos(car.h)*side*sign,sign}));
    const door=doors.filter(v=>!isSolid(game.world,v.x,v.y,7) && lineClear(game.world,p,v))
        .sort((a,b)=>dist(a,p)-dist(b,p))[0];
    if(!door)return false;
    p.transition={kind:'enter',time:0,car,start:{x:p.x,y:p.y},origin:{x:car.x,y:car.y},side:side*door.sign};
    p.armed=false;p.speed=0;return true;
}

function takeSeat(game,car){
    const p=game.player;
    if (car.driver) {
        car.driver = false;
        const runner = game.addPed(car.x, car.y, true);
        if (runner) runner.scared = 3;
    }
    car.ai = 'parked';
    car.stolen = !car.owned;
    car.ambient = false;
    p.car = car;
    p.x = car.x;
    p.y = car.y;
    p.h = car.h;
    p.carCooldown = EXIT_COOLDOWN;
    p.moving = false;
    game.audio.play('enter');
    if(!car.owned) {
        game.stats.stolen += 1;
        game.crime('theft', 1.4, { x: p.x, y: p.y }, false);
    }
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
    p.transition={kind:'exit',time:0,car,start:{x:car.x,y:car.y},spot};
    p.armed=false;p.speed=0;p.moving=false;
    game.audio.play('enter');
    return true;
}

function advanceTransition(game,dt){
    const p=game.player,tr=p.transition,car=tr.car;
    tr.time+=dt;
    const x=p.x,y=p.y;
    if(tr.kind==='enter'){
        if(car.wreck || !game.cars.includes(car) || dist(car,tr.origin)>TUNE.enterDistance*.6 ||
            (car.type==='police' && !car.owned && game.police.stars<2)){
            p.transition=null;p.moving=false;p.travelHeading=p.h;
            game.notify('RIDE UNAVAILABLE',car.wreck?'The engine is wrecked.':'The car is out of reach.',P.carCoral);
            return;
        }
        const doorX=car.x-Math.sin(car.h)*tr.side,doorY=car.y+Math.cos(car.h)*tr.side;
        const walk=clamp(tr.time/.25,0,1),slide=clamp((tr.time-.5)/.3,0,1);
        p.x=lerp(lerp(tr.start.x,doorX,walk),car.x,slide);
        p.y=lerp(lerp(tr.start.y,doorY,walk),car.y,slide);
        const face=walk<1?Math.atan2(doorY-tr.start.y,doorX-tr.start.x):Math.atan2(car.y-doorY,car.x-doorX);
        p.h+=angleDelta(p.h,face)*(1-Math.exp(-12*dt));
        if(tr.time>=.8-1e-8){p.transition=null;takeSeat(game,car);}
    }else{
        const slide=clamp(tr.time/.3,0,1),stand=clamp((tr.time-.3)/.3,0,1);
        const k=.9*slide+.1*stand;
        p.x=lerp(tr.start.x,tr.spot.x,k);p.y=lerp(tr.start.y,tr.spot.y,k);
        if(tr.time>=.6-1e-8){
            const blocked=game.cars.some(v=>v!==car && dist(v,p)<22);
            if(blocked){const safe=canExit(game,car)||huntExitSpot(game,car);if(safe)Object.assign(p,safe);}
            p.transition=null;p.carCooldown=EXIT_COOLDOWN;p.travelHeading=p.h;
        }
    }
    const distance=Math.hypot(p.x-x,p.y-y);
    const walking=tr.kind==='enter'?tr.time<.25:tr.time>.3;
    p.moving=walking && distance>.01;
    updateGait(p.gait,{speed:p.moving?TUNE.walk:0,distance:p.moving?distance:0},dt);
    p.phase=p.gait.phase;
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
        if(!p.car.missionId && p.car.type!=='taxi' && p.car.type!=='police')
            p.car.color=CAR_COLORS[(CAR_COLORS.indexOf(p.car.color)+1)%CAR_COLORS.length];
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

// Collect an owned ride at a clear forecourt bay. A full yard leaves both
// cash and title untouched. Repeated calls bring back the same physical car.
export function collectGarageCar(game,type) {
    if(game.mode!=='garage' || game.player.car || nearestService(game,REPAIR_REACH)?.kind!=='garage'
        || !Object.hasOwn(CARS,type)) return false;
    const owned=game.unlockedCars.has(type), cost=owned?0:GARAGE_PRICES[type];
    if(!Number.isFinite(cost) || game.player.cash<cost) return false;
    const existing=game.cars.find(c=>c.owned && c.type===type);
    const spot=[{x:1214,y:2060},{x:1160,y:2110},{x:1255,y:2110},{x:1200,y:2176}]
        .find(p=>!isSolid(game.world,p.x,p.y,17) && game.cars.every(c=>c===existing || dist(c,p)>54));
    if(!spot) return false;
    const car=existing || makeCar(type,spot.x,spot.y,0,type==='sports'?P.magenta:type==='taxi'?P.taxi:P.teal);
    if(!existing) game.cars.push(car);
    Object.assign(car,spot,{owned:true,ai:'parked',driver:false,wreck:false,hp:CARS[type].hp,
        h:0,vx:0,vy:0,speed:0,handbrake:false,impactCooldown:0});
    game.player.cash-=cost; game.unlockedCars.add(type);
    Object.assign(game.player,spot,{car,h:0,carCooldown:EXIT_COOLDOWN});
    game.save(); game.audio.play('enter'); return true;
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
        if(item.kind==='tape') {
            if(game.tapes.has(item.id)) continue;
            game.tapes.add(item.id);
            item.active=false;
            p.cash+=75; game.stats.earned+=75; game.stats.reputation+=50;
            game.floatText(item.x,item.y,'+$75',P.pink);
            game.notify('NEON TAPE  '+game.tapes.size+' / '+TAPE_COUNT,'+$75  ·  +50 REP',P.pink);
            game.audio.play('pickup'); game.save(); continue;
        }
        if (item.kind === 'cash') {
            const amount = item.amount || 40;
            p.cash += amount;
            game.stats.earned += amount;
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
    p.flinch=.33;
    p.invincible = 0.45;
    game.damageFlash = Math.min(1, game.damageFlash + 0.55);
    game.shake = Math.min(9, game.shake + 3);
    if (p.health <= 0) game.end('dead');
}
