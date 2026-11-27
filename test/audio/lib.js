// In-page analysis helpers for the AU harness (loaded with page.addScriptTag)
window.AL = (() => {
  const { AU } = window.__T;
  function fft(re, im) { const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const ur = re[i + k], ui = im[i + k], j = i + k + len / 2, vr = re[j] * cr - im[j] * ci, vi = re[j] * ci + im[j] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[j] = ur - vr; im[j] = ui - vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
  const N = 2048;
  function spectrum(x, sr) { // averaged power per band
    const bands = [[0, 60], [60, 250], [250, 2000], [2000, 6000], [6000, 24000]], E = [0, 0, 0, 0, 0];
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let o = 0; o + N <= x.length; o += N * 2) {
      for (let i = 0; i < N; i++) { re[i] = x[o + i] * (.5 - .5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) { const f = k * sr / N, p = re[k] * re[k] + im[k] * im[k]; for (let b = 0; b < 5; b++) if (f >= bands[b][0] && f < bands[b][1]) E[b] += p; }
    }
    const tot = E.reduce((a, b) => a + b, 0) || 1; return E.map(e => +(e / tot).toFixed(3));
  }
  function stats(L, R, sr) {
    let nan = 0, pk = 0, ss = 0, md = 0;
    for (let i = 0; i < L.length; i++) { const l = L[i], r = R ? R[i] : l; if (!isFinite(l) || !isFinite(r)) { nan++; continue; }
      pk = Math.max(pk, Math.abs(l), Math.abs(r)); ss += l * l + r * r;
      if (i) md = Math.max(md, Math.abs(l - L[i - 1])); }
    // silence fraction in 50ms windows
    const w = sr * .05 | 0; let sil = 0, nw = 0;
    for (let o = 0; o + w <= L.length; o += w) { let e = 0; for (let i = o; i < o + w; i++) e += L[i] * L[i]; nw++; if (Math.sqrt(e / w) < .003) sil++; }
    return { nan, peak: +pk.toFixed(3), rms: +Math.sqrt(ss / (2 * L.length)).toFixed(4), rmsDb: +(10 * Math.log10(ss / (2 * L.length) + 1e-12)).toFixed(1),
      maxStep: +md.toFixed(3), silentFrac: +(sil / Math.max(1, nw)).toFixed(2), spec: spectrum(L, sr) };
  }
  function renderSong(name, bars, sr, intensity, ramp) {
    const e = AU._dev.mkEngine(sr); e.music(name); e.setI(intensity == null ? .5 : intensity);
    const bpm = AU._dev.SONGS[name].bpm, n = Math.ceil(bars * 16 * sr * 15 / bpm / 64) * 64;
    const L = new Float32Array(n), R = new Float32Array(n), CH = 1024; let t0 = performance.now(), steps = [];
    e.onStep = (s, b, off) => steps.push(off);
    for (let o = 0; o < n; o += CH) { if (ramp) e.setI(Math.min(1, o / n * 1.15)); const m = Math.min(CH, n - o); e.render(L, R, o, m / 64); }
    const ms = performance.now() - t0;
    return { L, R, ms, sec: n / sr, steps: steps.length };
  }
  function wav(L, R, sr) {
    const n = L.length, b = new DataView(new ArrayBuffer(44 + n * 4)); const ws = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); b.setUint32(4, 36 + n * 4, true); ws(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 2, true);
    b.setUint32(24, sr, true); b.setUint32(28, sr * 4, true); b.setUint16(32, 4, true); b.setUint16(34, 16, true); ws(36, 'data'); b.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { b.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); b.setInt16(46 + i * 4, Math.max(-1, Math.min(1, (R || L)[i])) * 32767, true); }
    let s = ''; const u = new Uint8Array(b.buffer); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s);
  }
  // spectrogram (log freq, 30 Hz..16 kHz) over waveform strip
  function picture(L, sr, title, W) {
    W = W || 1200; const Hs = 300, Hw = 100, c = document.createElement('canvas'); c.width = W; c.height = Hs + Hw + 16;
    const g = c.getContext('2d'), img = g.createImageData(W, Hs), hop = Math.max(1, Math.floor((L.length - N) / W));
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let x = 0; x < W; x++) { const o = x * hop; for (let i = 0; i < N; i++) { re[i] = (L[o + i] || 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; } fft(re, im);
      for (let y = 0; y < Hs; y++) { const f = 30 * Math.pow(16000 / 30, 1 - y / Hs), k = Math.min(N / 2 - 1, Math.round(f * N / sr)); const p = re[k] * re[k] + im[k] * im[k];
        const db = 10 * Math.log10(p + 1e-12) - 54, v = Math.max(0, Math.min(1, (db + 85) / 80)); const i = (y * W + x) * 4;
        img.data[i] = 255 * Math.min(1, v * 2); img.data[i + 1] = 255 * Math.max(0, v * 2 - 1); img.data[i + 2] = 255 * (v < .5 ? v : 1 - v); img.data[i + 3] = 255; } }
    g.fillStyle = '#000'; g.fillRect(0, 0, W, c.height); g.putImageData(img, 0, 16);
    g.fillStyle = '#fff'; g.font = '12px monospace'; g.fillText(title, 4, 12);
    g.strokeStyle = '#6cf'; g.beginPath(); const spp = L.length / W;
    for (let x = 0; x < W; x++) { let mn = 0, mx = 0; for (let i = x * spp | 0; i < (x + 1) * spp; i++) { mn = Math.min(mn, L[i]); mx = Math.max(mx, L[i]); }
      g.moveTo(x + .5, Hs + 16 + Hw / 2 - mx * Hw / 2); g.lineTo(x + .5, Hs + 16 + Hw / 2 - mn * Hw / 2 + 1); }
    g.stroke(); return c.toDataURL('image/png');
  }
  return { stats, renderSong, wav, picture, spectrum };
})();
