// Neon Bay Nights — third-person 3D renderer (Three.js, vendored, offline).
//
// The simulation stays 2D (world x/y, heading 0 = east, clockwise in 2D);
// this module is the only place that knows about Three.js. 2D (x, y) maps
// to 3D (x, 0, y) and a 2D heading h becomes rotation.y = -h, so cars and
// characters face the way the simulation thinks they do. The camera is a
// chase cam: behind the player on foot, behind the car when driving, eased
// toward its target every frame instead of snapping.
//
// Facades share an atlas and their window lights warm up with the clock.
// City geometry is batched by block, with instanced palms, car lights,
// shadows and skid marks. Cars and walking characters use cached meshes.
//
// In environments without a real WebGL context (the Node test suite) the
// renderer runs headless: the 3D scene is skipped, but the HUD overlay
// still paints, so every render path the tests exercise keeps working.
import * as THREE from './../vendor/three.module.min.js';
import { createRandom } from './random.js';
import { CARS, PALETTE as P, clamp, lerp, angleDelta } from './config.js';
import {
    buildCityGeometry, buildPalms, buildSigns, carGeometry, carLettering, personGeometry,
    pickupGeometry, makeBeacon, yawFor
} from './art.js';
import { makeMap, drawHUD, drawFullMap } from './hud.js';

const FOV = 55;
const FOOT_DIST = 82, FOOT_HEIGHT = 38;
const CAR_DIST = 109, CAR_HEIGHT = 37;
const LOOK_AHEAD = 30, LOOK_HEIGHT = 14;
const MAX_PARTICLES = 500;
const MAX_SKIDS = 500;
const MAX_SHADOWS = 320;

// Periodic noise painted once. Both the cloud banks and tidal ripples sample
// this field, so the weather is reproducible without advancing the city RNG.
function weatherTexture() {
    const rng=createRandom(317), size=256;
    const lattice=Float32Array.from({length:64*64},()=>rng());
    function noise(x,y,period) {
        const ix=Math.floor(x), iy=Math.floor(y);
        let fx=x-ix, fy=y-iy;
        fx=fx*fx*(3-2*fx); fy=fy*fy*(3-2*fy);
        const at=(a,b)=>lattice[((iy+b)%period)*64+((ix+a)%period)];
        return lerp(lerp(at(0,0),at(1,0),fx),lerp(at(0,1),at(1,1),fx),fy);
    }
    const data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++){
        let v=0, weight=.52;
        for(let f=4;f<=64;f*=2) {
            v+=weight*noise(x*f/size,y*f/size,f); weight*=.5;
        }
        const i=4*(x+y*size);
        data[i]=data[i+1]=data[i+2]=Math.round(255*v); data[i+3]=255;
    }
    const t=new THREE.DataTexture(data,size,size);
    t.wrapS=t.wrapT=THREE.RepeatWrapping; t.magFilter=t.minFilter=THREE.LinearFilter;
    t.needsUpdate=true; return t;
}

// Neutral grain tiles in world units across all asphalt strips, including
// crossroads. A few surface repairs break up the long coastal straight.
function roadMaterial() {
    const rng=createRandom(714), c=document.createElement('canvas');c.width=c.height=256;
    const ctx=c.getContext('2d'), im=ctx.createImageData(256,256);
    for(let i=0;i<im.data.length;i+=4){
        const k=rng.range(211,253);im.data[i]=k;im.data[i+1]=k;im.data[i+2]=k;im.data[i+3]=255;
    }
    ctx.putImageData(im,0,0);ctx.strokeStyle='#73717a59';ctx.lineWidth=1.15;
    ctx.beginPath();ctx.moveTo(20,177);ctx.lineTo(31,174);ctx.lineTo(32,168);ctx.lineTo(44,161);ctx.stroke();
    const map=new THREE.CanvasTexture(c);map.wrapS=map.wrapT=THREE.RepeatWrapping;
    map.colorSpace=THREE.SRGBColorSpace;return new THREE.MeshLambertMaterial({map,vertexColors:true});
}

function animateStride(mesh,moving,phase) {
    const stride=moving?Math.sin(phase):0;
    mesh.morphTargetInfluences[0]=Math.max(0,-stride);
    mesh.morphTargetInfluences[1]=Math.max(0,stride);
}

const sunDirection = new THREE.Vector3(.025,.165,-.986).normalize();
function makeSky(noise) {
    const uniforms={
        cloud:{value:noise}, sunDir:{value:sunDirection}, dusk:{value:.65},
        day:{value:new THREE.Color(P.sky)}, night:{value:new THREE.Color(P.skyDusk)},
        horizon:{value:new THREE.Color(P.horizon)}, ember:{value:new THREE.Color(P.horizonDusk)}
    };
    const mat=new THREE.ShaderMaterial({
        uniforms, side:THREE.BackSide, depthWrite:false,
        vertexShader:`varying vec3 ray;
        void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`varying vec3 ray; uniform sampler2D cloud;
        uniform vec3 sunDir,day,night,horizon,ember; uniform float dusk;
        void main(){
            vec3 d=normalize(ray); float y=max(0.,d.y);
            vec3 low=mix(horizon,ember,dusk);
            vec3 top=mix(day,night,min(1.,dusk*1.32));
            vec3 rose=mix(day,vec3(.70,.19,.32),min(1.,dusk*1.35));
            vec3 col=mix(low,rose,smoothstep(.005,.245,y));
            col=mix(col,top,smoothstep(.12,.43,y));
            float az=atan(d.z,d.x)/6.283185;
            vec2 uv=vec2(az*4.,y*2.6);
            float n=texture2D(cloud,uv).r*.82+texture2D(cloud,uv*3.+.21).r*.18;
            float clouds=smoothstep(.48,.64,n)*smoothstep(.01,.09,y)*(1.-smoothstep(.33,.66,y));
            col=mix(col,mix(vec3(.95,.55,.45),vec3(.23,.16,.31),smoothstep(.1,.43,y)),clouds*.59);
            float r=length(d-sunDir);
            col+=vec3(.85,.37,.12)*exp(-r*8.)*.70;
            col=mix(col,vec3(1.,.87,.57),1.-smoothstep(.052,.0535,r));
            gl_FragColor=vec4(col,1.);
            #include <colorspace_fragment>
        }`
    });
    const sky=new THREE.Mesh(new THREE.SphereGeometry(6500,32,16),mat);
    sky.renderOrder=-10; return sky;
}

function makeWater(world, noise) {
    const mat=new THREE.ShaderMaterial({
        uniforms:{noiseMap:{value:noise},time:{value:0},dusk:{value:.65},
            water:{value:new THREE.Color(P.water)},plum:{value:new THREE.Color(P.waterDusk)}},
        vertexShader:`varying vec3 pos; void main(){
            pos=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(pos,1.);}`,
        fragmentShader:`varying vec3 pos; uniform sampler2D noiseMap; uniform float time,dusk;
        uniform vec3 water,plum; void main(){
            vec2 uv=pos.xz; vec3 ray=normalize(pos-cameraPosition);
            float ripple=texture2D(noiseMap,uv*vec2(.002,.019)+vec2(time*.015,0.)).r;
            float wave=sin(uv.y*.20+11.*ripple+time*1.2);
            float far=1.-smoothstep(.012,.32,abs(ray.y));
            vec3 base=mix(water,plum,dusk*.40);
            base=mix(base,vec3(.40,.31,.43),far*.66);
            float glint=pow(max(0.,dot(normalize(ray.xz),normalize(vec2(.025,-.986)))),24.);
            base+=vec3(.91,.54,.25)*glint*smoothstep(.05,.83,wave)*smoothstep(.34,.65,ripple);
            base+=vec3(.15,.26,.25)*smoothstep(.49,.76,ripple)*(.4+.6*wave);
            gl_FragColor=vec4(base,1.);
            #include <colorspace_fragment>
        }`
    });
    const water=new THREE.Mesh(new THREE.PlaneGeometry(12000,17000),mat);
    water.rotation.x=-Math.PI/2;
    water.position.set(world.water+6000,.45,world.height/2); return water;
}

// A real WebGL context exposes numeric enum constants; the Node test
// stand-in canvas returns a proxy whose properties are all functions.
function tryWebGLContext(canvas) {
    try {
        const gl = canvas.getContext('webgl2', { antialias: true, alpha: false })
            || canvas.getContext('webgl', { antialias: true, alpha: false });
        if (!gl || typeof gl.getParameter !== 'function') return null;
        if (typeof gl.VERSION !== 'number' || typeof gl.TRIANGLES !== 'number') return null;
        const version = gl.getParameter(gl.VERSION);
        if (typeof version !== 'string' || !version) return null;
        return gl;
    } catch {
        return null;
    }
}

function dampAngle(current, target, rate, dt) {
    return current + angleDelta(current, target) * (1 - Math.exp(-rate * dt));
}

export class Renderer {
    constructor(canvas, world) {
        this.canvas = canvas;
        this.width = 1280;
        this.height = 800;
        this.game = null;
        this.lastTime = 0;
        this.headless = false;
        this.map = null;
        this.camPos = null;
        this.camInit = false;
        this.renderScale = 1;
        // Dynamic resolution: software rasterisers pay per pixel, so the
        // game lowers the WebGL buffer when frames run long and raises it
        // when they are cheap (a real GPU holds 1.0). ?shot= is a photo
        // mode: it pins full resolution so captures stay crisp.
        this.reducedMotion=typeof window!=='undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        this._frameEMA = 16;
        this._adaptTick = 0;
        this._lastFrameNow = 0;
        this._hudTick = 0;
        this._shotMode = (typeof location !== 'undefined'
            && /[?&]shot=/.test(location.search));

        // Cars catch narrow highlights. People, roofs and street furniture
        // share softer vertex lighting and the same low directional sun.
        this.lambert = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.basic = new THREE.MeshBasicMaterial({ vertexColors: true });
        this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.paint=new THREE.MeshPhongMaterial({vertexColors:true,specular:0x8d7a8a,shininess:42});
        this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd76a });
        this.shadowMat = new THREE.MeshBasicMaterial({
            color: 0x311f3e, transparent: true, opacity: 0.29, depthWrite: false
        });
        this.skidMat = new THREE.MeshBasicMaterial({
            color: 0x16181d, transparent: true, opacity: 0.42, depthWrite: false
        });

        this.carMeshes = new Map();
        this.pedMeshes = new Map();
        this.enemyMeshes = new Map();
        this.officerMeshes = new Map();
        this.bulletMeshes = new Map();
        this.pickupMeshes = new Map();
        this.playerMesh = null;
        this.staticGroup = null;
        this.water = null;
        this.sun = null;

        const gl = tryWebGLContext(canvas);
        this.renderer = null;
        this.scene = null;
        this.camera = null;
        if (gl) {
            try {
                this.renderer = new THREE.WebGLRenderer({
                    canvas, context: gl, antialias: false, powerPreference: 'high-performance'
                });
                this.renderer.setPixelRatio(
                    Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 1.5));
                this.scene = new THREE.Scene();
                this.scene.background = new THREE.Color(P.sky);
                this.scene.fog=new THREE.Fog(0xe9aca7,480,2700);
                this.camera = new THREE.PerspectiveCamera(FOV, 1280 / 800, .8, 9000);
                this.hemi = new THREE.HemisphereLight(0xffd8df, 0xb7adba, 1.72);
                this.scene.add(this.hemi);
                this.dir = new THREE.DirectionalLight(0xffcd98, 2.1);
                this.scene.add(this.dir,this.dir.target);
                this.renderer.shadowMap.enabled=true;
                this.renderer.shadowMap.type=THREE.PCFShadowMap;
                this.dir.castShadow=true;
                this.dir.shadow.mapSize.set(1024,1024);
                Object.assign(this.dir.shadow.camera,{left:-350,right:350,top:350,bottom:-350,near:1,far:1600});
                this.dir.shadow.camera.updateProjectionMatrix();
                this.dir.shadow.bias=-.00045;
                this.dir.shadow.normalBias=.7;
                const rim=new THREE.DirectionalLight(0xffb6d4,.72);
                rim.position.set(-.8,.35,.35); this.scene.add(rim);
                this.noise=weatherTexture(); this.sky=makeSky(this.noise); this.scene.add(this.sky);
                this._buildDynamicPools();
            } catch {
                this.renderer = null;
                this.scene = null;
                this.camera = null;
            }
        }
        if (!this.renderer) this.headless = true;

        this.hudCanvas = this._findHudCanvas();
        this.hudCtx = null;
        try {
            this.hudCtx = this.hudCanvas?.getContext?.('2d') || null;
        } catch {
            this.hudCtx = null;
        }

        this._tmpColor = new THREE.Color();
        this._tmpMatrix = new THREE.Matrix4();
        this._tmpVec = new THREE.Vector3();

        this.setWorld(world);
        this.resize();
    }

    // --- setup ------------------------------------------------------------

    _findHudCanvas() {
        try {
            const el = typeof document !== 'undefined'
                ? document.querySelector('#hud') : null;
            if (el && typeof el.getContext === 'function') return el;
        } catch {
            // fall through to creating one
        }
        try {
            const c = document.createElement('canvas');
            if (c.style) {
                c.style.position = 'fixed';
                c.style.inset = '0';
                c.style.pointerEvents = 'none';
                c.style.zIndex = '1';
            }
            document.body?.appendChild?.(c);
            return c;
        } catch {
            return null;
        }
    }

    _buildDynamicPools() {
        // Particles: one THREE.Points, positions and colours rewritten
        // every frame from the live particle list.
        this.particleGeo = new THREE.BufferGeometry();
        this.particlePos = new Float32Array(MAX_PARTICLES * 3);
        this.particleCol = new Float32Array(MAX_PARTICLES * 3);
        this.particleGeo.setAttribute('position',
            new THREE.BufferAttribute(this.particlePos, 3).setUsage(THREE.DynamicDrawUsage));
        this.particleGeo.setAttribute('color',
            new THREE.BufferAttribute(this.particleCol, 3).setUsage(THREE.DynamicDrawUsage));
        this.particleGeo.setDrawRange(0, 0);
        this.particlePoints = new THREE.Points(this.particleGeo, new THREE.PointsMaterial({
            size: 6, sizeAttenuation: false, vertexColors: true,
            transparent: true, opacity: 0.95, depthWrite: false
        }));
        this.particlePoints.frustumCulled = false;
        this.scene.add(this.particlePoints);

        // Blob shadows: one instanced dark ellipse per actor.
        const shadowGeo = new THREE.CircleGeometry(1, 20);
        shadowGeo.rotateX(-Math.PI / 2);
        this.shadowMesh = new THREE.InstancedMesh(shadowGeo, this.shadowMat, MAX_SHADOWS);
        this.shadowMesh.frustumCulled = false;
        this.shadowMesh.count = 0;
        this.scene.add(this.shadowMesh);

        // Skid marks: one instanced dark quad per mark.
        const skidGeo = new THREE.PlaneGeometry(16, 5);
        skidGeo.rotateX(-Math.PI / 2);
        this.skidMesh = new THREE.InstancedMesh(skidGeo, this.skidMat, MAX_SKIDS);
        this.skidMesh.frustumCulled = false;
        this.skidMesh.count = 0;
        this.scene.add(this.skidMesh);

        // Light pools share one soft sprite texture, instanced in world space.
        const c=document.createElement('canvas'); c.width=c.height=96;
        const ctx=c.getContext('2d'), g=ctx.createRadialGradient(48,48,0,48,48,47);
        g.addColorStop(0,'#ffffff'); g.addColorStop(.18,'#ffffffb0'); g.addColorStop(1,'#ffffff00');
        ctx.fillStyle=g;ctx.fillRect(0,0,96,96);
        const glowMap=new THREE.CanvasTexture(c);
        const glowMat=new THREE.MeshBasicMaterial({map:glowMap,transparent:true,depthWrite:false,
            blending:THREE.AdditiveBlending,side:THREE.DoubleSide});
        this.glows=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),glowMat,900);
        this.glows.frustumCulled=false;this.scene.add(this.glows);
        // A feathered beam opens from each lamp and fades along the asphalt.
        const cone=document.createElement('canvas');cone.width=128;cone.height=64;
        const paint=cone.getContext('2d'), pixels=paint.createImageData(128,64);
        for(let y=0;y<64;y++) for(let x=0;x<128;x++){
            const t=x/127, across=Math.abs(y/31.5-1)/(.13+.86*t),i=4*(128*y+x);
            pixels.data[i]=255;pixels.data[i+1]=224;pixels.data[i+2]=167;
            pixels.data[i+3]=Math.round(100*Math.exp(-t*2.1)*Math.max(0,1-across*across)*Math.min(1,t*16)*(1-t));
        }
        paint.putImageData(pixels,0,0);
        const beamMat=new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cone),transparent:true,
            blending:THREE.AdditiveBlending,depthWrite:false});
        this.beams=new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1),beamMat,300);
        this.beams.frustumCulled=false;this.scene.add(this.beams);
        this.lightTransform=new THREE.Object3D();
        this.bulletGeo = new THREE.BoxGeometry(16, 2, 2);

        // Mission / waypoint beacons.
        this.missionBeacon = makeBeacon(P.mango);
        this.waypointBeacon = makeBeacon(P.cyan);
        this.scene.add(this.missionBeacon);
        this.scene.add(this.waypointBeacon);

        // Muzzle flash: a small additive glow sprite, shown for a blink.
        let flashMap = null;
        try {
            const c = document.createElement('canvas');
            c.width = 64;
            c.height = 64;
            const ctx = c.getContext('2d');
            const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
            grad.addColorStop(0, 'rgba(255,244,200,1)');
            grad.addColorStop(0.5, 'rgba(255,180,80,0.7)');
            grad.addColorStop(1, 'rgba(255,120,40,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 64, 64);
            flashMap = new THREE.CanvasTexture(c);
        } catch {
            flashMap = null;
        }
        this.flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: flashMap, color: 0xffe9a8, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false
        }));
        this.flashSprite.scale.set(30, 30, 1);
        this.flashSprite.visible = false;
        this.scene.add(this.flashSprite);
    }

    setWorld(world) {
        const sameCity=this.world?.seed===world.seed;
        this.world = world;
        if(!sameCity) this.map = makeMap(world);
        // Drop every dynamic mesh: the new game owns new actor objects.
        for (const map of [this.carMeshes, this.pedMeshes, this.enemyMeshes,
            this.officerMeshes, this.bulletMeshes, this.pickupMeshes]) {
            for (const mesh of map.values()) this.scene?.remove(mesh);
            map.clear();
        }
        this.camInit=false;
        if(sameCity && this.staticGroup) return;
        if (this.playerMesh) {
            this.scene?.remove(this.playerMesh);
            this.playerMesh = null;
        }
        if (!this.scene) return;
        if (this.staticGroup) {
            this.scene.remove(this.staticGroup);
            const geometries=new Set(), materials=new Set();
            this.staticGroup.traverse(o=>{
                if(o.geometry) geometries.add(o.geometry);
                if(o.material && o.material!==this.lambert && o.material!==this.basic) materials.add(o.material);
            });
            for(const g of geometries) g.dispose();
            for(const m of materials){m.map?.dispose();m.emissiveMap?.dispose();m.dispose();}
            this.staticGroup = null;
        }
        this.staticGroup = new THREE.Group();
        const {walls,rest,ground,road,glow,atlas,windows}=buildCityGeometry(world);
        this.facadeMaterial=new THREE.MeshLambertMaterial({map:atlas,emissiveMap:windows,emissive:0xffdbad});
        for(const [blocks,mat] of [[walls,this.facadeMaterial],[rest,this.lambert]]) {
            for(const geo of blocks) {
                const block=new THREE.Mesh(geo,mat);
                block.castShadow=block.receiveShadow=true;
                this.staticGroup.add(block);
            }
        }
        const pavement=new THREE.Mesh(ground,this.lambert); pavement.receiveShadow=true;
        const asphalt=new THREE.Mesh(road,roadMaterial());
        asphalt.receiveShadow=true;
        this.staticGroup.add(buildPalms(world,this.lambert),pavement,asphalt,new THREE.Mesh(glow,this.basic));
        for (const sign of buildSigns(world)) this.staticGroup.add(sign);
        this.water=makeWater(world,this.noise);
        this.staticGroup.add(this.water);
        this.scene.add(this.staticGroup);
        // Player mesh (fixed colours) is built once per world.
        this.playerMesh = new THREE.Mesh(personGeometry({
            player:true, jacket: P.jacket, skin: '#C48A62', hair: P.ink, trousers: P.trousers
        }), this.lambert);
        this.playerMesh.castShadow=true;
        this.scene.add(this.playerMesh);
        this.camInit = false;
    }

    resize() {
        const w = Math.max(320, this.canvas.clientWidth || this.canvas.width
            || (typeof window !== 'undefined' ? window.innerWidth : 1280) || 1280);
        const h = Math.max(240, this.canvas.clientHeight || this.canvas.height
            || (typeof window !== 'undefined' ? window.innerHeight : 800) || 800);
        this.width = w;
        this.height = h;
        if (this.renderer) {
            // The drawing buffer may render below the CSS size (see
            // setRenderScale): the browser upscales it, the HUD stays crisp.
            this.renderer.setSize(
                Math.max(320, Math.round(w * this.renderScale)),
                Math.max(240, Math.round(h * this.renderScale)), false);
        }
        if (this.camera) {
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }
        if (this.hudCanvas) {
            this.hudCanvas.width = w;
            this.hudCanvas.height = h;
        }
    }

    // Shrink (or restore) the WebGL drawing buffer relative to the CSS
    // size. Software rasterisers pay per pixel, so this is the cheapest
    // frame-time lever when the scene gets heavy; 1 is full resolution.
    setRenderScale(scale) {
        this.renderScale = scale;
        this.resize();
    }

    // Mouse aim: unproject the screen point onto the ground plane (y = 0).
    screenToWorld(sx, sy) {
        const p = this.game?.player;
        if (!this.renderer || !this.camera || !p) {
            return { x: p?.x ?? 0, y: p?.y ?? 0 };
        }
        const ndc = new THREE.Vector2(
            (sx / this.width) * 2 - 1, -((sy / this.height) * 2 - 1));
        const rc = new THREE.Raycaster();
        rc.setFromCamera(ndc, this.camera);
        const o = rc.ray.origin, d = rc.ray.direction;
        if (Math.abs(d.y) < 1e-6) return { x: p.x, y: p.y };
        const t = -o.y / d.y;
        if (t <= 0) return { x: p.x, y: p.y };
        return { x: o.x + d.x * t, y: o.z + d.z * t };
    }

    // --- frame ------------------------------------------------------------

    render(game) {
        this.game = game;
        if (!this.renderer) {
            this._drawHUD(game);
            return;
        }
        // Dynamic resolution (skipped in ?shot= photo mode). The frame
        // delta is smoothed; every 5 frames the buffer scale steps toward
        // a ~28ms frame. In software WebGL this drops fast (1.0 -> 0.25
        // within ~15 frames); on a real GPU it stays at 1.0.
        if (!this._shotMode) {
            const now = performance.now();
            if (this._lastFrameNow) {
                const d = now - this._lastFrameNow;
                this._frameEMA = this._frameEMA * 0.8 + Math.min(d, 500) * 0.2;
            }
            this._lastFrameNow = now;
            if (++this._adaptTick >= 5) {
                this._adaptTick = 0;
                let s = this.renderScale;
                if (this._frameEMA > 40) s = Math.max(0.2, s * 0.6);
                else if (this._frameEMA < 22) s = Math.min(1, s * 1.15);
                if (s !== this.renderScale) this.setRenderScale(s);
            }
        }
        const t = game.time || 0;
        const dt = t > this.lastTime ? Math.min(t - this.lastTime, 0.1) : 1 / 60;
        this.lastTime = t;
        this._updateCamera(game, dt);
        this._updateEnvironment(game);
        this._syncWorld(game);
        this.renderer.render(this.scene, this.camera);
        this._drawHUD(game);
    }

    _updateEnvironment(game) {
        const d = game.mode==='title'?.72:clamp(game.dusk ?? .4,0,1);
        this.sky.position.copy(this.camera.position);
        this.sky.material.uniforms.dusk.value=d;
        this.water.material.uniforms.time.value=game.time;
        this.water.material.uniforms.dusk.value=d;
        this.facadeMaterial.emissiveIntensity=clamp((d-.24)*1.45,0,.9);
        this.dir.intensity=lerp(2.15,1.75,d);
        const {x,z}=this.camera.position;
        this.dir.position.set(x+40,340,z-780);
        this.dir.target.position.set(x,0,z);
    }

    _updateCamera(game, dt) {
        if(game.mode==='title') {
            const t=this.reducedMotion?0:game.time;
            const a=Math.sin(t*.065);
            this.camera.position.set(2860+a*170,165+a*28,1860+Math.cos(t*.065)*130);
            this.camera.lookAt(2200+a*70,64,850); this.camInit=false; return;
        }
        if(game.camera.photo) {
            const {dx,dy,dz,tx,ty,tz}=game.camera.photo, p=game.player;
            this.camera.position.set(p.x+dx,dy,p.y+dz);
            this.camera.lookAt(p.x+tx,ty,p.y+tz);
            return;
        }
        const p = game.player;
        const car = p.car;
        const yaw = game.camera.yaw ?? p.h;
        const zoomScale = clamp(1.15 / (game.camera.zoom || 1.15), 0.8, 1.5);
        const speed = car ? Math.abs(car.speed) : 0;
        const speedBoost = 1 + Math.min(speed / 400, 0.25) * 0.35;
        const dist = (car ? CAR_DIST : FOOT_DIST) * zoomScale * speedBoost;
        const height = (car ? CAR_HEIGHT : FOOT_HEIGHT) * zoomScale;
        const fx = Math.cos(yaw), fz = Math.sin(yaw);
        this._tmpVec.set(p.x - fx * dist, height, p.y - fz * dist);
        if (!this.camInit || !this.camPos) {
            this.camPos = this._tmpVec.clone();
            this.camInit = true;
        } else {
            const k = 1 - Math.exp(-6 * dt);
            this.camPos.lerp(this._tmpVec, k);
        }
        // Screen shake rides on top of the smoothed position.
        const shake = game.shake || 0;
        const sx = shake ? Math.sin(game.time * 191) * .5 * shake * 1.4 : 0;
        const sy = shake ? Math.sin(game.time * 143 + 2) * .5 * shake * 1.4 : 0;
        this.camera.position.set(this.camPos.x + sx, this.camPos.y + sy, this.camPos.z);
        this.camera.lookAt(p.x + fx * LOOK_AHEAD, LOOK_HEIGHT, p.y + fz * LOOK_AHEAD);
    }

    _syncWorld(game) {
        this._syncCars(game);
        this._syncPeople(this.pedMeshes, game.peds, ped => ({
            jacket: ped.jacket, skin: ped.skin, hair: ped.hair, trousers: ped.trousers
        }), game);
        this._syncPeople(this.enemyMeshes, game.enemies, e => ({
            jacket: e.jacket, skin: e.skin, hair: e.hair, trousers: P.trousers
        }), game);
        this._syncPeople(this.officerMeshes, game.police.officers, o => ({
            jacket: o.jacket, skin: o.skin, hair: o.hair,
            trousers: P.trousers, officer: true
        }), game);
        this._syncPlayer(game);
        this._syncPickups(game);
        this._syncBullets(game);
        this._syncParticles(game);
        this._syncSkids(game);
        this._syncShadows(game);
        this._syncLights(game);
        this._syncMarkers(game);
        this._syncFlash(game);
    }

    _syncCars(game) {
        const seen = new Set();
        for (const car of game.cars) {
            seen.add(car);
            let mesh = this.carMeshes.get(car);
            if (!mesh) {
                mesh = new THREE.Mesh(carGeometry(car.type, car.color), this.paint);
                mesh.add(carLettering(car.type));
                mesh.castShadow=mesh.receiveShadow=true;
                this.scene.add(mesh);
                this.carMeshes.set(car, mesh);
            }
            if(mesh.userData.paint!==car.color) {
                mesh.geometry=carGeometry(car.type,car.color); mesh.userData.paint=car.color;
            }
            mesh.position.set(car.x, car.wreck ? -2 : 0, car.y);
            mesh.rotation.set(0, yawFor(car.h), car.wreck ? 0.05 : 0);
            mesh.children[0].visible=Math.hypot(car.x-this.camera.position.x,car.y-this.camera.position.z)<340;
            mesh.visible = true;
        }
        for (const [car, mesh] of this.carMeshes) {
            if (!seen.has(car)) {
                this.scene.remove(mesh);
                this.carMeshes.delete(car);
            }
        }
    }

    _syncPeople(map, list, makeOpts, game) {
        const seen = new Set();
        for (const person of list) {
            seen.add(person);
            let mesh = map.get(person);
            if (!mesh) {
                mesh = new THREE.Mesh(personGeometry(makeOpts(person)), this.lambert);
                this.scene.add(mesh);
                mesh.castShadow=true;
                map.set(person, mesh);
            }
            if(person.inCab) {mesh.visible=false;continue;}
            const dead = person.dead;
            animateStride(mesh,person.moving && !dead,game.time*8+person.id);
            const bob = !dead && person.moving
                ? Math.abs(Math.sin(game.time * 9 + (person.id || 0))) * 1.6 : 0;
            mesh.position.set(person.x, dead ? 2 : bob, person.y);
            mesh.rotation.order = 'YXZ';
            if (dead) mesh.rotation.set(-Math.PI / 2 * 0.9, yawFor(person.h), 0);
            else mesh.rotation.set(0, yawFor(person.h), 0);
            mesh.material = person.flash > 0 ? this.flashMat : this.lambert;
            mesh.visible = true;
        }
        for (const [person, mesh] of map) {
            if (!seen.has(person)) {
                this.scene.remove(mesh);
                map.delete(person);
            }
        }
    }

    _syncPlayer(game) {
        const p = game.player;
        const mesh = this.playerMesh;
        if (!mesh) return;
        if (p.car) {
            mesh.visible = false;
            return;
        }
        mesh.visible = true;
        animateStride(mesh,p.moving,game.time*9);
        const bob = p.moving ? Math.abs(Math.sin(game.time * 9)) * 1.6 : 0;
        mesh.position.set(p.x, bob, p.y);
        mesh.rotation.order = 'YXZ';
        mesh.rotation.set(0, yawFor(p.h), 0);
        mesh.material = p.flash > 0 ? this.flashMat : this.lambert;
    }

    _syncPickups(game) {
        const seen = new Set();
        for (const item of game.world.pickups) {
            if (!item.active) continue;
            seen.add(item);
            let mesh = this.pickupMeshes.get(item);
            if (!mesh) {
                mesh = new THREE.Mesh(pickupGeometry(item.kind), this.lambert);
                this.scene.add(mesh);
                this.pickupMeshes.set(item, mesh);
            }
            mesh.position.set(item.x,
                12 + Math.sin(game.time * 2 + (item.phase || 0)) * 3, item.y);
            mesh.rotation.y = game.time * 1.2;
            mesh.visible = true;
        }
        for (const [item, mesh] of this.pickupMeshes) {
            if (!seen.has(item)) {
                this.scene.remove(mesh);
                this.pickupMeshes.delete(item);
            }
        }
    }

    _syncBullets(game) {
        const seen = new Set();
        for (const b of game.bullets) {
            seen.add(b);
            let mesh = this.bulletMeshes.get(b);
            if (!mesh) {
                mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat);
                this.scene.add(mesh);
                this.bulletMeshes.set(b, mesh);
            }
            mesh.position.set(b.x, 9, b.y);
            mesh.rotation.set(0, yawFor(Math.atan2(b.vy, b.vx)), 0);
            mesh.visible = true;
        }
        for (const [b, mesh] of this.bulletMeshes) {
            if (!seen.has(b)) {
                this.scene.remove(mesh);
                this.bulletMeshes.delete(b);
            }
        }
    }

    _syncParticles(game) {
        const n = Math.min(game.particles.length, MAX_PARTICLES);
        for (let i = 0; i < n; i++) {
            const p = game.particles[i];
            const age = 1 - p.life / (p.max || 1);
            const height = p.kind === 'smoke' ? 6 + age * 26 : 4;
            this.particlePos[i * 3] = p.x;
            this.particlePos[i * 3 + 1] = height;
            this.particlePos[i * 3 + 2] = p.y;
            this._tmpColor.set(p.color || '#ffffff');
            this.particleCol[i * 3] = this._tmpColor.r;
            this.particleCol[i * 3 + 1] = this._tmpColor.g;
            this.particleCol[i * 3 + 2] = this._tmpColor.b;
        }
        this.particleGeo.setDrawRange(0, n);
        this.particleGeo.attributes.position.needsUpdate = true;
        this.particleGeo.attributes.color.needsUpdate = true;
        this.particlePoints.visible = n > 0;
    }

    _syncSkids(game) {
        const n = Math.min(game.skids.length, MAX_SKIDS);
        this.skidMesh.count = n;
        for (let i = 0; i < n; i++) {
            const s = game.skids[i];
            this._tmpMatrix.makeRotationY(yawFor(s.h));
            this._tmpMatrix.setPosition(s.x, 0.35, s.y);
            this.skidMesh.setMatrixAt(i, this._tmpMatrix);
        }
        this.skidMesh.instanceMatrix.needsUpdate = true;
        this.skidMesh.visible = n > 0;
    }

    _syncShadows(game) {
        let n = 0;
        const put = (x, y, sx, sz) => {
            if (n >= MAX_SHADOWS) return;
            this._tmpMatrix.makeScale(sx, 1, sz);
            this._tmpMatrix.setPosition(x, 0.3, y);
            this.shadowMesh.setMatrixAt(n++, this._tmpMatrix);
        };
        for (const car of game.cars) {
            this._tmpMatrix.makeRotationY(-car.h);
            this._tmpMatrix.scale(this._tmpVec.set(CARS[car.type].length*.54,1,CARS[car.type].width*.58));
            this._tmpMatrix.setPosition(car.x,.30,car.y);
            if(n<MAX_SHADOWS) this.shadowMesh.setMatrixAt(n++,this._tmpMatrix);
        }
        for (const ped of game.peds) if (!ped.dead && !ped.inCab) put(ped.x, ped.y, 5, 4);
        for (const e of game.enemies) if (!e.dead) put(e.x, e.y, 10, 10);
        for (const o of game.police.officers) if (!o.dead) put(o.x, o.y, 10, 10);
        if (!game.player.car) put(game.player.x, game.player.y, 5, 4);
        this.shadowMesh.count = n;
        this.shadowMesh.instanceMatrix.needsUpdate = true;
        this.shadowMesh.visible = n > 0;
    }

    _syncLights(game) {
        const a=this.lightTransform, mesh=this.glows;
        let n=0, beams=0;
        const put=(x,y,z,sx,sz,color,ground,h=0)=>{
            if(n>=900)return;
            a.position.set(x,y,z);a.scale.set(sx,sz,1);
            if(ground) a.rotation.set(-Math.PI/2,0,-h,'YXZ');
            else a.quaternion.copy(this.camera.quaternion);
            a.updateMatrix(); mesh.setMatrixAt(n,a.matrix);
            mesh.setColorAt(n++,this._tmpColor.set(color));
        };
        for(const c of game.cars){
            if(c.wreck || (c!==game.player.car && !c.driver) || Math.hypot(c.x-this.camera.position.x,c.y-this.camera.position.z)>600) continue;
            const def=CARS[c.type], fx=Math.cos(c.h),fz=Math.sin(c.h);
            const facing=(this.camera.position.x-c.x)*fx+(this.camera.position.z-c.y)*fz;
            for(const side of [-1,1]){
                const ox=-fz*side*def.width*.29, oz=fx*side*def.width*.29;
                const lx=c.x+ox+fx*(def.length*.51), lz=c.y+oz+fz*(def.length*.51);
                if(game.dusk>.35){
                    if(beams<this.beams.instanceMatrix.count) {
                        a.position.set(lx+fx*35,.47,lz+fz*35);a.scale.set(70,25,1);
                        a.rotation.set(-Math.PI/2,0,-c.h,'YXZ');a.updateMatrix();
                        this.beams.setMatrixAt(beams++,a.matrix);
                    }
                    if(facing>0) put(lx,7,lz,6.5,3.8,'#ffdb97',false);
                    if(facing<0) put(c.x+ox-fx*def.length*.50,7,c.y+oz-fz*def.length*.50,6,3.2,'#ff3358',false);
                }
                if(c.type==='police' && game.police.stars && Math.sin(game.time*12+c.id)*side>-.15){
                    const col=side>0?'#ff385f':'#408aff';
                    put(c.x+ox,20.2,c.y+oz,20,14,col,false);
                    put(c.x+ox*3,.51,c.y+oz*3,45,30,col,true,c.h);
                }
            }
        }
        this.beams.count=beams;this.beams.instanceMatrix.needsUpdate=true;
        mesh.count=n;mesh.instanceMatrix.needsUpdate=true;
        if(mesh.instanceColor) mesh.instanceColor.needsUpdate=true;
    }

    _syncMarkers(game) {
        this._placeBeacon(this.missionBeacon, game.mission.marker, game);
        this._placeBeacon(this.waypointBeacon, game.waypoint, game);
    }

    _placeBeacon(beacon, point, game) {
        if (!point) {
            beacon.visible = false;
            return;
        }
        beacon.visible = true;
        beacon.position.set(point.x, 0, point.y);
        const pulse = 1 + Math.sin(game.time * 4) * 0.18;
        beacon.userData.ring.scale.set(pulse, pulse, 1);
        beacon.userData.cone.position.y = 29 + Math.sin(game.time * 2.5) * 2;
    }

    _syncFlash(game) {
        const p = game.player;
        if (!p.flash || p.flash <= 0) {
            this.flashSprite.visible = false;
            return;
        }
        const reach = p.car ? 26 : 20;
        const a = p.fireHeading || p.h;
        this.flashSprite.position.set(
            p.x + Math.cos(a) * reach, 10, p.y + Math.sin(a) * reach);
        this.flashSprite.material.opacity = clamp(p.flash / 0.09, 0, 1);
        this.flashSprite.visible = true;
    }

    _drawHUD(game) {
        const ctx = this.hudCtx;
        if (!ctx) return;
        // The HUD canvas is a full-screen layer: redrawing it every frame
        // forces a full re-upload to the compositor in software rendering.
        // Redraw every 3rd frame (the minimap still moves smoothly); the
        // full map and the damage flash always draw promptly.
        if (!this._shotMode && !game.mapOpen && !(game.damageFlash > 0)) {
            if (++this._hudTick % 3 !== 0) return;
        }
        ctx.clearRect(0, 0, this.width, this.height);
        if(game.mode==='title') return;
        if (game.mapOpen) drawFullMap(ctx, game, this);
        else drawHUD(ctx, game, this);
        if (game.damageFlash > 0) {
            const v=ctx.createRadialGradient(this.width/2,this.height/2,this.height*.18,
                this.width/2,this.height/2,this.width*.59);
            v.addColorStop(0,'#a0182400');
            v.addColorStop(1,'rgba(175,20,48,'+clamp(game.damageFlash*.85,0,.8)+')');ctx.fillStyle=v;
            ctx.fillRect(0, 0, this.width, this.height);
        }
    }
}

// The camera follow point glides toward the player and the camera yaw
// eases toward the player (or car) heading, so the chase cam swings
// around behind the direction of travel instead of snapping.
export function updateCamera(game, dt) {
    const p = game.player;
    const k = 1 - Math.exp(-5 * dt);
    game.camera.x += (p.x - game.camera.x) * k;
    game.camera.y += (p.y - game.camera.y) * k;
    const target = p.car ? p.car.h : p.h;
    if (game.camera.yaw === undefined) game.camera.yaw = target;
    game.camera.yaw = dampAngle(game.camera.yaw, target, 3.2, dt);
}
