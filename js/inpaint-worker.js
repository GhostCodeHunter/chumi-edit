/* Runs content-aware fill off the main thread so the editor stays responsive. */
importScripts('inpaint-core.js');
self.onmessage = function (e) {
  var m = e.data;
  try {
    var out = self.ChumiInpaint.inpaint(m.rgba, m.w, m.h, m.hole, m.opts, function (f) { self.postMessage({ type: 'progress', f: f }); });
    if (!out) self.postMessage({ type: 'done', ok: false });
    else self.postMessage({ type: 'done', ok: true, rgba: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
