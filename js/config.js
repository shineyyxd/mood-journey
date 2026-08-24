// ————————————————————————————————————————————————
// config.js · 22 项情绪与视觉可调参数（单一事实源）
// ————————————————————————————————————————————————
export const PARAMS = [
  // — 情绪编排 —
  { key: 'curvature',       label: '弧线曲率',     group: '情绪编排', min: 0,    max: 1,   step: 0.01, def: 0.55 },
  { key: 'journeySec',      label: '旅程时长(s)',  group: '情绪编排', min: 30,   max: 300, step: 5,    def: 120 },
  { key: 'smoothSteps',     label: '缓动阶数',     group: '情绪编排', min: 1,    max: 4,   step: 1,    def: 2   },
  { key: 'redShift',        label: '情绪红移',     group: '情绪编排', min: 0,    max: 1,   step: 0.01, def: 0.6 },
  { key: 'quadrantSoft',    label: '象限柔化',     group: '情绪编排', min: 0.05, max: 1,   step: 0.01, def: 0.5 },
  // — 视觉 —
  { key: 'turbulence',      label: '湍流强度',     group: '视觉', min: 0,   max: 2,   step: 0.01, def: 0.45 },
  { key: 'noiseScale',      label: '噪声尺度',     group: '视觉', min: 0.5, max: 3,   step: 0.05, def: 1.0  },
  { key: 'flowSpeed',       label: '流动速度',     group: '视觉', min: 0,   max: 3,   step: 0.05, def: 0.8  },
  { key: 'grain',           label: '磁带颗粒',     group: '视觉', min: 0,   max: 1,   step: 0.01, def: 0    },
  { key: 'vignette',        label: '边缘暗角',     group: '视觉', min: 0,   max: 1,   step: 0.01, def: 0.5  },
  { key: 'aberration',      label: '色散(px)',     group: '视觉', min: 0,   max: 4,   step: 0.1,  def: 0    },
  { key: 'glow',            label: '弧线辉光',     group: '视觉', min: 0,   max: 2,   step: 0.05, def: 1.2  },
  { key: 'arcWidth',        label: '弧线宽度',     group: '视觉', min: 1,   max: 8,   step: 0.5,  def: 3    },
  { key: 'particles',       label: '粒子数量',     group: '视觉', min: 0,   max: 400, step: 10,   def: 50   },
  { key: 'spinSpeed',       label: '盘面转速',     group: '视觉', min: 0,   max: 2,   step: 0.05, def: 1    },
  { key: 'pullForce',       label: '曲率牵引',     group: '视觉', min: 0,   max: 2,   step: 0.05, def: 1.0  },
  { key: 'exposure',        label: 'ACES 曝光',    group: '视觉', min: 0.2, max: 2.5, step: 0.05, def: 1.1  },
  // — 音频 —
  { key: 'masterVol',       label: '主音量',       group: '音频', min: 0, max: 1, step: 0.01, def: 0.8 },
  { key: 'padVol',          label: '垫乐音量',     group: '音频', min: 0, max: 1, step: 0.01, def: 0.4 },
  { key: 'padOn',           label: '低频垫乐',     group: '音频', min: 0, max: 1, step: 1,    def: 1   },
  { key: 'brightness',      label: '音色亮度',     group: '音频', min: 0, max: 1, step: 0.01, def: 0.5 },
  { key: 'tempoBase',       label: '基础 BPM',     group: '音频', min: 40, max: 120, step: 1, def: 64 },
];

export const PARAM_MAP = Object.fromEntries(PARAMS.map(p => [p.key, p]));

export function defaultParams() {
  return Object.fromEntries(PARAMS.map(p => [p.key, p.def]));
}

// 画质三档
export const QUALITY = {
  standard:  { name: 'STANDARD',  bgDiv: 5, octaves: 3, aberration: 0,    dprCap: 1.5 },
  high:      { name: 'HIGH',      bgDiv: 3, octaves: 4, aberration: 1,    dprCap: 2   },
  cinematic: { name: 'CINEMATIC', bgDiv: 2, octaves: 5, aberration: 1,    dprCap: 2   },
};
export const QUALITY_ORDER = ['standard', 'high', 'cinematic'];

export const STORAGE_KEY = 'moodjourney.v1';
