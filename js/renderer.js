// ————————————————————————————————————————————————
// renderer.js · Canvas 2D 渲染内核
// 程序化流体背景 + ACES 电影级色调映射 + 暗角 + 磁带颗粒 + 色散
// 黑胶盘面（盘面即 Russell 平面投影，纹理层自转）/ 弧线辉光 / 光点追踪 / 粒子曲率牵引 / 调试视图
// ————————————————————————————————————————————————
import { fbm } from '../vendor/noise.js';
import { emotionColor, hslRgb, hslCss, clamp, lerp } from './emotion.js';
import { arcPoint, arcTangent, arcCurvature } from './arc.js';

// ACES filmic tonemap（Narkowicz 拟合）
function aces(x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
}

// 平面坐标 → 屏幕坐标（盘面合一：Russell 正方形 [-1,1]² 四角恰好内接唱片盘面）
export function makeProjector(W, H) {
  const cx = W * 0.5, cy = H * 0.52;
  const radius = Math.min(W, H) * 0.40;
  const scale = radius / Math.SQRT2;
  return {
    toScreen(p) { return { x: cx + p.v * scale, y: cy - p.a * scale }; },
    scale, cx, cy, radius, // cx/cy/radius 供盘面拖拽命中测试复用
  };
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.bg = document.createElement('canvas');      // 低分辨率流体缓冲
    this.bgCtx = this.bg.getContext('2d');
    this.particles = [];
    this.t = 0;
    this.fps = 60;
    this.spinAngle = 0;   // 盘面自转角（仅纹理层随转）
    this.spinVel = 0;     // 自转速度（缓动逼近目标）
    this.discAlpha = 0.4; // 盘面整体透明度（非旅程态淡出）
    this._lastFrame = performance.now();
    this.resize();
  }

  resize(quality) {
    const dpr = Math.min(window.devicePixelRatio || 1, quality ? quality.dprCap : 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = this.W * dpr; this.canvas.height = this.H * dpr;
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
    this.dpr = dpr;
  }

  resizeBg(quality) {
    this.bgW = Math.max(96, Math.round(this.W / quality.bgDiv));
    this.bgH = Math.max(54, Math.round(this.H / quality.bgDiv));
    this.bg.width = this.bgW; this.bg.height = this.bgH;
    this.bgImg = this.bgCtx.createImageData(this.bgW, this.bgH);
  }

  ensureParticles(n) {
    while (this.particles.length < n) {
      this.particles.push({
        x: Math.random() * this.W, y: Math.random() * this.H,
        vx: 0, vy: 0, life: Math.random(),
      });
    }
    if (this.particles.length > n) this.particles.length = n;
  }

  // —— 主绘制 ——
  // state: { arc, pro, steps, params, quality, debug, paused }
  draw(state, dt) {
    const { params: P, quality: Q } = state;
    this.t += dt * P.flowSpeed;

    // FPS 估算
    const now = performance.now();
    this.fps = lerp(this.fps, 1000 / Math.max(now - this._lastFrame, 1), 0.05);
    this._lastFrame = now;

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const cur = state.arc ? arcPoint(state.arc, state.pro, P.smoothSteps) : state.freePoint;
    const cc = emotionColor(cur.v, cur.a, P.redShift);

    // 盘面自转：缓动逼近目标转速，暂停平滑停转、无跳变
    const spinTarget = state.playing ? P.spinSpeed : 0;
    this.spinVel = lerp(this.spinVel, spinTarget, 1 - Math.exp(-dt * 2));
    this.spinAngle += this.spinVel * dt * (Math.PI / 9); // spinSpeed=1 → 约 18 秒/圈

    // 非旅程态盘面淡出（入口屏文字压在盘面上仍可读）
    this.discAlpha = lerp(this.discAlpha, state.arc ? 1 : 0.4, 1 - Math.exp(-dt * 4));

    this.renderFluid(cur, cc, state);

    // 上屏不做额外柔化（分辨率已足够，保留噪声细节）
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(this.bg, 0, 0, this.bgW, this.bgH, 0, 0, this.W, this.H);

    // 盘面组：唱片 / 弧线 / 粒子 / 光点整体随 discAlpha 淡入淡出
    ctx.save();
    ctx.globalAlpha = this.discAlpha;
    this.drawDisc(state, cur, cc);
    if (state.arc) {
      this.drawArc(state, cur, cc);
      this.drawParticles(state, cur, cc);
    }
    this.drawDot(state, cur, cc); // 始终绘制：无旅程时 freePoint 光点供拖拽反馈
    ctx.restore();

    // 色散：主画布自叠印（High/Cinematic）
    if (Q.aberration && P.aberration > 0.05) {
      const ab = P.aberration;
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.06 + ab * 0.02;
      ctx.drawImage(this.canvas, ab, 0, this.W, this.H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.05 + ab * 0.015;
      ctx.drawImage(this.canvas, -ab, ab * 0.6, this.W, this.H);
      ctx.restore();
    }

    if (state.debug > 0) this.drawDebug(state, cur);
  }

  // —— 流体背景（干净版：大尺度低频渐变场 × 皮肤底色 × ACES × 暗角）——
  renderFluid(cur, cc, state) {
    const { params: P, quality: Q, skin } = state;
    const { bgW: W, bgH: H } = this;
    const data = this.bgImg.data;
    const oct = Q.octaves;
    const sc = 1.6 * P.noiseScale;
    const t = this.t * 0.16;
    const turb = P.turbulence * (0.6 + 0.4 * ((cur.a + 1) / 2)); // 高唤醒 → 更湍急
    const expo = P.exposure;
    const vig = P.vignette;
    const grain = P.grain;
    const arousal = (cur.a + 1) / 2;
    const base = skin ? skin.rgb : [5, 7, 13];
    const light = skin?.mode === 'light';
    // 房间光：深色皮肤把情绪色场的色相拉向皮肤主色相（最短路径环形插值）
    let fieldColor = cc;
    if (!light && skin) {
      const d = ((skin.hue - cc.h + 540) % 360) - 180;
      fieldColor = { ...cc, h: ((cc.h + d * 0.45) % 360 + 360) % 360 };
    }
    const rgb = hslRgb(fieldColor);
    // 皮肤底色浸入暗部
    const tintK = light ? 0 : 0.26;
    const tint = base.map(c => Math.min(c * 3.2, 80));
    const rgbT = rgb.map((c, i) => lerp(c, tint[i], tintK));

    let i = 0;
    for (let y = 0; y < H; y++) {
      const ny = y / H - 0.5;
      for (let x = 0; x < W; x++) {
        const nx = x / W - 0.5;
        // 纯净低频流场：只有大尺度涌动，无细颗粒纹理
        const n1 = fbm(x / W * sc + t, y / H * sc - t * 0.7, t * 0.35, oct);
        const n2 = fbm(x / W * sc - t * 0.6 + 5.2, y / H * sc + t * 0.5, t * 0.3 + 2.7, Math.max(2, oct - 1));
        let f = 0.5 + 0.5 * (n1 * 0.7 + n2 * 0.5) * turb;
        f = clamp(f, 0, 1);
        f = f * f * (3 - 2 * f); // 场平滑

        let r, g, b;
        if (!light) {
          // 深色皮肤：皮肤底色 → 情绪色（已被皮肤光染色）
          const lift = 0.30 + arousal * 0.55;
          r = (base[0] + (rgbT[0] - base[0]) * f) / 255 * lift;
          g = (base[1] + (rgbT[1] - base[1]) * f) / 255 * lift;
          b = (base[2] + (rgbT[2] - base[2]) * f) / 255 * lift;
        } else {
          // 浅色皮肤：亮色纸面被情绪色轻轻染色
          const lr = lerp(rgb[0], 255, 0.35), lg = lerp(rgb[1], 255, 0.35), lb = lerp(rgb[2], 255, 0.35);
          r = (base[0] + (lr - base[0]) * f * 0.62) / 255;
          g = (base[1] + (lg - base[1]) * f * 0.62) / 255;
          b = (base[2] + (lb - base[2]) * f * 0.62) / 255;
        }

        // ACES 色调映射（带曝光）
        r = aces(r * expo); g = aces(g * expo); b = aces(b * expo);

        // 边缘暗角
        if (vig > 0.01) {
          const d = Math.sqrt(nx * nx + ny * ny) * 1.6;
          const v = 1 - vig * clamp(d * d - 0.15, 0, 1) * (light ? 0.4 : 0.85);
          r *= v; g *= v; b *= v;
        }

        // 模拟磁带颗粒（默认关闭，调参台可手动加回）
        if (grain > 0.01) {
          const gr = (Math.random() - 0.5) * grain * 0.10;
          r = clamp(r + gr, 0, 1); g = clamp(g + gr, 0, 1); b = clamp(b + gr, 0, 1);
        }

        data[i++] = r * 255; data[i++] = g * 255; data[i++] = b * 255; data[i++] = 255;
      }
    }
    this.bgCtx.putImageData(this.bgImg, 0, 0);
  }

  // —— 黑胶盘面：盘面即 Russell 平面投影，仅 grooves/光泽/标签等纹理层自转 ——
  drawDisc(state, cur, cc) {
    const { params: P, skin } = state;
    const light = skin?.mode === 'light';
    const ctx = this.ctx;
    const proj = makeProjector(this.W, this.H);
    const { cx, cy, radius: R } = proj;
    const base = skin?.rgb || [5, 7, 13];
    const ink = (a) => light ? `rgba(26,30,40,${a})` : `rgba(255,255,255,${a})`;
    // 盘体底色：深色皮肤由皮肤底色调暗（微透流体背景），纸白用奶油色
    const bodyRgb = light ? [247, 244, 236] : base.map(c => Math.round(c * 0.5));

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7);
    ctx.fillStyle = `rgba(${bodyRgb},${light ? 0.94 : 0.88})`;
    ctx.fill();

    // —— 旋转纹理层：clip 盘面后 translate+rotate；Russell 映射/弧线/光点不随转 ——
    ctx.save();
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(this.spinAngle);

    // 同心圆 grooves（细、淡）
    ctx.lineWidth = 1;
    ctx.strokeStyle = light ? 'rgba(26,30,40,0.06)' : 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 26; i++) {
      const r = R * (0.16 + 0.81 * (i / 25));
      ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke();
    }

    // 一瓣极淡的光泽扫掠扇形：纯同心圆旋转不可见，扫掠让自转可感知
    const sheen = ctx.createConicGradient(0, 0, 0);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.05, `rgba(255,255,255,${light ? 0.10 : 0.055})`);
    sheen.addColorStop(0.10, 'rgba(255,255,255,0)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-R, -R, R * 2, R * 2);

    // 中心标签：底色亮一档 + 细描边 + 情绪色细环 + 偏心标记点 + 轴孔
    const lr = R * 0.11;
    const labelRgb = light ? bodyRgb : bodyRgb.map(c => Math.min(c + 24, 255));
    ctx.beginPath(); ctx.arc(0, 0, lr, 0, 7);
    ctx.fillStyle = `rgb(${labelRgb})`;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink(0.22);
    ctx.stroke();
    // 标签边缘一圈情绪色细环（标签本体不实心填充情绪色）
    const ringRgb = hslRgb(cc).map(Math.round);
    ctx.beginPath(); ctx.arc(0, 0, lr - 3, 0, 7);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(${ringRgb},0.9)`;
    ctx.stroke();
    // 偏心标记点：标签自转的指针
    ctx.beginPath(); ctx.arc(lr * 0.5, 0, Math.max(R * 0.008, 2), 0, 7);
    ctx.fillStyle = ink(0.5);
    ctx.fill();
    // 中心轴孔
    ctx.beginPath(); ctx.arc(0, 0, Math.max(R * 0.02, 3), 0, 7);
    ctx.fillStyle = light ? '#f3f0ea' : `rgb(${base.map(c => Math.round(c * 0.3))})`;
    ctx.fill();

    ctx.restore(); // 出旋转纹理层

    // —— 屏幕静止层：象限语义不随盘面旋转 ——
    if (light) {
      // 纸白：极淡四象限暗示（深色皮肤不画——试过，浑浊发黄很脏）
      for (let qv = 0; qv < 2; qv++) for (let qa = 0; qa < 2; qa++) {
        const col = emotionColor(qv ? 0.5 : -0.5, qa ? 0.5 : -0.5, P.redShift);
        ctx.fillStyle = hslCss(col, 0.06);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, (qa ? Math.PI : 0) + (qv ? 0 : Math.PI / 2), (qa ? Math.PI : 0) + (qv ? Math.PI / 2 : Math.PI));
        ctx.closePath(); ctx.fill();
      }
    }
    // 象限轴线（深色下极淡）
    ctx.strokeStyle = ink(light ? 0.10 : 0.045);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    // 盘面外缘
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7);
    ctx.strokeStyle = ink(light ? 0.25 : 0.30);
    ctx.stroke();

    ctx.restore();
  }

  // —— 弧线：辉光描边（多层叠加，无 shadowBlur 性能陷阱）——
  drawArc(state, cur, cc) {
    const { arc, pro, params: P, skin } = state;
    const light = skin?.mode === 'light';
    const inkSoft = light ? 'rgba(26,30,40,0.22)' : 'rgba(255,255,255,0.10)';
    const ctx = this.ctx;
    const proj = makeProjector(this.W, this.H);
    const N = 72;
    const pts = [];
    for (let i = 0; i <= N; i++) pts.push(proj.toScreen(arcPoint(arc, i / N, P.smoothSteps)));

    ctx.save();
    // 盘面圆形 clip：防辉光溢出唱片
    ctx.beginPath(); ctx.arc(proj.cx, proj.cy, proj.radius, 0, 7); ctx.clip();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    const col = (a) => `rgba(${hslRgb(cc).map(Math.round).join(',')},${a})`;

    // 未走段（全程）——细而弱
    ctx.beginPath();
    pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = inkSoft;
    ctx.lineWidth = Math.max(P.arcWidth * 0.4, 1);
    ctx.stroke();

    // 已走段：三层辉光（浅色皮肤上增强密度，保证可读）
    const upto = Math.max(2, Math.floor(pro * N));
    if (upto > 1) {
      const boost = light ? 1.7 : 1;
      const layers = [
        { w: P.arcWidth * 6, a: 0.08 * P.glow * boost },
        { w: P.arcWidth * 2.6, a: 0.24 * P.glow * boost },
        { w: P.arcWidth, a: 0.95 },
      ];
      for (const L of layers) {
        ctx.beginPath();
        for (let i = 0; i <= upto; i++) i ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = col(L.a);
        ctx.lineWidth = L.w;
        ctx.stroke();
      }
    }

    // 起终点节点
    const s = proj.toScreen(arc.p0), e = proj.toScreen(arc.p1);
    this.node(s, 5, light ? 'rgba(26,30,40,0.55)' : 'rgba(255,255,255,0.5)');
    this.node(e, 6, col(0.95));
    ctx.restore();
  }

  node(p, r, fill) {
    const ctx = this.ctx;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fillStyle = fill; ctx.fill();
  }

  // —— 播放光点：沿弧追踪，呼吸光晕 ——
  drawDot(state, cur, cc) {
    const ctx = this.ctx;
    const light = state.skin?.mode === 'light';
    const proj = makeProjector(this.W, this.H);
    const p = proj.toScreen(cur);
    const breath = 0.5 + 0.5 * Math.sin(this.t * 1.4);
    const rgb = hslRgb(cc).map(Math.round);
    const glowA = light ? 0.22 : 0.5; // 浅色皮肤收敛光晕，避免糊成墨团
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 46 + breath * 18);
    g.addColorStop(0, `rgba(${rgb},${glowA})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, 46 + breath * 18, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, 7);
    ctx.fillStyle = light ? '#1a1e26' : '#fff';
    ctx.fill();
  }

  // —— 粒子：情绪曲率视觉牵引 ——
  drawParticles(state, cur, cc) {
    const { arc, pro, params: P, skin } = state;
    const light = skin?.mode === 'light';
    const ctx = this.ctx;
    const proj = makeProjector(this.W, this.H);
    this.ensureParticles(P.particles | 0);
    const rgb = hslRgb(cc).map(Math.round);
    const kappa = arcCurvature(arc, pro, P.smoothSteps);
    const dot = proj.toScreen(cur);
    const tang = arcTangent(arc, pro, P.smoothSteps);
    const tvx = tang.v * proj.scale, tvy = -tang.a * proj.scale;
    const tl = Math.hypot(tvx, tvy) || 1;

    ctx.save();
    for (const pt of this.particles) {
      // 漂向光点，受弧切线与曲率牵引
      const dx = dot.x - pt.x, dy = dot.y - pt.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = P.pullForce * clamp(1 - d / (this.W * 0.55), 0, 1);
      const swirl = (kappa * 0.15 + 0.12) * pull;
      pt.vx += (dx / d) * pull * 0.5 + (tvx / tl) * swirl * 8 + (Math.random() - 0.5) * 0.1;
      pt.vy += (dy / d) * pull * 0.5 + (tvy / tl) * swirl * 8 + (Math.random() - 0.5) * 0.1;
      pt.vx *= 0.94; pt.vy *= 0.94;
      pt.x += pt.vx; pt.y += pt.vy;
      pt.life -= 0.002;
      if (pt.life <= 0 || pt.x < -20 || pt.x > this.W + 20 || pt.y < -20 || pt.y > this.H + 20) {
        pt.x = Math.random() * this.W; pt.y = Math.random() * this.H;
        pt.vx = pt.vy = 0; pt.life = 0.5 + Math.random() * 0.5;
      }
      const a = (0.10 + pull * 0.35) * (light ? 0.5 : 1); // 浅色上粒子减半，避免像浮尘
      ctx.fillStyle = `rgba(${rgb},${a.toFixed(3)})`;
      ctx.fillRect(pt.x, pt.y, 1.6, 1.6);
    }
    ctx.restore();
  }

  // —— 调试视图 0–9 ——
  drawDebug(state, cur) {
    const ctx = this.ctx;
    const proj = makeProjector(this.W, this.H);
    ctx.save();
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const d = state.debug;
    if (d === 1 || d === 9) { // 象限网格
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      for (let i = -4; i <= 4; i++) {
        const a = proj.toScreen({ v: i / 4, a: -1 }), b = proj.toScreen({ v: i / 4, a: 1 });
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        const c = proj.toScreen({ v: -1, a: i / 4 }), e = proj.toScreen({ v: 1, a: i / 4 });
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      }
    }
    if ((d === 2 || d === 9) && state.arc) { // 曲率热力
      for (let i = 0; i <= 40; i++) {
        const pro = i / 40;
        const k = arcCurvature(state.arc, pro, state.params.smoothSteps);
        const p = proj.toScreen(arcPoint(state.arc, pro, state.params.smoothSteps));
        ctx.fillStyle = `rgba(255,${Math.round(255 - clamp(k * 4, 0, 1) * 200)},80,0.8)`;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
    }
    if (d === 3 || d === 9) { // 噪声场数值
      const n = fbm(this.t % 10, this.t * 0.3 % 10, 1.7, 2);
      ctx.fillText(`noise=${n.toFixed(3)} t=${this.t.toFixed(1)}`, 20, 92);
    }
    if (d === 4 || d === 9) ctx.fillText(`particles=${this.particles.length}`, 20, 106);
    if (d === 5 || d === 9) ctx.fillText(`audio=${state.audioStatus}`, 20, 120);
    if (d === 6 || d === 9) ctx.fillText(`fps=${this.fps.toFixed(0)} dpr=${this.dpr}`, 20, 134);
    if (d === 7 || d === 9) { // 色阶标尺
      for (let i = 0; i <= 20; i++) {
        const c = emotionColor(-1 + i / 10, cur.a, state.params.redShift);
        const rgb = hslRgb(c).map(Math.round);
        ctx.fillStyle = `rgb(${rgb})`;
        ctx.fillRect(20 + i * 14, 148, 12, 10);
      }
    }
    if (d === 8 || d === 9) { // 安全区
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.strokeRect(this.W * 0.05, this.H * 0.05, this.W * 0.9, this.H * 0.9);
    }
    ctx.restore();
  }
}
