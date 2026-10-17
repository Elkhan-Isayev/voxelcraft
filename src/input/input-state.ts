import type { MoveInput } from '../physics/player-physics';

export type InputAction =
  | 'toggleFly'
  | 'inventory'
  | 'drop'
  | 'dropAll'
  | 'debug'
  | 'toggleMode'
  | 'pause'
  | `hotbar${0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;

const DOUBLE_TAP_MS = 300;

/** Keyboard state machine, independent of the DOM so it can be unit-tested. */
export class InputState {
  private readonly down = new Set<string>();
  private readonly lastTap = new Map<string, number>();
  private sprintLatched = false;

  keyDown(code: string, timeMs: number): InputAction[] {
    if (this.down.has(code)) return []; // auto-repeat
    this.down.add(code);
    const actions: InputAction[] = [];
    const prev = this.lastTap.get(code);
    const doubleTap = prev !== undefined && timeMs - prev < DOUBLE_TAP_MS;
    this.lastTap.set(code, doubleTap ? -Infinity : timeMs);

    if (code === 'KeyW' && doubleTap) this.sprintLatched = true;
    if (code === 'Space' && doubleTap) actions.push('toggleFly');
    const digit = /^Digit([1-9])$/.exec(code);
    if (digit) actions.push(`hotbar${Number(digit[1]) - 1}` as InputAction);
    if (code === 'KeyE') actions.push('inventory');
    // Ctrl+Q drops the whole stack (Cmd+Q would quit the browser on macOS, so it is not used).
    if (code === 'KeyQ') actions.push(this.down.has('ControlLeft') || this.down.has('ControlRight') ? 'dropAll' : 'drop');
    if (code === 'F3') actions.push('debug');
    if (code === 'KeyG') actions.push('toggleMode');
    if (code === 'Escape') actions.push('pause');
    return actions;
  }

  keyUp(code: string): void {
    this.down.delete(code);
    if (code === 'KeyW' || code === 'ArrowUp') this.sprintLatched = false;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  clear(): void {
    this.down.clear();
    this.sprintLatched = false;
  }

  moveInput(): MoveInput {
    const k = (c: string) => (this.down.has(c) ? 1 : 0);
    const forward = Math.max(k('KeyW'), k('ArrowUp')) - Math.max(k('KeyS'), k('ArrowDown'));
    const strafe = Math.max(k('KeyD'), k('ArrowRight')) - Math.max(k('KeyA'), k('ArrowLeft'));
    return {
      forward,
      strafe,
      jump: this.down.has('Space'),
      sneak: this.down.has('ShiftLeft') || this.down.has('ShiftRight'),
      sprint: this.sprintLatched || this.down.has('ControlLeft') || this.down.has('ControlRight'),
    };
  }
}
