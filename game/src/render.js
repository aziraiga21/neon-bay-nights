// Neon Bay Nights — third-person 3D renderer (Three.js, vendored, offline).
//
// The simulation stays 2D (world x/y, heading 0 = east, clockwise in 2D);
// this module is the only place that knows about Three.js. 2D (x, y) maps
// to 3D (x, 0, y) and a 2D heading h becomes rotation.y = -h, so cars and
// characters face the way the simulation thinks they do. The camera is a
// chase cam: behind the player on foot, behind the car when driving, eased
// toward its target every frame instead of snapping.
//
// The city itself is merged into two static draw calls (one lit, one
// glowing); every car and person is one merged mesh; particles, skid marks
// and blob shadows are instanced. That keeps the frame cheap enough for
// software WebGL (SwiftShader) at 1280x800.
//
// In environments without a real WebGL context (the Node test suite) the
// renderer runs headless: the 3D scene is skipped, but the HUD overlay
// still paints, so every render path the tests exercise keeps working.
import * as THREE from '../vendor/three.module.min.js';
import { PALETTE as P, clamp, lerp, angleDelta } from './config.js';
import {
    buildCityGeometry, buildSigns, carGeometry, personGeometry,
    pickupGeometry, makeBeacon, yawFor
} from './art.js';
import { makeMap, drawHUD, drawFullMap } from './hud.js';

const FOV = 55;
const FOOT_DIST = 125, FOOT_HEIGHT = 78;
const CAR_DIST = 208, CAR_HEIGHT = 100;
const LOOK_AHEAD = 30, LOOK_HEIGHT = 14;
const MAX_PARTICLES = 500;
const MAX_SKIDS = 500;
const MAX_SHADOWS = 320;

// A real WebGL context exposes numeric enum constants; the Node test
// stand-in canvas returns a proxy whose properties are all functions.
function tryWebGLContext(canvas) {
    try {
        const gl = canvas.getContext('webgl2', { antialias: false, alpha: false })
            || canvas.getContext('webgl', { antialias: false, alpha: false });
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
        this._frameEMA = 16;
        this._adaptTick = 0;
        this._lastFrameNow = 0;
        this._hudTick = 0;
        this._shotMode = (typeof location !== 'undefined'
            && /[?&]shot=/.test(location.search));

        // Shared materials. Vertex colours carry the palette, so one
        // material serves every merged mesh in the scene. The static city
        // uses MeshBasicMaterial with baked sunset shading (see art.js):
        // one cheap lookup per pixel instead of per-fragment lights,
        // which is what keeps software WebGL fast.
        this.lambert = new THREE.MeshLambertMaterial({ vertexColors: true });
        this.basic = new THREE.MeshBasicMaterial({ vertexColors: true });
        this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.bulletMat = new THREE.MeshBasicMaterial({ color: 0xffd76a });
        this.shadowMat = new THREE.MeshBasicMaterial({
            color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false
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
                // No scene fog: in software WebGL (SwiftShader) the
                // per-fragment fog mix costs ~150ms/frame at 1280x800
                // (measured: 183ms with fog, 17ms without). The far
                // ground plane below reaches the horizon instead, so the
                // world edge never shows as a hard line.
                this.camera = new THREE.PerspectiveCamera(FOV, 1280 / 800, 1, 9000);
                this.hemi = new THREE.HemisphereLight(0xbfe3f0, 0x8a7a66, 0.95);
                this.scene.add(this.hemi);
                this.dir = new THREE.DirectionalLight(0xffe2b8, 1.25);
                this.dir.position.set(-500, 700, -400);
                this.scene.add(this.dir);
                this.scene.add(this.dir.target);
                // A flat warm disc for the low north-west sun; it always
                // faces the camera and ignores fog so it stays bright.
                this.sun = new THREE.Mesh(
                    new THREE.CircleGeometry(230, 32),
                    new THREE.MeshBasicMaterial({ color: 0xffd9a0, fog: false })
                );
                this.sun.position.set(-1400, 760, -1400);
                this.scene.add(this.sun);
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

        this._skyDay = new THREE.Color(P.sky);
        this._skyDusk = new THREE.Color(P.skyDusk);
        this._sunDay = new THREE.Color(0xffe2b8);
        this._sunDusk = new THREE.Color(0xff9a5c);
        this._hemiDay = new THREE.Color(0xbfe3f0);
        this._hemiDusk = new THREE.Color(0x6a5588);
        this._waterDay = new THREE.Color(P.water);
        this._waterDusk = new THREE.Color(P.waterDusk);
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
        this.world = world;
        this.map = makeMap(world);
        // Drop every dynamic mesh: the new game owns new actor objects.
        for (const map of [this.carMeshes, this.pedMeshes, this.enemyMeshes,
            this.officerMeshes, this.bulletMeshes, this.pickupMeshes]) {
            for (const mesh of map.values()) this.scene?.remove(mesh);
            map.clear();
        }
        if (this.playerMesh) {
            this.scene?.remove(this.playerMesh);
            this.playerMesh = null;
        }
        if (!this.scene) return;
        if (this.staticGroup) {
            this.scene.remove(this.staticGroup);
            this.staticGroup = null;
        }
        this.staticGroup = new THREE.Group();
        const { walls, rest } = buildCityGeometry(world);
        // Lambert (lit by the scene sun/hemisphere) with raw palette
        // colours: the baked-shading Basic path rendered the city black
        // in software WebGL, and lit Lambert matches the cars/peds.
        this.staticGroup.add(
            new THREE.Mesh(walls, this.lambert),
            new THREE.Mesh(rest, this.lambert)
        );
        for (const sign of buildSigns(world)) this.staticGroup.add(sign);
        // The bay: one big translucent plane east of the seawall, running
        // out to the horizon so the water never ends mid-frame.
        const waterW = (world.width - world.water) + 6000;
        const waterH = world.height + 700;
        const waterGeo = new THREE.PlaneGeometry(waterW, waterH);
        waterGeo.rotateX(-Math.PI / 2);
        this.water = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({
            color: P.water, transparent: true, opacity: 0.9
        }));
        this.water.position.set(world.water + waterW / 2 - 100, 0.5, world.height / 2);
        this.staticGroup.add(this.water);
        this.scene.add(this.staticGroup);
        // Player mesh (fixed colours) is built once per world.
        this.playerMesh = new THREE.Mesh(personGeometry({
            jacket: P.jacket, skin: '#C48A62', hair: P.ink, trousers: P.trousers
        }), this.lambert);
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
        this._updateEnvironment(game);
        this._updateCamera(game, dt);
        this._syncWorld(game);
        this.renderer.render(this.scene, this.camera);
        this._drawHUD(game);
    }

    _updateEnvironment(game) {
        const d = clamp(game.dusk ?? 0.4, 0, 1);
        this._tmpColor.lerpColors(this._skyDay, this._skyDusk, d);
        this.scene.background.copy(this._tmpColor);
        this.dir.color.lerpColors(this._sunDay, this._sunDusk, d);
        this.dir.intensity = lerp(1.25, 0.85, d);
        this.hemi.intensity = lerp(0.95, 0.7, d);
        this.hemi.color.lerpColors(this._hemiDay, this._hemiDusk, d);
        if (this.water) {
            this.water.material.color.lerpColors(this._waterDay, this._waterDusk, d);
            this.water.material.opacity = 0.86 + Math.sin(game.time * 0.6) * 0.04;
        }
        if (this.sun) {
            this.sun.lookAt(this.camera.position);
            this.sun.material.color.setHex(d > 0.55 ? 0xffb36b : 0xffd9a0);
        }
        // The sun light always comes from the north-west, and it follows
        // the camera so the visible streets stay lit.
        const p = game.player;
        this.dir.position.set(p.x - 500, 700, p.y - 400);
        this.dir.target.position.set(p.x, 0, p.y);
        this.dir.target.updateMatrixWorld();
    }

    _updateCamera(game, dt) {
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
        const sx = shake ? (Math.random() - 0.5) * shake * 1.4 : 0;
        const sy = shake ? (Math.random() - 0.5) * shake * 1.4 : 0;
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
        this._syncMarkers(game);
        this._syncFlash(game);
    }

    _syncCars(game) {
        const seen = new Set();
        for (const car of game.cars) {
            seen.add(car);
            let mesh = this.carMeshes.get(car);
            if (!mesh) {
                mesh = new THREE.Mesh(carGeometry(car.type, car.color), this.lambert);
                this.scene.add(mesh);
                this.carMeshes.set(car, mesh);
            }
            mesh.position.set(car.x, car.wreck ? -2 : 0, car.y);
            mesh.rotation.set(0, yawFor(car.h), car.wreck ? 0.05 : 0);
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
                map.set(person, mesh);
            }
            const dead = person.dead;
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
        for (const car of game.cars) put(car.x, car.y, 30, 15);
        for (const ped of game.peds) if (!ped.dead) put(ped.x, ped.y, 10, 10);
        for (const e of game.enemies) if (!e.dead) put(e.x, e.y, 10, 10);
        for (const o of game.police.officers) if (!o.dead) put(o.x, o.y, 10, 10);
        if (!game.player.car) put(game.player.x, game.player.y, 10, 10);
        this.shadowMesh.count = n;
        this.shadowMesh.instanceMatrix.needsUpdate = true;
        this.shadowMesh.visible = n > 0;
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
        beacon.userData.cone.position.y = 46 + Math.sin(game.time * 2.5) * 5;
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
        if (!game.mapOpen && !(game.damageFlash > 0)) {
            if (++this._hudTick % 3 !== 0) return;
        }
        ctx.clearRect(0, 0, this.width, this.height);
        if (game.mapOpen) drawFullMap(ctx, game, this);
        else drawHUD(ctx, game, this);
        if (game.damageFlash > 0) {
            ctx.fillStyle = `rgba(200,40,40,${clamp(game.damageFlash * 0.3, 0, 0.3)})`;
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
