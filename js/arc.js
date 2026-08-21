// ————————————————————————————————————————————————
// arc.js · 情绪弧线：Russell 平面上的实时计算路径
// 三次贝塞尔 + smoothstep 缓动采样；曲率/切线实时解析求值。
// ————————————————————————————————————————————————
import { smoothstepN } from './emotion.js';

// 由起点/终点与曲率参数构造三次贝塞尔控制点。
// 弯向由「是否需要跨越象限」决定：跨象限的旅程先贴着起点情绪走一段（建立信任），再抬头。
export function buildArc(p0, p1, curvature) {
  const dx = p1.v - p0.v, dy = p1.a - p0.a;
  const len = Math.hypot(dx, dy) || 1e-6;
  // 法向
  const nx = -dy / len, ny = dx / len;
  // 弯向：朝「更低唤醒」一侧弯（弧线先沉下去，再升起 —— 先接住，再带领）
  const side = (p1.a + p0.a) / 2 > 0 ? -1 : 1;
  const bend = curvature * len * 0.5 * side;
  const c1 = { v: p0.v + dx * 0.28 + nx * bend, a: p0.a + dy * 0.28 + ny * bend };
  const c2 = { v: p0.v + dx * 0.72 + nx * bend * 0.7, a: p0.a + dy * 0.72 + ny * bend * 0.7 };
  return { p0: { ...p0 }, p1: { ...p1 }, c1, c2 };
}

// t∈[0,1] 原始参数 → 位置（不带缓动）
export function arcRaw(arc, t) {
  const mt = 1 - t;
  const v = mt ** 3 * arc.p0.v + 3 * mt * mt * t * arc.c1.v + 3 * mt * t * t * arc.c2.v + t ** 3 * arc.p1.v;
  const a = mt ** 3 * arc.p0.a + 3 * mt * mt * t * arc.c1.a + 3 * mt * t * t * arc.c2.a + t ** 3 * arc.p1.a;
  return { v, a };
}

// 带 smoothstep 缓动的旅程采样：播放进度 pro∈[0,1] → 弧上坐标
export function arcPoint(arc, pro, steps = 2) {
  return arcRaw(arc, smoothstepN(pro, steps));
}

// 切线（方向），供粒子牵引与光点朝向
export function arcTangent(arc, pro, steps = 2) {
  const e = 1e-3;
  const a = arcPoint(arc, Math.max(pro - e, 0), steps);
  const b = arcPoint(arc, Math.min(pro + e, 1), steps);
  const dv = b.v - a.v, da = b.a - a.a;
  const l = Math.hypot(dv, da) || 1e-6;
  return { v: dv / l, a: da / l };
}

// 曲率 κ（解析数值解），用于视觉牵引与 HUD
export function arcCurvature(arc, pro, steps = 2) {
  const e = 2e-3;
  const p0 = arcPoint(arc, Math.max(pro - e, 0), steps);
  const p1 = arcPoint(arc, pro, steps);
  const p2 = arcPoint(arc, Math.min(pro + e, 1), steps);
  const d1x = (p2.v - p0.v) / (2 * e), d1y = (p2.a - p0.a) / (2 * e);
  const d2x = (p2.v - 2 * p1.v + p0.v) / (e * e), d2y = (p2.a - 2 * p1.a + p0.a) / (e * e);
  const num = Math.abs(d1x * d2y - d1y * d2x);
  const den = Math.pow(d1x * d1x + d1y * d1y, 1.5) || 1e-6;
  return num / den;
}

// 弧上能量：随进度从起点唤醒爬升到终点唤醒 → 供音频引擎做曲风能量连续渐变
export function arcEnergy(arc, pro, steps = 2) {
  const pt = arcPoint(arc, pro, steps);
  return (pt.a + 1) / 2; // arousal → 0..1
}
