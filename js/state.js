// ————————————————————————————————————————————————
// state.js · 偏好持久化 / 旅程状态 / URL 分享与快照
// ————————————————————————————————————————————————
import { STORAGE_KEY, defaultParams, PARAM_MAP } from './config.js';

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* 隐私模式忽略 */ }
}

// —— URL 分享：状态压缩进 hash ——
// #j=v,a,tv,ta,pro,q,skin  （起点 / 终点 / 进度 / 画质 / 皮肤）
export function encodeShareURL(journey, quality, skinId) {
  const u = new URL(location.href);
  const parts = [
    journey.start.v.toFixed(2), journey.start.a.toFixed(2),
    journey.end.v.toFixed(2), journey.end.a.toFixed(2),
    (journey.pro || 0).toFixed(3), quality, skinId || 'abyss',
  ];
  u.hash = 'j=' + parts.join(',');
  return u.toString();
}

export function decodeShareURL() {
  try {
    const m = location.hash.match(/#j=([-\d.,\w]+)/);
    if (!m) return null;
    const [v, a, tv, ta, pro, q, skin] = m[1].split(',');
    return {
      start: { v: parseFloat(v), a: parseFloat(a), label: '分享的起点' },
      end: { v: parseFloat(tv), a: parseFloat(ta), label: '分享的终点' },
      pro: parseFloat(pro) || 0,
      quality: ['standard', 'high', 'cinematic'].includes(q) ? q : null,
      skin: ['abyss', 'dusk', 'moss', 'mist', 'paper'].includes(skin) ? skin : null,
    };
  } catch { return null; }
}

// 参数校验与合并（持久化读取时防御）
export function mergeParams(saved) {
  const p = defaultParams();
  if (saved) {
    for (const k of Object.keys(p)) {
      if (typeof saved[k] === 'number' && PARAM_MAP[k]) {
        p[k] = Math.min(Math.max(saved[k], PARAM_MAP[k].min), PARAM_MAP[k].max);
      }
    }
  }
  return p;
}

// —— 快照：主画布 + 元信息水印 → PNG ——
export function makeSnapshot(stageCanvas, meta) {
  const out = document.createElement('canvas');
  out.width = stageCanvas.width; out.height = stageCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(stageCanvas, 0, 0);
  const r = stageCanvas.width / window.innerWidth; // dpr 比
  // 元信息水印
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = `${12 * r}px ui-monospace, monospace`;
  ctx.textAlign = 'right';
  ctx.fillText(`情绪旅程 · ${meta}`, out.width - 24 * r, out.height - 24 * r);
  return out.toDataURL('image/png');
}
