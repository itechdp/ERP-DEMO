// A short, clear two-note chime for a newly assigned task. The sound is made in the browser (a tiny WAV built in memory), so there is
// no file to load. It is played with an <audio> element — the most dependable way across Chrome, Safari, phones and the Android app —
// and, if that is refused, with Web Audio.
// Browsers only allow sound after the person has touched the page once (a click, a key, a tap). primeSound() listens for that first
// touch from the moment the app opens (the Sign In click counts) and unlocks the sound with it.

const RATE = 22050;
let url: string | null = null;
let audio: HTMLAudioElement | null = null;
let ctx: AudioContext | null = null;
let primed = false;

/** the chime as a 16-bit mono WAV: A5 then E6, each a soft bell (quick attack, gentle fade), about 0.8 s */
function chimeUrl(): string {
  if (url) return url;
  const len = Math.floor(RATE * 0.8);
  const pcm = new Float32Array(len);
  const bell = (freq: number, start: number, dur: number, vol: number) => {
    const s0 = Math.floor(start * RATE);
    const n = Math.floor(dur * RATE);
    for (let i = 0; i < n && s0 + i < len; i++) {
      const t = i / RATE;
      const env = Math.min(1, t / 0.008) * Math.exp(-t * 6);
      pcm[s0 + i] += vol * env * (Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(4 * Math.PI * freq * t));
    }
  };
  bell(880, 0, 0.5, 0.45);
  bell(1318.5, 0.18, 0.62, 0.45);
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + len * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return url;
}

function element(): HTMLAudioElement | null {
  if (audio) return audio;
  try {
    audio = new Audio(chimeUrl());
    audio.preload = 'auto';
    audio.volume = 1;
  } catch {
    audio = null;
  }
  return audio;
}

function webAudio(): AudioContext | null {
  if (ctx) return ctx;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try {
    ctx = new C();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Listen for the first touch of the page and unlock the sound with it. Safe to call more than once. */
export function primeSound() {
  if (primed || typeof window === 'undefined') return;
  primed = true;
  const unlock = () => {
    const a = element();
    if (a) {
      // a silent play inside the touch: from now on the browser lets this element play by itself
      a.muted = true;
      void a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
    }
    const c = webAudio();
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined);
    window.removeEventListener('pointerdown', unlock, true);
    window.removeEventListener('keydown', unlock, true);
    window.removeEventListener('touchstart', unlock, true);
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchstart', unlock, true);
}

/** the same chime with Web Audio (used only if the <audio> element is refused) */
function playWebAudio() {
  const c = webAudio();
  if (!c) return;
  if (c.state === 'suspended') void c.resume().catch(() => undefined);
  const now = c.currentTime + 0.02;
  const note = (freq: number, start: number, length: number) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + start);
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.5, now + start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
    osc.connect(gain).connect(c.destination);
    osc.start(now + start);
    osc.stop(now + start + length + 0.05);
  };
  note(880, 0, 0.45);
  note(1318.5, 0.18, 0.6);
}

/** ding-dong for a newly assigned task */
export function playTaskChime() {
  const a = element();
  if (!a) return playWebAudio();
  try {
    a.muted = false;
    a.currentTime = 0;
    void a.play().catch(() => playWebAudio());
  } catch {
    playWebAudio();
  }
}
