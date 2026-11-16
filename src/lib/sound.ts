import type { SoundEffect } from '../types';

export function playSound(effect: SoundEffect): void {
  if (effect === 'none') return;
  const context = new AudioContext();
  const start = context.currentTime;
  const frequencies = effect === 'tick' ? [880] : [660, 990];
  frequencies.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const offset = index * 0.09;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.12, start + offset + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.1);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.11);
  });
  window.setTimeout(() => void context.close(), 350);
}
