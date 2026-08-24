// ————————————————————————————————————————————————
// hud.js · HUD 面板 / 调参台
// ————————————————————————————————————————————————
import { PARAMS } from './config.js';
import { quadrantName, emotionColor, hslCss } from './emotion.js';

const $ = (s) => document.querySelector(s);

// ———— HUD ————
export class Hud {
  constructor() {
    this.el = $('#hud');
    this.cells = {
      v: $('#hud-v'), a: $('#hud-a'), q: $('#hud-q'), p: $('#hud-p'),
      k: $('#hud-k'), e: $('#hud-e'), bpm: $('#hud-bpm'), c: $('#hud-c'), fps: $('#hud-fps'),
    };
    this._acc = 0;
  }
  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }
  // 10Hz 刷新足够，避免 DOM 抖动
  update(dt, s) {
    this._acc += dt;
    if (this._acc < 0.1) return;
    this._acc = 0;
    this.cells.v.textContent = s.v.toFixed(2);
    this.cells.a.textContent = s.a.toFixed(2);
    this.cells.q.textContent = quadrantName(s.v, s.a);
    this.cells.p.textContent = (s.pro * 100).toFixed(1) + '%';
    this.cells.k.textContent = s.kappa.toFixed(2);
    this.cells.e.textContent = (s.energy * 100).toFixed(0) + '%';
    this.cells.bpm.textContent = s.bpm ? s.bpm.toFixed(0) + ' BPM' : '—';
    const c = emotionColor(s.v, s.a, s.redShift);
    this.cells.c.textContent = `hsl(${c.h.toFixed(0)}°)`;
    this.cells.c.style.color = hslCss(c);
    this.cells.fps.textContent = s.fps.toFixed(0);
  }
}

// ———— 调参台（22 项） ————
export class ParamsPanel {
  constructor(params, onChange) {
    this.el = $('#params');
    this.params = params;
    this.onChange = onChange;
    this.outputs = {};
    const body = $('#params-body');
    let group = null;
    for (const p of PARAMS) {
      if (p.group !== group) {
        group = p.group;
        const g = document.createElement('div');
        g.className = 'param-group'; g.textContent = group;
        body.appendChild(g);
      }
      const row = document.createElement('div');
      row.className = 'param-row';
      row.innerHTML = `<label>${p.label}<output>${p.def}</output></label>`;
      const input = document.createElement('input');
      input.type = 'range'; input.min = p.min; input.max = p.max; input.step = p.step; input.value = p.def;
      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        params[p.key] = val;
        this.outputs[p.key].textContent = p.step >= 1 ? val | 0 : val.toFixed(2);
        onChange(p.key, val);
      });
      row.appendChild(input);
      body.appendChild(row);
      this.outputs[p.key] = row.querySelector('output');
    }
    $('#params-reset').addEventListener('click', () => {
      for (const p of PARAMS) {
        params[p.key] = p.def;
        this.outputs[p.key].textContent = p.step >= 1 ? p.def : p.def.toFixed(2);
      }
      this.el.querySelectorAll('input').forEach((inp, i) => { inp.value = PARAMS[i].def; });
      onChange('*', 0);
    });
  }
  toggle() { this.el.classList.toggle('hidden'); }
  get visible() { return !this.el.classList.contains('hidden'); }
  sync(params) {
    for (const p of PARAMS) {
      this.outputs[p.key].textContent = p.step >= 1 ? params[p.key] | 0 : params[p.key].toFixed(2);
    }
  }
}
