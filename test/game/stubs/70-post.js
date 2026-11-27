const POST = (() => { let cx, img; return { init(cv) { cv.width = W; cv.height = H; cx = cv.getContext('2d'); img = cx.createImageData(W, H); },
  present() { if (!cx) return; new Uint32Array(img.data.buffer).set(fb); cx.putImageData(img, 0, 0); } }; })();
