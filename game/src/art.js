// Procedural coastal architecture, street surfaces and vehicles. Static parts
// bake into district meshes. Car paint, glass, trim and lamps have separate
// surfaces up close; more distant traffic shares baked silhouettes.
// The canvas helpers below also paint the HUD.
import * as THREE from './../vendor/three.module.min.js';
import { RoundedBoxGeometry } from '../vendor/RoundedBoxGeometry.js';
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

const roundedShapes=new Map();
function indexedRoundedBox(w,h,d,segments,radius) {
    const shape=new RoundedBoxGeometry(w,h,d,segments,radius);
    if(shape.index) return shape;
    // r160 expands a BoxGeometry grid before rounding each corner in place.
    // Recover its original index. Each face keeps a separate grid for its UVs.
    const divisions=2*segments+1;
    const grid=new THREE.BoxGeometry(1,1,1,divisions,divisions,divisions);
    for(const [name,a] of Object.entries(shape.attributes)) {
        const packed=new Float32Array(grid.attributes.position.count*a.itemSize);
        for(let i=0;i<a.count;i++) {
            const offset=grid.index.array[i]*a.itemSize;
            for(let k=0;k<a.itemSize;k++) packed[offset+k]=a.array[i*a.itemSize+k];
        }
        shape.setAttribute(name,new THREE.BufferAttribute(packed,a.itemSize));
    }
    shape.setIndex(grid.index);
    return shape;
}

function roundedPart(w,h,d,x,y,z,color,radius=Math.min(w,h,d)*.14,segments=1,ry=0) {
    const key=[w,h,d,radius,segments].join('/');
    if(!roundedShapes.has(key)) roundedShapes.set(key,indexedRoundedBox(w,h,d,segments,radius));
    const geo=roundedShapes.get(key).clone();
    if(ry) geo.rotateY(ry);
    geo.translate(x,y,z);
    return {geo,color};
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

// Retain the primitive indices when batching. UV and normal seams keep their
// own vertices, while adjoining triangles can reuse transformed vertices.
function mergeParts(parts) {
    let vertexCount=0, indexCount=0;
    for(const {geo} of parts) {
        vertexCount+=geo.attributes.position.count;
        indexCount+=geo.index?.count ?? geo.attributes.position.count;
    }
    const positions=new Float32Array(vertexCount*3), normals=new Float32Array(vertexCount*3);
    const colors=new Float32Array(vertexCount*3), uvs=new Float32Array(vertexCount*2);
    const indices=vertexCount>65535?new Uint32Array(indexCount):new Uint16Array(indexCount);
    let vertex=0, cursor=0;
    for(const {geo,color} of parts) {
        const {position,normal,uv}=geo.attributes;
        positions.set(position.array,vertex*3);
        normals.set(normal.array,vertex*3);
        if(uv) uvs.set(uv.array,vertex*2);
        if(color===null) colors.set(geo.attributes.color.array,vertex*3);
        else {
            _color.set(color);
            for(let i=vertex;i<vertex+position.count;i++) _color.toArray(colors,i*3);
        }
        if(geo.index) for(const i of geo.index.array) indices[cursor++]=vertex+i;
        else for(let i=0;i<position.count;i++) indices[cursor++]=vertex+i;
        vertex+=position.count;
    }
    const out=new THREE.BufferGeometry();
    out.setIndex(new THREE.BufferAttribute(indices,1));
    out.setAttribute('position',new THREE.BufferAttribute(positions,3));
    out.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    out.setAttribute('color',new THREE.BufferAttribute(colors,3));
    out.setAttribute('uv',new THREE.BufferAttribute(uvs,2));
    return out;
}

// A street-level camera sees just a few blocks. Keep distant blocks out
// of both the colour and shadow passes, including on software renderers.
function mergeBlocks(parts, lod=false) {
    const blocks=new Map();
    for(const part of parts){
        part.geo.computeBoundingBox();
        const b=part.geo.boundingBox;
        const key=Math.floor((b.max.x+b.min.x)/768)+','+Math.floor((b.max.z+b.min.z)/768);
        if(!blocks.has(key)) blocks.set(key,[]);
        blocks.get(key).push(part);
    }
    return Array.from(blocks.values(),group=>{
        const near=mergeParts(group);
        if(!lod)return near;
        const far=[];
        for(const part of group){
            const bounds=part.geo.boundingBox, sz=bounds.getSize(new THREE.Vector3());
            if(Math.max(sz.x,sz.y,sz.z)<18)continue;
            if(part.geo instanceof RoundedBoxGeometry){
                const mid=bounds.getCenter(new THREE.Vector3());
                far.push(boxPart(sz.x,sz.y,sz.z,mid.x,mid.y,mid.z,part.color));
            }else far.push(part);
        }
        near.computeBoundingSphere();
        return {near,far:far.length?mergeParts(far):null,center:near.boundingSphere.center};
    });
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
    for(let y=0;y<256;y+=5){
        rect(0,y,256,.6,'#48333717');
        for(let x=(y%2)*8;x<256;x+=18) rect(x,y,.6,5,'#49363912');
    }
    for(let i=0;i<850;i++) rect(rng()*256,rng()*256,1.4,1,'#533f4021');
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
    const rib=t=>[length*t,Math.sin(Math.PI*t)*length*.25-curl*t*t,Math.sin(t*2.1)*length*.06];
    const tri=(a,b,c)=>vertices.push(...a,...b,...c);
    for(let i=0;i<12;i++) {
        const t=i/12,end=(i+1)/12,a=rib(t),b=rib(end);
        const spread=width*(.22+.9*Math.sin(Math.PI*(t+.02)));
        for(const side of [-1,1]){
            const base=[a[0]+.25,a[1]-.09,a[2]+side*.32];
            tri(a,b,base);
            const point=[b[0]+length*.09,b[1]-spread*(.65+t*.3),b[2]+side*spread];
            const crease=[a[0]+length*.048,a[1]-.09,a[2]+side*spread*.45];
            tri(base,crease,point);tri(crease,b,point);
        }
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.computeVertexNormals();geo.rotateY(-angle);geo.translate(x,y,z);
    return {geo,color};
}

function strut(a,b,r,color,baseRadius=r) {
    const start=new THREE.Vector3(...a), end=new THREE.Vector3(...b), axis=end.clone().sub(start);
    const geo=new THREE.CylinderGeometry(r,baseRadius,axis.length(),8);
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

// Share one crown at each projected size. Double-sided fronds shade both
// faces of a blade without sending its reversed triangles through the GPU.
export function buildPalms(world, material) {
    const group=new THREE.Group(), near=[], mid=[], far=[];
    for(const [parts,leaves] of [[near,7],[mid,6],[far,6]]) {
        parts.push(strut([0,0,0],[1,26,-.9],1.72,'#927e68',2.45),
            strut([1,26,-.9],[3,54,0],1.28,'#ac9074',1.72),
            cylPart(2.8,1.7,7,3,52,0,'#748951',7));
        if(parts===near) for(let k=1;k<15;k++){
            const t=k/15, r=2.42-t*1.08,dx=t<.48?t/.48:1+(t-.48)/.52*2;
            const z=t<.48?-t/.48*.9:-(1-t)/.52*.9;
            parts.push(cylPart(r*.99,r+.10,.36,dx,54*t,z,'#8e7d6c',8));
        }
        for(let i=0;i<leaves;i++) {
            if(parts===near) parts.push(frond(24+i%3*3.5,4.7,5+i%3*3,i*2.4,3,56,0,
                ['#3a816b','#589365','#416c5a'][i%3]));
            else {
                const vertices=[],r=23+i%2*5,sections=parts===far?3:5;
                const edge=(k,side)=>{
                    const t=k/sections;
                    return [r*t,Math.sin(t*Math.PI)*5-(3+i%3)*t*t-Math.abs(side)*.6,
                        side*(.12+2.4*Math.sin(t*Math.PI))];
                };
                for(let k=0;k<sections;k++)for(const side of [-1,1]){
                    const a=edge(k,0),b=edge(k+1,0),c=edge(k+1,side),d=edge(k,side);
                    vertices.push(...a,...b,...c,...a,...c,...d);
                }
                const geo=new THREE.BufferGeometry();
                geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
                geo.computeVertexNormals();geo.rotateY(i*2.4);geo.translate(3,56,0);
                parts.push({geo,color:i%2?'#528b65':'#356955'});
            }
        }
    }
    const transform=new THREE.Object3D();
    const trees=world.props.filter(p=>p.kind==='palm').map(p=>{
        transform.position.set(p.x,0,p.y);
        transform.rotation.y=p.phase;
        transform.scale.set(p.scale,p.scale*(.95+p.phase*.026),p.scale);
        transform.updateMatrix();
        const center=new THREE.Vector3(p.x,32*transform.scale.y,p.y);
        const bounds=new THREE.Sphere(center,46*Math.max(p.scale,transform.scale.y));
        return {matrix:transform.matrix.clone(),bounds};
    });
    const foliage=material.clone();
    foliage.side=THREE.DoubleSide;
    const levels=[near,mid,far].map(parts=>{
        const geometry=mergeParts(parts);
        // Trees outside the fitted sun map need only their colour pass.
        return [false,true].map(caster=>{
            const mesh=new THREE.InstancedMesh(geometry,foliage,trees.length);
            mesh.count=0;mesh.castShadow=caster;mesh.frustumCulled=false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            group.add(mesh);
            return mesh;
        });
    });
    group.userData.update=(eye,scale,view,sun)=>{
        for(const mesh of group.children) mesh.count=0;
        const nearSq=(340*scale)**2, midSq=(1250*scale)**2;
        for(const {matrix,bounds} of trees){
            const caster=sun.intersectsSphere(bounds);
            if(!caster && !view.intersectsSphere(bounds)) continue;
            const d=eye.distanceToSquared(bounds.center);
            const mesh=levels[d<nearSq?0:d<midSq?1:2][Number(caster)];
            mesh.setMatrixAt(mesh.count++,matrix);
        }
        for(const mesh of group.children){
            mesh.visible=mesh.count>0;
            if(mesh.visible) mesh.instanceMatrix.needsUpdate=true;
        }
    };
    return group;
}

// An eave rectangle and a variable ridge define the roof faces. Extending
// the ridge to the ends gives gables; shortening it produces hips; a single
// apex gives a pyramid. Rotate the local ridge onto the longer building axis.
function roofPart(b, height) {
    const alongZ=b.h>b.w, w=Math.max(b.w,b.h)/2+1.8,d=Math.min(b.w,b.h)/2+1.8;
    const form=b.kind==='warehouse'?'gable':b.kind==='clinic'?'hip':
        b.kind==='bank'?'pyramid':b.kind==='shop'?['flat','skillion','hip','gable'][b.detail%4]:'flat';
    if(form==='flat') return roundedPart(b.w+3,3,b.h+3,b.x+b.w/2,height,b.y+b.h/2,b.roof,1.1);
    const rise=form==='pyramid'?21:form==='skillion'?9:Math.min(20,d*.28);
    const ridge=form==='gable'?w:form==='pyramid'?0:Math.max(0,w-d*.83);
    const a=[-w,0,-d],c=[w,0,-d],e=[w,0,d],f=[-w,0,d];
    const l=[-ridge,rise,0],r=[ridge,rise,0],vertices=[];
    const tri=(a,b,c)=>vertices.push(...a,...b,...c);
    if(form==='skillion'){
        const topL=[-w,rise,d],topR=[w,rise,d];
        tri(a,topL,topR);tri(a,topR,c);tri(f,e,topR);tri(f,topR,topL);
        tri(a,f,topL);tri(c,topR,e);
    } else {
        tri(a,l,r);tri(a,r,c);tri(e,r,l);tri(e,l,f);tri(a,f,l);tri(c,r,e);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.computeVertexNormals();if(alongZ) geo.rotateY(Math.PI/2);
    geo.translate(b.x+b.w/2,height,b.y+b.h/2);
    return {geo,color:b.roof};
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
        const part=roundedPart(w,h,d,x,y,z,'#ffffff',Math.min(4,h*.08));
        const uv=part.geo.attributes.uv;
        for (let face=0;face<6;face++) {
            const tile=b.id*2+(face<2?1:0);
            const perSide=uv.count/6;
            for(let corner=0;corner<perSide;corner++){
                const i=face*perSide+corner;
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
    // Road surfaces use an atlas of complete markings. Straight tiles end at
    // stop bars, leaving the centre of every junction clear for turning traffic.
    const paving=[];
    const roadTile=(x,z,w,d,kind,across=false)=>{
        const part=flatPart(w,d,x,z,'#ffffff',.16);
        const uv=part.geo.attributes.uv;
        for(let i=0;i<uv.count;i++){
            let u=uv.getX(i),v=uv.getY(i);
            if(across) [u,v]=[v,1-u];
            uv.setXY(i,(kind+.002+.996*u)/3,.002+.996*v);
        }
        roads.push(part);
    };
    for(const x of ROADS_X){
        let from=0;
        for(const z of ROADS_Y){
            roadTile(x,(from+z-52)/2,104,z-52-from,0);
            roadTile(x,z,104,104,1);
            from=z+52;
        }
        roadTile(x,(from+world.height)/2,104,world.height-from,0);
    }
    for(const z of ROADS_Y){
        let from=0;
        for(const x of ROADS_X){
            roadTile((from+x-52)/2,z,x-52-from,104,0,true);
            from=x+52;
        }
        roadTile((from+2744)/2,z,2744-from,104,0,true);
    }
    for(let z=0;z<world.height;z+=240){
        const length=Math.min(240,world.height-z);
        roadTile(2778,z+length/2,68,length,2);
    }
    function sidewalk(w,d,x,z) {
        const part=roundedPart(w,1,d,x,-.26,z,'#ffffff',.45);
        const pos=part.geo.attributes.position, uv=part.geo.attributes.uv;
        for(let i=0;i<pos.count;i++) uv.setXY(i,pos.getX(i)/66,pos.getZ(i)/66);
        paving.push(part);
    }
    for(const x of ROADS_X.slice(0,-1)) for(const z of ROADS_Y.slice(0,-1))
        sidewalk(279,279,x+192,z+192);
    sidewalk(24,world.height,2732,world.height/2);
    sidewalk(17,world.height,2820.5,world.height/2);
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
            ctx.scale(size/256,size/256);mask.scale(size/256,size/256);
            paintFacade(ctx,mask,b,side?b.h:b.w,H,world.seed+tile*109);
            mask.restore();
            ctx.restore();
        }
        facadeBox(b,b.w,H,b.h,cx,H/2,cz);
        rest.push(roundedPart(b.w+3.6,2.2,b.h+3.6,cx,H-.8,cz,b.roof,.68),roofPart(b,H),roundedPart(b.w+1.5,1.8,b.h+1.5,cx,.9,cz,'#aca49a',.65));
        if(b.kind==='shop'||b.kind==='diner'){
            const cornice=b.district==='Glasswater'?'#a9bab8':'#d2b296';
            for(const side of [-1,1]){
                rest.push(roundedPart(b.w-.5,1.35,1.5,cx,H-6,cz+side*b.h*.499,cornice,.4));
                for(const fx of [-.46,.46])
                    rest.push(roundedPart(2.1,18,2,cx+fx*b.w,9,cz+side*b.h*.5,'#dad0b8',.55));
            }
        }
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
            rest.push(roundedPart(b.w*.65,4,b.h*.63,cx-12,H+tower,cz-14,P.mullion));
            for(let level=22;level<tower;level+=22)
                rest.push(roundedPart(b.w*.64,1.5,b.h*.63,cx-12,H+level,cz-14,'#e2d1bb',.65));
            rest.push(boxPart(b.w*.38,9,b.h*.34,cx-12,H+tower+6,cz-14,P.glassDeep));
            if(b.kind==='bank'){
                const w=b.w*.43,d=b.h*.37;
                rest.push(roofPart({kind:'bank',x:cx-12-w/2,y:cz-14-d/2,w,h:d,roof:'#81a6a4'},H+tower+11));
            }
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
            if(b.detail%4===0 && b.kind==='shop'){
                for(const side of [-1,1]) for(const u of [-.25,.25]){
                    const x=cx+u*b.w,z=cz+side*(b.h/2+2.2);
                    rest.push(roundedPart(b.w*.27,1.1,5,x,H*.54,z,'#e0c7ad',.45),
                        boxPart(b.w*.27,.45,.45,x,H*.54+3.3,z+side*2,'#5c7477'));
                    for(const v of [-.123,0,.123])rest.push(boxPart(.38,3.1,.38,x+v*b.w,H*.54+1.75,z+side*2,'#5c7477'));
                }
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
            rest.push(strut([x,27,y],[x+3,31,y],.65,'#465155'),
                strut([x+3,31,y],[x+7,31,y],.58,'#526060'),
                roundedPart(6.3,1.5,3.3,x+6,30.2,y,'#465154',.65));
            glow.push(roundedPart(5.1,.6,2.65,x+6,29.36,y,++lampIndex%3?P.lamp:P.glint));
        } else if (kind === 'bench') {
            const h = prop.h || 0;
            const bench=(xx,yy,zz,w,thick,d,color)=>{
                rest.push(roundedPart(w,thick,d,x+xx*Math.cos(h)-zz*Math.sin(h),yy,
                    y+xx*Math.sin(h)+zz*Math.cos(h),color,Math.min(thick,d)*.18,1,-h));
            };
            for(const z of [-2.5,0,2.5])bench(0,5.7,z,22,.95,2.1,'#956a50');
            for(const yy of [8.7,11])bench(0,yy,3.65,22,1.85,.95,'#a57756');
            for(const xx of [-8.5,8.5]){
                bench(xx,3.05,0,1.15,5.5,3,'#39484b');bench(xx,8.1,3.3,.9,7,.8,'#405055');
            }
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
            rest.push(roundedPart(86,26,32,x,13,y,prop.color||P.teal,.9));
            for(const side of [-1,1]) for(let k=-38;k<42;k+=5)
                rest.push(boxPart(1.3,23,1,x+k,13,y+side*16,prop.color||P.teal));
        } else if(kind==='bin'){
            rest.push(roundedPart(5.4,8,5.4,x,4,y,'#476365',.65),
                roundedPart(6.1,1.4,6.1,x,8.4,y,'#263e43',.5),
                boxPart(3,.18,1.3,x,9.14,y,'#19292d'));
        } else if(kind==='cone'){
            rest.push(roundedPart(5.8,.9,5.8,x,.5,y,'#36343b'),
                cylPart(.35,2.25,6.3,x,4,y,'#e27443'),cylPart(.92,1.45,1.5,x,4.5,y,'#f4dac1'));
        } else if(kind==='manhole'){
            rest.push(cylPart(5.5,5.5,.16,x,.29,y,'#56545b',16));
            for(let k=-2;k<=2;k++) rest.push(flatPart(6,.22,x,y+k,'#3c3a41',.39));
        } else if (kind === 'tables') {
            rest.push(cylPart(11, 11, 2, x, 9, y, '#F4EFE6', 8));
            rest.push(cylPart(1.5, 1.5, 9, x, 4.5, y, '#2C3138', 5));
        }
    }

    const atlas = new THREE.CanvasTexture(sheet);
    atlas.colorSpace=THREE.SRGBColorSpace;atlas.anisotropy=4;
    const windows=new THREE.CanvasTexture(lamps);windows.colorSpace=THREE.SRGBColorSpace;
    return { walls: mergeBlocks(walls), rest: mergeBlocks(rest,true), ground:mergeParts(ground), road:mergeParts(roads), paving:mergeParts(paving), glow: mergeBlocks(glow,true), atlas, windows };

}

// Rooftop blades and double-sided marquees carry the hand-painted shop names.
export function buildSigns(world) {
    const buildings=world.buildings.filter(b=>['diner','garage','clinic','bank','hotel'].includes(b.kind)
        || ['COPPER / 09','BAY FREIGHT','MARLIN STORAGE','SURF CLUB','TIDE BAR','SUNSET MOTEL','BAJA MARKET','RECORDS'].includes(b.label));
    const labels=[...new Set(buildings.map(b=>b.label))],w=512,h=128,cols=4,rows=Math.ceil(labels.length/cols);
    const sheet=document.createElement('canvas');sheet.width=w*cols;sheet.height=h*rows;
    const ctx=sheet.getContext('2d'),parts=[];
    for(const [i,name] of labels.entries()){
        const b=buildings.find(b=>b.label===name),wharf=b.kind==='warehouse'||b.kind==='garage';
        const bg=wharf?'#39494a':b.kind==='diner'?'#5a253e':b.detail%2?'#1e383d':'#3b2d42';
        const neon=wharf?'#f5d3a5':b.detail%2?'#a5eee0':'#ff9faf';
        ctx.save();ctx.translate(i%cols*w,Math.floor(i/cols)*h);
        ctx.fillStyle=bg;ctx.fillRect(0,0,w,h);
        ctx.strokeStyle=neon;ctx.lineWidth=2;ctx.strokeRect(6,6,w-12,h-12);
        ctx.fillStyle=neon;
        if(wharf){
            for(let k=0;k<3;k++)ctx.fillRect(20,34+k*11,36-k*7,4);
            ctx.font='bold 15px monospace';ctx.fillText('PORT AUTHORITY  /  MARLIN',67,35);
            ctx.font='bold 56px sans-serif';ctx.fillText(name,64,94,424);
            for(const x of [15,w-15])for(const y of [15,h-15]){ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill();}
        }else{
            ctx.textAlign='center';ctx.font='bold 14px monospace';ctx.fillText(b.district.toUpperCase().split('').join(' '),w/2,30);
            ctx.shadowBlur=5;ctx.shadowColor=neon;
            ctx.font=(b.kind==='bank'?'bold 54px serif':'italic bold 59px sans-serif');
            ctx.fillText(name,w/2,93,w-42);
        }
        ctx.restore();
    }
    for(const b of buildings){
        const H=buildingHeight(b),bw=Math.min(b.w*.79,102),bh=bw*h/w;
        const i=labels.indexOf(b.label),offset=.7;
        const faces=[[b.x+b.w+offset,b.y+b.h/2,Math.PI/2],[b.x-offset,b.y+b.h/2,-Math.PI/2],
            [b.x+b.w/2,b.y+b.h+offset,0],[b.x+b.w/2,b.y-offset,Math.PI]];
        for(const [x,z,a] of faces){
            const p=wallQuad(bw,bh,x,Math.min(H-bh*.54,21+bh/2),z,'#ffffff',a);
            const uv=p.geo.attributes.uv;
            for(let k=0;k<uv.count;k++)uv.setXY(k,(i%cols+.004+uv.getX(k)*.992)/cols,
                1-(Math.floor(i/cols)+.996-uv.getY(k)*.992)/rows);
            parts.push(p);
        }
    }
    const tex=new THREE.CanvasTexture(sheet);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
    return [new THREE.Mesh(mergeParts(parts),new THREE.MeshBasicMaterial({map:tex,toneMapped:false}))];
}

// A coachbuilt shell runs from the tail to the nose. Each transverse ring
// has a sill, curved shoulder and crown. The lower edge follows the tyres.
function loft(rings) {
    const vertices=rings.flat(2), indices=[], count=rings[0].length;
    for(let i=0;i<rings.length-1;i++) for(let k=0;k<count;k++) {
        const a=i*count+k,b=i*count+(k+1)%count;
        indices.push(a,a+count,b+count,a,b+count,b);
    }
    for(let k=1;k<count-1;k++){
        const end=(rings.length-1)*count;
        indices.push(0,k,k+1,end,end+k+1,end+k);
    }
    const geo=new THREE.BufferGeometry();geo.setIndex(indices);
    geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
    geo.computeVertexNormals();return geo;
}

const carCache=new Map(), wheels=new Map();
const painted=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.47,roughness:.30,envMapIntensity:.42});
const lacquer=new THREE.MeshPhysicalMaterial({vertexColors:true,metalness:.55,roughness:.25,
    clearcoat:.88,clearcoatRoughness:.16,envMapIntensity:.47});
const glazing=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.76,roughness:.11,envMapIntensity:1});
const moulding=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.32,roughness:.46,envMapIntensity:.5});
const lens=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});
const rubber=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.87});
const alloy=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.92,roughness:.22});
function materialGroups(batches){
    const geo=mergeParts(batches.flat());let start=0;
    batches.forEach((parts,i)=>{
        const count=parts.reduce((n,p)=>n+(p.geo.index?.count||p.geo.attributes.position.count),0);
        geo.addGroup(start,count,i);start+=count;
    });
    return geo;
}

function wheelGeometry(radius) {
    if(wheels.has(radius))return wheels.get(radius);
    const tyres=[],rims=[];
    function disc(r,depth,z,paint,target) {
        const geo=new THREE.CylinderGeometry(r,r,depth,20);geo.rotateX(Math.PI/2);geo.translate(0,0,z);
        target.push({geo,color:paint});
    }
    disc(radius,2.35,0,'#202029',tyres);
    disc(radius*.72,.36,1.17,'#b3b9ba',rims);
    disc(radius*.59,.22,1.38,'#272b32',tyres);
    for(let k=0;k<7;k++){
        const a=k*Math.PI*2/7;
        rims.push(strut([.45*Math.cos(a),.45*Math.sin(a),1.57],
            [radius*.59*Math.cos(a+.24),radius*.59*Math.sin(a+.24),1.51],.28,'#dedcd6'));
    }
    disc(.66,.4,1.56,'#959c9f',rims);
    const geo=materialGroups([tyres,rims]); wheels.set(radius,geo); return geo;
}

function carParts(type,color) {
    const key=type+'|'+color;
    if(carCache.has(key))return carCache.get(key);
    const {length:L,width:W}=CARS[type],sports=type==='sports',van=type==='van'||type==='armored';
    const radius=sports?3.95:4.52,top=sports?8.5:10.15, roof=van?22:sports?13.5:16.4;
    const paint=[],glass=[],trim=[],lights=[],wheelCenters=[];
    const body=[];
    for(const x of [-.5,-.482,-.447,-.406,-.37,-.31,-.25,-.214,-.18,0,.18,.214,.25,.31,.37,.406,.447,.485,.5]){
        const nearAxle=Math.abs(Math.abs(x)-.31)*L;
        const arch=nearAxle<radius+1?Math.sqrt((radius+1)**2-nearAxle**2)+radius:3.25;
        const end=Math.max(0,(Math.abs(x)-.42)/.08);
        const w=W*(.5-.075*end**2), h=top+.95*Math.exp(-((nearAxle/6)**2))-(x>0?1.55:.55)*end;
        const low=Math.min(h-.7,arch), sill=2.6;
        body.push([[0,sill],[w*.80,sill],[w*.93,low],[w*.993,low+.28],[w,h-.8],[w*.98,h-.32],
            [w*.91,h],[w*.65,h+.14],[0,h+.24],[-w*.65,h+.14],[-w*.91,h],[-w*.98,h-.32],
            [-w,h-.8],[-w*.993,low+.28],[-w*.93,low],[-w*.80,sill]].map(([z,y])=>[L*x,y,z]));
    }
    paint.push({geo:loft(body),color});
    const tail=van?-.465:sports?-.37:-.34, back=van?-.42:-.16,front=van?.23:.065,nose=van?.42:.29;
    const cabin=[[tail,top+.45,.435],[back-.035,roof-.48,.369],[back,roof,.354],
        [front,roof+.05,.35],[front+.036,roof-.50,.366],[nose,top+.38,.423]];
    const cabinRings=cabin.map(([x,h,tw])=>{
        const bottom=top-.22;
        return [[0,bottom],[W*.445,bottom],[W*tw,h-.18],[W*tw*.82,h+.14],
            [0,h+.28],[-W*tw*.82,h+.14],[-W*tw,h-.18],[-W*.445,bottom]].map(([z,y])=>[x*L,y,z]);
    });
    glass.push({geo:loft(cabinRings),color:'#243348'});
    paint.push(roundedPart((front-back+.035)*L,.84,W*.715,(back+front)*L/2,roof+.05,0,color,.4,2));
    for(const side of [-1,1]){
        const pane=(x,y,z)=>[x*L,y,z*W*side];
        paint.push(strut(pane(tail,top+.47,.44),pane(back,roof,.35),van?.95:.5,color),
            strut(pane(front,roof,.35),pane(nose,top+.42,.43),.49,color));
        trim.push(strut(pane(back*.30,top+.13,.447),pane(back*.30,roof-.20,.359),.39,'#242637'),
            strut(pane(tail,top+.12,.453),pane(nose,top+.12,.453),.21,'#b3b5b1'));
        if(van) paint.push(roundedPart(L*.56,roof-top-.45,1.4,-L*.15,(roof+top)/2,side*W*.414,color,.64));
        paint.push(roundedPart(2.9,1.25,2.5,L*.16,top+.85,side*W*.53,color,.54,2));
        trim.push(roundedPart(L*.42,.68,.62,0,3,side*W*.487,'#41414b'),
            roundedPart(2.1,.45,.52,-L*.068,top-.86,side*W*.491,'#b6b5b4',.2));
        // Thin swept light signatures wrap around both corners.
        lights.push(strut(pane(.491,top-1.92,.12),pane(.478,top-1.65,.42),.39,'#fff3d2'),
            strut(pane(.478,top-1.65,.42),pane(.443,top-.95,.486),.33,'#fff0c8'),
            strut(pane(-.505,top-1.18,.05),pane(-.494,top-1.09,.40),.33,'#ff3348'),
            strut(pane(-.494,top-1.09,.4),pane(-.452,top-.36,.472),.35,'#ff4954'));
        for(const ax of [-.31,.31]) wheelCenters.push([ax*L,radius,side*W*.474,side]);
        trim.push(roundedPart(1.4,.95,2.8,-L*.491,3.2,side*W*.30,'#979698',.42));
    }
    trim.push(roundedPart(1.4,2.75,W*.78,L*.486,4.65,0,'#262830',.65,2),
        roundedPart(1.52,3.2,W*.80,-L*.483,4.7,0,'#34313b',.73,2));
    for(const side of [-1,1]) trim.push(roundedPart(.62,1.5,W*.18,L*.501,5.7,side*W*.28,'#171b20'));
    paint.push(roundedPart(L*.23,1.05,W*.82,-L*.38,top-.1,0,color,.50,2),
        roundedPart(L*.18,.85,W*.77,L*.31,top+.03,0,color,.41,2));
    function panel(points,material,tint) {
        const geo=new THREE.BufferGeometry();
        const coords=[];
        for(let i=1;i<points.length-1;i++) coords.push(...points[0],...points[i],...points[i+1],
            ...points[i+1],...points[i],...points[0]);
        geo.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));
        geo.computeVertexNormals();material.push({geo,color:tint});
    }
    const noseX=L*.504,tailX=-L*.504;
    // Recessed radiator opening, splitter, projector lenses, rear diffuser and exhaust tips.
    panel([[noseX,3.65,-W*.30],[noseX,3.65,W*.30],[noseX,5.66,W*.235],[noseX,5.66,-W*.235]],trim,'#171b26');
    for(const y of [4,4.45,4.9,5.35])
        trim.push(boxPart(.14,.11,W*(y<4.6?.54:.48),noseX+.10,y,0,'#54525a'));
    trim.push(roundedPart(1.4,.58,W*.86,noseX-.55,3.18,0,'#30303c',.24),
        roundedPart(.85,2.05,W*.80,tailX,top-1.54,0,'#382631',.42,2),
        roundedPart(1.24,1.60,W*.81,tailX+.14,3.64,0,'#292b33',.44,2));
    for(const side of [-1,1]){
        const frontPoint=(y,z)=>[noseX+.06,y,side*W*z];
        panel([frontPoint(top-2.55,.155),frontPoint(top-1.66,.18),
            frontPoint(top-1.4,.385),frontPoint(top-2.34,.40)],trim,'#253346');
        lights.push(strut(frontPoint(top-1.79,.19),frontPoint(top-1.56,.38),.16,'#fff3c8'),
            spherePart(.46,noseX+.2,top-2.03,side*W*.33,'#e4f6fc',.48,.8,1.18));
        for(const row of [0,.40]) lights.push(roundedPart(.36,.22,W*.29,tailX-.48,top-1.42+row,side*W*.235,'#ff394b',.1));
        const exhaust=new THREE.CylinderGeometry(.76,.76,1.15,12);exhaust.rotateZ(Math.PI/2);
        exhaust.translate(tailX-.14,3.55,side*W*.305);trim.push({geo:exhaust,color:'#8b8d8c'});
        const bore=new THREE.CircleGeometry(.57,12);bore.rotateY(-Math.PI/2);
        bore.translate(tailX-.73,3.55,side*W*.305);trim.push({geo:bore,color:'#161a21'});
        const beltZ=side*W*.503;
        trim.push(strut([-L*.18,top-.8,beltZ],[-L*.15,4.4,beltZ],.12,'#5c414e'),
            strut([-L*.15,4.4,beltZ],[L*.16,4.4,beltZ],.12,'#493744'),
            strut([L*.16,4.4,beltZ],[L*.205,top-.8,beltZ],.12,'#5c414e'));
    }
    if(!van){
        for(let i=1;i<=6;i++){
            const t=i/8,x=L*(tail+(back-.035-tail)*t)-.18,y=top+.55+(roof-.48-top-.45)*t;
            trim.push(boxPart(.13,.11,W*(.80-.11*t),x,y,0,'#545562'));
        }
    }
    if(sports){
        paint.push(roundedPart(2.8,.72,W*.92,-L*.444,top+1.75,0,color,.35,2));
        for(const side of [-1,1]) trim.push(roundedPart(.8,1.8,.8,-L*.44,top+.78,side*W*.30,'#383039'));
    }
    if(type==='taxi'){
        lights.push(roundedPart(7.6,3.3,12,0,roof+1.98,0,'#ffe5a0',.78));
        for(let k=-4;k<=4;k++) for(const side of [-1,1])
            trim.push(boxPart(2,1,.54,k*3.4,top-2+(k%2===0?0:.9),side*W*.492,'#24272b'));
    }
    if(type==='police'){
        trim.push(roundedPart(3,1,W*.70,0,roof+1,0,'#242634'));
        for(const side of [-1,1]){
            lights.push(roundedPart(3,1.7,W*.31,0,roof+2.2,side*W*.17,side>0?P.policeRed:P.policeCyan,.62));
            trim.push(roundedPart(L*.75,2,.6,0,top-2,side*W*.494,P.navy));
        }
    }
    const shell=materialGroups([paint,glass,trim,lights]),wheel=wheelGeometry(radius);
    // The middle-distance mesh keeps the silhouette and livery in one draw.
    // Wheel faces and glazing stay legible where a cab still spans 200 pixels.
    const distantParts=[{geo:loft(body),color},{geo:loft(cabinRings),color:'#374858'}];
    for(const part of [...paint.slice(1),...trim,...lights]){
        if(part.geo instanceof RoundedBoxGeometry){
            part.geo.computeBoundingBox();
            const box=part.geo.boundingBox,sz=box.getSize(new THREE.Vector3()),pt=box.getCenter(new THREE.Vector3());
            distantParts.push(boxPart(sz.x,sz.y,sz.z,pt.x,pt.y,pt.z,part.color));
        }else distantParts.push(part);
    }
    for(const [x,y,z,side] of wheelCenters){
        const geo=new THREE.CylinderGeometry(radius,radius,2.28,14);geo.rotateX(Math.PI/2);geo.translate(x,y,z);
        distantParts.push({geo,color:P.tire});
        const hub=new THREE.CircleGeometry(radius*.66,14);
        hub.rotateY(side<0?Math.PI:0);hub.translate(x,y,z+side*1.18);
        distantParts.push({geo:hub,color:'#a2a6a5'});
        for(let i=0;i<7;i++){
            const a=i*Math.PI*2/7;
            const wheelPoint=(r,offset)=>[x+r*Math.cos(a+offset),y+r*Math.sin(a+offset),z+side*1.20];
            const tri=[wheelPoint(radius*.20,0),wheelPoint(radius*.54,-.25),wheelPoint(radius*.54,.24)];
            const hole=new THREE.BufferGeometry();
            hole.setAttribute('position',new THREE.Float32BufferAttribute((side>0?tri:tri.reverse()).flat(),3));
            hole.computeVertexNormals();distantParts.push({geo:hole,color:'#353941'});
        }
    }
    const silhouette=[{geo:loft(body.filter((_,i)=>[0,2,4,5,6,9,12,13,14,16,18].includes(i))),color},
        {geo:loft(cabinRings),color:'#415466'},boxPart((front-back)*L,.8,W*.7,(front+back)*L/2,roof,0,color)];
    for(const [x,y,z,side] of wheelCenters){
        const tyre=new THREE.CylinderGeometry(radius,radius,2.3,10);tyre.rotateX(Math.PI/2);tyre.translate(x,y,z);
        const hub=new THREE.CircleGeometry(radius*.63,10);hub.rotateY(side>0?0:Math.PI);hub.translate(x,y,z+side*1.2);
        silhouette.push({geo:tyre,color:P.tire},{geo:hub,color:P.hub});
    }
    for(const side of [-1,1]){
        silhouette.push(boxPart(.6,1.1,W*.23,L*.5,top-1.8,side*W*.30,P.headlamp),
            boxPart(.6,.8,W*.30,-L*.5,top-1.35,side*W*.25,P.taillight));
    }
    if(type==='taxi')silhouette.push(boxPart(7.5,3,12,0,roof+1.85,0,P.lamp));
    if(type==='police')for(const side of [-1,1])silhouette.push(boxPart(3,2,W*.3,0,roof+2.1,side*W*.17,side>0?P.policeRed:P.policeCyan));
    const model={shell,wheel,wheelCenters,radius,medium:mergeParts(distantParts),distant:mergeParts(silhouette)};
    carCache.set(key,model);return model;
}

export function buildCar(type,color) {
    const model=carParts(type,color),root=new THREE.Group(),fine=new THREE.Group();
    const shell=new THREE.Mesh(model.shell,[painted,glazing,moulding,lens]);
    shell.castShadow=shell.receiveShadow=true;fine.add(shell,carLettering(type));
    const tyres=model.wheelCenters.map(([x,y,z,side])=>{
        const tyre=new THREE.Mesh(model.wheel,[rubber,alloy]);tyre.position.set(x,y,z);
        tyre.rotation.y=side>0?0:Math.PI;fine.add(tyre);return tyre;
    });
    const lod=new THREE.Mesh(model.distant,painted);lod.castShadow=lod.receiveShadow=true;
    root.add(fine,lod);root.userData={fine,lod,shell,tyres,color,model,radius:model.radius};
    return root;
}

export function poseCar(root,car,range,hero){
    const {fine,lod,shell,tyres,radius}=root.userData;
    const near=hero || range<165;
    fine.visible=near;lod.visible=!near;
    if(root.userData.color!==car.color){
        const model=carParts(car.type,car.color);
        shell.geometry=model.shell;root.userData.model=model;root.userData.color=car.color;
    }
    if(!near)lod.geometry=range<520?root.userData.model.medium:root.userData.model.distant;
    shell.material[0]=hero?lacquer:painted;
    if(near) tyres.forEach((tyre,i)=>{
        const side=Math.sign(tyre.position.z);
        tyre.rotation.order='YXZ';tyre.rotation.y=(side>0?0:Math.PI)-(i%2?car.steer*.32:0);
        tyre.rotation.z=-side*(car.travel||0)/radius;
    });
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
    const plate=lettering(type==='sports'?'N B  ·  0 7':type==='police'?'NBPD':'N • BAY','#f7ddb0','#373a52','NEON BAY');
    add(5.8,2.25,-def.length*.526,5.21,0,-Math.PI/2,plate);
    if(type==='taxi'){
        const cab=lettering('TAXI','#ffe9a8','#262738');
        for(const side of [-1,1])add(11,3.1,side*3.82,18.4,0,side*Math.PI/2,cab);
        for(const side of [-1,1])add(7,2.8,0,18.4,side*6.1,side===1?0:Math.PI,cab);
    }
    if(type==='police') {
        const badge=lettering('NBPD','#233145','#f3eddb');
        for (const side of [-1,1]) add(13,3.7,0,7,side*(def.width*.5+.5),side===1?0:Math.PI,badge);
    }
    return details;
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
