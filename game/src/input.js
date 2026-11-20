const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
export class Input {
    constructor(canvas) {
        this.keys = new Set();
        this.pressed = new Set();
        this.mouse = {
            x: 0, y: 0, aim: false
        };
        this.canvas = canvas;
        window.addEventListener('keydown', e => {
            // Let menu buttons keep native keyboard activation and focus navigation.
            if (e.target?.closest?.('#screen') && ['Tab', 'Space', 'Enter'].includes(e.code)) return;
            if (BLOCKED.has(e.code) || (e.ctrlKey && ['KeyW','KeyA','KeyS','KeyD'].includes(e.code))) {
                e.preventDefault();
            }
            if (!this.keys.has(e.code)) {
                this.pressed.add(e.code);
            }
            this.keys.add(e.code);
        });
        window.addEventListener('keyup', e => this.keys.delete(e.code));
        const point=e=>{
            const r=canvas.getBoundingClientRect();
            this.mouse.x=e.clientX-r.left;this.mouse.y=e.clientY-r.top;
        };
        canvas.addEventListener('pointermove',point);
        // Mouse events report each button in a chord, including fire while aiming.
        canvas.addEventListener('mousedown',e=>{
            point(e);
            if(e.button===0)this.pressed.add('MouseLeft');
            if(e.button===2)this.mouse.aim=true;
            canvas.focus();
        });
        window.addEventListener('mouseup',e=>{
            if(e.button===2)this.mouse.aim=false;
        });
        window.addEventListener('pointercancel',()=>this.clear());
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('blur', () => this.clear());
    }
    down(...codes) {
        return codes.some(c => this.keys.has(c));
    }
    tap(code) {
        return this.pressed.delete(code);
    }
    endFrame() {
        this.pressed.clear();
    }
    clear() {
        this.keys.clear();
        this.pressed.clear();
        this.mouse.aim = false;
    }
    axes() {
        return { x: Number(this.down('KeyD', 'ArrowRight')) - Number(this.down('KeyA', 'ArrowLeft')), y: Number(this.down('KeyS', 'ArrowDown')) - Number(this.down('KeyW', 'ArrowUp')) };
    }
}
