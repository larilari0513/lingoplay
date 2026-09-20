export function selection(a, b) {
  const bound = n => Math.max(0, Math.min(1, n));
  return { x: bound(Math.min(a.x, b.x)), y: bound(Math.min(a.y, b.y)), w: Math.min(1, Math.abs(a.x - b.x)), h: Math.min(1, Math.abs(a.y - b.y)) };
}
export function signature(context, width, height) {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(context.canvas, 0, 0, width, height, 0, 0, 128, 64);
  return ctx.getImageData(0, 0, 128, 64).data;
}
export function changed(a, b, threshold = 1.8) {
  if (!a || a.length !== b.length) return true;
  let delta = 0, strong = 0;
  for (let i = 0; i < a.length; i += 4) { const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); delta += d; if (d > 72) strong++; }
  return delta / (a.length / 4 * 3) > threshold || strong / (a.length / 4) > 0.002;
}
