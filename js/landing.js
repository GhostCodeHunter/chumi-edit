/* Chumi.edit landing page.
   1. The live picture (hero) and the scroll-driven develop scene both render with the editor's own colour code (Chumi.Adjust).
   2. GSAP + ScrollTrigger add the motion. If GSAP cannot load, or the visitor prefers reduced motion,
      every section stays complete and in place: nothing here is needed to read the page. */
(function () {
  'use strict';

  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  const A = window.Chumi && window.Chumi.Adjust;
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  const ease = function (t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };

  /* ---------- live pictures: an <img> underneath, a canvas on top once the engine has drawn into it ---------- */
  function whenLoaded(img) {
    return new Promise(function (res) {
      if (img.complete && img.naturalWidth) return res(true);
      img.addEventListener('load', function () { res(true); }, { once: true });
      img.addEventListener('error', function () { res(false); }, { once: true });
    });
  }

  function cssFilter(a) {          /* close enough when the canvas cannot be read (for example from file://) */
    const f = [];
    f.push('brightness(' + (1 + (a.exposure || 0) / 110).toFixed(3) + ')');
    f.push('contrast(' + (1 + (a.contrast || 0) / 100).toFixed(3) + ')');
    f.push('saturate(' + Math.max(0, 1 + (a.saturation || 0) / 100).toFixed(3) + ')');
    if (a.grayscale) f.push('grayscale(' + clamp(a.grayscale, 0, 100) + '%)');
    if (a.sepia) f.push('sepia(' + clamp(a.sepia, 0, 100) + '%)');
    return f.join(' ');
  }

  function makeLive(img, canvas, maxW) {
    let work = null, ok = false, failed = false, pending = null, raf = 0;
    function draw() {
      raf = 0;
      if (!pending) return;
      const a = pending; pending = null;
      if (ok) {
        try { A.render(work, a, canvas); canvas.parentNode.classList.add('is-live'); } catch (e) { ok = false; failed = true; }
      }
      if (failed) img.style.filter = cssFilter(a);
    }
    function prepare() {
      if (!A || ok || failed || !img.naturalWidth) return;
      try {
        const w = Math.min(maxW, img.naturalWidth), h = Math.round(w * img.naturalHeight / img.naturalWidth);
        work = document.createElement('canvas'); work.width = w; work.height = h;
        const c = work.getContext('2d', { willReadFrequently: true });
        c.drawImage(img, 0, 0, w, h);
        c.getImageData(0, 0, 1, 1);               /* throws when the picture is cross-origin */
        ok = true;
      } catch (e) { failed = true; }
      if (pending && !raf) raf = requestAnimationFrame(draw);
    }
    whenLoaded(img).then(prepare);
    return {
      set: function (a) { if (!A) return; pending = a; if ((ok || failed) && !raf) raf = requestAnimationFrame(draw); },
    };
  }

  /* ---------- hero: the dot from the name is the handle that develops the picture ---------- */
  const DULL = { exposure: -14, contrast: -34, saturation: -55, temperature: -22 };
  let look = 'original';
  let heroT = 1;
  let hero = null;

  function lookTarget(id) {
    const base = A.defaults();
    const p = A.presets.filter(function (x) { return x.id === id; })[0];
    return Object.assign(base, p ? p.adj : {});
  }
  function heroAdj(t) {
    const to = lookTarget(look), out = {};
    A.KEYS.forEach(function (k) { const f = DULL[k] || 0; out[k] = f + ((to[k] || 0) - f) * t; });
    return out;
  }

  let autoId = 0;
  function tween(from, to, ms, fn, done) {
    cancelAnimationFrame(autoId);
    const t0 = performance.now();
    (function step(now) {
      const k = clamp((now - t0) / ms, 0, 1);
      fn(from + (to - from) * ease(k));
      if (k < 1) autoId = requestAnimationFrame(step); else if (done) done();
    })(t0);
  }

  function makeDial(el, onChange) {
    let t = 1, drag = false;
    function set(v) {
      t = clamp(v, 0, 1);
      el.style.setProperty('--t', t.toFixed(4));
      el.setAttribute('aria-valuenow', String(Math.round(t * 100)));
      el.setAttribute('aria-valuetext', t < .12 ? 'As shot' : t > .88 ? 'Developed' : Math.round(t * 100) + ' percent developed');
      onChange(t);
    }
    function fromEvent(e) {
      const r = el.getBoundingClientRect(), pad = 15;
      set((e.clientX - r.left - pad) / Math.max(1, r.width - pad * 2));
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      cancelAnimationFrame(autoId);
      drag = true; el.classList.add('is-drag'); el.focus({ preventScroll: true });
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      fromEvent(e);
    });
    el.addEventListener('pointermove', function (e) { if (drag) fromEvent(e); });
    const end = function () { drag = false; el.classList.remove('is-drag'); };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('keydown', function (e) {
      const step = { ArrowLeft: -.05, ArrowDown: -.05, ArrowRight: .05, ArrowUp: .05, PageDown: -.2, PageUp: .2 }[e.key];
      if (step !== undefined) { cancelAnimationFrame(autoId); set(t + step); e.preventDefault(); }
      else if (e.key === 'Home') { cancelAnimationFrame(autoId); set(0); e.preventDefault(); }
      else if (e.key === 'End') { cancelAnimationFrame(autoId); set(1); e.preventDefault(); }
    });
    return { set: set, get: function () { return t; } };
  }

  const dialEl = $('#dial');
  let dial = null;
  function initHero() {
    const img = $('#liveImg'), canvas = $('#liveCanvas');
    if (!img || !canvas || !dialEl || !A) return;
    hero = makeLive(img, canvas, 1280);
    dial = makeDial(dialEl, function (t) { heroT = t; hero.set(heroAdj(t)); });
    dial.set(reduceMQ.matches ? 1 : 0);
    $$('#chips .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        look = chip.getAttribute('data-look');
        $$('#chips .chip').forEach(function (c) { c.setAttribute('aria-checked', String(c === chip)); });
        hero.set(heroAdj(heroT));
        if (heroT < .9 && !reduceMQ.matches) tween(heroT, 1, 700, function (v) { dial.set(v); });
        else if (heroT < .9) dial.set(1);
      });
    });
  }
  function developHero() {
    if (!dial) return;
    if (reduceMQ.matches) { dial.set(1); return; }
    tween(0, 1, 2000, function (v) { dial.set(v); });
  }

  /* ---------- develop scene: four sliders move as you scroll ---------- */
  const DEV = [
    { k: 'exposure', from: -16, to: 8 },
    { k: 'contrast', from: -34, to: 22 },
    { k: 'temperature', from: 24, to: -4 },
    { k: 'saturation', from: -60, to: 30 },
  ];
  let dev = null;
  const devRows = {};
  function initDevelop() {
    const img = $('#devImg'), canvas = $('#devCanvas');
    $$('#devRows .dev-row').forEach(function (r) { devRows[r.getAttribute('data-k')] = r; });
    if (!img || !canvas || !A) return;
    dev = makeLive(img, canvas, 1100);
    devApply(1);
  }
  function devApply(p) {
    if (!dev) return;
    const a = A.defaults();
    let active = -1;
    DEV.forEach(function (d, i) {
      const s = clamp(p * DEV.length - i, 0, 1);
      const v = d.from + (d.to - d.from) * ease(s);
      a[d.k] = v;
      if (s > 0 && s < 1) active = i;
      const row = devRows[d.k];
      if (row) {
        const n = Math.round(v);
        row.style.setProperty('--t', ((v + 100) / 200).toFixed(4));
        row.querySelector('.dev-val').textContent = (n > 0 ? '+' : '') + n;
      }
    });
    if (active < 0 && p >= 1) active = DEV.length - 1;
    DEV.forEach(function (d, i) { const row = devRows[d.k]; if (row) row.classList.toggle('is-active', i === active); });
    dev.set(a);
  }

  /* ---------- small things that need no library ---------- */
  function initNav() {
    const nav = $('#nav');
    const onScroll = function () { nav.classList.toggle('is-stuck', window.scrollY > 40); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        const id = a.getAttribute('href');
        const target = id.length > 1 ? $(id) : null;
        if (id === '#top') { e.preventDefault(); window.scrollTo({ top: 0, behavior: reduceMQ.matches ? 'auto' : 'smooth' }); return; }
        if (!target) return;
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY - 8;
        window.scrollTo({ top: Math.max(0, y), behavior: reduceMQ.matches ? 'auto' : 'smooth' });
        try { history.replaceState(null, '', id); } catch (x) { /* ignore */ }
      });
    });
  }

  /* ---------- motion ---------- */
  let intro = null;
  function initMotion() {
    const gsap = window.gsap, ScrollTrigger = window.ScrollTrigger;
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    /* the first screen, played when the loader curtain lifts */
    if (!reduceMQ.matches) {
      intro = gsap.timeline({ paused: true, defaults: { ease: 'power4.out' } });
      intro
        .from('.nav-in > *', { y: -22, opacity: 0, duration: .8, stagger: .08 }, 0)
        .from('.hero-title .w > span', { yPercent: 118, duration: 1.1, stagger: .09 }, 0.05)
        .from('.hero-copy > *', { y: 30, opacity: 0, duration: .9, stagger: .12 }, 0.4)
        .fromTo('.live-frame', { clipPath: 'inset(0% 0% 100% 0% round 24px)' }, { clipPath: 'inset(0% 0% 0% 0% round 24px)', duration: 1.3, ease: 'power3.inOut', clearProps: 'clipPath' }, 0.2)
        .from('.live-ui, .chips', { y: 24, opacity: 0, duration: .8, stagger: .12 }, 1)
        .add(developHero, 1.1);
    }

    const mm = gsap.matchMedia();
    mm.add({
      desk: '(min-width: 901px) and (prefers-reduced-motion: no-preference)',
      mob: '(max-width: 900px) and (prefers-reduced-motion: no-preference)',
      reduce: '(prefers-reduced-motion: reduce)',
    }, function (ctx) {
      const c = ctx.conditions;
      if (c.reduce) { devApply(1); return; }
      const cleanups = [];

      /* Triggers are created from the top of the page down, so pins above never shift positions already measured. */
      /* text and cards fade up as they enter */
      const revealsTop = $$('.samples [data-reveal]');
      gsap.set(revealsTop, { opacity: 0, y: 40 });
      ScrollTrigger.batch(revealsTop, {
        start: 'top 90%',
        onEnter: function (b) { gsap.to(b, { opacity: 1, y: 0, duration: .9, stagger: .12, ease: 'power3.out', overwrite: true }); },
      });
      const samples = $$('.sample');
      gsap.set(samples, { opacity: 0, y: 70 });
      ScrollTrigger.batch(samples, {
        start: 'top 92%',
        onEnter: function (b) { gsap.to(b, { opacity: 1, y: 0, duration: 1, stagger: .14, ease: 'power3.out', overwrite: true }); },
      });

      /* develop: scroll drives the sliders and the picture */
      if (dev) {
        const prog = { p: 0 };
        devApply(0);
        if (c.desk) {
          const tl = gsap.timeline({ scrollTrigger: { trigger: '.develop', start: 'top top', end: '+=2600', pin: true, scrub: .6, anticipatePin: 1 } });
          tl.to(prog, { p: 1, duration: 3, ease: 'none', onUpdate: function () { devApply(prog.p); } }, 0);
        } else {
          gsap.to(prog, { p: 1, ease: 'none', onUpdate: function () { devApply(prog.p); }, scrollTrigger: { trigger: '#devRows', start: 'top 75%', end: 'bottom 55%', scrub: .5 } });
        }
        cleanups.push(function () { devApply(1); });
      }

      /* layers: three cards slide apart, one is hidden, two swap places, then they close up again */
      const photo = $('.c-photo'), sun = $('.c-sun'), text = $('.c-text');
      const caps = $$('.lcard figcaption'), bgs = $$('.lcard-bg');
      function layersTimeline(st) {
        const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' }, scrollTrigger: st });
        tl.to(photo, { yPercent: 74, scale: .82, duration: 1 }, 0)
          .to(sun, { scale: .82, duration: 1 }, 0)
          .to(text, { yPercent: -74, scale: .82, duration: 1 }, 0)
          .to(bgs, { opacity: 1, duration: .6 }, .3)
          .to(caps, { opacity: 1, duration: .5, stagger: .12 }, .7)
          .to(sun, { opacity: .16, duration: .5 }, 1.7)
          .to(sun, { opacity: 1, duration: .5 }, 2.3)
          .to(sun, { yPercent: -74, duration: .9 }, 3)
          .to(text, { yPercent: 0, duration: .9 }, 3)
          .to([photo, sun, text], { yPercent: 0, scale: 1, duration: 1 }, 4.2)
          .to(bgs, { opacity: 0, duration: .6 }, 4.2)
          .to(caps, { opacity: 0, duration: .4 }, 4.2);
        return tl;
      }
      gsap.from('.lay-copy > *', { y: 40, opacity: 0, duration: .9, stagger: .12, ease: 'power3.out', scrollTrigger: { trigger: '.layers', start: 'top 70%' } });
      if (c.desk) {
        const tl = layersTimeline({ trigger: '.layers', start: 'top top', end: '+=2200', pin: true, scrub: .6, anticipatePin: 1 });
        tl.from('#layPanel', { xPercent: 40, opacity: 0, duration: 1.2, ease: 'power3.out' }, 0);
      } else {
        layersTimeline({ trigger: '#layCards', start: 'top 85%', end: 'bottom 25%', scrub: .6 });
      }

      /* tools: a pinned horizontal ride on large screens (small screens swipe the row natively) */
      if (c.desk) {
        const pin = $('#toolsPin'), track = $('#toolsTrack');
        pin.style.overflowX = 'hidden';
        cleanups.push(function () { pin.style.overflowX = ''; });
        const dist = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };
        const ride = gsap.to(track, {
          x: function () { return -dist(); }, ease: 'none',
          scrollTrigger: { trigger: pin, pin: true, scrub: .6, start: 'top top', end: function () { return '+=' + dist(); }, invalidateOnRefresh: true, anticipatePin: 1 },
        });
        $$('.tp', track).forEach(function (tp) {
          const kids = $$('.tp-copy > *, .tp-intro > *', tp).concat($$('.tp-shot', tp));
          gsap.from(kids, {
            y: 46, opacity: 0, duration: .9, stagger: .1, ease: 'power3.out',
            scrollTrigger: { trigger: tp, containerAnimation: ride, start: 'left 88%', toggleActions: 'play none none reverse' },
          });
          const img = $('.tp-shot img', tp);
          if (img) {
            gsap.fromTo(img, { xPercent: -3.5, scale: 1.08 }, {
              xPercent: 3.5, scale: 1.08, ease: 'none',
              scrollTrigger: { trigger: tp, containerAnimation: ride, start: 'left right', end: 'right left', scrub: true },
            });
          }
        });
      } else {
        gsap.from('.tools .tp', { x: 48, opacity: 0, duration: .8, stagger: .12, ease: 'power3.out', scrollTrigger: { trigger: '.tools-track', start: 'top 85%' } });
      }

      /* privacy: the dot grows until it is the whole section */
      const field = $('#privField');
      if (field) {
        const proxy = { r: 14 };
        const OY = 150;
        const setClip = function () { field.style.clipPath = 'circle(' + proxy.r.toFixed(1) + 'px at 50% ' + OY + 'px)'; };
        const reach = function () { return Math.hypot(field.offsetWidth / 2, Math.max(OY, field.offsetHeight - OY)) + 40; };
        setClip();
        gsap.to(proxy, {
          r: reach, ease: 'none', onUpdate: setClip,
          scrollTrigger: { trigger: '#privacy', start: 'top 80%', end: 'top 15%', scrub: .5, invalidateOnRefresh: true },
        });
        cleanups.push(function () { field.style.clipPath = ''; });
      }

      /* below the pins: created last, so their positions already include every pin spacer above */
      const revealsLate = $$('[data-reveal]').filter(function (el) { return !el.closest('.samples'); });
      gsap.set(revealsLate, { opacity: 0, y: 40 });
      ScrollTrigger.batch(revealsLate, {
        start: 'top 90%',
        onEnter: function (b) { gsap.to(b, { opacity: 1, y: 0, duration: .9, stagger: .12, ease: 'power3.out', overwrite: true }); },
      });
      const qas = $$('.qa');
      gsap.set(qas, { opacity: 0, y: 36 });
      ScrollTrigger.batch(qas, {
        start: 'top 92%',
        onEnter: function (b) { gsap.to(b, { opacity: 1, y: 0, duration: .8, stagger: .09, ease: 'power3.out', overwrite: true }); },
      });
      gsap.from('.priv-item', { y: 40, opacity: 0, duration: .9, stagger: .14, ease: 'power3.out', scrollTrigger: { trigger: '.priv-list', start: 'top 85%' } });
      gsap.from('.foot .bl', { yPercent: 120, duration: 1.1, stagger: .05, ease: 'power4.out', scrollTrigger: { trigger: '.foot-word', start: 'top 95%' } });

      return function () { cleanups.forEach(function (f) { f(); }); };
    });

    return ScrollTrigger;
  }

  /* ---------- boot ---------- */
  function start() {
    initNav();
    initHero();
    initDevelop();

    let ST = null;
    if (window.gsap && window.ScrollTrigger) {
      try { ST = initMotion(); } catch (e) { console.error('Chumi.edit: motion could not start', e); ST = null; }
    }
    if (!ST) devApply(1);

    const refresh = function () { if (ST) ST.refresh(); };
    const boot = window.ChumiBoot;
    let played = false;
    const play = function () {
      if (played) return; played = true;
      if (intro) intro.play(); else developHero();
    };
    if (boot) { boot.onReveal(play); boot.onDone(refresh); setTimeout(play, 12000); } else play();
    window.addEventListener('load', refresh);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refresh);

    /* tell the loader we are ready: fonts and the first picture are in (never waiting more than a few seconds) */
    const cap = function (p, ms) { return Promise.race([p, new Promise(function (r) { setTimeout(r, ms); })]); };
    const fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    const heroImg = $('#liveImg') ? whenLoaded($('#liveImg')) : Promise.resolve();
    Promise.all([cap(fonts, 1800), cap(heroImg, 3500)]).then(function () { if (boot) boot.ready(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
