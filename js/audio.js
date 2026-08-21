// ————————————————————————————————————————————————
// audio.js · Web Audio 程序化情绪音乐引擎
// valence → 调式（小调五声 → 大调五声）连续渐变
// arousal → BPM / 滤波截止 / 琶音密度 = 曲风能量连续渐变
// 可选低频垫乐（本地 mp3 循环）；全链路 try/catch 自动降级。
// ————————————————————————————————————————————————
import { clamp, lerp } from './emotion.js';

const MINOR_PENTA = [0, 3, 5, 7, 10];   // 小调五声：沉郁
const MAJOR_PENTA = [0, 4, 5, 7, 9];    // 大调五声：明亮
const ROOT = 220;                        // A3

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ok = false;        // 链路是否可用
    this.degraded = false;  // 是否已降级
    this.muted = false;
    this.playing = false;
    this.v = 0; this.a = 0; // 当前情绪坐标（引擎内部平滑跟随）
    this._nextNote = 0;
    this._timer = null;
    this.padEl = null;
    this.onError = null;
  }

  // 必须由用户手势触发
  init(padUrl) {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      // 软限幅，防爆音
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 20; comp.ratio.value = 8;
      this.master.connect(comp).connect(this.ctx.destination);

      this.bus = this.ctx.createGain(); this.bus.gain.value = 1; this.bus.connect(this.master);
      this.padGain = this.ctx.createGain(); this.padGain.gain.value = 0.4; this.padGain.connect(this.master);

      // 持续底床：双失谐振荡 + 低通
      this.droneFilter = this.ctx.createBiquadFilter();
      this.droneFilter.type = 'lowpass'; this.droneFilter.frequency.value = 320; this.droneFilter.Q.value = 0.6;
      this.droneGain = this.ctx.createGain(); this.droneGain.gain.value = 0.05;
      this.osc1 = this.ctx.createOscillator(); this.osc1.type = 'sine'; this.osc1.frequency.value = ROOT / 2;
      this.osc2 = this.ctx.createOscillator(); this.osc2.type = 'triangle'; this.osc2.frequency.value = ROOT / 2 * 1.005;
      this.osc1.connect(this.droneFilter); this.osc2.connect(this.droneFilter);
      this.droneFilter.connect(this.droneGain).connect(this.bus);
      this.osc1.start(); this.osc2.start();

      // 低频垫乐（可选，加载失败仅降级该层）
      if (padUrl) {
        this.padEl = new Audio(padUrl);
        this.padEl.loop = true; this.padEl.crossOrigin = 'anonymous';
        try {
          const src = this.ctx.createMediaElementSource(this.padEl);
          src.connect(this.padGain);
        } catch (e) { this.padEl = null; }
      }
      this.ok = true;
    } catch (e) {
      this.degraded = true;
      this.onError?.('init', e);
    }
  }

  setVolumes(master, pad, padOn) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : master, t, 0.1);
    this.padGain.gain.setTargetAtTime(padOn ? pad : 0, t, 0.2);
  }

  // 每帧喂入情绪坐标（内部再平滑，保证象限间过渡不断裂）
  feed(v, a) {
    this.v = lerp(this.v, v, 0.03);
    this.a = lerp(this.a, a, 0.03);
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    // 亮度：arousal + 参数 → 滤波截止
    const cutoff = 240 + (this.a + 1) / 2 * 2400 * this._brightness;
    this.droneFilter.frequency.setTargetAtTime(clamp(cutoff, 200, 4200), t, 0.3);
    // 底床音量随唤醒微起伏
    this.droneGain.gain.setTargetAtTime(0.04 + (this.a + 1) / 2 * 0.05, t, 0.4);
  }

  setBrightness(b) { this._brightness = b; }
  setTempoBase(bpm) { this._tempoBase = bpm; }

  get bpm() { return (this._tempoBase || 64) * (0.75 + ((this.a + 1) / 2) * 0.85); }

  start() {
    if (!this.ok) return;
    try {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.playing = true;
      this.padEl?.play().catch(() => {});
      this._nextNote = this.ctx.currentTime + 0.1;
      if (!this._timer) this._timer = setInterval(() => this._schedule(), 40);
    } catch (e) { this._degrade('start', e); }
  }

  pause() {
    this.playing = false;
    try { this.padEl?.pause(); } catch { /* noop */ }
  }

  _degrade(where, e) {
    this.degraded = true; this.ok = false;
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.onError?.(where, e);
  }

  // 前瞻式音符调度
  _schedule() {
    if (!this.playing || !this.ok) return;
    const beat = 60 / this.bpm;
    while (this._nextNote < this.ctx.currentTime + 0.15) {
      const arousal = (this.a + 1) / 2;
      const density = 0.16 + arousal * 0.62;  // 唤醒越高，琶音越密
      if (Math.random() < density) this._pluck(this._nextNote);
      this._nextNote += beat / 2;             // 八分音符网格
    }
  }

  _pluck(when) {
    try {
      const blend = (this.v + 1) / 2; // 0=纯小调 … 1=纯大调
      const scale = Math.random() < blend ? MAJOR_PENTA : MINOR_PENTA;
      const deg = scale[(Math.random() * scale.length) | 0];
      const oct = Math.random() < 0.3 ? 2 : 1;
      const freq = ROOT * Math.pow(2, deg / 12) * oct;

      const osc = this.ctx.createOscillator();
      osc.type = (this.v + 1) / 2 > 0.5 ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      const g = this.ctx.createGain();
      const peak = 0.05 + (this.a + 1) / 2 * 0.08;
      const dur = 1.2 + (1 - (this.a + 1) / 2) * 2.2; // 低唤醒长尾
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak, when + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 600 + (this.a + 1) / 2 * 2600;
      osc.connect(f).connect(g).connect(this.bus);
      osc.start(when); osc.stop(when + dur + 0.1);
    } catch (e) { this._degrade('pluck', e); }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ok) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  status() {
    if (this.degraded) return 'degraded';
    if (!this.ctx) return 'idle';
    return this.ctx.state === 'running' ? 'running' : this.ctx.state;
  }
}
