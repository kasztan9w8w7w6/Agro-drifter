/**
 * Single shared color palette for every generated texture and effect.
 * Keeping every draw call pulling from this one list (instead of ad-hoc
 * hex literals scattered around) is what makes the pixel art read as one
 * consistent place instead of a pile of unrelated placeholder shapes.
 *
 * Theme: melancholic Polish night - cold indigo sky, sodium-orange
 * streetlight glow, wet asphalt, and a few saturated neon accents.
 */
export const Palette = {
  skyTop: 0x0a0e24,
  skyBottom: 0x141a33,

  asphalt: 0x232129,
  asphaltLight: 0x322f3a,
  roadEdge: 0xcfcabb,
  roadLine: 0xe8d24a,
  offroadDirt: 0x2a2418,

  grassDark: 0x0e2018,
  grassMid: 0x143528,

  treeTrunk: 0x2a1e14,
  treeCanopy: 0x0f2a1c,

  buildingShadow: 0x211d2a,
  buildingLit: 0xffb347,
  buildingUnlit: 0x2a2438,

  lampGlowCore: 0xffe1a8,
  lampGlowOuter: 0xff9d3d,
  headlightWarm: 0xfff2c9,

  neonMagenta: 0xff2fb0,
  neonCyan: 0x2fe0ff,
  neonToxic: 0x8dff4a,

  carBody: 0xd1273a,
  carShadow: 0x6e1420,
  carGlass: 0xdfe8ff,
  carChrome: 0xffe27a,

  damageRed: 0xff3b3b,
  fuelGreen: 0x4ad84a,
  fuelLow: 0xd8402c,

  deerFur: 0x7a5230,
  deerDark: 0x3a2a1a,
  deerEye: 0xffd54a,

  bottleGlass: 0x2c8f5a,
  bottleHighlight: 0x8fe0b0,

  potholeVoid: 0x0c0c0d,
  potholeRim: 0x2a2a2e,

  fog: 0x9db3c9,
  smoke: 0xc9c2b8,
  spark: 0xffce54,

  hudBg: 0x14121a,
  hudFuel: 0x4ad84a,
  hudDamage: 0xd8a02c,
  hudText: 0xf2eee6,
} as const;

export function toCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

export function toCssAlpha(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
