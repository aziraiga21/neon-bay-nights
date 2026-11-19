const BLOCKED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
export class Input {
    constructor(canvas) {
        this.keys = new Set();
        this.pressed = new Set();
        this.mouse = {
            x: 0, y: 0, down: false, aim: false
        };
        this.canvas = canvas;
        window.addEventListener('keydown', e => {
            // Let menu buttons keep native keyboard activation and focus navigation.
            if (e.target?.closest?.('#screen') && ['Tab', 'Space', 'Enter'].includes(e.code)) return;
            if (BLOCKED.has(e.code)) {
                e.preventDefault();
            }
            if (!this.keys.has(e.code)) {
                this.pressed.add(e.code);
            }
            this.keys.add(e.code);
        });
        window.addEventListener('keyup', e => this.keys.delete(e.code));
        canvas.addEventListener('pointermove', e => {
            const r = canvas.getBoundingClientRect();
            this.mouse.x = e.clientX - r.left;
            this.mouse.y = e.clientY - r.top;
            this.mouse.aim = true;
        });
        canvas.addEventListener('pointerdown', e => {
            if (e.button === 0) {
                this.mouse.down = true;
                this.mouse.aim = true;
                canvas.focus();
            }
        });
        window.addEventListener('pointerup', () => this.mouse.down = false);
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        window.addEventListener('blur', () => this.clear());
    }
    down(...codes) {
        return codes.some(c => this.keys.has(c));
    }
    tap(code) {
        if (!this.pressed.has(code)) {
            return false;
        }
        this.pressed.delete(code);
        return true;
    }
    endFrame() {
        this.pressed.clear();
    }
    clear() {
        this.keys.clear();
        this.pressed.clear();
        this.mouse.down = false;
        this.mouse.aim = false;
    }
    axes() {
        return { x: Number(this.down('KeyD', 'ArrowRight')) - Number(this.down('KeyA', 'ArrowLeft')), y: Number(this.down('KeyS', 'ArrowDown')) - Number(this.down('KeyW', 'ArrowUp')) };
    }
}
