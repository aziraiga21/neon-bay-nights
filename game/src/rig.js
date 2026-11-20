// Joint-local, rigidly weighted pieces share a single skin draw per person.
import * as THREE from '../vendor/three.module.min.js';
import {PALETTE as P, LEG, HIP_HEIGHT} from './config.js';

const outfits=new Map();
const fabric=new THREE.MeshLambertMaterial({vertexColors:true,emissive:0x161219});
const hitFabric=new THREE.MeshStandardMaterial({color:0xffddbf,emissive:0x542527,roughness:.83});
const portraitSphere=new THREE.SphereGeometry(1,12,8);
const crowdSphere=new THREE.SphereGeometry(1,8,5);
const farSphere=new THREE.SphereGeometry(1,6,4);
const unitBox=new THREE.BoxGeometry(1,1,1);
const joints=[
    ['pelvis',null,0,HIP_HEIGHT,0],['torso','pelvis',0,1,0],['head','torso',0,7.74,0]
];
for(const [suffix,side] of [['L',1],['R',-1]]){
    joints.push(['thigh'+suffix,'pelvis',0,0,side*1.47],['knee'+suffix,'thigh'+suffix,0,-LEG.thigh,0],
        ['ankle'+suffix,'knee'+suffix,0,-LEG.shin,0],['shoulder'+suffix,'torso',0,5.9,side*2.93],
        ['elbow'+suffix,'shoulder'+suffix,0,-4.2,side*.24]);
}

function outfit(opts, bones, distant=false) {
    const {jacket,skin,hair,trousers,player,officer,style,openJacket}=opts;
    const key=[jacket,skin,hair,trousers,player,officer,style,openJacket,distant].join('|');
    if(outfits.has(key)) return outfits.get(key);
    const sphere=distant?farSphere:player?portraitSphere:crowdSphere;
    const position=[],normal=[],color=[],index=[],skinIndex=[],weight=[];
    const ink=new THREE.Color();
    function piece(joint, geo, tint, x,y,z, sx=1,sy=1,sz=1, angle=0) {
        const b=bones[joint], base=position.length/3;
        const matrix=new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),angle),new THREE.Vector3(sx,sy,sz));
        if(joint==='torso' || joint==='pelvis') {
            matrix.premultiply(new THREE.Matrix4().makeScale(.83, joint==='torso'?.94:1, .75));
        } else if(joint.startsWith('shoulder') || joint.startsWith('elbow')) {
            matrix.premultiply(new THREE.Matrix4().makeScale(.77,1.09,.75));
        }
        const g=geo.clone().applyMatrix4(matrix.premultiply(b.matrixWorld));
        ink.set(tint);
        const pos=g.attributes.position,nor=g.attributes.normal, id=joints.findIndex(j=>j[0]===joint);
        for(let i=0;i<pos.count;i++){
            position.push(pos.getX(i),pos.getY(i),pos.getZ(i));
            normal.push(nor.getX(i),nor.getY(i),nor.getZ(i));
            color.push(ink.r,ink.g,ink.b);skinIndex.push(id,0,0,0);weight.push(1,0,0,0);
        }
        if(g.index) for(const i of g.index.array) index.push(base+i);
        else for(let i=0;i<pos.count;i++) index.push(base+i);
    }
    const oval=(joint,tint,x,y,z,sx,sy,sz,angle=0)=>piece(joint,sphere,tint,x,y,z,sx,sy,sz,angle);
    // Elliptical sections let a jacket narrow at the ribs, a calf taper
    // into a cuff, and the jaw project forward of the neck.
    function cut(joint,tint,profile,depth=1) {
        const sides=distant?6:player?14:10,verts=[],indices=[];
        profile.forEach(([height,r,offset=0],i)=>{
            for(let k=0;k<sides;k++){
                const a=k*Math.PI*2/sides;
                verts.push(offset+depth*r*Math.cos(a),height,r*Math.sin(a));
                if(i){
                    const p=(i-1)*sides+k,q=(i-1)*sides+(k+1)%sides;
                    indices.push(p,p+sides,q+sides,p,q+sides,q);
                }
            }
        });
        for(let k=1;k<sides-1;k++){
            const top=(profile.length-1)*sides;
            indices.push(0,k,k+1,top,top+k+1,top+k);
        }
        const geo=new THREE.BufferGeometry();geo.setIndex(indices);
        geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));geo.computeVertexNormals();
        piece(joint,geo,tint,0,0,0);
    }
    cut('pelvis',trousers,[[-1.65,1.1,-.18],[-1.12,3.32,-.22],[.55,3.48],[1.32,3.1],[1.4,.1]],.69);
    cut('torso',jacket,[[-.9,2.85],[-.55,3.47],[.4,3.49],[2,3.2],[4.5,3.75],
        [5.82,4.16],[6.38,3.85],[6.95,2.50],[7.32,1.48]],.67);
    cut('torso',player?'#214349':trousers,[[-.82,3.5],[-.32,3.53]],.68);
    // The neck belongs to the chest. The head turns about the base of the jaw.
    cut('torso',skin,[[7.14,.99],[8.1,.98],[8.84,1.04,.05]],.95);
    cut('head',skin,[[0,.42,.34],[.16,.79,.32],[.59,1.02,.15],[1.22,1.14,.11],
        [1.89,1.17,.02],[2.62,1.14,-.03],[3.21,.91,-.06],[3.52,.27,-.09]],1.13);
    // The hair follows the skull with an open hairline at the forehead.
    const locks=[],hairIndex=[],sides=distant?8:16;
    const crown=[[.23,.88,.26],[.90,1.16,.14],[1.73,1.24,.05],[2.58,1.24,-.02],
        [3.10,1.12,-.06],[3.42,.96,-.09],[3.66,.61,-.09],[3.76,.03,-.09]];
    for(let j=0;j<8;j++)for(let k=0;k<sides;k++){
        const a=k*Math.PI*2/sides,front=(Math.cos(a)+1)/2;
        const hairline= .42+1.96*front+.085*Math.sin(a*3+.4);
        const y=j===7?3.76:hairline+(3.76-hairline)*j/7;
        const hi=crown.findIndex(row=>row[0]>=y),lo=Math.max(0,hi-1);
        const [y0,r0,x0]=crown[lo],[y1,r1,x1]=crown[hi];
        const t=(y-y0)/(y1-y0||1),r=r0+(r1-r0)*t;
        locks.push(x0+(x1-x0)*t+1.13*r*Math.cos(a),y,r*Math.sin(a));
        if(j){
            const p=(j-1)*sides+k,q=(j-1)*sides+(k+1)%sides;
            hairIndex.push(p,p+sides,q+sides,p,q+sides,q);
        }
    }
    const cap=new THREE.BufferGeometry();cap.setIndex(hairIndex);
    cap.setAttribute('position',new THREE.Float32BufferAttribute(locks,3));cap.computeVertexNormals();
    piece('head',cap,hair,0,0,0);
    if(style===1) oval('head',hair,-1.21,2.14,0,.61,.76,.7);
    if(style===2) oval('head',hair,-.79,1.07,0,.66,1.40,1.03);
    if(style===3){
        oval('head','#b29273',-1.05,2.89,0,.44,.45,.49);
        oval('head',hair,-1.54,2.97,0,.79,.77,.83);
    }
    if(style===4){
        // A shoulder-length curtain narrows below the jaw, leaving the face clear.
        cut('head',hair,[[-1.45,.70,-1.03],[-.9,1.10,-.99],[.6,1.24,-.93],
            [1.9,1.27,-.70],[2.82,.94,-.60]],.43);
    }
    if(!distant)oval('head','#684647',1.29,.85,0,.105,.068,.39);
    for(const [s,side] of [['L',1],['R',-1]]){
        if(!distant){
            oval('head',skin,-.04,1.34,side*1.11,.26,.44,.18);
            oval('head',P.ink,1.29,1.79,side*.47,.10,.11,.15);
            oval('head',hair,1.29,2.01,side*.49,.11,.092,.34,side*.075);
        }
        const thigh='thigh'+s,knee='knee'+s,ankle='ankle'+s,arm='shoulder'+s,elbow='elbow'+s;
        cut(thigh,trousers,[[-7.87,1.03,.17],[-6.85,1.16,.16],[-4.14,1.33,.04],[-1.16,1.45,-.12],[.84,1.11]],1.03);
        cut(knee,trousers,[[-6.8,.82],[-6.2,.89,-.12],[-3.17,1.14,-.28],[-1.16,1.16,-.1],[.54,1.03,.08]],.95);
        oval(ankle,'#978f86',.72,-1.09,0,2.04,.39,.97);
        oval(ankle,'#30323b',.71,-.64,0,1.98,.74,.96);
        if(!distant)oval(arm,jacket,-.02,-.28,-side*.39,1.43,1.11,1.52);
        cut(arm,jacket,[[-3.65,1.16],[-3.4,1.37],[-2.1,1.41],[-.88,1.48],[.13,1.17],[.6,.58],[.65,.1]],1.06);
        cut(elbow,skin,[[-4,.68,.17],[-3.15,.78,.13],[-1.65,1.03],[-.55,1.10,-.12],[.75,.92]],1);
        oval(elbow,skin,.19,-4.07,0,.83,1.02,.70);
        if(!distant){
            oval(elbow,skin,.67,-3.88,-side*.47,.4,.69,.27);
            cut(arm,player?'#206a72':jacket,[[-3.79,1.24],[-3.47,1.32]],1.06);
        }
    }
    // Follow the woven surface. Angle zero is the chest, pi the spine.
    function cloth(tint,rows){
        const points=[],idx=[],steps=12;
        for(const [y,r,left,right] of rows){
            for(let i=0;i<=steps;i++){
                const a=left+(right-left)*i/steps;
                points.push(.67*r*Math.cos(a),y,r*Math.sin(a));
                const n=points.length/3-1;
                if(n>steps && i)idx.push(n-steps-2,n-1,n,n-steps-2,n,n-steps-1);
            }
        }
        const geo=new THREE.BufferGeometry();geo.setIndex(idx);
        geo.setAttribute('position',new THREE.Float32BufferAttribute(points,3));geo.computeVertexNormals();
        piece('torso',geo,tint,0,0,0);
    }
    if(openJacket){
        cloth('#e7d7bf',[[-.34,3.56,-.52,.52],[2,3.32,-.49,.49],[4.5,3.88,-.55,.55],[6.35,4.0,-.52,.52]]);
        for(const side of [-1,1]){
            const lapel=(y,r,a,b)=>[y,r,side>0?a:-b,side>0?b:-a];
            cloth('#40535a',[lapel(.1,3.58,.42,.55),lapel(2,3.38,.42,.63),
                lapel(5.2,4.10,.39,.80),lapel(6.4,4.03,.61,.90)]);
        }
    }
    if(player){
        cloth('#f3aa66',[[4.02,3.72,-1.42,1.42],[4.50,3.84,-1.42,1.42]]);
        cut('torso','#206a72',[[6.87,1.72],[7.55,1.6]],.87);
        // An enamel-coloured sunset badge follows the curved centre back.
        function badge(geo,tint,offset){
            const pos=geo.attributes.position;
            for(let i=0;i<pos.count;i++){
                const y=4.12+pos.getY(i),z=pos.getX(i)*1.23;
                const r=3.2+(y-2)*.22;
                pos.setXYZ(i,-.67*Math.sqrt(r*r-z*z)-offset,y,z);
            }
            geo.computeVertexNormals();piece('torso',geo,tint,0,0,0);
        }
        badge(new THREE.CircleGeometry(.99,24),'#206a72',.074);
        badge(new THREE.RingGeometry(.83,1.01,24),'#f3aa66',.088);
        badge(new THREE.CircleGeometry(.58,20,0,Math.PI),'#f3aa66',.094);
        piece('head',unitBox,'#312b38',1.35,1.82,0,.22,.30,1.86);
    }
    if(officer){
        oval('head','#263249',0,3.18,0,1.56,.83,1.41);
        oval('head','#172337',1.10,3.01,0,1.14,.18,1.30);
        oval('torso','#dabb73',2.48,5.28,1.22,.18,.64,.48);
    }
    const geo=new THREE.BufferGeometry();geo.setIndex(index);
    for(const [name,data,n] of [['position',position,3],['normal',normal,3],['color',color,3],['skinWeight',weight,4]])
        geo.setAttribute(name,new THREE.Float32BufferAttribute(data,n));
    geo.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(skinIndex,4));
    outfits.set(key,geo);return geo;
}

const gunMaterial=new THREE.MeshStandardMaterial({color:0x26303a,metalness:.64,roughness:.32});
const gunGeometry=new THREE.BoxGeometry(.87,3.25,.78);
export function buildPersonRig(opts={}) {
    const root=new THREE.Group(), bones={};
    for(const [name,parent,x,y,z] of joints){
        const b=new THREE.Bone();b.name=name;b.position.set(x,y,z);
        (bones[parent]||root).add(b);bones[name]=b;
    }
    root.updateMatrixWorld(true);
    const palette={jacket:P.jacket,skin:'#c48a62',hair:P.ink,trousers:P.trousers,...opts};
    const geometry=outfit(palette,bones),lod=opts.player?geometry:outfit(palette,bones,true);
    const mesh=new THREE.SkinnedMesh(geometry,fabric);
    root.add(mesh);
    mesh.bind(new THREE.Skeleton(Object.values(bones)));
    mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3(0,13,0),22);
    mesh.castShadow=mesh.receiveShadow=true;
    const gun=new THREE.Mesh(gunGeometry,gunMaterial);gun.position.set(.53,-5.86,0);
    bones.elbowR.add(gun);gun.visible=false;
    root.userData={bones,gun,mesh,geometry,lod};return root;
}

export function poseRig(group, pose, distant=false, flash=false) {
    const {bones:b,gun,mesh,geometry,lod}=group.userData;
    mesh.geometry=distant?lod:geometry;mesh.material=flash?hitFabric:fabric;
    b.pelvis.position.set(0,HIP_HEIGHT+pose.pelvisY,pose.sway);
    b.pelvis.rotation.set(pose.bank,pose.pelvisYaw,-pose.tilt);
    b.torso.rotation.set(0,pose.shoulderYaw,-pose.lean);b.torso.scale.y=pose.breath;
    b.head.rotation.set(-pose.bank*.55,pose.headYaw,pose.lean*.78);
    for(const [side,sign,limb] of [['L',1,pose.left],['R',-1,pose.right]]){
        // A downward-pointing limb rotates towards +x with a positive Z angle.
        b['thigh'+side].rotation.z=limb.hip;
        b['knee'+side].rotation.z=-limb.knee;
        b['ankle'+side].rotation.set(0,pose.footYaw,limb.foot-limb.hip+limb.knee);
        b['shoulder'+side].rotation.set(-sign*(.07+limb.spread),0,limb.shoulder);
        b['elbow'+side].rotation.z=limb.elbow;
    }
    gun.visible=pose.gun;
}
