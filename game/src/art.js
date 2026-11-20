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
        const key=Math.floor((b.max.x+b.min.x)/256)+','+Math.floor((b.max.z+b.min.z)/256);
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

// One draw per material. Repack indices only when a street cell enters or
// leaves a frustum. The colour and depth passes share immutable vertex buffers.
export function cityBatch(blocks, material, castShadow, level='all'){
    const cells=[];
    for(const block of blocks){
        const geo=level==='all'?block:block[level];
        if(!geo)continue;
        geo.computeBoundingBox();
        const box=geo.boundingBox,mid=box.getCenter(new THREE.Vector3()),half=box.getSize(new THREE.Vector3()).multiplyScalar(.5);
        cells.push({geo,color:null,box,mid,half,center:block.center,mask:-1});
    }
    const geometry=mergeParts(cells), source=geometry.index.array;
    const indices=new source.constructor(source.length*(castShadow?2:1));
    const attribute=new THREE.BufferAttribute(indices,1).setUsage(THREE.DynamicDrawUsage);
    geometry.setIndex(attribute);
    let start=0,visible=0,casters=0;
    for(const cell of cells){
        cell.indices=source.subarray(start,start+cell.geo.index.count);
        start+=cell.geo.index.count;delete cell.geo;
    }
    const mesh=new THREE.Mesh(geometry,material);
    mesh.frustumCulled=false;mesh.castShadow=castShadow;mesh.receiveShadow=castShadow;
    mesh.onBeforeShadow=()=>geometry.setDrawRange(visible,casters);
    mesh.onAfterShadow=()=>geometry.setDrawRange(0,visible);
    mesh.userData.update=(eye,view,sun,occlusion)=>{
        let changed=false;
        for(const cell of cells){
            const d=cell.center?eye.distanceToSquared(cell.center):0;
            const active=level==='all'||(level==='near'?d<570**2:d>=570**2 && d<2300**2);
            const {mid,half}=cell;
            const camera=active && view.intersectsBox(cell.box) && !occlusion.hides(mid.x,mid.y,mid.z,half.x,half.y,half.z);
            const mask=active?(Number(camera) |
                (castShadow && sun.intersectsBox(cell.box)?2:0)):0;
            if(mask!==cell.mask){cell.mask=mask;changed=true;}
        }
        if(!changed)return;
        visible=0;casters=0;
        for(const cell of cells)if(cell.mask&1){indices.set(cell.indices,visible);visible+=cell.indices.length;}
        for(const cell of cells)if(cell.mask&2){indices.set(cell.indices,visible+casters);casters+=cell.indices.length;}
        attribute.clearUpdateRanges();attribute.addUpdateRange(0,visible+casters);attribute.needsUpdate=true;
        mesh.visible=visible+casters>0;geometry.setDrawRange(0,visible);
    };
    return mesh;
}

// 2D heading h (0 = east, clockwise) becomes a Three.js yaw of -h, so a
// mesh built facing +x points the way the simulation thinks it does.
export const yawFor = h => -h;

// --- 3D: the static city ---------------------------------------------------

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
            // Recess shadow, aluminium sill and partly drawn curtains give the
            // upper storeys depth beyond the geometric balcony floors.
            rect(x,y,w,1.7,'#403b5096');
            rect(x,y,1.6,h,'#393c4e83');
            if(!wharf && (col+row+b.detail)%3===1){
                rect(x+2,y+1,w*.19,h-2,lit?'#dbb394':'#a29aa4');
                rect(x+w*.78,y+1,w*.18,h-2,lit?'#c8a588':'#9a909b');
            }
            if(!wharf && (col*5+row+b.id)%7===0) for(let blind=0;blind<4;blind++)
                rect(x+1,y+blind*2.5,w-2,1.5,'#c0afa8');
            rect(x-1,y+h,w+3,glass?1.7:3,trim);
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
            // A lit ceiling, shelves, then the glazing bars in front of them.
            const warm=rng()<.70;
            if(warm){
                const room=ctx.createLinearGradient(0,193,0,247);
                room.addColorStop(0,'#e7a879');room.addColorStop(.5,'#996b65');room.addColorStop(1,'#3d3947');
                rect(x+4,194,slot-13,51,room);
                mask.fillStyle='#b88456';mask.fillRect(x+4,194,slot-13,48);
                rect(x+7,197,slot*.45,1.7,'#ffebbb');
                for(let shelf=0;shelf<2;shelf++){
                    const sy=220+shelf*13;
                    for(let k=0;k<5;k++){
                        const wh=rng.range(3,9);
                        rect(x+6+k*(slot-18)/5,sy-wh,(slot-20)/7,wh,rng.pick(['#947d69','#dfb58a','#4f6666','#785751']));
                    }
                    rect(x+4,sy,slot-13,2,'#53444c');
                    mask.clearRect(x+4,sy,slot-13,2);
                }
            }
            rect(x+slot*.46,191,2.4,60,trim);rect(x+2,204,slot-9,2,trim);
            mask.clearRect(x+slot*.46,191,2.4,60);

        }
    }
    rect(0,252,256,4,trim);
}

// The open spaces between narrow palm leaflets are cut out of a folded blade.
function palmAtlas(){
    const c=document.createElement('canvas');c.width=256;c.height=128;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,3,3);
    for(const side of [-1,1]){
        for(let i=0;i<38;i++){
            const t=(i+.5)/40, x=3+t*243;
            const spread=(9+48*Math.sin(t*Math.PI)**.68)*(1+.09*Math.sin(i*2.7+side));
            ctx.fillStyle=i%3?'#f5faea':'#d8e4c9';
            ctx.beginPath();ctx.moveTo(x,64);
            ctx.quadraticCurveTo(x+4,64+side*spread*.62,x+9+9*(1-t),64+side*spread);
            ctx.quadraticCurveTo(x+6,64+side*spread*.43,x+3,64);ctx.fill();
        }
    }
    ctx.fillStyle='#ecdda8';ctx.beginPath();ctx.moveTo(0,61.6);ctx.lineTo(255,64);ctx.lineTo(0,66);ctx.fill();
    const map=new THREE.CanvasTexture(c);map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=4;
    return map;
}

function palmBlade(length,width,droop,angle,sections,tipY,bend,color){
    const coords=[],uv=[],index=[];
    for(let k=0;k<=sections;k++){
        const t=k/sections;
        for(const side of [-1,0,1]){
            const curve=Math.sin(t*Math.PI);
            coords.push(length*t,tipY+curve*length*.25-droop*t*t-Math.abs(side)*width*(.18+.52*t),
                bend*t*t+side*width);
            uv.push(.017+.978*t,.5+side*.494);
        }
        if(k>0)for(let j=0;j<2;j++){
            const a=(k-1)*3+j;index.push(a,a+1,a+4,a,a+4,a+3);
        }
    }
    const geo=new THREE.BufferGeometry();geo.setIndex(index);
    geo.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();
    geo.rotateY(angle);geo.translate(3,0,0);return {geo,color};
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
    const wheel=[],bulbs=[];
    for(const side of [-1,1]){
        const zz=z+side*5, rim=new THREE.TorusGeometry(r,1.4,6,48);
        rim.translate(x,cy,zz);wheel.push({geo:rim,color:'#e4c3b6'});
        wheel.push(strut([x-39,10,zz+side*7],[x,cy,zz],2.4,'#d9bfa8'),
            strut([x+39,10,zz+side*7],[x,cy,zz],2.4,'#d9bfa8'));
        for(let i=0;i<16;i++){
            const a=i*Math.PI/8,px=x+Math.cos(a)*r,py=cy+Math.sin(a)*r;
            wheel.push(strut([x,cy,zz],[px,py,zz],.6,'#d4aaa7'));
            bulbs.push(spherePart(1.6,px,py,zz,i%2?'#fff6c1':'#ff9cac',1,1,1,5));
            if(side===1){
                wheel.push(boxPart(7,6,8,px,py-5,z,'#53858d'));
                bulbs.push(boxPart(7.6,1.3,8.6,px,py-2,z,'#ffcc98'));
            }
        }
    }
    bulbs.push(cylPart(2.1,2.1,9,x,cy,z,'#ffbd98'));
    // A distant wheel still needs its complete circumference and carriages.
    rest.push({geo:mergeParts(wheel),color:null});glow.push({geo:mergeParts(bulbs),color:null});
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
    const group=new THREE.Group(),near=[],mid=[],far=[];
    for(const [parts,leaves,steps] of [[near,10,6],[mid,9,4],[far,8,3]]){
        const trunk=strut([0,0,0],[1.1,27,-.9],1.64,'#998675',2.45);
        parts.push(trunk,strut([1.1,27,-.9],[3,53.5,0],1.18,'#a68f74',1.64),
            cylPart(2,1.32,6,3,52.4,0,'#839450',8));
        if(parts===near)for(let k=1;k<=12;k++){
            const t=k/13,r=t<.5?2.45-1.62*t:2.10-.92*t;
            const geo=new THREE.CylinderGeometry(r+.018,r+.045,.21,8,1,true);
            geo.rotateZ(.045*Math.sin(k));geo.translate(t<.5?t*2.2:1.1+(t-.5)*3.8,54*t,-Math.min(t,1-t)*1.8);
            parts.push({geo,color:'#907b68'});
        }
        for(const part of parts){
            const uv=part.geo.attributes.uv;for(let k=0;k<uv.count;k++)uv.setXY(k,.005,.990);
        }
        for(let i=0;i<leaves;i++){
            parts.push(palmBlade(20+(i%4)*2.8,4.3+(i%3)*.85,i%3===0?11:5,
                i*2.40+.11*Math.sin(i),steps,55+i%3*.6,Math.sin(i*4)*3,
                ['#46886c','#77a15e','#548367','#709754'][i%4]));
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
    foliage.side=THREE.DoubleSide;foliage.map=palmAtlas();foliage.alphaTest=.31;
    const levels=[near,mid,far].map(parts=>{
        const geometry=mergeParts(parts);
        // Camera-visible casters occupy the front of each instance buffer.
        return [false,true].map(caster=>{
            const mesh=new THREE.InstancedMesh(geometry,foliage,trees.length);
            mesh.count=0;mesh.castShadow=caster;mesh.frustumCulled=false;
            const shadows=mesh.userData.shadowOnly=[];
            mesh.onBeforeShadow=()=>{mesh.count=mesh.userData.drawn+shadows.length;};
            mesh.onAfterShadow=()=>{mesh.count=mesh.userData.drawn;};
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            group.add(mesh);return mesh;
        });
    });
    group.userData.update=(eye,scale,view,sun,occlusion)=>{
        for(const mesh of group.children){mesh.count=0;mesh.userData.shadowOnly.length=0;}
        const nearSq=(340*scale)**2, midSq=(1250*scale)**2;
        for(const {matrix,bounds} of trees){
            const caster=sun.intersectsSphere(bounds),c=bounds.center,r=bounds.radius;
            const visible=view.intersectsSphere(bounds) && !occlusion.hides(c.x,c.y,c.z,r*.74,r,r*.74);
            if(!caster && !visible)continue;
            const d=eye.distanceToSquared(c);
            const mesh=levels[d<nearSq?0:d<midSq?1:2][Number(caster)];
            if(visible)mesh.setMatrixAt(mesh.count++,matrix);
            else mesh.userData.shadowOnly.push(matrix);
        }
        for(const mesh of group.children){
            mesh.userData.drawn=mesh.count;
            for(let i=0;i<mesh.userData.shadowOnly.length;i++)mesh.setMatrixAt(mesh.count+i,mesh.userData.shadowOnly[i]);
            mesh.visible=mesh.count+mesh.userData.shadowOnly.length>0;
            if(mesh.visible)mesh.instanceMatrix.needsUpdate=true;
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

// Local u runs along the storefront, v out toward the pavement. The back of
// the entry stays at the wall while the surrounding bays project over it.
function streetFront(b,rest,glow,angle=b.front) {
    const nx=Math.sin(angle),nz=Math.cos(angle);
    const alongX=Math.abs(nz)>.5, span=alongX?b.w:b.h;
    const cx=b.x+b.w/2+nx*(alongX?b.h:b.w)/2,cz=b.y+b.h/2+nz*(alongX?b.h:b.w)/2;
    const frame=b.district==='Glasswater'?'#c4d2c8':'#f0d3ac';
    function place(w,h,d,u,y,v,tint,tilt=0,radius=0,dest=rest){
        const part=radius?roundedPart(w,h,d,0,0,0,tint,radius):boxPart(w,h,d,0,0,0,tint);
        part.geo.rotateX(tilt);part.geo.rotateY(angle);
        part.geo.translate(cx+nz*u+nx*v,y,cz-nx*u+nz*v);dest.push(part);
    }
    if(b.kind==='shop'||b.kind==='diner'||b.kind==='hotel'){
        const fabric=b.detail%2?'#1f9799':'#e65c78',width=span*.88, bays=width>108?5:3;
        const bay=width/bays, entry=-width/2+bay*1.5;
        place(width,1.1,5,0,.6,1.8,frame);
        place(bay*.78,15,.36,entry,8.3,.24,'#393746');
        for(const side of [-1,1]){
            place(1.25,15,4.5,entry+side*bay*.39,8.3,2.1,'#a38b83');
            place(bay*.31,10,.28,entry+side*bay*.18,9.5,.5,'#536272');
            place(.38,2.3,.5,entry+side*.9,8,.85,'#f0c58e');
        }
        for(let i=0;i<=bays;i++)place(1.75,17.8,3.9,-width/2+i*bay,9,2.05,frame);
        place(width,1.5,4.8,0,17.3,2.1,frame);
        // Contiguous fabric gores share a single pitched canopy with a hanging valance.
        for(let i=0;i<bays*3;i++){
            const u=-width/2+(i+.5)*bay/3,col=i%3===0?'#ead4af':fabric;
            place(bay/3+.02,.70,8.6,u,19.6,4.4,col,.32);
            place(bay/3+.02,1.65,.42,u,17.5,8.45,col);
        }
        place(width*.95,.34,.42,0,18.5,3.25,'#ffd3a2',0,0,glow);
    }
    if(b.balconies && angle===b.front){
        const width=Math.min(23,span*.24),count=span>115?3:2;
        for(let level=0;level<2;level++)for(let i=0;i<count;i++){
            const u=(i-(count-1)/2)*span*.72/count, y=23+level*Math.min(16,(b.height-33)*.5);
            place(width*.77,9.8,.7,u,y+4.7,.5,'#344651');
            place(.52,9.6,.7,u,y+4.7,1,'#d7c9ac');
            place(width,1.25,6,u,y,2.6,frame,0,.4);
            place(width,.55,.6,u,y+4.4,5.55,'#4c666a');
            for(const f of [-.48,-.25,0,.25,.48])place(.45,3.8,.48,u+width*f,y+2.45,5.55,'#536b6a');
            for(const side of [-1,1])place(.52,.55,5.1,u+side*width*.48,y+4.4,3,'#4c666a');
        }
    }
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
        const H=b.height, cx=b.x+b.w/2, cz=b.y+b.h/2;
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
        rest.push(roundedPart(b.w+3.6,2.2,b.h+3.6,cx,H-.8,cz,b.roof,.68),...(b.setback?[]:[roofPart(b,H)]),roundedPart(b.w+1.5,1.8,b.h+1.5,cx,.9,cz,'#aca49a',.65));
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
        } else if(b.setback){
            const w=b.w*.70,d=b.h*.70;
            facadeBox(b,w,b.setback,d,cx,H+b.setback/2,cz);
            rest.push(roundedPart(w+2.2,2.4,d+2.2,cx,H+b.setback,cz,b.roof,.45),
                boxPart(w*.65,2,d*.64,cx,H+b.setback+1.5,cz,'#968881'));
        }
        streetFront(b,rest,glow);
        if(b.kind==='shop'||b.kind==='diner')for(const face of b.crossFronts)streetFront(b,rest,glow,face);
        if(b.kind==='shop'||b.kind==='diner'){
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
            rest.push(boxPart(23,4.5,8,x,2.3,y,'#dfc5aa'),boxPart(21,.4,6.4,x,4.7,y,'#564d46'));
            // Three tapering rosettes, each with a young central spear and
            // folded outer leaves. The dusty undersides catch the rim light.
            for(const [dx,h,r,tint] of [[-6,6.7,3.4,'#638775'],[.6,9.4,3.8,'#8b9d76'],[6.8,7.3,3.4,'#587f70']]){
                rest.push(conePart(r*.29,h,x+dx,4.8+h/2,y,tint,5));
                for(let k=0;k<8;k++){
                    const angle=k*2.4+dx, spread=r*(k%2?.82:1.2),tip=h*(k%2?.89:.58);
                    const geo=new THREE.BufferGeometry();
                    geo.setAttribute('position',new THREE.Float32BufferAttribute([
                        0,0,0, spread*.48,tip*.40,-.94, spread*.43,tip*.55,0,
                        spread*.48,tip*.40,-.94,spread,tip,0,spread*.43,tip*.55,0,
                        0,0,0,spread*.43,tip*.55,0,spread*.48,tip*.40,.94,
                        spread*.43,tip*.55,0,spread,tip,0,spread*.48,tip*.40,.94],3));
                    geo.computeVertexNormals();geo.rotateY(angle);geo.translate(x+dx,4.7,y);
                    rest.push({geo,color:tint});
                }
            }
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

export function streetSignals(world,material){
    const signals=world.props.filter(p=>p.kind==='signal');
    const pole='#546368', housing='#334347';
    const parts=[cylPart(1.3,1.8,35,0,17.5,0,pole,8),cylPart(2.45,2.7,2.3,0,1.15,0,'#7c827c',8),
        strut([0,32,0],[6,37,0],.93,pole),strut([6,37,0],[76,37,0],.78,pole),
        strut([0,34,0],[44,37,0],.43,pole),
        boxPart(4.8,11.3,2.85,75,31.7,0,'#d1a253'),boxPart(4.2,10.65,.72,75,31.7,1.58,housing)];
    for(let k=0;k<3;k++){
        const y=35-k*3.25,geo=new THREE.CircleGeometry(1.25,12);
        geo.translate(75,y,2.03);parts.push({geo,color:['#673f44','#66563b','#34574e'][k]});
        const shade=new THREE.CylinderGeometry(1.48,1.48,1.5,8,1,true,0,Math.PI);
        shade.rotateX(Math.PI/2);shade.rotateZ(Math.PI/2);shade.translate(75,y,2.65);
        parts.push({geo:shade,color:housing});
    }
    const mesh=new THREE.InstancedMesh(mergeParts(parts),material,signals.length);
    const pose=new THREE.Object3D();
    const frames=[];
    const lights=signals.map((s,i)=>{
        pose.position.set(s.x,0,s.y);pose.rotation.y=s.angle;pose.updateMatrix();mesh.setMatrixAt(i,pose.matrix);
        const bounds=new THREE.Sphere(new THREE.Vector3(38,18,0).applyMatrix4(pose.matrix),45);
        frames.push({matrix:pose.matrix.clone(),bounds});
        const point=new THREE.Vector3(75,0,2.12).applyMatrix4(pose.matrix);
        return {node:s.node,horizontal:s.angle!==0,x:point.x,z:point.z,angle:s.angle};
    });
    mesh.castShadow=mesh.receiveShadow=true;mesh.frustumCulled=false;
    mesh.userData.update=(view,sun,occlusion)=>{
        mesh.count=0;
        for(const {matrix,bounds} of frames){
            const c=bounds.center;
            if(sun.intersectsSphere(bounds)||(view.intersectsSphere(bounds)&&!occlusion.hides(c.x,c.y,c.z,44,20,44)))
                mesh.setMatrixAt(mesh.count++,matrix);
        }
        mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;
    };
    return {mesh,lights};
}

export function curbPuddles(world){
    const parts=[];
    for(const p of world.props.filter(p=>p.kind==='puddle')){
        const geo=new THREE.CircleGeometry(1,16);
        const pos=geo.attributes.position;
        for(let i=1;i<pos.count;i++){
            const a=2*Math.PI*(i-1)/16, r=.84+.12*Math.sin(3*a+p.phase)+.09*Math.cos(5*a);
            pos.setXY(i,r*Math.cos(a)*p.width,r*Math.sin(a)*p.length*.50);
        }
        geo.rotateX(-Math.PI/2);geo.translate(p.x,.205,p.y);
        parts.push({geo,color:'#625766'});
    }
    return new THREE.Mesh(mergeParts(parts),new THREE.MeshStandardMaterial({
        vertexColors:true,roughness:.05,metalness:.48,envMapIntensity:1
    }));
}

// Rooftop blades and double-sided marquees carry the hand-painted shop names.
export function buildSigns(world,halos=[]) {
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
        }else if(name==='TIDE BAR'||name==='SURF CLUB'){
            const tide=name==='TIDE BAR';
            ctx.strokeStyle=neon;ctx.shadowBlur=7;ctx.shadowColor=neon;ctx.lineWidth=3.4;
            // A rolling wave and three tapered surfboards identify the two Ocean Drive marquees.
            for(let j=0;j<3;j++){
                ctx.beginPath();
                if(tide){ctx.moveTo(23,53+j*9);ctx.bezierCurveTo(42,60+j*9,51,32+j*9,79,47+j*9);}
                else{ctx.ellipse(38+j*12,64,4.1,25,-.36+j*.14,0,Math.PI*2);}
                ctx.stroke();
            }
            ctx.textAlign='left';ctx.shadowBlur=0;ctx.fillStyle='#e7c399';
            ctx.font='bold 14px monospace';ctx.fillText(tide?'O C E A N    D R I V E':'C O R A L    M I L E',98,35);
            ctx.fillStyle=neon;ctx.shadowColor=neon;ctx.shadowBlur=6;
            ctx.font=tide?'italic bold 64px sans-serif':'bold 59px sans-serif';ctx.fillText(name,94,94,394);
        }else{
            ctx.textAlign='center';ctx.font='bold 14px monospace';ctx.fillText(b.district.toUpperCase().split('').join(' '),w/2,30);
            ctx.shadowBlur=5;ctx.shadowColor=neon;
            ctx.font=(b.kind==='bank'?'bold 54px serif':'italic bold 59px sans-serif');
            ctx.fillText(name,w/2,93,w-42);
        }
        ctx.restore();
    }
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,5,5);
    const tubeShape=(length,r)=>{
        const geo=new THREE.CylinderGeometry(r,r,length,5,1,true);
        const uv=geo.attributes.uv;
        for(let k=0;k<uv.count;k++)uv.setXY(k,2.5/sheet.width,1-2.5/sheet.height);
        return geo;
    };
    for(const b of buildings){
        const H=b.height,bw=Math.min(b.w*.79,102),bh=bw*h/w;
        const i=labels.indexOf(b.label),offset=.7;
        const faces=[[b.x+b.w+offset,b.y+b.h/2,Math.PI/2],[b.x-offset,b.y+b.h/2,-Math.PI/2],
            [b.x+b.w/2,b.y+b.h+offset,0],[b.x+b.w/2,b.y-offset,Math.PI]];
        for(const [x,z,a] of faces){
            const p=wallQuad(bw,bh,x,Math.min(H-bh*.54,21+bh/2),z,'#ffffff',a);
            const nx=Math.sin(a),nz=Math.cos(a),y=Math.min(H-bh*.54,21+bh/2);
            const tint=buildings.find(other=>other.label===b.label);
            const color=['warehouse','garage'].includes(tint.kind)?'#ffbf76':tint.detail%2?'#6aebd5':'#ff749c';
            halos.push({x:x-.28*nx,y,z:z-.28*nz,nx,nz,angle:a,width:bw*1.52,height:bh*2.55,color});
            const uv=p.geo.attributes.uv;
            for(let k=0;k<uv.count;k++)uv.setXY(k,(i%cols+.004+uv.getX(k)*.992)/cols,
                1-(Math.floor(i/cols)+.996-uv.getY(k)*.992)/rows);
            parts.push(p);
            // Each tube stands proud of the enamel backplate and catches the silhouette.
            for(const sign of [-1,1]){
                for(const horizontal of [true,false]){
                    const geo=tubeShape(horizontal?bw-1.1:bh-1.1,.39);
                    if(horizontal)geo.rotateZ(Math.PI/2);
                    geo.rotateY(a);
                    const u=horizontal?0:sign*(bw/2-.6),v=horizontal?sign*(bh/2-.6):0;
                    geo.translate(x+u*nz+nx*.5,y+v,z-u*nx+nz*.5);parts.push({geo,color});
                }
            }
        }
    }
    for(const b of world.buildings.filter(b=>b.kind==='shop'||b.kind==='diner')){
        const angle=b.front,nx=Math.sin(angle),nz=Math.cos(angle),across=Math.abs(nz)>.5;
        const depth=(across?b.h:b.w)/2+1.1;
        halos.push({x:b.x+b.w/2+nx*depth,y:9,z:b.y+b.h/2+nz*depth,
            nx,nz,angle,width:(across?b.w:b.h)*.88,height:22,color:'#ffa067'});
    }
    const tex=new THREE.CanvasTexture(sheet);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;
    return [cityBatch(mergeBlocks(parts),new THREE.MeshBasicMaterial({map:tex,toneMapped:false,vertexColors:true}),false)];
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
const painted=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.47,roughness:.30,envMapIntensity:.55});
const lacquer=new THREE.MeshPhysicalMaterial({vertexColors:true,metalness:.55,roughness:.25,
    clearcoat:1,clearcoatRoughness:.10,envMapIntensity:.8});
const glazing=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.76,roughness:.11,envMapIntensity:1.2});
const moulding=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.32,roughness:.46,envMapIntensity:.5});
const lens=new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false});
const rubber=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.87});
const alloy=new THREE.MeshStandardMaterial({vertexColors:true,metalness:.67,roughness:.22});
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
    disc(radius*.75,.27,1.16,'#b1b6bd',rims);
    disc(radius*.656,.20,1.30,'#242b36',tyres);
    disc(radius*.43,.11,1.42,'#68727a',rims);
    // Tapered split spokes leave the rotor and dark barrel visible.
    for(let k=0;k<5;k++)for(const split of [-1,1]){
        const a=k*Math.PI*2/5, verts=[];
        for(const [r,off] of [[.12,-.26],[.63,split*.23-.055],[.69,split*.23+.065],[.16,.29]]){
            verts.push(Math.cos(a+off)*r*radius,Math.sin(a+off)*r*radius,1.55);
        }
        const spoke=new THREE.BufferGeometry();
        spoke.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
        spoke.setIndex([0,1,2,0,2,3]);spoke.computeVertexNormals();
        rims.push({geo:spoke,color:'#e4e5dd'});
    }
    disc(radius*.17,.25,1.58,'#b5b8be',rims);
    const geo=materialGroups([tyres,rims]); wheels.set(radius,geo); return geo;
}

// Belt sections run tail to nose as [fractional length, half-width fraction,
// deck height]. Greenhouse stations control rear glass, roof and windshield rake.
const coachwork = {
    sports:{belt:[[-.50,.405,8.7],[-.44,.479,9.3],[-.31,.512,10.9],[-.14,.466,8.8],[.10,.477,8.45],[.31,.503,10.7],[.43,.465,8.15],[.50,.389,7.25]],
        cabin:[-.43,-.21,-.035,.225], top:9.1, roof:14.1},
    sedan:{belt:[[-.50,.44,9.0],[-.40,.488,10.8],[-.28,.501,11.6],[.12,.495,11.1],[.31,.501,11.5],[.50,.444,9.6]],
        cabin:[-.31,-.225,.112,.32], top:11.1, roof:18.0},
    taxi:{belt:[[-.50,.456,10.3],[-.43,.50,11.3],[-.30,.506,11.95],[.20,.496,11.6],[.34,.498,11.6],[.50,.451,10.05]],
        cabin:[-.365,-.265,.138,.326], top:11.55, roof:18.35},
    police:{belt:[[-.50,.43,10.25],[-.40,.485,11.35],[-.31,.511,11.95],[.13,.483,10.75],[.31,.507,11.65],[.50,.456,9.45]],
        cabin:[-.35,-.19,.078,.32], top:11.0, roof:16.9},
    van:{belt:[[-.50,.471,12.45],[-.45,.504,12.65],[.24,.505,12.6],[.40,.493,11.8],[.50,.45,10.6]],
        cabin:[-.49,-.462,.242,.45], top:12.55, roof:23.65},
    armored:{belt:[[-.50,.462,13.25],[-.455,.506,13.75],[.17,.507,13.75],[.31,.495,13.1],[.50,.453,11.95]],
        cabin:[-.486,-.447,.162,.379], top:13.55, roof:24.5}
};

function archBand(x,y,z,side,inner,outer,color){
    const geo=new THREE.RingGeometry(inner,outer,18,1,0,Math.PI);
    if(side<0)geo.rotateY(Math.PI);
    geo.translate(x,y,z);
    return {geo,color};
}

function carParts(type,color) {
    const key=type+'|'+color;
    if(carCache.has(key))return carCache.get(key);
    const {length:L,width:W,wheelRadius:radius}=CARS[type],sports=type==='sports',van=type==='van'||type==='armored';
    const {belt,cabin:[tail,back,front,nose],top,roof}=coachwork[type];
    const paint=[],glass=[],trim=[],lights=[],wheelCenters=[];
    const stations=new Set(belt.map(row=>row[0]));
    for(const axle of [-.31,.31]) for(let j=0;j<=8;j++){
        stations.add(axle+Math.cos(j*Math.PI/8)*(radius+.72)/L);
    }
    const section=x=>{
        const end=belt.findIndex((r,i)=>i>0 && r[0]>=x);
        const [xa,wa,ya]=belt[end-1], [xb,wb,yb]=belt[end];
        const t=(x-xa)/(xb-xa),w=W*(wa+(wb-wa)*t),h=ya+(yb-ya)*t;
        return {w,h};
    };
    const body=[...stations].sort((a,b)=>a-b).map(x=>{
        const {w,h}=section(x);
        const dx=Math.abs(Math.abs(x)-.31)*L, outer=radius+.72;
        const arch=dx<outer?radius+Math.sqrt(Math.max(0,outer**2-dx**2)):3.15;
        const low=Math.min(h-.26,arch),sill=2.7;
        return [[0,sill],[w*.73,sill],[w*.87,low],[w*.98,low+.10],[w,h-.30],[w*.94,h+.05],
            [w*.72,h+.34],[0,h+.48],[-w*.72,h+.34],[-w*.94,h+.05],[-w,h-.30],
            [-w*.98,low+.10],[-w*.87,low],[-w*.73,sill]].map(([z,y])=>[L*x,y,z]);
    });
    paint.push({geo:loft(body),color});
    const cabin=[[tail,top+.45,.435],[back-.019,roof-.51,van?.418:.36],[back,roof,van?.412:.348],
        [front,roof+.06,van?.412:.346],[front+.025,roof-.45,van?.42:.358],[nose,top+.35,.427]];
    const cabinRings=cabin.map(([x,h,tw])=>{
        const bottom=top-.22;
        return [[0,bottom],[W*.445,bottom],[W*tw,h-.18],[W*tw*.82,h+.14],
            [0,h+.28],[-W*tw*.82,h+.14],[-W*tw,h-.18],[-W*.445,bottom]].map(([z,y])=>[x*L,y,z]);
    });
    glass.push({geo:loft(cabinRings),color:'#7a8298'});
    paint.push(roundedPart((front-back+.035)*L,.84,W*(van?.834:.705),(back+front)*L/2,roof+.05,0,color,.4,2));
    for(const side of [-1,1]){
        const pane=(x,y,z)=>[x*L,y,z*W*side];
        paint.push(strut(pane(tail,top+.47,.44),pane(back,roof,van?.412:.348),van?.95:.5,color),
            strut(pane(front,roof,van?.412:.348),pane(nose,top+.42,.43),.49,color));
        trim.push(strut(pane(back*.30,top+.13,.447),pane(back*.30,roof-.20,.359),.39,'#242637'),
            strut(pane(tail,top+.12,.453),pane(nose,top+.12,.453),.21,'#b3b5b1'));
        if(van){
            const rear=tail*L+.8,end=L*(front-.035),len=end-rear;
            // Broad pressed cargo doors replace the passenger greenhouse behind the cab.
            paint.push(roundedPart(len,roof-top-.25,1.5,(rear+end)/2,(roof+top)/2,side*W*.435,color,.62));
            trim.push(boxPart(len*.80,.35,.30,(rear+end)/2,top+2,side*W*.469,'#594954'));
            if(type==='armored') trim.push(boxPart(len*.70,1.7,.46,(rear+end)/2,roof-2.1,side*W*.472,'#303e48'));
        }
        const mirrorX=L*nose*.75;
        paint.push(roundedPart(3.6,1.6,3,mirrorX,top+1,side*W*.548,color,.55));
        glass.push(roundedPart(.28,1.03,2.2,mirrorX-1.79,top+1.05,side*W*.548,'#8796ae',.12));
        trim.push(roundedPart(L*.40,.78,.72,0,3.1,side*W*.487,'#31343e'));
        for(const handle of [-.113,.12]) trim.push(boxPart(1.95,.43,.58,handle*L,top-1.15,side*W*.49,'#3b3944'));
        trim.push(strut(pane(-.19,top-.62,.491),pane(.19,top-.69,.49),.17,'#56424c'));
        // Thin swept light signatures wrap around both corners.
        const corner=(x,drop)=>{const {w,h}=section(x);return [x*L,h-drop,side*(w+.02)];};
        lights.push(strut(corner(.492,.67),corner(.444,.66),.18,'#ffe7bc'),
            strut(corner(-.497,1.0),corner(-.457,.86),.20,'#ff4954'));
        for(const ax of [-.31,.31]){
            const face=side*(W*.503+.35);
            trim.push(archBand(ax*L,radius,face,side,radius-.03,radius+.65,'#171b26'));
            paint.push(archBand(ax*L,radius,face+side*.06,side,radius+.65,radius+.91,color));
            wheelCenters.push([ax*L,radius,side*(W*.503-.94),side]);
        }
        trim.push(roundedPart(1.4,.95,2.8,-L*.491,3.2,side*W*.30,'#979698',.42));
    }
    trim.push(roundedPart(1.4,2.75,W*.78,L*.486,4.65,0,'#262830',.65),
        roundedPart(1.52,3.2,W*.80,-L*.483,4.7,0,'#34313b',.73));
    for(const side of [-1,1]) trim.push(roundedPart(.62,1.5,W*.18,L*.501,5.7,side*W*.28,'#171b20'));

    function panel(points,material,tint) {
        const geo=new THREE.BufferGeometry();
        const coords=[];
        for(let i=1;i<points.length-1;i++) coords.push(...points[0],...points[i],...points[i+1],
            ...points[i+1],...points[i],...points[0]);
        geo.setAttribute('position',new THREE.Float32BufferAttribute(coords,3));
        geo.computeVertexNormals();material.push({geo,color:tint});
    }
    if(van){
        // Split cargo doors follow the rake of the van's rear wall. The armoured
        // carrier has narrow vision slots and steel hinges on the reinforced edge.
        const rearDoor=(t,z,proud)=>[(tail+(back-.019-tail)*t)*L-proud,
            top+.45+(roof-.48-top-.45)*t,z*W];
        for(const side of [-1,1]){
            const patch=(bottom,high,inner,outer,proud,parts,tint)=>panel([
                rearDoor(bottom,inner*side,proud),rearDoor(bottom,outer*side,proud),
                rearDoor(high,outer*side,proud),rearDoor(high,inner*side,proud)],parts,tint);
            patch(.015,.98,.008,.412,.17,paint,color);
            patch(type==='armored'?.60:.42,.85,.055,.353,.22,trim,'#33414c');
            patch(type==='armored'?.65:.47,.81,.066,.34,.25,glass,'#71818a');
            for(const t of [.18,.71]){
                const [x,y,z]=rearDoor(t,.40*side,.28);
                trim.push(boxPart(.48,.60,1.8,x,y,z,'#505559'));
            }
            const [x,y,z]=rearDoor(.28,.075*side,.35);
            trim.push(boxPart(.5,1.1,1.75,x,y,z,'#383e41'));
        }
    }
    const noseX=L*.504,tailX=-L*.504;
    // Recessed radiator opening, splitter, projector lenses, rear diffuser and exhaust tips.
    panel([[noseX,3.65,-W*.30],[noseX,3.65,W*.30],[noseX,5.66,W*.235],[noseX,5.66,-W*.235]],trim,'#171b26');
    for(const y of [4,4.45,4.9,5.35])
        trim.push(boxPart(.14,.11,W*(y<4.6?.54:.48),noseX+.10,y,0,'#54525a'));
    trim.push(roundedPart(1.4,.58,W*.86,noseX-.55,3.18,0,'#30303c',.24),
        roundedPart(.85,2.05,W*.80,tailX,top-1.54,0,'#382631',.42),
        roundedPart(1.24,1.60,W*.81,tailX+.14,3.64,0,'#292b33',.44));
    for(const side of [-1,1]){
        const frontPoint=(y,z)=>[noseX+.06,y,side*W*z];
        const head=belt[belt.length-1][2], outer=belt[belt.length-1][1]-.023;
        panel([frontPoint(head-1.58,.14),frontPoint(head-.61,.18),
            frontPoint(head-.48,outer),frontPoint(head-1.57,outer-.01)],trim,'#253346');
        lights.push(strut(frontPoint(head-.67,.18),frontPoint(head-.55,outer),.14,'#fff3c8'),
            spherePart(.34,noseX+.20,head-1.07,side*W*.31,'#e4f6fc',.46,.78,1.20));
        for(const row of [0,.40]) lights.push(roundedPart(.36,.22,W*.29,tailX-.48,top-1.42+row,side*W*.235,'#ff394b',.1));
        const exhaust=new THREE.CylinderGeometry(.76,.76,1.15,12);exhaust.rotateZ(Math.PI/2);
        exhaust.translate(tailX-.14,3.55,side*W*.305);trim.push({geo:exhaust,color:'#8b8d8c'});
        const bore=new THREE.CircleGeometry(.57,12);bore.rotateY(-Math.PI/2);
        bore.translate(tailX-.73,3.55,side*W*.305);trim.push({geo:bore,color:'#161a21'});
        const doorPoint=(x,y)=>[L*x,y,side*(section(x).w*.984+.13)];
        for(const x of [-.177,.171]){
            trim.push(strut(doorPoint(x,section(x).h-.72),doorPoint(x*.87,4.2),.085,'#4b343e'));
        }
        if(sports){
            const hood=(x,z)=>[x*L,section(x).h+.43,z*W*side];
            trim.push(strut(hood(.228,.29),hood(.31,.255),.071,'#70334d'),
                strut(hood(.31,.255),hood(.455,.22),.071,'#70334d'));
        }
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
    const mediumBody=body.map(row=>[row[0],row[2],row[4],row[6],row[8],row[10],row[12]]);
    const distantParts=[{geo:loft(mediumBody),color},{geo:loft(cabinRings),color:'#374858'}];
    // At roughly 70–200 screen pixels the roof shape, window pillars, rocker,
    // lights and wheels survive. Subpixel fasteners don't need individual tubes.
    for(const part of [...paint.slice(1),...trim,...lights]){
        part.geo.computeBoundingBox();
        const box=part.geo.boundingBox,sz=box.getSize(new THREE.Vector3()),pt=box.getCenter(new THREE.Vector3());
        if(part.geo.type==='RingGeometry')continue;
        if(Math.max(sz.x,sz.y,sz.z)<3.2)continue;
        if(part.geo instanceof RoundedBoxGeometry)distantParts.push(boxPart(sz.x,sz.y,sz.z,pt.x,pt.y,pt.z,part.color));
        else if(part.geo.type==='CylinderGeometry'){
            // Retain raked pillars and the long belt line but use four sides at this LOD.
            const attr=part.geo.attributes.position,n=part.geo.parameters.radialSegments;
            const endpoint=row=>{
                const v=new THREE.Vector3();for(let i=0;i<n;i++)v.add(new THREE.Vector3().fromBufferAttribute(attr,row*(n+1)+i));
                return v.divideScalar(n);
            };
            const top=endpoint(0),base=endpoint(1),axis=top.clone().sub(base);
            const geo=new THREE.CylinderGeometry(part.geo.parameters.radiusTop,part.geo.parameters.radiusBottom,axis.length(),4,1,true);
            geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),axis.normalize()));
            const middle=top.lerp(base,.5);geo.translate(middle.x,middle.y,middle.z);distantParts.push({geo,color:part.color});
        }else distantParts.push(part);
    }
    for(const [x,y,z,side] of wheelCenters){
        const geo=new THREE.CylinderGeometry(radius,radius,2.28,14,1,true);geo.rotateX(Math.PI/2);geo.translate(x,y,z);
        distantParts.push({geo,color:P.tire});
        const face=new THREE.CircleGeometry(radius,14);face.rotateY(side<0?Math.PI:0);face.translate(x,y,z+side*1.15);
        distantParts.push({geo:face,color:P.tire});
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
    const outline=body.filter((_,i)=>i%3===0 || i===body.length-1).map(row=>[row[0],row[3],row[5],row[7],row[9],row[11]]);
    const silhouette=[{geo:loft(outline),color},
        {geo:loft(cabinRings),color:'#415466'},boxPart((front-back)*L,.8,W*.7,(front+back)*L/2,roof,0,color)];
    for(const [x,y,z,side] of wheelCenters){
        const tyre=new THREE.CylinderGeometry(radius,radius,2.3,10,1,true);tyre.rotateX(Math.PI/2);tyre.translate(x,y,z);
        const face=new THREE.CircleGeometry(radius,10);face.rotateY(side<0?Math.PI:0);face.translate(x,y,z+side*1.16);
        silhouette.push({geo:face,color:P.tire});
        const hub=new THREE.CircleGeometry(radius*.63,10);hub.rotateY(side>0?0:Math.PI);hub.translate(x,y,z+side*1.2);
        silhouette.push({geo:tyre,color:P.tire},{geo:hub,color:P.hub});
    }
    for(const side of [-1,1]){
        silhouette.push(boxPart(.6,1.1,W*.23,L*.5,top-1.8,side*W*.30,P.headlamp),
            boxPart(.6,.8,W*.30,-L*.5,top-1.35,side*W*.25,P.taillight));
    }
    if(van) {
        const length=(front-tail)*L;
        for(const side of [-1,1]) silhouette.push(boxPart(length,roof-top-.4,1.3,
            (tail+front)*L/2,(roof+top)/2,side*W*.425,color));
        for(const part of paint)if(part.geo.type==='BufferGeometry' && part!==paint[0])silhouette.push(part);
    }
    if(type==='taxi')silhouette.push(boxPart(7.5,3,12,0,roof+1.85,0,P.lamp));
    if(type==='police')for(const side of [-1,1])silhouette.push(boxPart(3,2,W*.3,0,roof+2.1,side*W*.17,side>0?P.policeRed:P.policeCyan));
    const model={shell,wheel,wheelCenters,radius,medium:mergeParts(distantParts),distant:mergeParts(silhouette)};
    carCache.set(key,model);return model;
}

// The white shell is the paint mask. Keep the glazing, rubber, trim and lamps
// in vertex colours while supplying just the body colour per traffic instance.
const trafficMaterial=painted.clone();
trafficMaterial.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <color_vertex>',
        `#include <color_vertex>
         #ifdef USE_INSTANCING_COLOR
         vColor=mix(color,instanceColor,step(.9999,min(color.r,min(color.g,color.b))));
         #endif`);
};
export function trafficBatch(type,level,capacity){
    const geo=carParts(type,'#ffffff')[level];
    const mesh=new THREE.InstancedMesh(geo,trafficMaterial,capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;
    return mesh;
}

export function buildCar(type,color) {
    const model=carParts(type,color),root=new THREE.Group(),fine=new THREE.Group();
    const shell=new THREE.Mesh(model.shell,[painted,glazing,moulding,lens]);
    shell.castShadow=shell.receiveShadow=true;fine.add(shell,carLettering(type));
    const wheelSet=new THREE.InstancedMesh(model.wheel,[rubber,alloy],4);
    const tyres=model.wheelCenters.map(([x,y,z,side],i)=>{
        const tyre=new THREE.Object3D();tyre.position.set(x,y,z);
        tyre.rotation.set(0,side>0?0:Math.PI,0,'YXZ');tyre.updateMatrix();
        wheelSet.setMatrixAt(i,tyre.matrix);return tyre;
    });
    wheelSet.computeBoundingSphere();wheelSet.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    fine.add(wheelSet);
    const lod=new THREE.Mesh(model.distant,painted);lod.castShadow=lod.receiveShadow=true;
    root.add(fine,lod);root.userData={fine,lod,shell,tyres,wheelSet,color,model,radius:model.radius};
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
        tyre.updateMatrix();root.userData.wheelSet.setMatrixAt(i,tyre.matrix);
    });
    if(near)root.userData.wheelSet.instanceMatrix.needsUpdate=true;
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
        for(const side of [-1,1])add(11,3.1,side*3.82,coachwork.taxi.roof+1.98,0,side*Math.PI/2,cab);
        for(const side of [-1,1])add(7,2.8,0,coachwork.taxi.roof+1.98,side*6.1,side===1?0:Math.PI,cab);
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
