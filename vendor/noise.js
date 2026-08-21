// vendored: 经典 Perlin 改进噪声（2D/3D），零依赖，确定性好。
// 来源算法：Ken Perlin improved noise, 标准置换表实现。
const perm = new Uint8Array(512);
const p = new Uint8Array(256);
(function seed() {
  // 固定种子的洗牌，保证每次加载湍流形态一致
  let s = 1337;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
})();

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }
function grad(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

export function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = perm[X] + Y, AA = perm[A] + Z, AB = perm[A + 1] + Z;
  const B = perm[X + 1] + Y, BA = perm[B] + Z, BB = perm[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
      lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
    lerp(
      lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}

// 分形叠加 fbm
export function fbm(x, y, z, octaves) {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise3(x * f, y * f, z * f);
    amp *= 0.5; f *= 2.02;
  }
  return v; // ~[-1,1]
}
