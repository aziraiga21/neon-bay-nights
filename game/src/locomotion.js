// The simulation owns phase. Distances here are the displacement after collision resolution.
import {clamp, lerp, gearValue, HIP_HEIGHT, LEG} from './config.js';

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const poses = [
    {hip:25, knee:60, absorb:12, arm:18, elbow:25, pump:8, lean:3, bob:1.2, flight:0},
    {hip:35, knee:80, absorb:20, arm:26, elbow:40, pump:12, lean:6, bob:1.8, flight:.10},
    {hip:45, knee:100, absorb:30, arm:34, elbow:65, pump:15, lean:10, bob:2.6, flight:.30},
    {hip:52, knee:125, absorb:40, arm:42, elbow:85, pump:18, lean:15, bob:3.2, flight:.45}
];
export const approach = (a,b,rate,dt) => lerp(a,b,1-Math.exp(-rate*dt));
const smooth = t => t*t*(3-2*t);

export function makeGait(id = 0) {
    const seed = (id*.61803398875 % 1)*TAU;
    return {phase:seed, seed, speed:0, visualSpeed:0, g:0, weight:0, lean:0,
        bank:0, anticipation:0, idle:0, clock:0};
}

export function updateGait(g, {speed, distance, turn=0, braking=false, airborne=false, panic=false}, dt) {
    g.speed = speed;
    g.clock += dt;
    g.idle = speed < 1 ? g.idle+dt : 0;
    const duration = speed < 34 ? .15 : speed < 64 ? .25 : speed < 107 ? .30 : .35;
    g.visualSpeed = approach(g.visualSpeed,speed,1/duration,dt);
    g.g = approach(g.g,smooth(clamp((speed-27)/8,0,1)),1/duration,dt);
    g.weight = approach(g.weight,clamp(speed/24,0,1),speed>4?8:10,dt);
    const cadence = (62*Math.sqrt(speed/16)+24)/60;
    if (!airborne && distance>0 && speed>0) {
        g.phase += distance/(2*speed/cadence)*TAU*(panic?1.1:1);
    } else if (!airborne && speed<1) {
        g.phase = approach(g.phase,Math.round(g.phase/Math.PI)*Math.PI,7,dt);
    }
    g.lean = approach(g.lean,(braking?-4:gearValue(g.visualSpeed,'lean',poses))*RAD*g.weight,8,dt);
    g.bank = approach(g.bank,clamp(.00075*turn*speed,-.28,.28),9,dt);
    g.anticipation = approach(g.anticipation,clamp(turn*.15,-.262,.262),10,dt);
}

// φ = 0 is left heel strike. The swing curves use a quarter-cycle offset
// so their maximum forward extension coincides with that contact.
function leg(phi, hip, knee, absorb, arm, elbow, pump, weight) {
    const s=Math.sin(phi), c=Math.cos(phi);
    const frames=[15,20,0,-50,15];
    const position=((phi/TAU%1+1)%1)*4, i=Math.floor(position);
    return {
        hip:hip*(s+.25*Math.sin(2*phi))*weight,
        knee:(knee*Math.max(0,c)**1.5+absorb*Math.max(0,-c))*weight,
        foot:lerp(frames[i],frames[i+1],smooth(position-i))*RAD*weight,
        shoulder:(-s-.18)*arm*weight,
        elbow:lerp(10*RAD,elbow+pump*Math.max(0,-s),weight),
        spread:0
    };
}

export function solvePose(g, actor = {}) {
    const val=k=>gearValue(g.visualSpeed,k,poses);
    const phi=g.phase+Math.PI/2, w=g.weight;
    const legs=[phi,phi+Math.PI].map(a=>leg(a,val('hip')*RAD*(actor.armed?.8:1),
        val('knee')*RAD,val('absorb')*RAD,val('arm')*RAD,val('elbow')*RAD,val('pump')*RAD,w));
    const [left,right]=legs;
    const idle=clamp(g.idle-.5,0,1);
    const breath=Math.sin(g.clock*Math.PI*.5+g.seed)*idle;
    const landing=clamp((actor.landing||0)/.15,0,1);
    const flinch=clamp((actor.flinch||0)/.25,0,1)*clamp((.33-(actor.flinch||0))/.08,0,1);
    const pose={left,right,
        pelvisY:(val('bob')*Math.abs(Math.cos(phi))-.8*val('flight')*Math.abs(Math.sin(phi))**12)*w-3*landing,
        sway:actor.armed?2*Math.sin(phi)*w:0,
        bank:g.bank+(g.idle>8?.026*breath:0), tilt:.031*Math.sin(2*phi+.6)*w,
        pelvisYaw:.11*Math.sin(phi)*w, shoulderYaw:-.14*Math.sin(phi)*w,
        lean:g.lean+.02*Math.sin(2*phi)*w-flinch*8*RAD,
        headYaw:-g.anticipation+.33*idle*Math.sin(g.clock*1.3+g.seed),
        footYaw:-g.anticipation*2, breath:1+breath*.005, gun:!!actor.armed};
    for(const limb of legs){
        limb.shoulder+=breath*.007;
        limb.knee+=35*RAD*landing;
        limb.hip+=16*RAD*landing;
        if(actor.scared>0) {limb.elbow+=20*RAD;limb.spread=.22;}
        if(actor.z>0) {
            limb.hip=RAD*(actor.vz>95?30:25);limb.knee=RAD*(actor.vz>95?70:60);
            limb.spread=.35;limb.shoulder=.34;
        }
    }
    if(actor.armed){
        const recoil=clamp((actor.recoil||0)/.08,0,1);
        right.shoulder=RAD*(77+3*recoil);right.elbow=15*RAD;
        left.shoulder=.86; left.elbow=.75;pose.lean-=2*RAD*recoil;
    }
    if(actor.punch>0){
        const t=(actor.role==='rival'?.30:.35)-actor.punch;
        const drive=smooth(clamp(t/.12,0,1))*smooth(clamp((.35-t)/.18,0,1));
        const limb=actor.punchLeft?left:right;
        limb.shoulder=lerp(-20,70,drive)*RAD;limb.elbow=lerp(86,12,drive)*RAD;
        pose.shoulderYaw+=(actor.punchLeft?1:-1)*15*RAD*drive;
        pose.gun=false;
    }
    const tr=actor.transition;
    if(tr){
        const reach=tr.kind==='enter'?clamp((tr.time-.20)/.1,0,1):1-clamp(tr.time/.3,0,1);
        const crouch=tr.kind==='enter'?clamp((tr.time-.50)/.3,0,1):1-clamp((tr.time-.3)/.3,0,1);
        right.shoulder+=.7*reach;
        for(const limb of legs){limb.hip+=.80*crouch;limb.knee+=1.55*crouch;}
    }
    // Solve after landing flexion so a bent knee brings the hips down to the planted shoe.
    const soleHeight=limb=>HIP_HEIGHT-LEG.thigh*Math.cos(limb.hip)-LEG.shin*Math.cos(limb.hip-limb.knee)
        +.72*Math.sin(limb.foot)-1.09*Math.cos(limb.foot)
        -Math.hypot(2.04*Math.sin(limb.foot),.39*Math.cos(limb.foot));
    const flight=val('flight')*g.g;
    const inFlight=flight?smooth(clamp((Math.abs(Math.cos(phi))-(1-flight))/flight,0,1)):0;
    if(!actor.z) pose.pelvisY=lerp(-Math.min(soleHeight(left),soleHeight(right)),pose.pelvisY,tr?0:inFlight*(1-landing));
    return pose;
}

// NPC paths can rejoin the sidewalk graph after a scare. A graph relocation
// contributes no footsteps; only motion along the current leg drives phase.
export function npcSpeed(actor, target, dt) {
    actor.speed=approach(actor.speed||0,target,target===0?6.5:4.5,dt);
    return actor.speed;
}

export function finishNpcStep(actor,x,y,dt) {
    actor.gait??=makeGait(actor.id);
    const travelled=Math.hypot(actor.x-x,actor.y-y);
    const distance=Math.min(travelled,Math.max(0,actor.speed||0)*dt);
    actor.moving=distance>4*dt;
    updateGait(actor.gait,{speed:dt?distance/dt:0,distance,panic:actor.scared>0},dt);
}
