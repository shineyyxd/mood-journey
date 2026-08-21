// ————————————————————————————————————————————————
// main.js · CLAUDIO FM 主控
// 旅程状态机：entry → fork → journey → landing
// 自动演示循环 / 三档画质 / 持久化 / 分享 / 快照 / 降级
// ————————————————————————————————————————————————
import { PARAM_MAP, QUALITY, QUALITY_ORDER, defaultParams } from './config.js';
import { inferEmotion, emotionColor, quadrantName, PRESETS, clamp, smoothstepN } from './emotion.js';
import { buildArc, arcPoint, arcCurvature, arcEnergy } from './arc.js';
import { Renderer } from './renderer.js';
import { AudioEngine } from './audio.js';
import { Hud, ParamsPanel, Disc } from './hud.js';
import { bindKeys } from './input.js';
import { loadPrefs, savePrefs, mergeParams, encodeShareURL, decodeShareURL, makeSnapshot } from './state.js';
import { SKINS, getSkin } from './skins.js';

const $ = (s) => document.querySelector(s);

// ———— 全局状态 ————
const prefs = loadPrefs() || {};
const state = {
  screen: 'entry',          // entry | fork | journey
  params: mergeParams(prefs.params),
  qualityKey: prefs.quality || 'high',
  skinId: prefs.skin || 'abyss',
  arc: null,
  pro: prefs.journey?.pro || 0,
  playing: false,
  demo: false,
  debug: 0,
  journey: null,            // { start, end, endpoints, startedAt }
  forkChoice: null,
  freePoint: { v: -0.1, a: -0.15 }, // 无旅程时圆盘自由点（微冷中性，不偏丧）
  elapsed: 0,
};

const quality = () => QUALITY[state.qualityKey];
const skin = () => getSkin(state.skinId);

// ———— 皮肤 ————
function applySkin(id, silent = false) {
  state.skinId = id;
  document.body.className = `skin-${id}`;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', getSkin(id).base);
  document.querySelectorAll('#skin-dots button').forEach(b => {
    b.classList.toggle('active', b.dataset.skin === id);
  });
  if (!silent) { toast(`皮肤 · ${getSkin(id).name}`); persist(); }
}
function cycleSkin() {
  const i = SKINS.findIndex(s => s.id === state.skinId);
  applySkin(SKINS[(i + 1) % SKINS.length].id);
}
// 顶栏皮肤圆点
SKINS.forEach(s => {
  const b = document.createElement('button');
  b.dataset.skin = s.id;
  b.title = s.name;
  b.style.setProperty('--dot', s.base);
  b.addEventListener('click', () => applySkin(s.id));
  $('#skin-dots').appendChild(b);
});
applySkin(state.skinId, true);

// ———— 子系统 ————
const renderer = new Renderer($('#stage'));
renderer.resizeBg(quality());
const audio = new AudioEngine();
audio._brightness = state.params.brightness;
audio._tempoBase = state.params.tempoBase;
const hud = new Hud();
const disc = new Disc($('#disc'), {
  onDrag(v, a) {
    // 拖拽 = 自由重锚定：旅程中改写当前坐标
    if (state.screen === 'journey' && state.arc) {
      state.journey.start = { v, a, label: quadrantName(v, a) };
      state.arc = buildArc(state.journey.start, state.journey.end, state.params.curvature);
      state.pro = 0; state.elapsed = 0;
      toast('已重新锚定起点');
    } else {
      state.freePoint = { v, a };
    }
    persist();
  },
  onEndpoint(i) {
    if (state.journey?.endpoints) chooseEndpoint(i);
  },
});
const paramsPanel = new ParamsPanel(state.params, onParamChange);

audio.onError = (where) => {
  $('#audio-badge').textContent = 'DEGRADED';
  $('#audio-badge').className = 'badge-err';
  toast(`音频链路降级（${where}），视觉旅程继续`);
};

// ———— 入口屏 ————
const CHIPS = ['累了', '心里乱', '有点想哭', '说不清'];
CHIPS.forEach(c => {
  const b = document.createElement('button');
  b.textContent = c;
  b.addEventListener('click', () => beginFromText(c));
  $('#entry-chips').appendChild(b);
});
PRESETS.forEach(p => {
  const b = document.createElement('button');
  b.textContent = `${p.name} · ${p.hint}`;
  b.addEventListener('click', () => beginFromPreset(p));
  $('#entry-presets').appendChild(b);
});
$('#entry-go').addEventListener('click', () => beginFromText($('#entry-input').value));
$('#entry-input').addEventListener('keydown', e => { if (e.key === 'Enter') beginFromText(e.target.value); });

function beginFromText(text) {
  const emo = inferEmotion(text);
  // 语义推断的起点，配一对通用双终点
  const endpoints = [
    { v: 0.42, a: -0.55, label: '能呼吸的平静', desc: '低唤醒 · 松弛。先让一切慢下来。' },
    { v: 0.66, a: 0.45,  label: '轻一点的振作', desc: '高唤醒 · 愉悦。把力气一点点找回来。' },
  ];
  offerFork({ v: emo.v, a: emo.a, label: text.trim() || '此刻' }, endpoints);
}

function beginFromPreset(preset) {
  offerFork({ ...preset.start }, preset.endpoints);
}

// ———— 双终点分歧 ————
function offerFork(start, endpoints) {
  state.pending = { start, endpoints };
  $('#entry').classList.add('hidden');
  const fork = $('#fork');
  fork.classList.remove('hidden');
  [['#fork-a', 0], ['#fork-b', 1]].forEach(([sel, i]) => {
    const card = $(sel);
    const e = endpoints[i];
    const c = emotionColor(e.v, e.a, state.params.redShift);
    card.querySelector('.fc-name')?.remove; // 防重复
    card.innerHTML = `
      <span class="fc-name" style="color:${`hsl(${c.h.toFixed(0)},${(c.s*100)|0}%,${Math.max(c.l*100+22,60)|0}%)`}">「${e.label}」</span>
      <span class="fc-desc">${e.desc}</span>
      <span class="fc-coord">V ${e.v.toFixed(2)} · A ${e.a.toFixed(2)}</span>`;
    card.onclick = () => chooseEndpoint(i);
  });
  disc.endpoints = endpoints;
}

function chooseEndpoint(i) {
  const { start, endpoints } = state.pending;
  const end = endpoints[i];
  state.journey = {
    start, end, endpoints,
    startedAt: Date.now(),
  };
  state.arc = buildArc(start, end, state.params.curvature);
  state.pro = 0; state.elapsed = 0;
  state.screen = 'journey';
  $('#fork').classList.add('hidden');
  hud.show();
  startPlayback();
  toast(`目的地：「${end.label}」`);
  persist();
}

// ———— 播放控制 ————
function startPlayback() {
  state.playing = true;
  audio.init('./audio/pad_low.mp3');
  if (audio.ok) {
    audio.setVolumes(state.params.masterVol, state.params.padVol, state.params.padOn);
    audio.start();
    updateAudioBadge();
  } else if (!audio.ctx) {
    $('#audio-gate').classList.remove('hidden');
  }
}
function updateAudioBadge() {
  const badge = $('#audio-badge');
  const st = audio.status();
  badge.textContent = st === 'running' ? 'ON AIR' : st.toUpperCase();
  badge.className = st === 'running' ? 'badge-ok' : st === 'degraded' ? 'badge-err' : 'badge-warn';
}
$('#audio-gate-btn').addEventListener('click', () => {
  audio.init('./audio/pad_low.mp3');
  audio.setVolumes(state.params.masterVol, state.params.padVol, state.params.padOn);
  audio.start();
  updateAudioBadge();
  $('#audio-gate').classList.add('hidden');
});

// ———— 参数变更 ————
function onParamChange(key, val) {
  if (key === 'brightness') audio.setBrightness(val);
  if (key === 'tempoBase') audio.setTempoBase(val);
  if (['masterVol', 'padVol', 'padOn'].includes(key) || key === '*') {
    audio.setVolumes(state.params.masterVol, state.params.padVol, state.params.padOn);
  }
  if (key === 'curvature' && state.journey) {
    state.arc = buildArc(state.journey.start, state.journey.end, val);
  }
  persist();
}

// ———— 画质 ————
function cycleQuality() {
  const i = QUALITY_ORDER.indexOf(state.qualityKey);
  state.qualityKey = QUALITY_ORDER[(i + 1) % QUALITY_ORDER.length];
  renderer.resize(quality());
  renderer.resizeBg(quality());
  $('#quality-badge').textContent = quality().name;
  toast(`画质 · ${quality().name}`);
  persist();
}
$('#quality-badge').textContent = quality().name;

// ———— 演示循环 ————
let demoTimer = null;
function toggleDemo() {
  state.demo = !state.demo;
  toast(state.demo ? '演示循环 · 开' : '演示循环 · 关');
  if (state.demo) runDemoStep(0);
  else if (demoTimer) { clearTimeout(demoTimer); demoTimer = null; }
}
function runDemoStep(i) {
  if (!state.demo) return;
  const preset = PRESETS[i % PRESETS.length];
  beginFromPreset(preset);
  chooseEndpoint(i % 2);
  state.params.journeySec = Math.max(state.params.journeySec, 45);
  demoTimer = setTimeout(() => runDemoStep(i + 1), state.params.journeySec * 1000 + 4000);
}

// ———— 快捷键 ————
bindKeys({
  space() {
    if (state.screen !== 'journey') return;
    state.playing = !state.playing;
    state.playing ? (audio.start(), toast('继续')) : (audio.pause(), toast('悬停在此刻'));
  },
  enter() { if (state.screen === 'entry') beginFromText($('#entry-input').value); },
  demo: toggleDemo,
  quality: cycleQuality,
  skin: cycleSkin,
  params: () => paramsPanel.toggle(),
  mute() { if (audio.ok) toast(audio.toggleMute() ? '已静音' : '声音恢复'); },
  snapshot: doSnapshot,
  share: doShare,
  reset: backToEntry,
  help: () => $('#help').classList.toggle('hidden'),
  escape: () => { $('#help').classList.add('hidden'); $('#params').classList.add('hidden'); },
  debug(n) { state.debug = n; toast(n === 0 ? '调试视图 · 关' : `调试视图 · ${n}`); },
});
$('#help-close').addEventListener('click', () => $('#help').classList.add('hidden'));

// ———— 分享 / 快照 ————
async function doShare() {
  if (!state.journey) { toast('还没有旅程可分享'); return; }
  const url = encodeShareURL({ start: state.journey.start, end: state.journey.end, pro: state.pro }, state.qualityKey, state.skinId);
  try { await navigator.clipboard.writeText(url); toast('分享链接已复制'); }
  catch { prompt('复制分享链接：', url); }
}
function doSnapshot() {
  const meta = state.journey
    ? `${state.journey.start.label} → ${state.journey.end.label}`
    : 'FREE DRIFT';
  const url = makeSnapshot(renderer.canvas, disc.canvas, meta);
  const a = document.createElement('a');
  a.href = url; a.download = `claudio-fm-${Date.now()}.png`; a.click();
  toast('快照已生成');
}

function backToEntry() {
  state.screen = 'entry'; state.journey = null; state.arc = null;
  state.playing = false; state.pro = 0;
  audio.pause();
  disc.endpoints = null; disc.arc = null;
  hud.hide();
  $('#fork').classList.add('hidden');
  $('#entry').classList.remove('hidden');
}

// ———— 恢复分享状态 ————
(function restoreFromURL() {
  const shared = decodeShareURL();
  if (shared) {
    if (shared.quality) { state.qualityKey = shared.quality; renderer.resize(quality()); renderer.resizeBg(quality()); $('#quality-badge').textContent = quality().name; }
    if (shared.skin) applySkin(shared.skin, true);
    state.pending = { start: shared.start, endpoints: [shared.end, { v: 0.5, a: -0.5, label: '能呼吸的平静', desc: '' }] };
    state.journey = { start: shared.start, end: shared.end, endpoints: state.pending.endpoints, startedAt: Date.now() };
    state.arc = buildArc(shared.start, shared.end, state.params.curvature);
    state.pro = clamp(shared.pro, 0, 1);
    state.screen = 'journey';
    $('#entry').classList.add('hidden');
    hud.show();
    $('#audio-gate').classList.remove('hidden'); // 分享进入需手势解锁声音
    toast('已载入分享的旅程');
  }
})();
// 恢复未完成的旅程（本地持久化）
if (state.screen === 'entry' && prefs.journey?.start && prefs.journey?.end) {
  // 静默恢复到入口即可，不强行继续
}

// ———— 持久化 ————
let persistTimer = null;
function persist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    savePrefs({
      params: state.params,
      quality: state.qualityKey,
      skin: state.skinId,
      journey: state.journey ? {
        start: state.journey.start, end: state.journey.end, pro: state.pro,
      } : null,
    });
  }, 400);
}
window.addEventListener('beforeunload', persist);

// ———— 吐司 ————
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ———— 时钟 ————
setInterval(() => {
  const d = new Date();
  $('#clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}, 1000);

// ———— 自适应 ————
window.addEventListener('resize', () => renderer.resize(quality()));

// ———— 主循环 ————
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  // 旅程推进（smoothstep 弧上采样在 renderer 内完成）
  if (state.screen === 'journey' && state.playing && state.arc) {
    state.elapsed += dt;
    state.pro = clamp(state.elapsed / state.params.journeySec, 0, 1);
    if (state.pro >= 1) {
      state.playing = false;
      toast(`抵达「${state.journey.end.label}」`);
    }
  }

  const cur = state.arc
    ? arcPoint(state.arc, state.pro, state.params.smoothSteps)
    : state.freePoint;

  // 音频跟随情绪坐标（象限间平滑过渡）
  if (audio.ok) audio.feed(cur.v, cur.a);

  renderer.draw({
    arc: state.arc,
    pro: state.pro,
    freePoint: state.freePoint,
    params: state.params,
    quality: quality(),
    skin: skin(),
    debug: state.debug,
    audioStatus: audio.status(),
  }, dt);

  // 圆盘与 HUD
  disc.point = cur;
  disc.arc = state.arc;
  disc.draw(state.params.redShift, skin().mode === 'light');

  if (state.screen === 'journey') {
    hud.update(dt, {
      v: cur.v, a: cur.a, pro: state.pro,
      kappa: state.arc ? arcCurvature(state.arc, state.pro, state.params.smoothSteps) : 0,
      energy: state.arc ? arcEnergy(state.arc, state.pro, state.params.smoothSteps) : 0,
      bpm: audio.ok ? audio.bpm : 0,
      redShift: state.params.redShift,
      fps: renderer.fps,
    });
  }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 调试句柄（自测与排障用）
window.__CLAUDIO__ = { state, renderer, audio };
