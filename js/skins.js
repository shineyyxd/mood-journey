// ————————————————————————————————————————————————
// skins.js · 皮肤系统：改变「房间的光线」，情绪色阶不变
// ————————————————————————————————————————————————
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export const SKINS = [
  { id: 'abyss', name: '深海', mode: 'dark',  base: '#05070d', hue: 232 },
  { id: 'dusk',  name: '暮色', mode: 'dark',  base: '#170c07', hue: 24  },
  { id: 'moss',  name: '苔原', mode: 'dark',  base: '#07110b', hue: 150 },
  { id: 'mist',  name: '雾紫', mode: 'dark',  base: '#100a18', hue: 278 },
  { id: 'paper', name: '纸白', mode: 'light', base: '#f3f0ea', hue: 40  },
];

export function getSkin(id) {
  const s = SKINS.find(s => s.id === id) || SKINS[0];
  return { ...s, rgb: hexToRgb(s.base) };
}
