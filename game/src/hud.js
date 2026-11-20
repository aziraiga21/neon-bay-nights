// Neon Bay Nights — HUD: everything Jax needs at a glance, and nothing
// he doesn't. Cash and health top-left, wanted stars top-right, the job
// objective across the top, speed bottom-right, and a live minimap
// bottom-left. Tab opens the same map full-screen, where a click drops
// a waypoint.
import { districtAt, route, nearestNode } from './world.js';
import { dist, CARS, TAPE_COUNT, TUNE, PALETTE as P, ROADS_X, ROADS_Y, money, clamp } from './config.js';
import { round, text, ellipse, polygon } from './art.js';

const MAP_W = 432;
const MAP_H = 360;
const MINI_W = 200;
const MINI_H = 167;

// --- baked minimap ---------------------------------------------------------
// One small painting of the whole city, drawn once per world: water and
// sand on the east edge, asphalt avenues, block paving, and a dot of
// colour per building. The live dots (player, cars, police, marker) are
// painted over it every frame.

export function makeMap(world) {
    const sheet = document.createElement('canvas');
    sheet.width = MAP_W;
    sheet.height = MAP_H;
    const ctx = sheet.getContext('2d');
    const sx = MAP_W / world.width;
    const sy = MAP_H / world.height;
    ctx.fillStyle = '#565367';
    ctx.fillRect(0, 0, MAP_W, MAP_H);
    ctx.fillStyle = '#26536c';
    ctx.fillRect(world.water * sx, 0, MAP_W - world.water * sx, MAP_H);
    ctx.fillStyle = '#aa958f';
    ctx.fillRect(world.coast * sx, 0, (world.water - world.coast) * sx, MAP_H);
    ctx.fillStyle = '#557875';
    for (const park of world.parks || []) {
        ctx.fillRect(park.x * sx, park.y * sy, park.w * sx, park.h * sy);
    }
    ctx.fillStyle = '#9a9ba7';
    for (const x of ROADS_X) ctx.fillRect((x - 52) * sx, 0, 104 * sx, MAP_H);
    for (const y of ROADS_Y) ctx.fillRect(0, (y - 52) * sy, 2780*sx, 104 * sy);
    ctx.fillStyle='#9a9ba7';
    ctx.fillRect(2744*sx,0,68*sx,MAP_H);
    for (const b of world.buildings || []) {
        ctx.fillStyle = b.district==='Marlin Wharf'?'#766c79':b.district==='Coral Mile'?'#a77f86':'#67818d';
        ctx.fillRect(b.x * sx, b.y * sy, Math.max(2, b.w * sx), Math.max(2, b.h * sy));
    }
    ctx.fillStyle = P.teal;
    for (const s of world.services || []) {
        ctx.fillRect(s.x * sx - 2, s.y * sy - 2, 4, 4);
    }
    return sheet;
}

// --- shared dot layer ------------------------------------------------------

function paintDots(ctx, game, ox, oy, scale) {
    const dot = (x, y, r, color) => ellipse(ctx, ox + x * scale, oy + y * scale, r, r, color);
    for (const car of game.cars) {
        if (car.wreck) continue;
        dot(car.x,car.y,car.type==='police'?2.8:1.3,car.type==='police'?P.policeRed:'#d2cbce');
    }
    for (const officer of game.police.officers) {
        if (!officer.dead) dot(officer.x, officer.y, 2, P.policeRed);
    }
    for (const foe of game.enemies) {
        if (!foe.dead) dot(foe.x, foe.y, 2, P.carCoral);
    }
    for(const tape of game.world.pickups) if(tape.kind==='tape' && tape.active) {
        const x=ox+tape.x*scale, y=oy+tape.y*scale;
        ctx.fillStyle='#34223d';ctx.fillRect(x-3,y-2.5,6,5);
        ctx.fillStyle='#ff86d5';ctx.fillRect(x-2,y-1.5,4,3);
    }
    const marker = game.mission.marker;
    if (marker) {
        const pulse = 4 + Math.sin(game.time * 4) * 1.5;
        dot(marker.x, marker.y, pulse, P.mango);
        dot(marker.x, marker.y, 2.5, P.paper);
    }
    if (game.waypoint) dot(game.waypoint.x, game.waypoint.y, 3, P.cyan);
    const p = game.player;
    ctx.save();
    ctx.translate(ox+p.x*scale,oy+p.y*scale);ctx.rotate(p.car?.h ?? p.h);
    polygon(ctx,[[7,0],[-5,5],[-3,0],[-5,-5]],'#fff4c5',P.ink); ctx.restore();
}

// --- the frame HUD ---------------------------------------------------------

export function drawHUD(ctx, game, renderer) {
    const w = renderer?.width || 1280;
    const h = renderer?.height || 800;
    if(game.player.car && Math.abs(game.player.car.speed)>255) {
        const intensity=clamp((Math.abs(game.player.car.speed)-255)/150,0,1);
        ctx.strokeStyle='rgba(255,229,205,'+(.19*intensity)+')';ctx.lineWidth=1.5;
        for(let i=0;i<18;i++){
            const a=i*2.399963+Math.sin(i)*.27;
            const r=.48+((i*.33+game.time*.9)%1)*.18;
            ctx.beginPath();ctx.moveTo(w*(.5+Math.cos(a)*r),h*(.56+Math.sin(a)*r));
            ctx.lineTo(w*(.5+Math.cos(a)*(r+.08)),h*(.56+Math.sin(a)*(r+.08)));ctx.stroke();
        }
    }
    drawVitals(ctx, game);
    drawWanted(ctx, game, w);
    drawObjective(ctx, game, w);
    drawMinimap(ctx, game, renderer, h);
    drawSpeed(ctx, game, w, h);
    drawToast(ctx, game, w);
    drawBust(ctx, game, w, h);
    drawHint(ctx, game, w, h);
    game.floats.slice(-3).forEach((f,i)=>{
        ctx.save();ctx.globalAlpha=clamp(f.life*2,0,1);
        ctx.shadowBlur=4;ctx.shadowColor='#1f202d';
        text(ctx,f.text,25,137+i*20-(1.6-f.life)*8,17,f.color); ctx.restore();
    });
    if(!game.capture && game.lastSave>0 && game.time-game.lastSave<2.2 && !game.saveError)
        text(ctx,'✓  SAVED',w-26,87,11,P.paper,'right');
    if (game.mission.dialogue) drawDialogue(ctx, game, w, h);
}

function panel(ctx, x, y, pw, ph) {
    round(ctx,x,y,pw,ph,5,'#161b30eb','#addbd331');
}

function drawVitals(ctx, game) {
    const p = game.player;
    panel(ctx,16,15,213,91);
    ctx.fillStyle='#75e2d1';ctx.fillRect(16,21,3,32);
    text(ctx,money(p.cash),29,45,25,'#fff3d7');
    text(ctx,'REP '+game.stats.reputation,216,34,11,'#a8dcd2','right');
    text(ctx,'TAPES '+game.tapes.size+'/'+TAPE_COUNT,216,50,10,'#f4a6d0','right');
    const pct=clamp(p.health/100,0,1);
    round(ctx,29,59,163,6,3,'#40344a');
    if(pct) round(ctx,29,59,163*pct,6,3,pct>.5?'#73dbb4':P.carCoral);
    text(ctx,Math.ceil(p.health)+'',215,67,10,P.paper,'right');
    text(ctx,'AMMO  '+p.ammo,29,91,12,P.paper);
    text(ctx,p.car?'ENGINE  '+Math.ceil(p.car.hp):'ON FOOT',215,91,11,'#b2c6d4','right');
}

function drawWanted(ctx, game, w) {
    const stars = game.police.stars;
    panel(ctx, w - 244, 12, 230, 52);
    if (stars > 0) text(ctx, 'WANTED', w - 232, 30, 9, P.policeRed);
    else text(ctx, 'NEON BAY PD', w - 232, 30, 9, P.paper);
    for (let i = 0; i < 5; i++) {
        const cx = w - 218 + i * 30;
        star(ctx,cx,48,stars>=3 && i<stars?9.5+Math.sin(game.time*5)*1.1:9,i<stars?'#ffc36a':'#535667');
    }
    text(ctx, game.clock, w - 26, 30, 12, P.paper, 'right');
    text(ctx, game.dusk > .86 ? 'NIGHT' : game.dusk > .55 ? (game.clock < '12:00' ? 'DAWN' : 'SUNSET') : 'DAY', w - 26, 52, 9, P.paper, 'right');
}

function star(ctx, cx, cy, r, color) {
    const points = [];
    for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? r : r * 0.45;
        points.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
    polygon(ctx, points, color, P.ink);
}

function drawObjective(ctx, game, w) {
    const m = game.mission;
    const waypoint=!m.active && !game.fare && !m.marker && game.waypoint;
    const label = m.active ? 'ROSA’S JOB  /  '+m.active.title.toUpperCase()
        : game.fare?'BAY CAB  /  '+(game.fare.stage==='pickup'?'PICKUP':'METER RUNNING')
        : waypoint?'NAVIGATION':m.marker?'AFTER HOURS':'FREE ROAM';
    const body=waypoint?waypoint.label:m.objective || '';
    ctx.font='bold 14px Arial';
    const pw=clamp(ctx.measureText(body).width+38,310,630);
    const x=(w-pw)/2;
    panel(ctx,x,15,pw,56);
    const accent=waypoint?P.cyan:game.fare?P.taxi:m.active?'#ffb87a':'#88dfd4';
    ctx.fillStyle=accent;ctx.fillRect(x,23,3,38);
    text(ctx,label,x+16,35,11,accent);
    text(ctx,body,x+16,56,14,P.paper);
    const marker=m.marker || waypoint, remaining=game.fare?.remaining ?? m.active?.remaining;
    if(remaining!=null){
        const sec=Math.max(0,Math.ceil(remaining));
        text(ctx,Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0'),x+pw-13,35,13,sec<15?P.carCoral:accent,'right');
    } else if(marker){
        text(ctx,Math.floor(dist(game.player,marker))+' m',x+pw-13,35,12,accent,'right');
    }
}

function drawMinimap(ctx, game, renderer, h) {
    const x = 14;
    const y = h - MINI_H - 14;
    const map = renderer?.map;
    round(ctx, x - 3, y - 3, MINI_W + 6, MINI_H + 6, 6, '#18333BE6', P.ink);
    if (map) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, MINI_W, MINI_H);
        ctx.clip();
        ctx.drawImage(map, x, y, MINI_W, MINI_H);
        ctx.restore();
    } else {
        ctx.fillStyle = P.asphalt;
        ctx.fillRect(x, y, MINI_W, MINI_H);
    }
    paintDots(ctx, game, x, y, MINI_W / game.world.width);
    panel(ctx,x-3,y-29,MINI_W+6,27);
    const p=game.player;
    text(ctx,p.x>2740?'OCEAN DRIVE':districtAt(p.x,p.y).toUpperCase(),x+7,y-11,13,'#ffe9cf');
    text(ctx,'N ↑',x+MINI_W-8,y-11,11,'#a7dcd6','right');
}

function drawSpeed(ctx, game, w, h) {
    const car = game.player.car;
    if (!car) return;
    const mph = Math.round(Math.abs(car.speed) * 0.32);
    const x=w-196,y=h-102;
    panel(ctx,x,y,180,85);
    text(ctx,CARS[car.type].name.toUpperCase(),x+13,y+21,11,'#a7ded8');
    ctx.font='italic bold 40px Arial';ctx.fillStyle=P.paper;ctx.textAlign='right';
    ctx.fillText(mph,x+122,y+61);
    text(ctx,car.speed<-4?'REV':'MPH',x+132,y+59,12,'#ffc981');
    for(let i=0;i<19;i++){
        ctx.fillStyle=i/19<Math.abs(car.speed)/CARS[car.type].max?(i<14?'#79dacc':'#ff8c87'):'#464154';
        ctx.fillRect(x+14+i*8,y+70,6,4);
    }
    if(car.hp<45) text(ctx,car.wreck?'WRECKED':'ENGINE',x+13,y+49,9,P.carCoral);
}

function drawToast(ctx, game, w) {
    const t = game.toast;
    if (!t || game.time > t.until) return;
    ctx.font='bold 12px Arial';
    const tw=Math.max(ctx.measureText(t.title).width,ctx.measureText(t.sub || '').width);
    const pw = clamp(tw + 44, 220, 560);
    const x = (w - pw) / 2;
    panel(ctx, x, 80, pw, t.sub ? 52 : 34);
    text(ctx, t.title, x + pw / 2, 100, 13, t.color || P.mango, 'center');
    if (t.sub) text(ctx, t.sub, x + pw / 2, 118, 11, P.paper, 'center');
}

function drawBust(ctx, game, w, h) {
    const bust = game.police.bust || 0;
    if (bust <= 0.03) return;
    const pw = 300;
    const x = (w - pw) / 2;
    const y = h - 120;
    panel(ctx, x, y, pw, 40);
    text(ctx, 'NBPD CLOSING IN — BREAK AWAY', x + pw / 2, y + 16, 11, P.policeRed, 'center');
    round(ctx, x + 14, y + 24, pw - 28, 6, 3, '#3A2E28');
    round(ctx, x + 14, y + 24, (pw - 28) * clamp(bust, 0, 1), 6, 3, P.policeRed);
}

function drawHint(ctx, game, w, h) {
    const p = game.player;
    let hint = '';
    if (p.car) hint = p.car.type==='taxi' && !game.mission.active && !game.fare?'T  TAKE A FARE':'E  EXIT    ·    SHIFT  HANDBRAKE';
    else if(game.world.services.some(s=>s.kind==='garage' && Math.hypot(p.x-s.x,p.y-s.y)<100)) hint='G  OPEN GARAGE';
    else {
        let near = false;
        for (const car of game.cars) {
            if (!car.wreck && Math.hypot(car.x - p.x, car.y - p.y) < TUNE.enterDistance) {
                near = true;
                break;
            }
        }
        hint = near ? 'E ENTER / STEAL CAR' : 'SPACE JUMP · RMB AIM · LMB ATTACK · TAB MAP';
    }
    ctx.font='bold 11px Arial';
    const sw=ctx.measureText(hint).width+22, y=p.car?h-134:h-45;
    panel(ctx,w-sw-16,y,sw,24);text(ctx,hint,w-27,y+16,11,'#e4e5e4','right');
}

function drawDialogue(ctx, game, w, h) {
    const lines = game.mission.dialogue.lines || [];
    const boxH = 30 + lines.length * 24;
    const bw = clamp(w * 0.62, 420, 760);
    const x = (w - bw) / 2;
    const y = h - boxH - 18;
    panel(ctx, x, y, bw, boxH);
    lines.forEach(([speaker, line], i) => {
        const ly = y + 26 + i * 24;
        text(ctx, speaker, x + 16, ly, 10, speaker === 'MAMA ROSA' ? P.mango : P.cyan);
        text(ctx, line, x + 118, ly, 11, P.paper);
    });
    text(ctx, 'ENTER ▸', x + bw - 14, y + boxH - 8, 10, P.mango, 'right');
}

// --- full-screen map -------------------------------------------------------

export function drawFullMap(ctx, game, renderer) {
    const w = renderer?.width || 1280;
    const h = renderer?.height || 800;
    ctx.fillStyle = '#142D38D9';
    ctx.fillRect(0, 0, w, h);
    const scale=Math.min(Math.min(w-32,760)/game.world.width,Math.min(h-148,600)/game.world.height);
    const mw = game.world.width * scale;
    const mh = game.world.height * scale;
    const x = (w - mw) / 2;
    const y = (h - mh) / 2 + 8;
    game.mapRect = { x, y, w: mw, h: mh, scale };
    round(ctx, x - 6, y - 6, mw + 12, mh + 12, 8, '#0F232BD9', P.paper);
    if (renderer?.map) ctx.drawImage(renderer.map, x, y, mw, mh);
    const target=game.waypoint || game.mission.marker;
    if(target){
        const a=nearestNode(game.world,game.player.x,game.player.y),b=nearestNode(game.world,target.x,target.y);
        const points=[game.player,...route(game.world,a.id,b.id),target];
        ctx.save();ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
        points.forEach((p,i)=>ctx[i?'lineTo':'moveTo'](x+p.x*scale,y+p.y*scale));
        ctx.strokeStyle='#253049';ctx.lineWidth=6;ctx.stroke();
        ctx.strokeStyle=game.waypoint?P.cyan:P.mango;ctx.lineWidth=3;ctx.stroke();ctx.restore();
    }
    paintDots(ctx, game, x, y, scale);
    text(ctx, 'NEON BAY — CITY MAP', w / 2, y - 18, 16, P.paper, 'center');
    text(ctx, 'CLICK TO SET WAYPOINT · TAB / ESC TO CLOSE', w / 2, y + mh + 30, 11, P.mango, 'center');
    const lx = x + 10;
    const ly = y + 14;
    text(ctx, 'CORAL MILE', lx + 2220 * scale, ly + 700 * scale, 11, P.paper);
    text(ctx, 'GLASSWATER', lx + 500 * scale, ly + 1500 * scale, 11, P.paper);
    text(ctx, 'MARLIN WHARF', lx + 900 * scale, ly + 2300 * scale, 11, P.paper);
    text(ctx, 'THE BAY', lx + 3050 * scale, ly + 1400 * scale, 11, P.cyan);
    text(ctx, '◆ YOU', x, y + mh + 52, 10, P.mango);
    text(ctx, '◆ POLICE', x + 70, y + mh + 52, 10, P.policeRed);
    text(ctx, '◆ JOB MARKER', x + 150, y + mh + 52, 10, P.mango);
    text(ctx,'▣ NEON TAPE',x+370,y+mh+52,10,P.pink);
    text(ctx, '◆ WAYPOINT', x + 260, y + mh + 52, 10, P.cyan);
}
