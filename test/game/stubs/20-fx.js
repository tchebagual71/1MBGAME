const FX = (() => ({ dim: .38, cur: 'stub', names: [], def() { }, set() { }, kick() { },
  draw(dt) { for (let y = 0; y < H; y++) { const c = rgb(8 + (y / 270 * 20), 6, 22 + Math.sin(y * .05 + S.t) * 8); fb.fill(c, y * W, y * W + W); }
    for (let x = 0; x < W; x += 32) for (let y = 0; y < H; y++) fb[y * W + x] = rgb(20, 24, 50); } }))();
