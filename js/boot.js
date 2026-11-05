/* Chumi.edit page loader controller. Plain script, no dependencies; loaded synchronously right after the #boot markup.
   API: ChumiBoot.ready()  - the page is ready to show
        ChumiBoot.onReveal(fn)  - fn runs as the curtain starts to lift (start your page's entrance here)
        ChumiBoot.onDone(fn)    - fn runs once the loader is gone
   Also fires window events "chumi:reveal" and "chumi:booted". */
(function () {
  'use strict';
  const boot = document.getElementById('boot');
  const root = document.documentElement;
  const listeners = { reveal: [], done: [] };
  const api = window.ChumiBoot = {
    revealed: false, done: false,
    ready: function () { state.ready = true; tick(); },
    onReveal: function (fn) { api.revealed ? fn() : listeners.reveal.push(fn); },
    onDone: function (fn) { api.done ? fn() : listeners.done.push(fn); },
  };
  if (!boot) { api.revealed = api.done = true; return; }

  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  let seen = false;
  try { seen = sessionStorage.getItem('chumi-booted') === '1'; } catch (e) { /* storage blocked */ }
  const quick = seen && !reduce;
  const T = reduce ? { dot: 0, text: 0, min: 500 }
    : quick ? { dot: 420, text: 640, min: 1300 }
    : { dot: 950, text: 1450, min: 2500 };
  boot.style.setProperty('--k', quick ? '.55' : '1');
  root.classList.add('is-booting');

  const state = { ready: false, minOk: false, started: false };
  const timers = [];
  const later = function (fn, ms) { const id = setTimeout(fn, ms); timers.push(id); return id; };
  const add = function (c) { boot.classList.add(c); };

  function dotOrigin() {
    const d = boot.querySelector('.boot-dot');
    if (!d) return;
    const r = d.getBoundingClientRect();
    boot.style.setProperty('--fx', Math.round(r.left + r.width / 2) + 'px');
    boot.style.setProperty('--fy', Math.round(r.top + r.height / 2) + 'px');
  }

  function fire(list) { list.splice(0).forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } }); }

  function exit() {
    if (state.leaving) return;
    state.leaving = true;
    timers.forEach(clearTimeout);
    boot.classList.remove('b-wait');
    try { sessionStorage.setItem('chumi-booted', '1'); } catch (e) { /* storage blocked */ }
    const finish = function () {
      boot.remove(); root.classList.remove('is-booting'); api.done = true;
      window.dispatchEvent(new CustomEvent('chumi:booted')); fire(listeners.done);
    };
    const reveal = function () {
      api.revealed = true; window.dispatchEvent(new CustomEvent('chumi:reveal')); fire(listeners.reveal);
    };
    if (reduce) {
      add('b-lift'); reveal(); later(finish, 380); return;
    }
    dotOrigin(); add('b-flood');
    later(function () { add('b-lift'); reveal(); root.classList.remove('is-booting'); }, 780);
    later(finish, 780 + 1000);
  }

  function tick() {
    if (state.ready && state.minOk) exit();
    else if (state.minOk && !state.ready) add('b-wait');
  }

  /* the wordmark waits for its font (never longer than the planned time + 600ms) */
  let textStarted = false;
  function startText() { if (textStarted) return; textStarted = true; add('b-text'); }
  function fontGate() {
    if (!document.fonts || !document.fonts.load) return startText();
    Promise.race([
      document.fonts.load('700 40px "Bricolage Grotesque"'),
      new Promise(function (res) { setTimeout(res, T.text + 600); }),
    ]).then(function () { later(startText, 0); });
  }

  add('b-ring');
  if (reduce) { add('b-dot'); startText(); } else {
    later(function () { add('b-dot'); }, T.dot);
    later(function () { fontGate(); }, T.text);
  }
  later(function () { state.minOk = true; tick(); }, T.min);
  later(function () { state.ready = true; tick(); }, 9000);          /* safety: never wait forever */
})();
