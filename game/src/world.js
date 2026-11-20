import { WORLD, ROADS_X, ROADS_Y, PALETTE as P, clamp } from './config.js';
import { createRandom } from './random.js';
// All architectural decisions use their own stream after lot generation.
function designFrontages(world) {
    const trim=createRandom(world.seed^0x4a79);
    const bases={hotel:85,bank:95,clinic:60,warehouse:55,garage:48,diner:42,shop:44};
    for(const b of world.buildings){
        const cx=b.x+b.w/2,cz=b.y+b.h/2;
        const faces=[];
        for(const x of [...ROADS_X,2778])faces.push({gap:Math.abs(x-cx)-b.w/2,angle:x>cx?Math.PI/2:-Math.PI/2});
        for(const z of ROADS_Y)faces.push({gap:Math.abs(z-cz)-b.h/2,angle:z>cz?0:Math.PI});
        faces.sort((a,b)=>a.gap-b.gap);
        b.front=faces[0].angle;
        // A corner shop also has a display window on its cross street.
        const corners=faces.filter(f=>Math.abs(Math.cos(f.angle-b.front))<.1 && f.gap<=110);
        b.crossFronts=corners.map(f=>f.angle);
        b.height=bases[b.kind]+(b.kind==='hotel'?b.detail*9:b.detail%4*(b.district==='Glasswater'?14:6));
        const neighbors=world.buildings.slice(0,b.id).filter(n=>{
            const dx=Math.max(b.x-n.x-n.w,n.x-b.x-b.w,0);
            const dz=Math.max(b.y-n.y-n.h,n.y-b.y-b.h,0);
            return Math.hypot(dx,dz)<210;
        });
        while(neighbors.some(n=>Math.abs(n.height-b.height)<1))b.height+=3;
    }
    const upperHomes=world.buildings.filter(b=>b.kind==='hotel'||b.kind==='shop' && (b.district==='Coral Mile'||b.district==='Glasswater'));
    const shops=world.buildings.filter(b=>b.kind==='shop' && b.height>=44);
    function select(lots,fraction){
        return lots.map(b=>({b,rank:trim()})).sort((a,b)=>a.rank-b.rank)
            .slice(0,Math.round(lots.length*fraction)).map(row=>row.b);
    }
    for(const b of select(upperHomes,.25))b.balconies=true;
    for(const b of select(shops,.20))b.setback=trim.int(18,30);
}

export function makeWorld(seed) {
    const rng = createRandom(seed), buildings = [], props = [], parks = [], nodes = [], pickups = [];
    const world = {
        ...WORLD, seed, buildings, props, parks, nodes, pickups
    };
    for (let j = 0; j < ROADS_Y.length; j++) {
        for (let i = 0; i < ROADS_X.length; i++) {
            const id = j * ROADS_X.length + i;
            nodes.push({
                id, x: ROADS_X[i], y: ROADS_Y[j], i, j, links: [i > 0 ? id - 1 : null, i < 6 ? id + 1 : null, j > 0 ? id - 7 : null, j < 6 ? id + 7 : null].filter(x => x !== null)
            });
        }
    }
    let bid = 0;
    const addBuilding = (x, y, w, h, kind, district, extra = {}) => {
        const wall = district === 'Glasswater' ? P.glass : rng.pick([P.coral, P.cream, P.mint]);
        const b = {
            id: bid++, x, y, w, h, kind, district, wall, roof: rng.pick([P.terra, '#B66D5F', '#C88769', P.roof]), detail: rng.int(0, 9), ...extra
        };
        buildings.push(b);
        return b;
    };
    for (let j = 0; j < 6; j++) {
        for (let i = 0; i < 6; i++) {
            const x = ROADS_X[i] + 82, y = ROADS_Y[j] + 82, w = 220, h = 220;
            const district = j >= 4 ? 'Marlin Wharf' : i >= 4 ? 'Coral Mile' : 'Glasswater';
            if ((i === 3 && j === 2) || (i === 1 && j === 3)) {
                parks.push({
                    x, y, w, h
                });
                continue;
            }
            if (i === 5 && j === 2) {
                addBuilding(x + 12, y + 25, 196, 130, 'diner', 'Coral Mile', { label: 'ROSA’S', wall: P.cream, roof: P.teal });
                props.push({ kind: 'tables', x: x + 96, y: y + 179 });
                continue;
            }
            if (i === 2 && j === 4) {
                addBuilding(x + 7, y + 15, 206, 154, 'garage', district, { label: 'MARLOWE MOTOR CO.', wall: P.mint });
                continue;
            }
            if (i === 0 && j === 1) {
                addBuilding(x + 6, y + 10, 204, 175, 'clinic', district, { label: 'BAY CLINIC', wall: P.cream });
                continue;
            }
            if (i === 4 && j === 4) {
                addBuilding(x + 8, y + 16, 204, 164, 'warehouse', district, { label: 'COPPER / 09', wall: '#B6AAA0' });
                continue;
            }
            if (i === 2 && j === 1) {
                addBuilding(x + 12, y + 8, 196, 194, 'bank', district, { label: 'BAY TRUST', wall: P.mint, roof: P.roof });
            }
            else if (district === 'Glasswater' && (i + j) % 3 === 0) {
                addBuilding(x + 12, y + 8, 196, 194, 'hotel', district, { label: i === 1 && j === 2 ? 'GLASSWATER HOTEL' : rng.pick(['BAYVIEW', 'SOLANA', 'THE TIDELINE']), roof: P.roof });
            }
            else if (district === 'Marlin Wharf') {
                addBuilding(x + 8, y + 10, 204, rng.int(125, 174), 'warehouse', district, { label: rng.pick(['MARLIN STORAGE', 'BAY FREIGHT', 'NORTH PIER', 'DOCKSIDE']), wall: P.concrete });
                for (let n = 0; n < 2; n++) {
                    props.push({
                        kind: 'container', x: x + 24 + n * 105, y: y + 201, color: n ? P.teal : P.rust
                    });
                }
            }
            else {
                const names = ['LUNA', 'BAJA MARKET', 'RECORDS', 'PALM & CO.', 'SUNSET MOTEL', 'GOLDEN HOUR', 'LA MARÉE', 'SOL CAFÉ'];
                if ((i + j) % 2 === 0) {
                    addBuilding(x + 5, y + 10, 94, 185, 'shop', district, { label: rng.pick(names) });
                    addBuilding(x + 120, y + 10, 94, 185, 'shop', district, { label: rng.pick(names) });
                }
                else {
                    addBuilding(x + 7, y + 5, 206, 92, 'shop', district, { label: rng.pick(names) });
                    addBuilding(x + 7, y + 120, 206, 88, 'shop', district, { label: rng.pick(names) });
                }
            }
        }
    }
    // Small outer lots give the city a finished perimeter, without blocking the road network.
    for (let j = 0; j < 7; j++) {
        addBuilding(96, ROADS_Y[j] - 65, 72, 130, 'shop', j > 3 ? 'Marlin Wharf' : 'Glasswater', { label: j % 2 ? 'BAY INN' : 'SOL' });
        if (j !== 3) {
            addBuilding(2650, ROADS_Y[j] - 64, 90, 128, 'shop', 'Coral Mile', { label: j % 2 ? 'SURF CLUB' : 'TIDE BAR' });
        }
    }
    for (let i = 0; i < 7; i++) {
        for (const y of [100, 2675]) {
            addBuilding(ROADS_X[i] - 62, y, 124, 80, 'warehouse', y > 2000 ? 'Marlin Wharf' : 'Glasswater', { label: 'NEON BAY' });
        }
    }
    designFrontages(world);
    for (const x of ROADS_X) {
        for (let j = 0; j < 6; j++) {
            for (const side of [-1, 1]) {
                for (let n = 0; n < 3; n++) {
                    const y = ROADS_Y[j] + 105 + n * 83;
                    props.push({
                        kind: 'palm', x: x + side * 68, y, scale: rng.range(.82, 1.08), phase: rng.range(0, 6)
                    });
                    if (n === 1) {
                        props.push({ kind: 'lamp', x: x + side * 62, y: y + 31 });
                    }
                }
            }
        }
    }
    for (const y of ROADS_Y) {
        for (let i = 0; i < 6; i++) {
            for (const side of [-1, 1]) {
                const x = ROADS_X[i] + 190;
                props.push({
                    kind: 'palm', x, y: y + side * 68, scale: rng.range(.85, 1.12), phase: rng.range(0, 6)
                });
                props.push({
                    kind: 'bench', x: x + 61, y: y + side * 67, h: side < 0 ? 0 : Math.PI
                });
                props.push({ kind: 'lamp', x: x - 65, y: y + side * 62 });
            }
        }
    }
    for (const park of parks) {
        for (let n = 0; n < 9; n++) {
            props.push({
                kind: 'palm', x: park.x + 24 + (n % 3) * 80, y: park.y + 30 + Math.floor(n / 3) * 79, scale: 1.1, phase: rng.range(0, 6)
            });
        }
    }
    for (let y = 120; y < 2800; y += 105) {
        props.push({
            kind: 'palm', x: 2820, y, scale: 1.25, phase: rng.range(0, 6)
        });
        if (y % 2) {
            props.push({
                kind: 'bench', x: 2867, y: y + 36, h: Math.PI / 2
            });
        }
        props.push({
            kind: 'umbrella', x: 2930 + rng.range(-8, 14), y: y + 43, color: rng.pick([P.carCoral, P.teal, P.mango])
        });
    }
    for(const x of ROADS_X) for(const y of ROADS_Y.slice(0,-1)) {
        props.push({kind:'bin',x:x-69,y:y+180},{kind:'manhole',x:x+12,y:y+96});
        if(y>=1792) props.push({kind:'cone',x:x+49,y:y+121},{kind:'cone',x:x+49,y:y+137});
        props.push({kind:'hydrant',x:x+57,y:y+83}, {kind:'planter',x:x-76,y:y+236});
    }
    const streetRng=createRandom(seed^0x71ae);
    // Signals use the same junction phase as traffic, including the short amber interval.
    for(const node of nodes){
        if((node.i+node.j)%2!==0)continue;
        props.push({kind:'signal',x:node.x-58,y:node.y-58,node,angle:0});
        props.push({kind:'signal',x:node.x+58,y:node.y-58,node,angle:-Math.PI/2});
    }
    for(let j=0;j<7;j+=2){
        const node=nodes[j*7+6];
        props.push({kind:'signal',x:2722,y:node.y-55,node,angle:0});
    }
    for(const x of [2176,2560,2778]) for(const y of ROADS_Y.slice(0,-1)){
        const curb=x===2778?39:59;
        for(const side of [-1,1]){
            const px=x+curb*side, py=y+streetRng.int(95,245);
            props.push({kind:'bin',x:px+side*4,y:py},{kind:'hydrant',x:px,y:py+11});
            props.push({kind:'cone',x:px-2*side,y:py+20});
        }
    }
    for(const district of ['Glasswater','Coral Mile','Marlin Wharf']){
        const local=nodes.filter(n=>districtAt(n.x,n.y+110)===district && n.j<6);
        for(let i=0;i<8;i++){
            const n=streetRng.pick(local);
            props.push({kind:'puddle',x:n.x+(i%2?1:-1)*47,y:n.y+streetRng.int(85,304),
                width:streetRng.range(2.6,5.3),length:streetRng.range(13,29),phase:streetRng.range(0,6)});
        }
    }
    world.services = [
        {
            id: 'diner', name: 'Rosa’s Diner', short: 'ROSA’S DINER', x: 2444, y: 1336, kind: 'food', price: 40, icon: '+'
        },
        {
            id: 'garage', name: 'Marlowe Motor Co.', short: 'YOUR GARAGE', x: 1214, y: 2060, kind: 'garage', price: 100, icon: 'G'
        },
        {
            id: 'clinic', name: 'Bay Clinic', short: 'BAY CLINIC', x: 440, y: 968, kind: 'clinic', price: 60, icon: '+'
        },
        {
            id: 'ammo', name: 'Dockside Supplies', short: 'DOCKSIDE SUPPLIES', x: 2025, y: 2085, kind: 'ammo', price: 45, icon: 'A'
        }
    ];
    world.spawn = { x: 2490, y: 1345, h: Math.PI / 2 };
    world.gangSpawns = [{ x: 1900, y: 2080 }, { x: 1948, y: 2095 }, { x: 2105, y: 2012 }, { x: 2045, y: 2109 }];
    for (let i = 0; i < 14; i++) {
        const service = world.services[i % 4];
        let p = i < 4 ? { x: service.x + 65, y: service.y } : sidewalkPoint(world, rng);
        if (!isSolid(world, p.x, p.y, 10)) {
            pickups.push({
                id: i, ...p, kind: i % 3 === 0 ? 'health' : 'ammo', active: true, respawn: 0, phase: rng.range(0, 6)
            });
        }
    }
    world.solids = [...buildings, ...props.filter(p => p.kind === 'container').map(p => ({
            x: p.x - 43, y: p.y - 16, w: 86, h: 32
        }))];
    // Stable IDs survive a new seed or a change in the ambient pickup population.
    const tapeSpots=[[188,488],[710,856],[1100,465],[1510,1180],[1864,1550],
        [2250,1120],[2862,1350],[710,2010],[1600,2246],[2460,2490]];
    tapeSpots.forEach(([x,y],i)=>pickups.push({
        id:'tape-'+(i+1),kind:'tape',x,y,phase:i*.9,active:true,respawn:0
    }));
    return world;
}
export function districtAt(x, y) {
    return y >= 1820 ? 'Marlin Wharf' : x >= 2110 ? 'Coral Mile' : 'Glasswater';
}
export function nearestNode(world, x, y) {
    let best = world.nodes[0], d = Infinity;
    for (const n of world.nodes) {
        const v = (n.x - x) ** 2 + (n.y - y) ** 2;
        if (v < d) {
            d = v;
            best = n;
        }
    }
    return best;
}
export function route(world, from, to) {
    const queue = [from], prev = new Map([[from, null]]);
    for (let i = 0; i < queue.length; i++) {
        const n = queue[i];
        if (n === to) {
            break;
        }
        for (const id of world.nodes[n].links) {
            if (!prev.has(id)) {
                prev.set(id, n);
                queue.push(id);
            }
        }
    }
    const path = [];
    let id = to;
    while (id !== null && id !== undefined) {
        path.unshift(world.nodes[id]);
        id = prev.get(id);
    }
    return path;
}
export function roadDistance(x, y) {
    let closest = Infinity;
    for (const road of ROADS_X) closest = Math.min(closest, Math.abs(road - x));
    for (const road of ROADS_Y) closest = Math.min(closest, Math.abs(road - y));
    return closest;
}
export function isSolid(world, x, y, r = 0) {
    if (x < 40 + r || y < 40 + r || x > world.water - 12 - r || y > world.height - 40 - r) {
        return true;
    }
    for (const b of world.solids || world.buildings) {
        if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) {
            return true;
        }
    }
    return false;
}
export function lineClear(world, a, b) {
    const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.ceil(len / 22);
    for (let i = 1; i < steps; i++) {
        if (isSolid(world, a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, 0)) {
            return false;
        }
    }
    return true;
}
export function moveCircle(world, actor, dx, dy, r) {
    let hit = false;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
    for (let i = 0; i < steps; i++) {
        const x = clamp(actor.x + dx / steps, 40 + r, world.water - 13 - r), y = clamp(actor.y + dy / steps, 40 + r, world.height - 40 - r);
        if (!isSolid(world, x, actor.y, r)) {
            actor.x = x;
        }
        else {
            hit = true;
        }
        if (!isSolid(world, actor.x, y, r)) {
            actor.y = y;
        }
        else {
            hit = true;
        }
    }
    return hit;
}
export function sidewalkPoint(world, rng) {
    for (let i = 0; i < 100; i++) {
        const vertical = rng() < .5;
        const p = vertical ? { x: rng.pick(ROADS_X) + rng.pick([-1, 1]) * 66, y: rng.range(180, 2600) } : { x: rng.range(180, 2620), y: rng.pick(ROADS_Y) + rng.pick([-1, 1]) * 66 };
        if (!isSolid(world, p.x, p.y, 8)) {
            return p;
        }
    }
    return { ...world.spawn };
}
export function signalPhase(time,node) {
    return (time + node.i * 1.8 + node.j * 1.2) % 13;
}
export function signalGreen(time, node, horizontal) {
    const phase=signalPhase(time,node);
    return horizontal ? phase < 5.7 : phase > 6.5 && phase < 12.2;
}
