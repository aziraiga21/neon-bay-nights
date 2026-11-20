import * as T from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { DRACOLoader } from '../vendor/DRACOLoader.js';
import { clone } from '../vendor/SkeletonUtils.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { civilianLook } from './pedestrians.js';
import { bundledResource } from './bundled-resource.js';
import { HIP_HEIGHT, LEG, PALETTE as P, TUNE, clamp } from './config.js';

const templates = new Map();
const regions = ['Skin','Shirt','Pants','Belt','Face','Hair','Canvas','Rubber','Iris','Lips'];
const standingHeight = HIP_HEIGHT + LEG.thigh + LEG.shin - LEG.ankleHeight;
const vertex = new T.Vector3();
const forwardRotation = new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),Math.PI/2);
let pending;

export function loadCharacters() {
    if (!pending) pending = (async () => {
        const draco = new DRACOLoader().setDecoderPath(new URL('../vendor/draco/gltf/', import.meta.url).href);
        const loader = new GLTFLoader().setDRACOLoader(draco);
        try {
            await Promise.all(['jax','female'].map(async name => {
                const file = new URL('../assets/glb/' + name + '.glb', import.meta.url);
                const response = await bundledResource(file);
                const asset = await loader.parseAsync(await response.arrayBuffer(), '');
                prepareCharacter(name, asset);
            }));
        } finally { draco.dispose(); }
    })();
    return pending;
}

// Six materials on the same female skeleton become a single draw. Palette
// selection stays per character, while the merged vertex/index buffers are shared.
export function prepareCharacter(name, asset) {
    const meshes = [];
    asset.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
    const mesh = meshes[0];
    if (!mesh) throw new Error(name + ' has no skinned mesh');
    const lodIndices = [];
    let vertexOffset = 0;
    for (const part of meshes) {
        for (const index of part.geometry.userData.crowdIndices) lodIndices.push(vertexOffset+index);
        vertexOffset += part.geometry.attributes.position.count;
    }
    if (name === 'female') {
        const parts = meshes.map(part => {
            const region = regions.indexOf(part.material.name);
            if (region < 0) throw new Error('Unknown Quaternius material ' + part.material.name);
            if (!mesh.skeleton.bones.every((b,i) => part.skeleton.bones[i] === b))
                throw new Error('Incompatible Quaternius bind order');
            const geometry = part.geometry;
            geometry.setAttribute('region', new T.Uint8BufferAttribute(
                new Uint8Array(geometry.attributes.position.count).fill(region), 1));
            return geometry;
        });
        mesh.geometry = mergeGeometries(parts);
        for (const part of meshes.slice(1)) part.removeFromParent();
    }
    const g = mesh.geometry;
    const lod = new T.BufferGeometry();
    for (const [attr,buffer] of Object.entries(g.attributes)) lod.setAttribute(attr,buffer);
    lod.setIndex(lodIndices);
    g.computeBoundingBox();
    const height = g.boundingBox.max.y - g.boundingBox.min.y;
    // The lowest sole changes from heel to toe as the foot rolls. Keep the
    // extremal sole vertices for each foot so contact follows the animated skin.
    const sole = new Set();
    const pos = g.attributes.position;
    for (const side of [-1, 1]) {
        const best = Array(16).fill(-Infinity), indices = Array(16).fill(-1);
        for (let i=0; i<pos.count; i++) {
            const x=pos.getX(i), y=pos.getY(i), z=pos.getZ(i);
            if (x*side < 0 || y>g.boundingBox.min.y+height*.09) continue;
            for (let j=0; j<16; j++) {
                const theta=(j%8)*Math.PI/4;
                const score=(x*Math.cos(theta)+z*Math.sin(theta))*(j<8?.20:1.4)-y;
                if (score>best[j]) { best[j]=score; indices[j]=i; }
            }
        }
        for (const i of indices) if (i>=0) sole.add(i);
    }
    if (!sole.size) throw new Error('Missing sole geometry on ' + name);
    // Blender also exports constant scale/translation tracks for the bind
    // pose. Remove only tracks that equal the actual initial node value.
    const clips = new Map();
    for (const clip of asset.animations) {
        clip.tracks = clip.tracks.filter(track => {
            if (track.times.length>2) return true;
            const binding=T.PropertyBinding.parseTrackName(track.name);
            const rest=asset.scene.getObjectByName(binding.nodeName)?.[binding.propertyName];
            if (!rest?.toArray) return true;
            const initial=rest.toArray();
            return track.values.some((v,i)=>Math.abs(v-initial[i%initial.length])>.00001);
        });
        clips.set(clip.name,clip);
        const upper = track => /Spine|Abdomen|Torso|Neck|Head|Shoulder|Arm|Hand|Fist/.test(track.name);
        if (['Walk','Run'].includes(clip.name))
            clips.set(clip.name+'Lower',new T.AnimationClip(clip.name+'Lower',clip.duration,clip.tracks.filter(t=>!upper(t))));
        if (/^Pistol|^Shoot_OneHanded/.test(clip.name))
            clips.set(clip.name+'Upper',new T.AnimationClip(clip.name+'Upper',clip.duration,clip.tracks.filter(upper)));
    }
    templates.set(name,{scene:asset.scene, meshName:mesh.name, height, clips, geometry:g, lod, sole:[...sole],
        map:name==='jax'?mesh.material.map:null});
}

function clothing(palette, female, atlas) {
    const mat = new T.MeshLambertMaterial({map:atlas, emissive:0x0d090f});
    const colors = [palette.skin, palette.jacket, palette.trousers, '#604531', '#ede3d0', palette.hair, '#36454d', '#e3dcc6', '#30231c', '#935655']
        .map(c => new T.Color(c));
    mat.customProgramCacheKey = () => female?'quaternius-outfit':'mixamo-outfit';
    mat.onBeforeCompile = shader => {
        shader.uniforms.outfit = {value:colors};
        shader.vertexShader = 'varying float garment;\n' + (female?'attribute float region;\n':'') + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
            '#include <begin_vertex>\n garment = '+(female?'region':'position.y')+';');
        shader.fragmentShader = 'varying float garment;\nuniform vec3 outfit[10];\n' + shader.fragmentShader;
        const tint = female ? 'diffuseColor.rgb *= outfit[int(garment+0.5)];' : `
            vec3 texel = diffuseColor.rgb;
            float lightness = dot(texel, vec3(.299,.587,.114));
            bool darkFabric = max(max(texel.r,texel.g),texel.b)<.060;
            if (darkFabric) {
                vec3 fabric = garment > .86 && vMapUv.x < .5 ? outfit[1] : outfit[2];
                if (garment > 1.70) fabric = outfit[5];
                diffuseColor.rgb = fabric * clamp(.45 + lightness*41.,.38,1.55);
            } else if (vMapUv.x < .5 && texel.r > texel.b*1.45 && texel.g > texel.r*.23) {
                diffuseColor.rgb = mix(texel, outfit[0]*clamp(lightness*4.8,.24,1.65),.7);
            }
        `;
        shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n'+tint);
    };
    return mat;
}

const pistolMetal = new T.MeshLambertMaterial({color:0x353c46});
const slide = new T.BoxGeometry(.025,.035,.15);
const grip = new T.BoxGeometry(.024,.078,.04);
function sidearm() {
    const gun = new T.Group();
    const barrel = new T.Mesh(slide,pistolMetal);
    const handle = new T.Mesh(grip,pistolMetal);
    barrel.position.set(0,.03,.055);
    handle.rotation.x=-.23;
    gun.add(barrel,handle);
    return gun;
}

export function createCharacter(actor, kind='civilian') {
    const female = kind==='rosa' || (kind==='civilian' && actor.id%2===0);
    const source = templates.get(female?'female':'jax');
    const root = new T.Group(), visual = clone(source.scene);
    root.add(visual);
    visual.rotation.y = Math.PI/2; // glTF +Z forward to game +X east
    const jitter = kind==='civilian' ? 1 + (((actor.id*37)%81)-40)*.001 : 1;
    visual.scale.setScalar(standingHeight/source.height*jitter);
    if (female) visual.scale.x*=.82;
    const mesh = visual.getObjectByName(source.meshName);
    const palette = {jacket:P.jacket, trousers:P.trousers, hair:P.ink, skin:'#c48a62', ...actor,
        ...(kind==='civilian'?civilianLook(actor.id):{})};
    if (kind==='officer') {palette.jacket=P.navy; palette.trousers='#202a40';}
    mesh.material = clothing(palette, female, source.map);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.boundingSphere = new T.Sphere();
    const mixer = new T.AnimationMixer(visual);
    const gun=sidearm(), hand=mesh.skeleton.bones.find(b=>/RightHandMiddle1$|FistR$/.test(b.name));
    hand.add(gun);
    // Bones can carry the centimetre-to-metre conversion above their local frame.
    root.updateMatrixWorld(true);
    const bindScale=hand.getWorldScale(vertex).x / visual.scale.x;
    gun.scale.setScalar(1/bindScale);
    gun.visible=false;
    const data = {visual, mesh, mixer, gun, source, female, current:null, state:'',
        phase:((actor.id||0)*.61803398875)%1, readyTime:0, triggerTime:0};
    root.userData = data;
    poseCharacter(root, actor, 0);
    placeCharacter(root,actor);
    return root;
}

function motion(actor, female) {
    if (actor.dead && female) return 'Death';
    if (actor.car || (actor.transition && (actor.transition.kind==='exit' || actor.transition.time>.45))) return female?'SitDown':'Sitting';
    if (actor.z>0 || actor.landing>.16) return 'Jump';
    if (actor.punch>0) return 'Punch';
    if (actor.recoil>0 || (actor.armed && actor.flash>0)) return female?'Shoot_OneHanded':'PistolShoot';
    if (actor.armed) return female?'Shoot_OneHanded':actor.isPlayer?'PistolAim':'PistolIdle';
    const speed=actor.gait?.speed||0;
    return speed>TUNE.walk*1.45?'Run':speed>3?'Walk':'Idle';
}

export function poseCharacter(root, actor, dt) {
    const d=root.userData;
    if (actor.recoil>0 || (actor.armed && actor.flash>0)) d.triggerTime=.14;
    else d.triggerTime=Math.max(0,d.triggerTime-dt);
    if (actor.isPlayer && (actor.armed || actor.recoil>0)) d.readyTime=.25;
    else d.readyTime=Math.max(0,d.readyTime-dt);
    let state=motion(actor,d.female);
    if (!actor.z && !actor.punch && !actor.transition && !actor.car) {
        if (d.triggerTime>0) state=d.female?'Shoot_OneHanded':'PistolShoot';
        else if (state==='Idle' && d.readyTime>0) state='PistolIdle';
    }
    const gait=actor.gait?.speed||0;
    const armedWalk=gait>3 && (state.startsWith('Pistol') || state==='Shoot_OneHanded');
    const clip=d.source.clips.get(armedWalk?state+'Upper':state);
    const stride=armedWalk?(gait>TUNE.walk*1.45?'Run':'Walk'):null;
    if (stride!==d.stride) {
        if (d.legs) d.legs.fadeOut(.15);
        d.stride=stride;
        d.legs=stride?d.mixer.clipAction(d.source.clips.get(stride+'Lower')):null;
        if (d.legs) d.legs.reset().fadeIn(.15).play();
    }
    if (d.legs) d.legs.timeScale=clamp(gait*d.legs.getClip().duration/(stride==='Run'?56:24),.56,2.8);
    d.placed=false;
    if (clip!==d.current?.getClip()) {
        const action=d.mixer.clipAction(clip);
        action.reset();
        const loop=['Idle','Walk','Run','PistolIdle','PistolAim'].includes(state);
        action.setLoop(loop?T.LoopRepeat:T.LoopOnce, loop?Infinity:1);
        action.clampWhenFinished=!loop;
        if (loop) action.time=clip.duration*d.phase;
        action.play();
        if (d.current) action.crossFadeFrom(d.current,.15,false);
        d.current=action; d.state=state;
    }
    const action=d.current;
    if (state==='Walk' || state==='Run') {
        const phase=actor.gait, circumference=state==='Walk'?24:56;
        action.timeScale=clamp((phase?.speed||0)*clip.duration/circumference,.56,2.8);
    } else if (state==='Jump') {
        // The simulation supplies the flight arc. The embedded clip supplies
        // the tuck and landing, including the last grounded recovery ticks.
        action.timeScale=clip.duration/.98;
    } else if (state==='Punch') action.timeScale=clip.duration/.35;
    else if (state==='PistolShoot') action.timeScale=clip.duration/.26;
    else if (state==='Sitting' || state==='SitDown') {
        action.timeScale=0;
        const t=actor.transition;
        action.time=clip.duration*(t?(t.kind==='enter'?clamp((t.time-.45)/.35,0,1):1-clamp((t.time-.3)/.3,0,1)):1);
    } else action.timeScale=1;
    d.mixer.update(dt);
    d.gun.visible=state.startsWith('Pistol') || state==='Shoot_OneHanded';
    d.mesh.material.emissive.setHex(!actor.isPlayer && actor.flash>0 ? 0x982335 : 0x0d090f);

}

export function placeCharacter(root, actor, distant=false) {
    const {visual,mesh,source}=root.userData;
    mesh.geometry=distant?source.lod:source.geometry;
    if (root.userData.placed && root.position.x===(actor.x||0) && root.position.z===(actor.y||0)
        && root.position.y===(actor.z||0) && root.rotation.y===-(actor.h||0)) return;
    root.userData.placed=true;
    root.position.set(actor.x||0,actor.z||0,actor.y||0);
    root.rotation.set(actor.dead || actor.health<=0 ? -Math.PI*.45 : 0, -(actor.h||0), 0, 'YXZ');
    root.updateMatrixWorld(true);
    let floor=Infinity;
    for (const index of source.sole) {
        mesh.getVertexPosition(index,vertex).applyMatrix4(mesh.matrixWorld);
        floor=Math.min(floor,vertex.y);
    }
    visual.position.y += root.position.y-floor;
    root.updateMatrixWorld(true);
    const gun=root.userData.gun;
    if (gun.visible) {
        gun.parent.getWorldQuaternion(gun.quaternion).invert();
        gun.quaternion.multiply(root.quaternion).multiply(forwardRotation);
        if (root.userData.state==='PistolIdle') gun.rotateX(.55);
    }
    // Frustum and shadow passes have different views. Give both the actor's
    // conservative animated bounds in the skinned mesh's local space.
    const bounds=mesh.boundingSphere;
    bounds.center.copy(root.position);
    bounds.center.y+=14;
    mesh.worldToLocal(bounds.center);
    bounds.radius=22/mesh.matrixWorld.getMaxScaleOnAxis();
}

export function disposeCharacter(root) {
    const {mixer,visual,mesh}=root.userData;
    mixer.stopAllAction();
    mixer.uncacheRoot(visual);
    mesh.skeleton.dispose();
    mesh.material.dispose();
}
