// ————————————————————————————————————————————————
// hud.js · HUD 面板 / 调参台 / Russell 圆盘（可拖拽）
// ————————————————————————————————————————————————
import { PARAMS } from './config.js';
import { quadrantName, emotionColor, hslCss, clamp } from './emotion.js';

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

// ———— 调参台（21 项） ————
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

// ———— Russell 圆盘：自由拖拽当前情绪点 ————
export class Disc {
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cb = callbacks; // { onDrag(v,a), onEndpoint(i) }
    this.point = { v: 0, a: 0 };
    this.arc = null; this.pro = 0; this.endpoints = null;
    this.dragging = false;
    this.hoverEnd = -1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bind();
  }

  resize() {
    const size = this.canvas.clientWidth || 208;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.size = size; this.dpr = dpr;
    this.canvas.width = size * dpr; this.canvas.height = size * dpr;
  }

  toScreen(p) {
    const c = this.size / 2, r = this.size * 0.42;
    return { x: (c + p.v * r) * this.dpr, y: (c - p.a * r) * this.dpr };
  }
  toPlane(x, y) {
    const c = this.size / 2, r = this.size * 0.42;
    const rect = this.canvas.getBoundingClientRect();
    const px = x - rect.left, py = y - rect.top;
    return { v: clamp((px - c) / r, -1, 1), a: clamp(-(py - c) / r, -1, 1) };
  }

  bind() {
    const down = (x, y) => {
      // 命中终点节点 → 切换终点；否则拖拽当前点
      if (this.endpoints) {
        for (let i = 0; i < this.endpoints.length; i++) {
          const p = this.toScreen(this.endpoints[i]);
          const rect = this.canvas.getBoundingClientRect();
          const dx = (x - rect.left) * this.dpr - p.x, dy = (y - rect.top) * this.dpr - p.y;
          if (Math.hypot(dx, dy) < 18 * this.dpr) { this.cb.onEndpoint(i); return; }
        }
      }
      this.dragging = true;
      this.emitDrag(x, y);
    };
    const move = (x, y) => { if (this.dragging) this.emitDrag(x, y); };
    const up = () => { this.dragging = false; };

    this.canvas.addEventListener('pointerdown', e => { this.canvas.setPointerCapture(e.pointerId); down(e.clientX, e.clientY); });
    this.canvas.addEventListener('pointermove', e => move(e.clientX, e.clientY));
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  emitDrag(x, y) {
    const p = this.toPlane(x, y);
    this.point = p;
    this.cb.onDrag(p.v, p.a);
  }

  draw(redShift, light = false) {
    const ctx = this.ctx;
    const ink = (a) => light ? `rgba(26,30,40,${a})` : `rgba(255,255,255,${a})`;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const c = this.size / 2 * this.dpr, R = this.size * 0.42 * this.dpr;

    // 盘面：四象限底色（按各自象限中央情绪着色，极淡）
    for (let qv = 0; qv < 2; qv++) for (let qa = 0; qa < 2; qa++) {
      const v = qv ? 0.5 : -0.5, a = qa ? 0.5 : -0.5;
      const col = emotionColor(v, a, redShift);
      ctx.fillStyle = hslCss(col, 0.10);
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, (qa ? Math.PI : 0) + (qv ? 0 : Math.PI / 2), (qa ? Math.PI : 0) + (qv ? Math.PI / 2 : Math.PI));
      ctx.closePath(); ctx.fill();
    }
    // 外环与轴线
    ctx.strokeStyle = ink(0.25); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(c, c, R, 0, 7); ctx.stroke();
    ctx.strokeStyle = ink(0.12);
    ctx.beginPath(); ctx.moveTo(c - R, c); ctx.lineTo(c + R, c); ctx.moveTo(c, c - R); ctx.lineTo(c, c + R); ctx.stroke();

    // 轴标
    ctx.fillStyle = ink(0.35);
    ctx.font = `${9 * this.dpr}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('V+', c + R - 8 * this.dpr, c - 5 * this.dpr);
    ctx.fillText('V−', c - R + 8 * this.dpr, c - 5 * this.dpr);
    ctx.fillText('A+', c + 10 * this.dpr, c - R + 10 * this.dpr);
    ctx.fillText('A−', c + 10 * this.dpr, c + R - 4 * this.dpr);

    // 缩略弧线
    if (this.arc) {
      ctx.beginPath();
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        const mt = 1 - t;
        const v = mt ** 3 * this.arc.p0.v + 3 * mt * mt * t * this.arc.c1.v + 3 * mt * t * t * this.arc.c2.v + t ** 3 * this.arc.p1.v;
        const a = mt ** 3 * this.arc.p0.a + 3 * mt * mt * t * this.arc.c1.a + 3 * mt * t * t * this.arc.c2.a + t ** 3 * this.arc.p1.a;
        const p = this.toScreen({ v, a });
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
      }
      ctx.strokeStyle = ink(0.5); ctx.lineWidth = 1.2 * this.dpr; ctx.stroke();
    }

    // 可选终点节点（发光）
    if (this.endpoints) {
      this.endpoints.forEach((e, i) => {
        const p = this.toScreen(e);
        const col = emotionColor(e.v, e.a, redShift);
        ctx.fillStyle = hslCss(col, 0.9);
        ctx.beginPath(); ctx.arc(p.x, p.y, 5 * this.dpr, 0, 7); ctx.fill();
        ctx.strokeStyle = hslCss(col, 0.4);
        ctx.beginPath(); ctx.arc(p.x, p.y, 9 * this.dpr, 0, 7); ctx.stroke();
      });
    }

    // 当前点
    const p = this.toScreen(this.point);
    const cc = emotionColor(this.point.v, this.point.a, redShift);
    ctx.fillStyle = hslCss(cc, 1);
    ctx.beginPath(); ctx.arc(p.x, p.y, 6 * this.dpr, 0, 7); ctx.fill();
    ctx.fillStyle = light ? '#1a1e26' : '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * this.dpr, 0, 7); ctx.fill();
  }
}
