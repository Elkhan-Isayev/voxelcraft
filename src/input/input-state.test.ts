import { InputState } from './input-state';

describe('InputState', () => {
  test('maps WASD to movement axes', () => {
    const s = new InputState();
    s.keyDown('KeyW', 0);
    s.keyDown('KeyD', 0);
    expect(s.moveInput()).toMatchObject({ forward: 1, strafe: 1 });
    s.keyDown('KeyS', 0);
    expect(s.moveInput().forward).toBe(0);
    s.keyUp('KeyW');
    expect(s.moveInput().forward).toBe(-1);
  });

  test('arrow keys also move', () => {
    const s = new InputState();
    s.keyDown('ArrowUp', 0);
    s.keyDown('ArrowLeft', 0);
    expect(s.moveInput()).toMatchObject({ forward: 1, strafe: -1 });
  });

  test('space jumps, shift sneaks, ctrl sprints', () => {
    const s = new InputState();
    s.keyDown('Space', 0);
    s.keyDown('ShiftLeft', 0);
    s.keyDown('ControlLeft', 0);
    expect(s.moveInput()).toMatchObject({ jump: true, sneak: true, sprint: true });
  });

  test('double-tapping W starts sprinting until W is released', () => {
    const s = new InputState();
    s.keyDown('KeyW', 0);
    s.keyUp('KeyW');
    s.keyDown('KeyW', 200);
    expect(s.moveInput().sprint).toBe(true);
    s.keyUp('KeyW');
    expect(s.moveInput().sprint).toBe(false);
  });

  test('slow taps do not trigger sprint', () => {
    const s = new InputState();
    s.keyDown('KeyW', 0);
    s.keyUp('KeyW');
    s.keyDown('KeyW', 600);
    expect(s.moveInput().sprint).toBe(false);
  });

  test('double-tapping space requests a flight toggle', () => {
    const s = new InputState();
    expect(s.keyDown('Space', 0)).toEqual([]);
    s.keyUp('Space');
    expect(s.keyDown('Space', 250)).toContain('toggleFly');
  });

  test('key repeat does not count as a double tap', () => {
    const s = new InputState();
    s.keyDown('Space', 0);
    expect(s.keyDown('Space', 30)).toEqual([]);
  });

  test('one-shot actions for hotbar, inventory, drop, debug, mode switch', () => {
    const s = new InputState();
    expect(s.keyDown('Digit3', 0)).toContain('hotbar2');
    expect(s.keyDown('KeyE', 0)).toContain('inventory');
    expect(s.keyDown('KeyQ', 0)).toContain('drop');
    expect(s.keyDown('F3', 0)).toContain('debug');
    expect(s.keyDown('KeyG', 0)).toContain('toggleMode');
  });

  test('clearing releases every key (e.g. when the window loses focus)', () => {
    const s = new InputState();
    s.keyDown('KeyW', 0);
    s.keyDown('Space', 0);
    s.clear();
    expect(s.moveInput()).toMatchObject({ forward: 0, jump: false });
  });
});
