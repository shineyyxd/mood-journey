// ————————————————————————————————————————————————
// emotion.js · Russell 二维情绪平面（valence 愉悦度 × arousal 唤醒度）
// 语义推断 / 象限命名 / 色阶红移 / 场景预设
// ————————————————————————————————————————————————

export const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
export const lerp = (a, b, t) => a + (b - a) * t;
// n 阶 smoothstep：s∘s∘… 越阶越「慢启动、稳着陆」
export function smoothstepN(t, n = 2) {
  let s = clamp(t, 0, 1);
  for (let i = 0; i < n; i++) s = s * s * (3 - 2 * s);
  return s;
}

// 象限命名（Russell 四象限）
export function quadrantName(v, a) {
  if (v >= 0 && a >= 0) return '高唤醒 · 愉悦';   // 兴奋 / 振作
  if (v < 0 && a >= 0) return '高唤醒 · 紧绷';    // 焦虑 / 烦躁
  if (v < 0 && a < 0) return '低唤醒 · 沉郁';     // 疲惫 / 低落
  return '低唤醒 · 松弛';                          // 平静 / 安宁
}

// —— 情绪语义推断：中文关键词 → 平面坐标 ——
const LEXICON = [
  { kw: ['焦虑', '慌', '紧张', '压力', '乱', '烦', '急', '崩', 'deadline'], v: -0.45, a: 0.72 },
  { kw: ['累', '疲', '困', '加班', '麻木', '撑不住', '熬夜', '倦'],        v: -0.55, a: -0.58 },
  { kw: ['难过', '丧', '哭', '失恋', '低落', '伤心', '孤独', '想他', '想她', '委屈'], v: -0.78, a: -0.28 },
  { kw: ['生气', '愤怒', '气死', '火大', '暴躁'],                          v: -0.6,  a: 0.85 },
  { kw: ['平静', '安静', '还好', '一般', '平淡'],                          v: 0.15,  a: -0.35 },
  { kw: ['开心', '高兴', '兴奋', '期待', '棒', '爽'],                      v: 0.72,  a: 0.55 },
  { kw: ['放松', '舒服', '治愈', '暖'],                                    v: 0.55,  a: -0.45 },
  { kw: ['睡', '失眠', '夜深', '深夜'],                                    v: -0.2,  a: -0.65 },
];

export function inferEmotion(text) {
  const t = (text || '').trim();
  for (const e of LEXICON) {
    if (e.kw.some(k => t.includes(k))) {
      return { v: e.v, a: e.a, label: t || '未命名', matched: true };
    }
  }
  // 未命中：说不清的心情 → 轻度偏负、中唤醒（最常见的"需要被接住"区）
  return { v: -0.35, a: -0.15, label: t || '说不清', matched: false };
}

// —— 情绪色阶红移映射 ——
// valence 决定基色（负→冷蓝紫，正→暖金），arousal 做红移：高唤醒把色相拉向红橙并提亮锐化。
export function emotionColor(v, a, redShift = 0.6) {
  // 基色：负 valence 区 蓝(218°)→紫(268°)；正区 金(38°)→青碧(168°)
  let hue, sat, lig;
  if (v < 0) {
    hue = lerp(268, 218, 1 + v);      // v:-1→268 紫, v:0→218 蓝
    sat = 0.34 + 0.1 * -v;            // 收敛蓝紫饱和，避免整屏"蓝得发腻"
    lig = 0.38;
  } else {
    // 正区快速脱离青绿带：v≈0.5 即达暖金，避免芥末绿中间态
    hue = lerp(178, 40, Math.min(v * 1.9, 1));
    sat = 0.5 + 0.15 * v;
    lig = 0.44;
  }
  // 红移：arousal 高 → 色相朝 12°（红橙）偏移，亮度/饱和度提升
  const shift = clamp(a, -1, 1) * redShift;
  if (shift > 0) {
    let d = ((12 - hue + 540) % 360) - 180; // 最短路径
    hue += d * shift * 0.45;
    sat = clamp(sat + shift * 0.22, 0, 1);
    lig = clamp(lig + shift * 0.20, 0, 1);
  } else {
    // 低唤醒：降饱和、压暗 —— 沉郁通透
    sat = clamp(sat + shift * 0.12, 0.15, 1);
    lig = clamp(lig + shift * 0.10, 0.16, 1);
  }
  hue = ((hue % 360) + 360) % 360;
  return { h: hue, s: sat, l: lig };
}

export function hslCss(c, alpha = 1) {
  return `hsla(${c.h.toFixed(1)},${(c.s * 100).toFixed(1)}%,${(c.l * 100).toFixed(1)}%,${alpha})`;
}

// HSL→RGB（0..255），供逐像素渲染
export function hslRgb(c) {
  const h = c.h / 360, s = c.s, l = c.l;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = t => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

// —— 四个情绪场景预设：起点 + 双终点分歧 ——
export const PRESETS = [
  {
    id: 'night', name: '深夜加班', hint: '疲惫 → ？',
    start: { v: -0.55, a: -0.58, label: '深夜的疲惫' },
    endpoints: [
      { v: 0.45, a: -0.62, label: '能睡着的平静', desc: '低唤醒 · 松弛。把今天轻轻放下。' },
      { v: 0.62, a: 0.42,  label: '一点点振作',   desc: '高唤醒 · 愉悦。还剩一点光，攒起来。' },
    ],
  },
  {
    id: 'anxious', name: '心里乱', hint: '紧绷 → ？',
    start: { v: -0.45, a: 0.72, label: '紧绷的焦虑' },
    endpoints: [
      { v: 0.3,  a: -0.4,  label: '松下来的呼吸', desc: '低唤醒 · 松弛。先把心跳放慢。' },
      { v: 0.68, a: 0.35,  label: '笃定的力量',   desc: '高唤醒 · 愉悦。乱，是因为在乎。' },
    ],
  },
  {
    id: 'sad', name: '有点想哭', hint: '低落 → ？',
    start: { v: -0.78, a: -0.28, label: '说不出的难过' },
    endpoints: [
      { v: 0.2,  a: -0.55, label: '被允许的安静', desc: '低唤醒 · 松弛。难过不必马上好。' },
      { v: 0.55, a: 0.1,   label: '回暖的胸口',   desc: '中唤醒 · 愉悦。一点点回温就好。' },
    ],
  },
  {
    id: 'numb', name: '说不清', hint: '混沌 → ？',
    start: { v: -0.35, a: -0.15, label: '说不清的心情' },
    endpoints: [
      { v: 0.4,  a: -0.5,  label: '清澈的平静',   desc: '低唤醒 · 松弛。让水面自己澄清。' },
      { v: 0.7,  a: 0.55,  label: '醒过来的自己', desc: '高唤醒 · 愉悦。把感官重新点亮。' },
    ],
  },
];
