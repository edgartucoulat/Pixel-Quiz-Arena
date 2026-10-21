/* =========================================================================
 * PIXEL QUIZ ARENA - Pixel art procédural
 * Avatars des joueurs (16x16), présentateur virtuel (24x32) et public.
 * Tout est dessiné dans une grille de pixels, puis un contour sombre est
 * ajouté automatiquement : pas d'image à charger.
 * ========================================================================= */
(function () {
  'use strict';
  const PQA = (window.PQA = window.PQA || {});

  const OUTLINE = '#1a1c2c';
  PQA.PALETTE = {
    skin: ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#a7f070', '#73eff7'],
    hair: ['#2b1d14', '#5a3825', '#b06d2a', '#f5d76e', '#e43b44', '#3b5dc9', '#f4f4f4', '#b55088'],
    player: ['#e43b44', '#41a6f6', '#38b764', '#ffcd75', '#b55088', '#73eff7', '#ef7d57', '#f6757a', '#a7f070', '#c0cbdc'],
    team: ['#e43b44', '#41a6f6', '#38b764', '#ffcd75'],
  };
  PQA.TEAM_NAMES = ['Rouges', 'Bleus', 'Verts', 'Jaunes'];
  // Nombre de variantes pour chaque partie de l'avatar (utilisé par l'éditeur).
  PQA.AVATAR_PARTS = { s: 7, h: 8, hc: 8, e: 4, a: 8 };

  PQA.randomAvatar = function () {
    const r = (n) => Math.floor(Math.random() * n);
    return { s: r(5), h: r(8), hc: r(8), e: r(4), a: r(8) };
  };

  /** Grille de pixels avec helpers de dessin. */
  class Grid {
    constructor(w, h) {
      this.w = w; this.h = h;
      this.px = new Array(w * h).fill(null);
    }
    set(x, y, c) { if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c; }
    get(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null; }
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
    outline(color = OUTLINE) {
      const add = [];
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        if (this.get(x, y)) continue;
        if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push([x, y]);
      }
      add.forEach(([x, y]) => this.set(x, y, color));
    }
    draw(ctx, ox, oy, s) {
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const c = this.px[y * this.w + x];
        if (c) { ctx.fillStyle = c; ctx.fillRect(ox + x * s, oy + y * s, s, s); }
      }
    }
  }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
    const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  PQA.shade = shade;

  /* ---------------------------------------------------------------------
   * Avatar joueur : grille 18x18 (16x16 + marge pour le contour)
   * pose : 'idle' | 'happy' | 'sad' | 'buzz'
   * ------------------------------------------------------------------- */
  function avatarGrid(av, color, pose) {
    av = av || {};
    const g = new Grid(18, 18);
    const o = 1; // décalage pour le contour
    const skin = PQA.PALETTE.skin[av.s % 7 || 0] || PQA.PALETTE.skin[0];
    const hair = PQA.PALETTE.hair[av.hc % 8 || 0] || PQA.PALETTE.hair[0];
    const shirt = color || '#41a6f6';
    const P = (x, y, c) => g.set(x + o, y + o, c);
    const R = (x, y, w, h, c) => g.rect(x + o, y + o, w, h, c);

    // Corps (t-shirt) + bras
    R(3, 12, 10, 4, shirt);
    R(4, 12, 8, 1, shade(shirt, 30));
    if (pose === 'happy' || pose === 'buzz') {
      R(1, 8, 2, 5, shirt); R(13, 8, 2, 5, shirt);
      R(1, 7, 2, 1, skin); R(13, 7, 2, 1, skin);
    } else {
      R(2, 13, 1, 3, shirt); R(13, 13, 1, 3, shirt);
    }
    // Cou + tête
    R(6, 11, 4, 1, shade(skin, -25));
    R(4, 3, 8, 8, skin);
    R(3, 5, 1, 4, skin); R(12, 5, 1, 4, skin); // oreilles
    P(3, 7, shade(skin, -30)); P(12, 7, shade(skin, -30));

    // Yeux
    const eye = OUTLINE;
    const e = av.e || 0;
    if (pose === 'happy') {
      P(5, 6, eye); P(6, 5, eye); P(7, 6, eye); P(8, 6, eye); P(9, 5, eye); P(10, 6, eye);
    } else if (e === 0) { R(6, 5, 1, 2, eye); R(9, 5, 1, 2, eye); }
    else if (e === 1) { R(5, 5, 2, 2, '#f4f4f4'); R(9, 5, 2, 2, '#f4f4f4'); P(6, 6, eye); P(10, 6, eye); }
    else if (e === 2) { R(5, 6, 2, 1, eye); R(9, 6, 2, 1, eye); }
    else { R(6, 5, 1, 2, eye); R(9, 5, 1, 2, eye); P(5, 4, eye); P(10, 4, eye); }
    // Joues
    P(5, 8, '#f6757a'); P(10, 8, '#f6757a');
    // Bouche
    if (pose === 'happy' || pose === 'buzz') { R(6, 8, 4, 2, '#5d275d'); R(7, 9, 2, 1, '#e43b44'); }
    else if (pose === 'sad') { R(6, 9, 4, 1, '#5d275d'); P(5, 10, '#5d275d'); P(10, 10, '#5d275d'); }
    else { R(6, 9, 4, 1, '#5d275d'); P(5, 8, '#5d275d'); P(10, 8, '#5d275d'); }

    // Cheveux
    switch (av.h || 0) {
      case 0: R(4, 2, 8, 2, hair); R(3, 3, 1, 3, hair); R(12, 3, 1, 3, hair); break; // court
      case 1: R(4, 2, 8, 2, hair); P(4, 1, hair); R(6, 0, 1, 2, hair); P(8, 1, hair); R(10, 0, 1, 2, hair); break; // pics
      case 2: R(3, 2, 10, 2, hair); R(3, 4, 1, 8, hair); R(12, 4, 1, 8, hair); break; // long
      case 3: R(3, 0, 10, 4, hair); R(2, 2, 1, 5, hair); R(13, 2, 1, 5, hair); break; // afro
      case 4: P(9, 3, shade(skin, 40)); break; // chauve qui brille
      case 5: R(7, 0, 2, 4, hair); break; // crête
      case 6: R(3, 2, 10, 3, hair); R(3, 5, 1, 2, hair); R(12, 5, 1, 2, hair); break; // bol
      case 7: R(4, 2, 8, 2, hair); R(12, 3, 2, 1, hair); R(13, 4, 1, 5, hair); break; // queue de cheval
    }
    // Accessoires
    switch (av.a || 0) {
      case 1: R(4, 5, 3, 2, '#c0cbdc'); R(9, 5, 3, 2, '#c0cbdc'); P(6, 6, eye); P(10, 6, eye); R(7, 5, 2, 1, OUTLINE); break; // lunettes
      case 2: R(4, 5, 8, 2, OUTLINE); P(5, 5, '#566c86'); P(9, 5, '#566c86'); break; // lunettes noires
      case 3: R(3, 1, 10, 2, '#e43b44'); R(10, 3, 4, 1, shade('#e43b44', -40)); P(7, 1, '#f4f4f4'); break; // casquette
      case 4: R(4, 1, 8, 1, '#ffcd75'); P(4, 0, '#ffcd75'); P(7, 0, '#ffcd75'); P(8, 0, '#ffcd75'); P(11, 0, '#ffcd75'); P(7, 1, '#e43b44'); break; // couronne
      case 5: R(4, 1, 8, 1, '#333c57'); R(3, 2, 1, 2, '#333c57'); R(12, 2, 1, 2, '#333c57'); R(2, 4, 2, 4, '#e43b44'); R(12, 4, 2, 4, '#e43b44'); break; // casque audio
      case 6: R(5, 8, 6, 1, hair); P(5, 9, hair); P(10, 9, hair); break; // moustache
      case 7: R(5, 1, 6, 1, '#b55088'); R(6, 0, 4, 1, '#ffcd75'); P(7, -1, '#f4f4f4'); break; // chapeau de fête
    }
    g.outline();
    return g;
  }

  const cache = new Map();
  /** Renvoie une URL d'image (data:) de l'avatar, mise en cache. */
  PQA.avatarURL = function (av, color, pose = 'idle', scale = 6) {
    const key = JSON.stringify([av, color, pose, scale]);
    if (cache.has(key)) return cache.get(key);
    const g = avatarGrid(av, color, pose);
    const c = document.createElement('canvas');
    c.width = g.w * scale; c.height = g.h * scale;
    g.draw(c.getContext('2d'), 0, 0, scale);
    const url = c.toDataURL();
    cache.set(key, url);
    return url;
  };
  PQA.drawAvatar = function (ctx, av, color, pose, x, y, scale) {
    avatarGrid(av, color, pose).draw(ctx, x, y, scale);
  };

  /* ---------------------------------------------------------------------
   * Présentateur virtuel : "Pixou", costume violet, nœud pap', micro.
   * expr : neutral | happy | surprised | smug | sad | wink
   * ------------------------------------------------------------------- */
  PQA.drawPresenter = function (ctx, x, y, s, expr, mouthOpen, frame) {
    const g = new Grid(26, 34);
    const R = (a, b, w, h, c) => g.rect(a + 1, b + 1, w, h, c);
    const P = (a, b, c) => g.set(a + 1, b + 1, c);
    const skin = '#f1c27d', suit = '#5d275d', suitL = '#b55088', hair = '#2b1d14';
    const bob = frame % 2;
    // Jambes + chaussures
    R(8, 28, 3, 4, '#333c57'); R(13, 28, 3, 4, '#333c57');
    R(7, 31, 4, 2, OUTLINE); R(13, 31, 4, 2, OUTLINE);
    // Veste
    R(6, 17, 12, 12, suit);
    R(7, 17, 1, 11, suitL); R(16, 17, 1, 11, suitL);
    R(10, 17, 4, 7, '#f4f4f4'); // chemise
    R(10, 17, 4, 1, '#e43b44'); P(11, 18, '#e43b44'); P(12, 18, '#e43b44'); // nœud pap'
    R(9, 17, 1, 1, '#e43b44'); R(14, 17, 1, 1, '#e43b44');
    P(12, 21, '#ffcd75'); P(12, 24, '#ffcd75'); // boutons
    // Bras gauche (le long du corps) et bras droit (micro)
    R(4, 18, 2, 8, suit); R(4, 26, 2, 2, skin);
    if (expr === 'happy' || expr === 'surprised') {
      R(18, 12, 2, 7, suit); R(18, 10, 2, 2, skin); // bras levé
    } else {
      R(18, 18, 2, 5, suit); R(18, 23, 3, 2, skin);
      R(20, 20, 2, 3, '#566c86'); R(19, 18, 4, 2, '#333c57'); // micro
    }
    // Tête
    R(7, 4 + bob * 0, 10, 11, skin);
    R(6, 8, 1, 4, skin); R(17, 8, 1, 4, skin);
    R(10, 15, 4, 2, shade(skin, -25)); // cou
    // Cheveux gominés
    R(6, 2, 12, 3, hair); R(6, 5, 2, 3, hair); R(16, 5, 2, 2, hair); R(14, 1, 4, 2, hair); P(15, 2, '#566c86');
    // Sourcils + yeux
    const eye = OUTLINE;
    if (expr === 'surprised') {
      R(8, 6, 3, 1, hair); R(13, 6, 3, 1, hair);
      R(9, 8, 2, 2, '#f4f4f4'); R(13, 8, 2, 2, '#f4f4f4'); P(9, 9, eye); P(14, 9, eye);
    } else if (expr === 'happy') {
      R(8, 7, 3, 1, hair); R(13, 7, 3, 1, hair);
      P(8, 9, eye); P(9, 8, eye); P(10, 9, eye); P(13, 9, eye); P(14, 8, eye); P(15, 9, eye);
    } else if (expr === 'wink' || expr === 'smug') {
      R(8, 7, 3, 1, hair); R(13, 6, 3, 1, hair);
      R(9, 9, 2, 1, eye); R(14, 8, 1, 2, eye);
    } else if (expr === 'sad') {
      P(8, 8, hair); P(9, 7, hair); P(15, 8, hair); P(14, 7, hair);
      R(9, 9, 1, 2, eye); R(14, 9, 1, 2, eye);
    } else {
      R(8, 7, 3, 1, hair); R(13, 7, 3, 1, hair);
      R(9, 8, 1, 2, eye); R(14, 8, 1, 2, eye);
    }
    P(11, 10, shade(skin, -35)); P(12, 11, shade(skin, -35)); // nez
    P(8, 11, '#f6757a'); P(15, 11, '#f6757a');
    // Moustache + bouche
    R(9, 12, 6, 1, hair);
    if (mouthOpen) { R(10, 13, 4, 2, '#5d275d'); R(11, 14, 2, 1, '#e43b44'); }
    else if (expr === 'sad') { R(10, 14, 4, 1, '#5d275d'); }
    else if (expr === 'smug') { R(11, 13, 4, 1, '#5d275d'); P(15, 12, '#5d275d'); }
    else if (expr === 'surprised') { R(11, 13, 2, 2, '#5d275d'); }
    else { R(10, 13, 4, 1, '#5d275d'); P(9, 12, '#5d275d'); P(14, 12, '#5d275d'); }
    g.outline();
    g.draw(ctx, x, y, s);
  };

  /* ---------------------------------------------------------------------
   * Public : rangées de petits spectateurs, qui sautent quand ça s'agite.
   * ------------------------------------------------------------------- */
  class Audience {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.excite = 0; // 0 = calme, 1 = délire
      this.people = [];
      const W = canvas.width;
      for (let row = 0; row < 3; row++) {
        for (let x = (row % 2) * 4; x < W; x += 8) {
          this.people.push({
            x: x + Math.random() * 2, row,
            skin: PQA.PALETTE.skin[Math.floor(Math.random() * 5)],
            shirt: ['#b13e53', '#3b5dc9', '#38b764', '#ef7d57', '#5d275d', '#257179', '#ffcd75', '#94b0c2'][Math.floor(Math.random() * 8)],
            hair: PQA.PALETTE.hair[Math.floor(Math.random() * 6)],
            phase: Math.random() * Math.PI * 2,
            speed: 6 + Math.random() * 6,
          });
        }
      }
    }
    cheer(level = 1) { this.excite = Math.max(this.excite, level); }
    draw(t) {
      const { ctx, c } = this;
      ctx.clearRect(0, 0, c.width, c.height);
      this.excite = Math.max(0, this.excite - 0.006);
      for (const p of this.people) {
        const baseY = c.height - 14 + p.row * 5 - 6;
        const jump = this.excite > 0.15 ? Math.max(0, Math.sin(t / 1000 * p.speed + p.phase)) * 3 * this.excite : 0;
        const y = Math.round(baseY - jump - (Math.sin(t / 700 + p.phase) > 0.95 ? 1 : 0));
        const x = Math.round(p.x);
        const dark = p.row === 0 ? -50 : p.row === 1 ? -25 : 0;
        ctx.fillStyle = shade(p.shirt, dark); ctx.fillRect(x, y + 4, 5, 6);
        ctx.fillStyle = shade(p.skin, dark); ctx.fillRect(x + 1, y, 3, 4);
        ctx.fillStyle = shade(p.hair, dark); ctx.fillRect(x + 1, y, 3, 1);
        if (this.excite > 0.3) { // bras levés
          const up = Math.sin(t / 120 + p.phase) > 0 ? 1 : 0;
          ctx.fillStyle = shade(p.skin, dark);
          ctx.fillRect(x - 1, y + 1 - up, 1, 3); ctx.fillRect(x + 5, y + 1 - up, 1, 3);
        }
      }
    }
  }
  PQA.Audience = Audience;
})();
