import { clamp } from './config.js';
export class Audio {
    constructor(settings = {}) {
        this.muted = !!settings.muted;
        this.musicEnabled = settings.music !== false;
        this.ctx = null;
        this.beat = 0;
        this.nextBeat = 0;
        this.paused = true;
    }
    unlock() {
        if (!this.ctx) {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (!Context) {
                return;
            }
            this.ctx = new Context();
            const c = this.ctx;
            this.master = c.createGain();
            this.master.gain.value = this.muted ? 0 : .42;
            this.master.connect(c.destination);
            this.music = c.createGain();
            this.music.gain.value = .36;
            this.music.connect(this.master);
            this.engineGain = c.createGain();
            this.engineGain.gain.value = 0;
            const filter = c.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 390;
            this.engineGain.connect(filter);
            filter.connect(this.master);
            this.engine = c.createOscillator();
            this.engine.type = 'sawtooth';
            this.engine.frequency.value = 40;
            this.engine.connect(this.engineGain);
            this.engine.start();
            this.sirenGain = c.createGain();
            this.sirenGain.gain.value = 0;
            this.sirenGain.connect(this.master);
            this.siren = c.createOscillator();
            this.siren.type = 'triangle';
            this.siren.frequency.value = 680;
            this.siren.connect(this.sirenGain);
            this.siren.start();
            const count = c.sampleRate;
            this.noise = c.createBuffer(1, count, c.sampleRate);
            const data = this.noise.getChannelData(0);
            let seed = 829;
            for (let i = 0; i < count; i++) {
                seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
                data[i] = (seed >>> 0) / 2147483648 - 1;
            }
            this.nextBeat = c.currentTime + .12;
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {
            });
        }
    }
    toggle() {
        this.muted = !this.muted;
        if (this.ctx) {
            this.master.gain.setTargetAtTime(this.muted ? 0 : .42, this.ctx.currentTime, .02);
        }
        return this.muted;
    }
    tone(freq, duration = .12, type = 'sine', volume = .15, delay = 0, dest = null, endFreq = null) {
        if (!this.ctx) {
            return;
        }
        const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (endFreq) {
            o.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
        }
        g.gain.setValueAtTime(.001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(.002, volume), t + .008);
        g.gain.exponentialRampToValueAtTime(.001, t + duration);
        o.connect(g);
        g.connect(dest || this.master);
        o.start(t);
        o.stop(t + duration + .01);
    }
    hiss(duration, volume = .2, cutoff = 1600) {
        if (!this.ctx) {
            return;
        }
        const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        s.buffer = this.noise;
        f.type = 'lowpass';
        f.frequency.value = cutoff;
        g.gain.setValueAtTime(volume, c.currentTime);
        g.gain.exponentialRampToValueAtTime(.001, c.currentTime + duration);
        s.connect(f);
        f.connect(g);
        g.connect(this.master);
        s.start();
        s.stop(c.currentTime + duration);
    }
    play(name, strength = 1) {
        if (!this.ctx || this.muted) {
            return;
        }
        if (name === 'shot') {
            this.hiss(.1, .27, 3600);
            this.tone(160, .1, 'triangle', .16, 0, null, 50);
        }
        if (name === 'enemyShot') {
            this.hiss(.08, .11, 2400);
        }
        if (name === 'crash') {
            this.hiss(.2, .24 * strength, 1000);
            this.tone(90, .18, 'sine', .25 * strength, 0, null, 28);
        }
        if (name === 'punch') {
            this.hiss(.07, .18, 700);
            this.tone(120, .09, 'triangle', .1, 0, null, 55);
        }
        if (name === 'pickup') {
            this.tone(660, .12, 'sine', .2);
            this.tone(990, .19, 'sine', .16, .09);
        }
        if (name === 'enter') {
            this.hiss(.08, .1, 600);
            this.tone(110, .06, 'triangle', .12);
        }
        if (name === 'empty') {
            this.tone(140, .04, 'square', .07);
        }
        if (name === 'wanted') {
            this.tone(392, .15, 'triangle', .18);
            this.tone(311, .22, 'triangle', .18, .14);
        }
        if (name === 'escape' || name === 'complete') {
            [330, 440, 554, 660].forEach((n, i) => this.tone(n, .35, 'triangle', .17, i * .12));
        }
    }
    update(game, dt, playing) {
        if (!this.ctx) {
            return;
        }
        const c = this.ctx, t = c.currentTime, car = game.player.car;
        const speed = car ? Math.abs(car.speed) : 0;
        this.engine.frequency.setTargetAtTime(34 + speed * .28 + (car?.throttle ? 14 : 0), t, .08);
        this.engineGain.gain.setTargetAtTime(playing && car && !car.wreck ? .065 + speed * .00023 : 0, t, .08);
        let near = Infinity;
        for (const p of game.police.units) {
            if (p.car && !p.car.wreck) {
                near = Math.min(near, Math.hypot(p.car.x - game.player.x, p.car.y - game.player.y));
            }
        }
        this.siren.frequency.setTargetAtTime(630 + Math.sin(game.time * 5.3) * 220, t, .045);
        this.sirenGain.gain.setTargetAtTime(playing && game.police.stars > 0 ? clamp(1 - near / 760, 0, 1) * .085 : 0, t, .1);
        if (!playing || !this.musicEnabled) {
            this.nextBeat = t + .1;
            return;
        }
        if (this.nextBeat < t - .3) {
            this.nextBeat = t + .02;
        }
        while (this.nextBeat < t + .12) {
            const delay = Math.max(0, this.nextBeat - t), b = this.beat % 32;
            const bass = [55, 55, 65.41, 49][Math.floor(b / 8)];
            if (b % 2 === 0) {
                this.tone(bass, b % 8 === 0 ? .35 : .18, 'triangle', .22, delay, this.music);
            }
            if (game.police.stars>=3 && b%2===1) {
                this.tone(bass*2,.105,'triangle',.17,delay,this.music);
                if(game.police.stars>=4) this.tone(bass,.08,'sine',.13,delay+.1225,this.music);
            }
            if (b % 4 === 0) {
                this.tone(115, .12, 'sine', .35, delay, this.music, 35);
            }
            const notes = [440, 523.25, 659.25, 587.33, 523.25, 392, 440, 329.63];
            if ([1, 4, 7, 10, 13, 17, 20, 23, 26, 29].includes(b)) {
                const note = notes[(Math.floor(b / 3) + Math.floor(this.beat / 32)) % notes.length];
                this.tone(note, .28, 'sine', .12, delay, this.music);
                this.tone(note * 2, .19, 'triangle', .025, delay, this.music);
            }
            if (b % 8 === 4) {
                this.tone(185, .08, 'triangle', .09, delay, this.music, 80);
            }
            this.beat++;
            this.nextBeat += .245;
        }
    }
}
