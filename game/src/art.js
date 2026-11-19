// Neon Bay Nights — procedural art, third-person 3D edition.
//
// Two jobs live here. First, the 3D mesh builders the renderer draws
// every frame: the merged static city (ground, roads, buildings, palms,
// lamps, props), one merged geometry per car type and per person outfit,
// pickups, and mission beacons. Everything is built from boxes,
// cylinders, cones and spheres with vertex colours from the exact
// palette, so a whole district costs a handful of draw calls.
//
// Second, the small 2D canvas helpers the HUD still draws with
// (rounded panels, text, dots, stars). The HUD is a 2D overlay canvas;
// the world is 3D.
import * as THREE from './../vendor/three.module.min.js';
import { createRandom } from './random.js';
import { PALETTE as P, CARS, WORLD, ROADS_X, ROADS_Y } from './config.js';

// --- 2D canvas helpers (used by hud.js) -----------------------------------

export function round(ctx, x, y, w, h, r, fill, stroke) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

export function text(ctx, str, x, y, size, color, align = 'left') {
    ctx.font = `bold ${size}px Arial, Helvetica, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
}

export function ellipse(ctx, x, y, rx, ry, color) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
}

export function polygon(ctx, points, fill, stroke) {
    ctx.beginPath();
    points.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
    }
    if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    }
}

// --- 3D: part helpers ------------------------------------------------------
// A "part" is a transformed geometry plus one flat colour. Parts are
// merged into a single vertex-coloured BufferGeometry, so a whole car,
// person, or the entire static city renders in one draw call per material.
//
const _color = new THREE.Color();

function boxPart(w, h, d, x, y, z, color, ry = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    return { geo, color };
}

function cylPart(rt, rb, h, x, y, z, color, seg = 8) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg);
    geo.translate(x, y, z);
    return { geo, color };
}

function conePart(r, h, x, y, z, color, seg = 8) {
    const geo = new THREE.ConeGeometry(r, h, seg);
    geo.translate(x, y, z);
    return { geo, color };
}

function spherePart(r, x, y, z, color, sx = 1, sy = 1, sz = 1, seg = 10) {
    const geo = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
    geo.scale(sx, sy, sz);
    geo.translate(x, y, z);
    return { geo, color };
}

function flatPart(w, d, x, z, color, y = 0) {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, y, z);
    return { geo, color };
}

// A flat quad standing on a wall, facing outward (ry turns it to face
// +z, -z, +x or -x). Used for window bands: two triangles per band.
function wallQuad(w, h, x, y, z, color, ry = 0) {
    const geo = new THREE.PlaneGeometry(w, h);
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    return { geo, color };
}

function mergeParts(parts) {
    const geos = [];
    let total = 0;
    for (const part of parts) {
        const geo = part.geo.index ? part.geo.toNonIndexed() : part.geo;
        geos.push({ geo, color: part.color });
        total += geo.attributes.position.array.length;
    }
    const positions = new Float32Array(total);
    const normals = new Float32Array(total);
    const colors = new Float32Array(total);
    const uvs = new Float32Array((total / 3) * 2);
    let offset = 0, uvOffset = 0;
    for (const { geo, color } of geos) {
        const pos = geo.attributes.position.array;
        const nor = geo.attributes.normal.array;
        const uv = geo.attributes.uv?.array;
        positions.set(pos, offset);
        normals.set(nor, offset);
        if (uv) uvs.set(uv, uvOffset);
        uvOffset += (pos.length / 3) * 2;
        if (color === null) {
            colors.set(geo.attributes.color.array,offset);
            offset += pos.length;
            continue;
        }
        _color.set(color);
        for (let i = offset; i < offset + pos.length; i += 3) {
            colors[i] = _color.r;
            colors[i + 1] = _color.g;
            colors[i + 2] = _color.b;
        }
        offset += pos.length;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    out.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    return out;
}

// A street-level camera sees just a few blocks. Keep distant blocks out
// of both the colour and shadow passes, including on software renderers.
function mergeBlocks(parts) {
    const blocks=new Map();
    for(const part of parts){
        part.geo.computeBoundingBox();
        const b=part.geo.boundingBox;
        const key=Math.floor((b.max.x+b.min.x)/768)+','+Math.floor((b.max.z+b.min.z)/768);
        if(!blocks.has(key)) blocks.set(key,[]);
        blocks.get(key).push(part);
    }
    return Array.from(blocks.values(),group=>mergeParts(group));
}

// 2D heading h (0 = east, clockwise) becomes a Three.js yaw of -h, so a
// mesh built facing +x points the way the simulation thinks it does.
export const yawFor = h => -h;

// --- 3D: the static city ---------------------------------------------------

function buildingHeight(b) {
    const base = {
        hotel: 130, bank: 95, clinic: 60, warehouse: 55,
        garage: 48, diner: 42, shop: 44
    }[b.kind] || 46;
    if (b.kind === 'hotel') return 85 + b.detail * 9;
    return base + (b.detail % 4) * (b.district === 'Glasswater' ? 14 : 6);
}

// One atlas for the whole city. Every face gets its own seed, so adjoining
// hotel rooms, closed shutters and illuminated shop windows vary by address.
function paintFacade(ctx, mask, b, width, height, seed) {
    const rng = createRandom(seed);
    const wharf = b.kind === 'warehouse' || b.kind === 'garage';
    const glass = b.district === 'Glasswater' && !wharf;
    const wall = wharf ? rng.pick(['#a38f86','#adb6b4','#b6a296']) : b.wall;
    const rect = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
    rect(0,0,256,256,wall);
    const trim = glass ? '#e1d8cc' : wharf ? '#786c70' : '#fae0b6';
    if (wharf) {
        for (let x=0; x<256; x+=5) rect(x,0,1,256,'#51496739');
    }
    const cols = Math.max(2, Math.round(width / (wharf ? 40 : 24)));
    const rows = Math.max(1, Math.round((height - 24) / 20));
    const bay = 244 / cols, floor = 158 / rows;
    for (let row=0; row<rows; row++) {
        const y=14+row*floor;
        if (!wharf) rect(0,y-3,256,3,trim);
        for (let col=0; col<cols; col++) {
            const x=7+col*bay, w=bay*(glass?.9:.72), h=floor*(glass?.85:.62);
            const lit = rng() < (wharf ? .14 : .34);
            rect(x-1,y-1,w+3,h+4,wharf?'#615b68':'#8d8293');
            const fill=ctx.createLinearGradient(0,y,0,y+h);
            fill.addColorStop(0,lit?'#ffd18c':rng.pick(['#526889','#445778','#655c7d']));
            fill.addColorStop(1,lit?'#ffab7e':rng.pick(['#96ced3','#beadb6','#dfa1aa']));
            rect(x,y,w,h,fill);
            if(lit){
                mask.fillStyle='#ffe0ad';mask.fillRect(x,y,w,h);
                mask.clearRect(x+w*.5,y,2,h);
            }
            rect(x+w*.5,y,1.8,h,'#514d65');
            if (lit && rng() < .7) rect(x,y,w*.2,h,'#bd8075');
            if (!glass) rect(x-2,y+h,w+5,3,trim);
        }
    }
    rect(0,173,256,6,trim);
    for (let col=0; col<Math.min(cols,5); col++) {
        const slot=250/Math.min(cols,5), x=5+col*slot;
        rect(x,188,slot-5,65,trim);
        if (wharf) {
            rect(x+2,191,slot-9,62,'#626774');
            for (let y=196;y<252;y+=6) rect(x+2,y,slot-9,2,'#475463');
        } else {
            const pane=ctx.createLinearGradient(0,188,0,251);
            pane.addColorStop(0,'#806987'); pane.addColorStop(.62,'#3e5c70'); pane.addColorStop(1,'#25384e');
            rect(x+2,191,slot-9,58,pane);
            rect(x+slot*.47,191,2,60,trim);
            rect(x+2,202,slot-8,2,trim);
            if(col%2===1) rect(x+5,215,slot*.19,16,'#ffaf85');
        }
    }
    rect(0,252,256,4,trim);
}

// A folded central blade with a fringe of narrow leaflets keeps a palm
// recognisable from the roadside and lets the sunset through its crown.
function frond(length, width, curl, angle, x, y, z, color) {
    const vertices=[];
    const rib=t=>[length*t,Math.sin(Math.PI*t)*length*.30-curl*t*t,0];
    const tri=(a,b,c)=>vertices.push(...a,...b,...c,...c,...b,...a);
    for(let i=0;i<6;i++) {
        const t=i/6, end=(i+1)/6, a=rib(t), b=rib(end);
        const broad=width*(.18+.82*Math.sin(Math.PI*(t+.05)));
        for(const k of [-1,1]) {
            const edge=[a[0],a[1]-.45,broad*.32*k],next=[b[0],b[1]-.45,broad*.32*k];
            tri(a,b,edge);tri(edge,b,next);
            tri(a,b,[b[0]+length*.05,b[1]-broad*.85,broad*k]);
        }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.computeVertexNormals();geo.rotateY(-angle);geo.translate(x,y,z);
    return {geo,color};
}

function strut(a,b,r,color) {
    const start=new THREE.Vector3(...a), end=new THREE.Vector3(...b), axis=end.clone().sub(start);
    const geo=new THREE.CylinderGeometry(r,r,axis.length(),6);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize()));
    const mid=start.lerp(end,.5);geo.translate(mid.x,mid.y,mid.z);return {geo,color};
}

// The pleasure pier is a navigational landmark from Ocean Drive. Its wheel,
// boarded deck and sailboats share the city's two opaque geometry batches.
function buildPier(rest,glow) {
    const x=3055,z=885,cy=91,r=71;
    rest.push(boxPart(275,4,33,2954,9,z,'#aa8071'));
    for(let i=0;i<11;i++) for(const side of [-1,1]){
        const px=2825+i*25;
        rest.push(boxPart(2,19,2,px,8,z+14*side,'#8c706c'));
        if(i<10) rest.push(boxPart(25,1.2,1.1,px+12.5,16,z+14*side,P.cream));
    }
    for(const side of [-1,1]){
        const zz=z+side*5;
        rest.push(strut([x-39,10,zz+side*7],[x,cy,zz],2.4,'#d9bfa8'),
            strut([x+39,10,zz+side*7],[x,cy,zz],2.4,'#d9bfa8'));
        for(let i=0;i<32;i++){
            const a=i*Math.PI/16, b=(i+1)*Math.PI/16;
            const pt=t=>[x+Math.cos(t)*r,cy+Math.sin(t)*r,zz];
            rest.push(strut(pt(a),pt(b),1.4,'#e4c3b6'));
            if(i%2===0){
                rest.push(strut([x,cy,zz],pt(a),.6,'#d4aaa7'));
                glow.push(spherePart(1.6,...pt(a),i%4?'#fff6c1':'#ff9cac',1,1,1,5));
                if(side===1){
                    const [px,py]=pt(a);rest.push(boxPart(7,6,8,px,py-5,z,'#53858d'));
                    glow.push(boxPart(7.6,1.3,8.6,px,py-2,z,'#ffcc98'));
                }
            }
        }
    }
    glow.push(cylPart(2.1,2.1,9,x,cy,z,'#ffbd98'));
    for(const [bx,bz,sz] of [[3090,1130,1],[3200,980,.78],[3370,745,1.4],[3105,1775,.9]]){
        rest.push(spherePart(10,bx,1,bz,'#fff0d4',.6,.22,1.7,9),cylPart(.45,.6,30*sz,bx,16*sz,bz,'#897c81'));
        const geo=new THREE.BufferGeometry();
        const points=[bx,31*sz,bz,bx-1,5,bz-12*sz,bx-1,5,bz];
        geo.setAttribute('position',new THREE.Float32BufferAttribute([...points,...points.slice(6),...points.slice(3,6),...points.slice(0,3)],3));
        geo.computeVertexNormals();rest.push({geo,color:'#ffe5ba'});
    }
}

// Crowns share geometry at two levels of detail. Grouping instances by
// block keeps a distant avenue cheap without changing the player's skyline.
export function buildPalms(world, material) {
    const blocks=new Map(), group=new THREE.Group();
    const near=[],far=[];
    for(const [parts,leaves] of [[near,9],[far,6]]) {
        parts.push(strut([0,0,0],[3,54,0],1.72,'#a18670'),
            cylPart(2.8,1.7,7,3,52,0,'#748951',7));
        if(parts===near) for(let k=1;k<7;k++) parts.push(
            cylPart(1.83,1.94,.8,3*k/7,54*k/7,0,'#886d5d',7));
        for(let i=0;i<leaves;i++) {
            if(parts===near) parts.push(frond(24+i%3*3.5,3.4,4+i%3*3,i*2.4,3,56,0,
                ['#3a816b','#589365','#416c5a'][i%3]));
            else {
                const geo=new THREE.BufferGeometry(), r=22+i%2*5;
                const pts=[0,0,0,10,4,-2.6,r,-4,0,0,0,0,r,-4,0,10,4,2.6];
                const rev=[...pts.slice(6,9),...pts.slice(3,6),...pts.slice(0,3),
                    ...pts.slice(15,18),...pts.slice(12,15),...pts.slice(9,12)];
                geo.setAttribute('position',new THREE.Float32BufferAttribute([...pts,...rev],3));
                geo.computeVertexNormals();geo.rotateY(i*2.4);geo.translate(3,56,0);
                parts.push({geo,color:i%2?'#579168':'#39745f'});
            }
        }
    }
    const nearGeo=mergeParts(near),farGeo=mergeParts(far), dummy=new THREE.Object3D();
    for(const tree of world.props.filter(p=>p.kind==='palm')){
        const key=Math.floor(tree.x/320)+','+Math.floor(tree.y/320);
        if(!blocks.has(key))blocks.set(key,[]);
        blocks.get(key).push(tree);
    }
    for(const trees of blocks.values()){
        const x=trees.reduce((sum,t)=>sum+t.x,0)/trees.length;
        const y=trees.reduce((sum,t)=>sum+t.y,0)/trees.length;
        const lod=new THREE.LOD(); lod.position.set(x,0,y);
        for(const [geo,distance] of [[nearGeo,0],[farGeo,550]]){
            const mesh=new THREE.InstancedMesh(geo,material,trees.length);
            trees.forEach((p,i)=>{
                dummy.position.set(p.x-x,0,p.y-y);dummy.rotation.y=p.phase;
                dummy.scale.set(p.scale,p.scale*(.95+p.phase*.026),p.scale);
                dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
            });
            mesh.castShadow=true;mesh.computeBoundingSphere();
            lod.addLevel(mesh,distance);
        }
        group.add(lod);
    }
    return group;
}

export function buildCityGeometry(world) {
    const walls = [], rest = [], glow = [];
    const size = 256, columns = 16;
    const sheet = document.createElement('canvas');
    sheet.width=columns*size;
    const tiles = world.buildings.length*2;
    sheet.height=Math.ceil(tiles/columns)*size;
    const ctx=sheet.getContext('2d');
    const lamps=document.createElement('canvas');lamps.width=sheet.width/4;lamps.height=sheet.height/4;
    const mask=lamps.getContext('2d');mask.scale(.25,.25);
    function facadeBox(b, w, h, d, x, y, z) {
        const part=boxPart(w,h,d,x,y,z,'#ffffff');
        const uv=part.geo.attributes.uv;
        for (let face=0;face<6;face++) {
            const tile=b.id*2+(face<2?1:0);
            for(let corner=0;corner<4;corner++){
                const i=face*4+corner;
                uv.setXY(i,(tile%columns+(0.004+uv.getX(i)*.992))/columns,
                    1-(Math.floor(tile/columns)+.996-uv.getY(i)*.992)/(sheet.height/size));
            }
        }
        walls.push(part);
    }
    // Ground: sidewalk paving under everything, sand on the beach strip.
    rest.push(flatPart(world.width, world.height,
        world.width / 2, world.height / 2, P.sidewalk, 0));
    rest.push(flatPart(world.water - world.coast, world.height,
        (world.coast + world.water) / 2, world.height / 2, P.sand, 0.12));
    for (const park of world.parks || []) {
        rest.push(flatPart(park.w, park.h,
            park.x + park.w / 2, park.y + park.h / 2, P.grass, 0.14));
    }

    const roads=[];
    // Roads: asphalt strips and dashed centre lines.
    for (const x of ROADS_X) {
        roads.push(flatPart(104, world.height, x, world.height / 2, P.asphalt, 0.15));
    }
    for (const y of ROADS_Y) {
        roads.push(flatPart(2780, 104, 1390, y, P.asphalt, 0.17));
    }
    for (const x of ROADS_X) {
        for (let y = 60; y < world.height; y += 46) {
            rest.push(flatPart(4, 20, x, y, P.yellow, 0.28));
        }
    }
    for (const y of ROADS_Y) {
        for (let x = 60; x < 2780; x += 46) {
            rest.push(flatPart(20, 4, x, y, P.yellow, 0.28));
        }
    }
    // Ocean Drive follows the seawall beyond the easternmost city blocks.
    roads.push(flatPart(68,world.height,2778,world.height/2,P.asphalt,.19));
    for(let y=20;y<world.height;y+=44) rest.push(flatPart(2,22,2778,y,P.yellow,.28));
    for(const x of [2744,2812]) rest.push(flatPart(1.8,world.height,x,world.height/2,P.curb,.29));
    for (const x of ROADS_X.slice(0,-1)) for(const y of ROADS_Y.slice(0,-1)) {
        const c=x>=2000?'#d7b9aa':y>=1750?'#b6a9a4':'#ccc3bc';
        rest.push(flatPart(278,278,x+192,y+192,c,.13));
        for(let i=60;i<330;i+=32) {
            rest.push(flatPart(.8,278,x+i,y+192,'#ac9d98',.145));
            rest.push(flatPart(278,.8,x+192,y+i,'#ac9d98',.145));
        }
        for(const edge of [54,330]) {
            rest.push(flatPart(2.5,276,x+edge,y+192,P.curb,.24));
            rest.push(flatPart(276,2.5,x+192,y+edge,P.curb,.24));
        }
    }
    // Wharf crossings use paired lines, the shopping streets use zebra bars.
    for (const x0 of ROADS_X) {
        for (const y0 of ROADS_Y) {
            for (const dx of (y0 >= 2100 ? [-36,-30,30,36] : [-39,-26,-13,0,13,26,39])) {
                rest.push(flatPart(5, 14, x0 + dx, y0 - 58, P.white, 0.32));
                rest.push(flatPart(5, 14, x0 + dx, y0 + 58, P.white, 0.32));
                rest.push(flatPart(14, 5, x0 - 58, y0 + dx, P.white, 0.32));
                rest.push(flatPart(14, 5, x0 + 58, y0 + dx, P.white, 0.32));
            }
        }
    }

    for(const part of roads){
        const pos=part.geo.attributes.position,uv=part.geo.attributes.uv;
        for(let i=0;i<pos.count;i++) uv.setXY(i,pos.getX(i)/120,pos.getZ(i)/120);
    }
    const ground=rest.splice(0);
    buildPier(rest,glow);
    // The lifting gantries stand on the container pads behind the wharf sheds.
    for(const depot of world.buildings.filter(b=>b.kind==='warehouse' && b.x>2120 && b.y>1800 && b.y<2600)){
        const x=depot.x+depot.w*.64,z=depot.y+depot.h+24;
        const paint='#be765c', boomY=108;
        for(const side of [-1,1]){
            rest.push(strut([x+side*12,0,z],[x+side*5,boomY,z],2.2,paint));
            rest.push(strut([x+side*12,0,z+12],[x+side*5,boomY,z+7],2.2,paint));
        }
        for(let i=0;i<7;i++){
            const bx=x-25+i*15;
            rest.push(strut([bx,boomY,z],[bx+15,boomY+7,z],1.1,paint),
                strut([bx+15,boomY+7,z],[bx+15,boomY,z],.9,paint));
        }
        rest.push(boxPart(106,2.4,7,x+27,boomY,z,paint),boxPart(106,1.7,5,x+27,boomY+7,z,paint),
            boxPart(15,9,13,x,boomY-5,z,'#49898d'),
            strut([x+65,boomY,z],[x+65,62,z],.48,'#494252'),
            boxPart(9,2.5,4,x+65,61,z,'#d8ad62'));
        glow.push(spherePart(1.9,x-22,boomY+9,z,'#ff6d69',1,1,1,6));
    }
    // Break up the northern horizon with the far side of Glasswater Bay.
    rest.push(boxPart(4900,12,670,1730,-4,-320,'#ba9caa'));
    for(let i=0;i<30;i++) {
        const rng=createRandom(world.seed+77*i);
        const h=rng.range(45,150), x=i*126-350, z=-180-rng.range(0,240);
        const paint=rng.pick(['#8c859b','#a593a2','#9790aa']);
        rest.push(boxPart(60,h,65,x,h/2,z,paint),boxPart(33,12,43,x,h+4,z,paint));
        if(i%4===1) rest.push(cylPart(.6,2,34,x,h+22,z,paint,5));
    }
    // Seawall along the coast.
    rest.push(boxPart(6, 8, world.height, 2816, 4, world.height / 2, P.seawall));

    for (const b of world.buildings) {
        const H=buildingHeight(b), cx=b.x+b.w/2, cz=b.y+b.h/2;
        for(let side=0;side<2;side++) {
            const tile=b.id*2+side;
            ctx.save(); ctx.translate((tile%columns)*size,Math.floor(tile/columns)*size);
            mask.save();mask.translate((tile%columns)*size,Math.floor(tile/columns)*size);
            paintFacade(ctx,mask,b,side?b.h:b.w,H,world.seed+tile*109);
            mask.restore();
            ctx.restore();
        }
        facadeBox(b,b.w,H,b.h,cx,H/2,cz);
        rest.push(boxPart(b.w+3,3,b.h+3,cx,H,cz,b.roof));
        rest.push(boxPart(b.w*.25,6,b.h*.14,cx-b.w*.22,H+4,cz,'#928d97'));
        for(let i=0;i<4;i++) rest.push(flatPart(2,b.h*.1,cx-b.w*.31+i*4,cz,'#454d5a',H+7.1));
        if(b.kind==='warehouse' || b.kind==='garage'){
            const tone=b.detail%2?'#779398':'#b47461';
            for(const side of [-1,1]){
                rest.push(boxPart(1.6,3,b.h+1,cx+side*b.w*.5,H-5,cz,tone));
                for(const off of [-.3,.3]) rest.push(boxPart(1.9,H*.6,1.6,cx+side*b.w*.504,H*.3,cz+off*b.h,'#839299'));
            }
        }
        if(b.kind==='hotel' || b.kind==='bank') {
            const tower=H*(b.kind==='hotel'?1.3:.62);
            facadeBox(b,b.w*.62,tower,b.h*.6,cx-12,H+tower/2,cz-14);
            rest.push(boxPart(b.w*.65,4,b.h*.63,cx-12,H+tower,cz-14,P.mullion));
            rest.push(boxPart(b.w*.38,9,b.h*.34,cx-12,H+tower+6,cz-14,P.glassDeep));
            if(b.kind==='hotel'){
                rest.push(boxPart(b.w*.64,2,19,cx,H+2,cz+b.h*.36,P.trim));
                glow.push(flatPart(b.w*.60,16,cx,cz+b.h*.36,P.pool,H+3.1));
            }
        } else if(b.kind==='shop' || b.kind==='diner'){
            const fabric=b.detail%2?'#1f9799':'#e65c78';
            for (const side of [-1,1]) {
                const z=cz+side*(b.h/2+4);
                rest.push(boxPart(b.w*.89,2.4,10,cx,19,z,fabric));
                for(let i=0;i<9;i+=2) rest.push(boxPart(b.w*.09,2.9,10.2,cx+(i-4)*b.w*.098,19,z,P.trim));
            }
            glow.push(boxPart(b.w+2,1.15,b.h+2,cx,H-3,cz,b.detail%2?'#ff96ad':'#86f8df'));
        }
    }

    // Props: palms, lamps, benches, umbrellas, containers, diner tables.
    let lampIndex = 0;
    for (const prop of world.props) {
        const { kind, x, y } = prop;
        if (kind === 'lamp') {
            rest.push(cylPart(1.1, 1.4, 30, x, 15, y, '#2C3138', 5));
            rest.push(boxPart(10,2,3,x+4,30,y,P.night));
            glow.push(boxPart(6,1.2,3,x+6,28.8,y,++lampIndex%3?P.lamp:P.glint));
        } else if (kind === 'bench') {
            const h = prop.h || 0;
            rest.push(boxPart(22, 3, 8, x, 6, y, '#6E3B32', -h));
            rest.push(boxPart(22, 9, 2,
                x + Math.sin(h) * 3.5, 10, y + Math.cos(h) * 3.5, '#6E3B32', -h));
            for(const dx of [-8,8]) rest.push(boxPart(2,5,5,x+dx,2.5,y,P.night));
        } else if(kind==='hydrant') {
            rest.push(cylPart(2.3,3,7,x,3.5,y,'#dd5342'),spherePart(2.8,x,7,y,'#eb7052',1,.7,1,6),
                boxPart(8,2.8,2.8,x,4.3,y,'#d94842'));
        } else if(kind==='planter') {
            rest.push(boxPart(23,4.5,8,x,2.3,y,'#e3c9ae'),spherePart(4,x-5,6,y,'#649079',1.3,1,.8,7),
                spherePart(4.7,x+3,6.4,y,'#76a277',1.4,1,.82,7));
        } else if (kind === 'umbrella') {
            rest.push(cylPart(1, 1, 22, x, 11, y, '#F4EFE6', 5));
            rest.push(conePart(17, 9, x, 26, y, prop.color || P.carCoral, 8));
        } else if (kind === 'container') {
            rest.push(boxPart(86, 26, 32, x, 13, y, prop.color || P.teal));
        } else if (kind === 'tables') {
            rest.push(cylPart(11, 11, 2, x, 9, y, '#F4EFE6', 8));
            rest.push(cylPart(1.5, 1.5, 9, x, 4.5, y, '#2C3138', 5));
        }
    }

    const atlas = new THREE.CanvasTexture(sheet);
    atlas.colorSpace=THREE.SRGBColorSpace;
    const windows=new THREE.CanvasTexture(lamps);windows.colorSpace=THREE.SRGBColorSpace;
    return { walls: mergeBlocks(walls), rest: mergeBlocks(rest), ground:mergeParts(ground), road:mergeParts(roads), glow: mergeParts(glow), atlas, windows };

}

// Rooftop blades and double-sided marquees carry the hand-painted shop names.
export function buildSigns(world) {
    const signs=[];
    for(const b of world.buildings) {
        const named=['diner','garage','clinic','bank','hotel'].includes(b.kind)
            || ['COPPER / 09','BAY FREIGHT','MARLIN STORAGE','SURF CLUB','TIDE BAR','SUNSET MOTEL','BAJA MARKET','RECORDS'].includes(b.label);
        if(!named) continue;
        const c=document.createElement('canvas');
        c.width=640; c.height=152;
        const ctx=c.getContext('2d'), neon=b.detail%2?'#ff96bc':'#88ffed';
        ctx.fillStyle='#232b45'; ctx.fillRect(0,0,c.width,c.height);
        ctx.strokeStyle=neon; ctx.lineWidth=3; ctx.strokeRect(8,8,624,136);
        ctx.textAlign='center'; ctx.fillStyle='#fbd6ac';
        ctx.font='bold 20px monospace';
        ctx.fillText(b.district.toUpperCase().split('').join(' '),320,37);
        ctx.shadowBlur=8; ctx.shadowColor=neon; ctx.fillStyle=neon;
        ctx.font='italic bold 68px sans-serif'; ctx.fillText(b.label,320,110,576);
        const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
        const mat=new THREE.MeshBasicMaterial({map:tex});
        const H=buildingHeight(b), w=Math.min(b.w*.80,104), h=w*152/640;
        const faces=[
            [b.x+b.w+.6,b.y+b.h/2,Math.PI/2],[b.x-.6,b.y+b.h/2,-Math.PI/2],
            [b.x+b.w/2,b.y+b.h+.6,0],[b.x+b.w/2,b.y-.6,Math.PI]
        ];
        const geo=new THREE.PlaneGeometry(w,h);
        for(const [x,z,ry] of faces) {
            const mesh=new THREE.Mesh(geo,mat);
            mesh.position.set(x, Math.min(H-h*.54,22+h/2),z);
            mesh.rotation.y=ry; signs.push(mesh);
        }
    }
    return signs;
}

// Tapered sections describe the sill, wheel shoulders and folded bonnet.
// The same sections carry their own glass reflection or painted body colour.
function coachwork(sections, side, top, front=side) {
    const positions=[], colors=[];
    function quad(a,b,c,d,color,glass=false) {
        _color.set(color);
        for(const v of [a,b,c,a,c,d]){
            if(glass) _color.set(v[1]>sections[0][1]+1?'#efafb1':'#426981');
            positions.push(...v); colors.push(_color.r,_color.g,_color.b);
        }
    }
    const rings=sections.map(([x,y,w,bottom,baseW])=>
        [[x,bottom,-baseW],[x,bottom,baseW],[x,y,w],[x,y,-w]]);
    for(let i=0;i<rings.length-1;i++){
        const a=rings[i],b=rings[i+1];
        for(let j=0;j<4;j++) {
            const k=(j+1)%4;
            const color=j===2?(Array.isArray(top)?top[i]:top):side;
            quad(a[j],b[j],b[k],a[k],color,Array.isArray(top) && j===2 && i!==1 && color!==side);
        }
    }
    quad(...rings[0],front);
    quad(...rings.at(-1).slice().reverse(),front);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors,3));
    geo.computeVertexNormals();
    return geo;
}

// --- 3D: cars ---------------------------------------------------------------
// One merged geometry per (type, colour), built facing +x (front at +x).

const carCache = new Map();

export function carGeometry(type, color) {
    const key = `${type}|${color}`;
    const hit = carCache.get(key);
    if (hit) return hit;
    const def = CARS[type] || CARS.sedan;
    const L = def.length, W = def.width;
    const parts = [];
    const isVan = type === 'van' || type === 'armored';
    const sports=type==='sports', cabH=isVan?22:sports?14.2:17;
    const bodyTop=sports?8.7:10.5;
    // Double-sided trim quads attach to sloped body panels.
    function trim(a,b,c,d,paint) {
        const geo=new THREE.BufferGeometry();
        geo.setAttribute('position',new THREE.Float32BufferAttribute([...a,...b,...c,...a,...c,...d,...c,...b,...a,...d,...c,...a],3));
        geo.computeVertexNormals();parts.push({geo,color:paint});
    }
    const hull=coachwork([
        [-L*.5,bodyTop-1,W*.42,3.8,W*.39],[-L*.43,bodyTop+.4,W*.50,3.3,W*.47],
        [L*.26,bodyTop,W*.50,3.3,W*.47],[L*.48,bodyTop-(sports?2:1),W*.46,3.8,W*.44],
        [L*.5,bodyTop-2.5,W*.4,4.2,W*.39]], color,color);
    const cabin=coachwork([
        [-L*(isVan?.47:.36),bodyTop+.3,W*.45,bodyTop-.8,W*.46],
        [-L*(isVan?.45:.17),cabH,W*.36,bodyTop-.8,W*.46],
        [L*(isVan?.26:.055),cabH+.3,W*.36,bodyTop-.8,W*.45],
        [L*(isVan?.43:.26),bodyTop+.1,W*.43,bodyTop-.8,W*.44]],
        isVan?color:'#527386',[isVan?color:'#7095a9',color,'#8fb1c2']);
    // Pillars, rocker panels, mirrors and deeply inset wheel hubs.
    for(const side of [-1,1]){
        if(!isVan) {
            const base=bodyTop-.1, high=cabH-.6;
            const v=(x,y)=>[x*L,y,side*W*(.462-(y-base)/(high-base)*.087)];
            trim(v(-.313,base+.4),v(-.153,high),v(-.07,high),v(-.07,base+.4),'#3c6478');
            trim(v(-.048,base+.4),v(-.048,high),v(.056,high),v(.225,base+.4),'#80afbd');
            trim(v(-.05,base),v(-.057,high+.25),v(-.073,high+.25),v(-.069,base),P.sportsInk);
            trim(v(-.21,base+.5),v(-.14,high-.3),v(-.16,high-.3),v(-.233,base+.5),'#96afba');
        }
        parts.push(boxPart(L*.65,1.1,1,0,4,side*W*.476,P.sportsInk));
        parts.push(boxPart(2,2,2.8,L*.15,bodyTop+.9,side*W*.5,color));
        parts.push(boxPart(2,1,1,-2,bodyTop-1,side*W*.5,P.glint));
        if(isVan) parts.push(boxPart(7,6,.7,L*.21,bodyTop+4,side*W*.432,P.carGlass));
        for(const ax of [-.31,.31]){
            const wheel=sports?3.85:4.6, faceZ=(W*.50+1)*side;
            for(let i=0;i<5;i++){
                const a=i*2*Math.PI/5;
                parts.push(strut([ax*L+Math.cos(a)*.5,wheel+Math.sin(a)*.5,faceZ],
                    [ax*L+Math.cos(a)*2.2,wheel+Math.sin(a)*2.2,faceZ],.30,'#dce1e2'));
            }
            for(const [r,thick,offset,col] of [[wheel,2.6,.47,P.tire],[wheel*.64,.45,.524,'#788895'],[1,.5,.531,P.sportsInk]]){
                const geo=new THREE.CylinderGeometry(r,r,thick,12);
                geo.rotateX(Math.PI/2); geo.translate(L*ax,wheel,W*offset*side);
                parts.push({geo,color:col});
            }
        }
        parts.push(boxPart(1,1.8,W*.25,-L*.49,bodyTop-1,side*W*.285,'#ff405d'));
        parts.push(boxPart(1,1.8,W*.23,L*.49,bodyTop-2.2,side*W*.285,'#ffefcb'));
    }
    if(!isVan){
        const screenPoint=(t,z)=>[L*(.055+(1-t)*.205)+.04,
            bodyTop+.17+(cabH+.3-bodyTop-.1)*t,z*W*(.43-.07*t)];
        trim(screenPoint(.08,-.86),screenPoint(.95,-.40),screenPoint(.95,-.27),screenPoint(.08,-.73),'#9ab4c6');
        for(const side of [-1,1]) {
            parts.push(strut(screenPoint(.09,side*.73),screenPoint(.18,side*.10),.15,'#374955'));
        }
        // Heated rear screen and bright window surrounds follow the fastback slope.
        for(const t of [.25,.45,.65,.85]){
            const x=L*(-.36+.19*t), y=bodyTop+.45+(cabH-bodyTop)*t;
            parts.push(boxPart(.18,.16,W*(.83-.13*t),x-.15,y,0,'#435568'));
        }
        for(const side of [-1,1]){
            const a=[-L*.36,bodyTop+.35,side*W*.452],b=[-L*.17,cabH+.12,side*W*.363],
                c=[L*.055,cabH+.42,side*W*.363],d=[L*.26,bodyTop+.18,side*W*.44];
            parts.push(strut(a,b,.34,color),strut(b,c,.32,color),strut(c,d,.38,color));
        }
    }
    parts.push(boxPart(1.1,2.3,W*.89,-L*.49,4.25,0,'#333040'));
    parts.push(boxPart(.7,1.1,W*.77,-L*.503,bodyTop-1,0,'#762d4e'));
    for(const side of [-1,1]){
        parts.push(boxPart(1,1,3,-L*.508,3.9,side*W*.29,P.hub));
        parts.push(boxPart(1.3,1.4,W*.23,-L*.502,bodyTop-.9,side*W*.27,'#ff6e7a'));
    }
    parts.push(boxPart(.5,2.2,5,-L*.506,5.4,0,'#f6dfae'));
    parts.push(boxPart(.5,1.1,7,L*.503,5.0,0,P.sportsInk));
    if(sports){
        // Two-tone rear fascia and pinstripes trace the GT's low beltline.
        for(const side of [-1,1]) parts.push(boxPart(L*.62,.35,.34,-1,7.4,W*.502*side,'#f787aa'));
        parts.push(boxPart(2.4,1.2,W*.94,-L*.445,bodyTop+3.2,0,color));
        for(const sign of [-1,1]){
            parts.push(boxPart(1,3,1,-L*.445,bodyTop+1.6,sign*W*.31,P.sportsInk));
            trim([L*.30,bodyTop-.20,sign*W*.16],[L*.37,bodyTop-.83,sign*W*.17],
                [L*.37,bodyTop-.83,sign*W*.26],[L*.30,bodyTop-.20,sign*W*.25],'#69364e');
        }
    }
    if(type==='taxi') {
        parts.push(boxPart(7.5,3.4,12,0,cabH+1.9,0,'#ffeb95'));
        for(const side of [-1,1]) for(let n=-4;n<=4;n++)
            parts.push(boxPart(2,1.2,.7,n*3.5,8+(n%2===0?0:1),side*W*.495,P.sportsInk));
    }
    if(type==='police'){
        parts.push(boxPart(3,1.5,W*.72,0,cabH+1.1,0,P.sportsInk));
        for(const side of [-1,1]){
            parts.push(boxPart(3,2,W*.32,0,cabH+2.6,side*W*.18,side===1?P.policeRed:P.policeCyan));
            parts.push(boxPart(L*.75,2,.8,0,8,side*W*.49,P.navy));
        }
    }
    parts.push({geo:hull,color:null},{geo:cabin,color:null});
    const geo=mergeParts(parts);
    carCache.set(key, geo);
    return geo;
}

const detailMaterials=new Map();
function lettering(text,background,ink,subtitle='') {
    const key=[text,background,ink,subtitle].join('|');
    if(detailMaterials.has(key)) return detailMaterials.get(key);
    const c=document.createElement('canvas'); c.width=256;c.height=80;
    const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,256,80);
    ctx.strokeStyle=ink;ctx.lineWidth=3;ctx.strokeRect(3,3,250,74);
    ctx.fillStyle=ink;ctx.textAlign='center';
    ctx.font='bold 18px sans-serif';if(subtitle)ctx.fillText(subtitle,128,24);
    ctx.font='bold '+(subtitle?46:60)+'px monospace';ctx.fillText(text,128,subtitle?67:59,242);
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;
    const material=new THREE.MeshBasicMaterial({map});
    detailMaterials.set(key,material);return material;
}

const detailQuads=new Map();
export function carLettering(type) {
    const def=CARS[type];
    const details=new THREE.Group();
    function add(w,h,x,y,z,ry,material){
        const key=w+','+h;
        if(!detailQuads.has(key))detailQuads.set(key,new THREE.PlaneGeometry(w,h));
        const m=new THREE.Mesh(detailQuads.get(key),material);
        m.position.set(x,y,z);m.rotation.y=ry;details.add(m);
    }
    const plate=lettering(type==='sports'?'MIRAGE':type==='police'?'NBPD':'N • BAY','#f7ddb0','#373a52','NEON BAY');
    add(5.8,2.25,-def.length*.517,5.4,0,-Math.PI/2,plate);
    if(type==='taxi'){
        const cab=lettering('TAXI','#ffe9a8','#262738');
        for(const side of [-1,1])add(11,3.1,side*3.82,19,0,side*Math.PI/2,cab);
        for(const side of [-1,1])add(7,2.8,0,19,side*6.1,side===1?0:Math.PI,cab);
    }
    if(type==='police') {
        const badge=lettering('NBPD','#233145','#f3eddb');
        for (const side of [-1,1]) add(13,3.7,0,7,side*(def.width*.5+.5),side===1?0:Math.PI,badge);
    }
    return details;
}

// --- 3D: people -------------------------------------------------------------
// One merged geometry per outfit, standing ~28 units tall, facing +x.

const personCache = new Map();

export function personGeometry(o) {
    const key = [o.jacket, o.skin, o.hair, o.trousers, o.officer ? '1' : o.player ? 'jax' : '0'].join('|');
    const hit = personCache.get(key);
    if (hit) return hit;
    const parts = [];
    const torso=cylPart(5.3,4.1,8.4,0,16.4,0,o.jacket,8);
    // Scale about the vertical axis to keep shoulders wider than the waist.
    torso.geo.scale(.64,1,1);
    parts.push(torso,cylPart(1.8,1.8,2,0,21,0,o.skin,8));
    const hips=cylPart(4.15,4,3,0,11.7,0,o.trousers,8);
    hips.geo.scale(.69,1,1);parts.push(hips);
    for(const side of [-1,1]){
        const z=side*2.18;
        parts.push(strut([0,11.8,z],[.28,6,z*1.06],1.96,o.trousers),
            strut([.28,6,z*1.06],[-.3,1.5,z*1.13],1.63,o.trousers),
            spherePart(2.15,.8,1.3,z*1.13,'#282a36',1.42,.62,.86,8),
            spherePart(1.9,-.15,18.9,side*4.1,o.jacket,1,.95,1,8),
            strut([0,19.1,side*4.4],[-.3,15.1,side*5.15],1.9,o.jacket),
            strut([-.3,15.3,side*5.15],[.55,11.4,side*5.45],1.24,o.skin),
            spherePart(1.34,.65,10.95,side*5.45,o.skin,.84,1.24,.82,7));
    }
    parts.push(spherePart(3.35,.14,24.15,0,o.skin,.91,1.19,.89,10));
    parts.push(spherePart(3.42,-.55,25.65,0,o.hair,.91,.79,.9,10));
    parts.push(spherePart(2.8,-1.18,24,0,o.hair,.66,.97,.91,9));
    parts.push(spherePart(.81,3.1,24.05,0,o.skin,.85,1,.78,6));
    for(const side of [-1,1]){
        parts.push(spherePart(.69,.07,24,side*2.79,o.skin,.8,1,.55,6));
        parts.push(boxPart(.4,.33,1.05,2.80,24.6,side*1.16,'#49333b'));
        parts.push(boxPart(.35,.32,1.22,2.81,25.06,side*1.15,o.hair));
    }
    if(o.player){
        for(const side of [-1,1]){
            parts.push(strut([-2.45,19.5,side*.25],[-2.5,17.8,side*3.4],.37,'#ffe0aa'),
                strut([2.38,19.8,side*2.5],[2.8,17.3,side*.4],.43,'#efc49e'));
        }
        const waist=cylPart(4.23,4.15,1.2,0,12.6,0,'#174854',8);
        waist.geo.scale(.67,1,1); parts.push(waist);
        // The stitched sun-and-wings patch is visible from the chase camera.
        parts.push(spherePart(1.64,-3.03,16.8,0,'#ffb684',.2,.91,1,9));
        for(const side of [-1,1]) {
            parts.push(strut([-3.09,16.9,side*.7],[-2.5,17.7,side*3],.36,'#fde1a6'),
                strut([-3.15,15.5,-1.28],[-3.15,15.5,1.28],.16,P.jacket));
        }
        parts.push(boxPart(.55,.9,5,2.71,24.8,0,'#28263a'));
    }
    if (o.officer) {
        parts.push(boxPart(9.5, 2, 9.5, 0, 27.6, 0, '#1E2A44'));
        parts.push(boxPart(10.5, 1, 4, 3.5, 26.8, 0, '#1E2A44'));
    }
    const geo = mergeParts(parts);
    const pos=geo.attributes.position;
    geo.morphAttributes.position=[-1,1].map(sign=>{
        const bent=pos.clone();
        for(let i=0;i<pos.count;i++){
            const y=pos.getY(i), z=pos.getZ(i);
            const arm=Math.abs(z)>3.65 && y<20, leg=y<11.7 && !arm;
            if(!leg && !arm) continue;
            const stride=(arm?-(20-y)*.23:(11.7-y)*.27)*Math.sign(z)*sign;
            bent.setXYZ(i,pos.getX(i)+stride,y+Math.max(0,stride)*.22,z);
        }
        return bent;
    });
    personCache.set(key, geo);
    return geo;
}

// --- 3D: pickups ------------------------------------------------------------

const pickupCache = new Map();

export function pickupGeometry(kind) {
    const hit = pickupCache.get(kind);
    if (hit) return hit;
    const parts = [];
    if (kind === 'tape') {
        parts.push(boxPart(4,9,15,0,0,0,'#281c42'),boxPart(4.5,5.5,13,0,.6,0,P.pink));
        for(const z of [-3.7,3.7]) parts.push(boxPart(5,2.2,2.2,0,.8,z,P.paper));
    } else if (kind === 'health') {
        parts.push(boxPart(11, 11, 11, 0, 0, 0, '#F4F1EA'));
        parts.push(boxPart(12.5, 3.5, 3.5, 0, 0, 0, '#E23B3B'));
        parts.push(boxPart(3.5, 12.5, 3.5, 0, 0, 0, '#E23B3B'));
    } else if (kind === 'ammo') {
        parts.push(boxPart(12, 8, 8, 0, 0, 0, '#2C3138'));
        parts.push(boxPart(12, 2.5, 8, 0, 5, 0, P.mango));
    } else {
        parts.push(boxPart(12, 7, 8, 0, 0, 0, '#7FB069'));
        parts.push(boxPart(12.6, 2, 8.6, 0, 0, 0, P.mango));
    }
    const geo = mergeParts(parts);
    pickupCache.set(kind, geo);
    return geo;
}

// --- 3D: mission / waypoint beacons -----------------------------------------

export function makeBeacon(colorHex) {
    const group = new THREE.Group();
    const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(1.3, 2.4, 65, 10, 1, true),
        new THREE.MeshBasicMaterial({
            color: colorHex, transparent: true, opacity: 0.10,
            side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
        })
    );
    beam.position.y = 32.5;
    const cone = new THREE.Mesh(
        new THREE.ConeGeometry(4.3, 8, 4),
        new THREE.MeshBasicMaterial({ color: colorHex })
    );
    cone.position.y = 46;
    cone.rotation.z = Math.PI;
    cone.rotation.y = Math.PI / 4;
    const ringGeo = new THREE.RingGeometry(12, 17, 24);
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: colorHex, transparent: true, opacity: 0.8,
        side: THREE.DoubleSide, depthWrite: false
    }));
    ring.position.y = 0.6;
    group.add(beam, cone, ring);
    group.userData = { beam, cone, ring };
    return group;
}
