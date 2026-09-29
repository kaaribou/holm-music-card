/* HOLM Music Card — v1
 * Lecteur Music Assistant moderne pour Home Assistant.
 * - Lecture en cours : pochette (carrée ou vinyle), fond et couleur d'accent tirés de la pochette,
 *   gestes (glisser = piste suivante / précédente, double-tap = favori), progression interactive.
 * - File d'attente : liste complète (connexion directe à Music Assistant) avec lecture, déplacement,
 *   « lire ensuite », suppression ; sinon piste en cours + suivante via Home Assistant.
 * - Bibliothèque : accueil (récents, favoris), playlists, albums, artistes, titres, radios, podcasts,
 *   livres audio, recherche globale (tous les fournisseurs), fiches album / artiste / playlist,
 *   lecture immédiate, ensuite, ajout à la file, remplacement, mode radio.
 * - Enceintes : choisir le lecteur, transférer la file, regrouper (multiroom), volume par enceinte.
 * - Vue mini (barre compacte) pour la navbar : un toucher ouvre le lecteur complet en fenêtre.
 * Tout se règle dans l'éditeur visuel.
 */
(() => {
  const VERSION = "1.2.0";
  const TYPES = {
    home: { label: "Accueil", icon: "mdi:home-variant-outline" },
    playlist: { label: "Playlists", icon: "mdi:playlist-music" },
    album: { label: "Albums", icon: "mdi:album" },
    artist: { label: "Artistes", icon: "mdi:account-music" },
    track: { label: "Titres", icon: "mdi:music-note" },
    radio: { label: "Radios", icon: "mdi:radio" },
    podcast: { label: "Podcasts", icon: "mdi:podcast" },
    audiobook: { label: "Livres audio", icon: "mdi:book-music" },
  };
  const DEFAULT_TYPES = ["home", "playlist", "album", "artist", "track", "radio"];
  const SORTS = {
    name: "Nom (A→Z)", name_desc: "Nom (Z→A)", timestamp_added_desc: "Ajout récent", last_played_desc: "Écouté récemment",
    play_count_desc: "Les plus écoutés", year_desc: "Année", random: "Aléatoire",
  };
  const DEFAULTS = { mode: "full", start_tab: "now", artwork: "square", dynamic_color: true, accent: "#26c6da", height: 640, library_types: DEFAULT_TYPES, show_players: true, mini_prev: true, mini_volume: true };
  const G = (window.__holmMusic = window.__holmMusic || { conns: {}, colors: {} });

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (s) => {
    if (s == null || isNaN(s)) return "–";
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(x).padStart(2, "0")}`;
  };
  // ------------------------------------------------------------------
  //  Images : les pochettes de Music Assistant pointent vers son serveur
  //  (http://ip:8095/imageproxy/...), inaccessible depuis une page HTTPS ou
  //  depuis l'extérieur. On les fait passer par l'ingress de l'add-on
  //  (même origine que Home Assistant), ou par une URL fournie (ma_image_url).
  // ------------------------------------------------------------------
  const IMG = (G.img = G.img || { base: null, state: "idle", custom: null });
  const ADDON_SLUGS = ["d5369777_music_assistant", "d5369777_music_assistant_beta", "local_music_assistant"];
  const proxied = (url) => {
    if (!url) return "";
    let u;
    try { u = new URL(url, location.href); } catch (e) { return url; }
    const i = u.pathname.indexOf("/imageproxy");
    if (i < 0 || u.origin === location.origin) return url;
    const base = IMG.custom || IMG.base;
    return base ? base + u.pathname.slice(i + 1) + u.search : url;
  };
  // Music Assistant n'accepte que ces tailles (0 = originale)
  const MA_SIZES = [80, 160, 256, 512, 1024];
  const snap = (n) => MA_SIZES.find((x) => x >= n) || 0;
  const sized = (url, size = 300) => (url ? proxied(String(url).replace(/([?&])size=\d+/, `$1size=${snap(size)}`)) : "");
  const setIngressCookie = (session) => {
    document.cookie = `ingress_session=${session};path=/api/hassio_ingress/;SameSite=Strict${location.protocol === "https:" ? ";Secure" : ""}`;
  };
  const initImages = async (hass, config) => {
    if (config.ma_image_url) { IMG.custom = config.ma_image_url.replace(/\/+$/, "") + "/"; return; }
    if (IMG.state !== "idle" || !hass || !hass.callWS) return;
    if (!(hass.config && hass.config.components && hass.config.components.includes("hassio"))) { IMG.state = "none"; return; }
    IMG.state = "loading";
    const slugs = config.ma_addon ? [config.ma_addon] : ADDON_SLUGS;
    let info = null;
    for (const slug of slugs) {
      try {
        const r = await hass.callWS({ type: "supervisor/api", endpoint: `/addons/${slug}/info`, method: "get" });
        if (r && r.ingress && r.ingress_url) { info = r; break; }
      } catch (e) { /* suivant */ }
    }
    if (!info) { IMG.state = "none"; return; }
    try {
      const s = await hass.callWS({ type: "supervisor/api", endpoint: "/ingress/session", method: "post" });
      if (!s || !s.session) throw new Error("no session");
      IMG.session = s.session;
      setIngressCookie(s.session);
      IMG.base = info.ingress_url.replace(/\/+$/, "") + "/";
      IMG.state = "ready";
      IMG.hass = hass;
      clearInterval(IMG.keep);
      IMG.keep = setInterval(async () => {
        try {
          await IMG.hass.callWS({ type: "supervisor/api", endpoint: "/ingress/validate_session", method: "post", data: { session: IMG.session } });
          setIngressCookie(IMG.session);
        } catch (e) {
          try { const n = await IMG.hass.callWS({ type: "supervisor/api", endpoint: "/ingress/session", method: "post" }); IMG.session = n.session; setIngressCookie(n.session); } catch (e2) { /* ignore */ }
        }
      }, 60000);
      window.dispatchEvent(new CustomEvent("holm-music-images"));
    } catch (e) {
      IMG.state = "none";
    }
  };
  const artists = (it) => (it && (it.artists || []).map((a) => a.name).filter(Boolean).join(", ")) || (it && it.artist) || "";
  const haptic = (t = "light") => window.dispatchEvent(new CustomEvent("haptic", { detail: t }));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ------------------------------------------------------------------
  //  Connexion directe (optionnelle) au serveur Music Assistant
  // ------------------------------------------------------------------
  class MaConn {
    constructor(url, token, ingress = false) {
      this.url = url.replace(/\/+$/, "");
      this.token = token;
      this.ingress = ingress; // via l'ingress de l'add-on : même origine, authentifié par Home Assistant
      this.pending = {};
      this.listeners = new Set();
      this.ready = null;
      this.id = 0;
      this.error = null;
    }
    connect() {
      if (this.ready) return this.ready;
      this.ready = new Promise((resolve, reject) => {
        let ws;
        try {
          ws = new WebSocket(this.ingress ? location.origin.replace(/^http/, "ws") + this.url + "/ws" : this.url.replace(/^http/, "ws") + "/ws");
        } catch (e) {
          this.error = "Adresse invalide";
          this.ready = null;
          return reject(e);
        }
        this.ws = ws;
        let authed = false;
        const fail = (msg) => {
          this.error = msg;
          this.ready = null;
          reject(new Error(msg));
        };
        ws.onmessage = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.server_id && !authed) {
            this.server = m;
            if (this.ingress) { authed = true; this.error = null; resolve(this); return; }
            this.send("auth", { token: this.token }, true).then(() => { authed = true; this.error = null; resolve(this); }).catch((e) => fail(e.message || "Jeton refusé"));
            return;
          }
          if (m.event) { this.listeners.forEach((fn) => fn(m)); return; }
          const p = this.pending[m.message_id];
          if (!p) return;
          if (m.error_code) { delete this.pending[m.message_id]; p.reject(new Error(m.details || m.error_code)); return; }
          if (m.partial) { p.acc = (p.acc || []).concat(m.result || []); return; }
          delete this.pending[m.message_id];
          p.resolve(p.acc ? p.acc.concat(m.result || []) : m.result);
        };
        ws.onerror = () => { if (!authed) fail("Serveur Music Assistant injoignable"); };
        ws.onclose = () => {
          if (this.ws !== ws) return;
          this.ready = null;
          Object.values(this.pending).forEach((p) => p.reject(new Error("Connexion fermée")));
          this.pending = {};
          if (authed) setTimeout(() => this.listeners.size && this.connect().catch(() => {}), 3000);
        };
      });
      return this.ready;
    }
    send(command, args = {}, raw = false) {
      const run = () => new Promise((resolve, reject) => {
        const message_id = `h${++this.id}`;
        this.pending[message_id] = { resolve, reject };
        this.ws.send(JSON.stringify({ message_id, command, args }));
        setTimeout(() => { if (this.pending[message_id]) { delete this.pending[message_id]; reject(new Error("Délai dépassé")); } }, 20000);
      });
      if (raw) return run();
      // une connexion restée ouverte longtemps peut avoir été coupée : on la rouvre une fois
      return this.connect().then(run).catch((e) => {
        if (!/Connexion fermée|Délai dépassé/.test(e.message || "")) throw e;
        try { this.ws && this.ws.close(); } catch (x) { /* déjà fermée */ }
        this.ready = null;
        return this.connect().then(run);
      });
    }
    image(img, size = 128) {
      if (!img) return "";
      if (typeof img === "string") return sized(img, size);
      if (img.remotely_accessible && /^https:/.test(img.path)) return img.path;
      const base = this.ingress ? this.url : (this.server && this.server.base_url) || this.url;
      if (img.proxy_id) return proxied(`${base}/imageproxy/${img.proxy_id}?size=${snap(size)}`);
      return proxied(`${base}/imageproxy?path=${encodeURIComponent(encodeURIComponent(img.path))}&provider=${encodeURIComponent(img.provider)}&size=${snap(size)}`);
    }
  }
  // Connexion automatique par l'ingress de l'add-on (aucun réglage, fonctionne en HTTPS)
  const ingressConn = () => (IMG.state === "ready" && IMG.base ? (G.conns.ingress = G.conns.ingress || new MaConn(IMG.base, null, true)) : null);
  const insecure = (url) => location.protocol === "https:" && /^http:/i.test(url || "");
  const imgOf = (o) => o && (o.image || (o.metadata && o.metadata.images && o.metadata.images.length && (o.metadata.images.find((i) => i.type === "thumb") || o.metadata.images[0]))) || null;
  const getConn = (url, token) => {
    if (!url || !token) return null;
    const k = url + "|" + token;
    return (G.conns[k] = G.conns[k] || new MaConn(url, token));
  };

  // ------------------------------------------------------------------
  //  Couleur dominante de la pochette (image servie par HA : même origine)
  // ------------------------------------------------------------------
  const colorFor = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    if (G.colors[src]) return resolve(G.colors[src]);
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = c.height = 24;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.drawImage(img, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data;
        let best = null, bestScore = -1, sr = 0, sg = 0, sb = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 510, s = mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255));
          sr += r; sg += g; sb += b; n++;
          const score = s * (1 - Math.abs(l - 0.55) * 1.6);
          if (score > bestScore && l > 0.2 && l < 0.85) { bestScore = score; best = [r, g, b]; }
        }
        const avg = [sr / n, sg / n, sb / n].map(Math.round);
        const res = { acc: best && bestScore > 0.18 ? best : null, avg };
        G.colors[src] = res;
        resolve(res);
      } catch (e) { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  // ------------------------------------------------------------------
  //  Carte
  // ------------------------------------------------------------------
  class HolmMusicCard extends HTMLElement {
    static getConfigElement() { return document.createElement("holm-music-card-editor"); }
    static getStubConfig(hass) {
      const e = Object.keys((hass && hass.entities) || {}).find((id) => id.startsWith("media_player.") && hass.entities[id].platform === "music_assistant" && hass.states[id] && hass.states[id].state !== "unavailable");
      return { type: "custom:holm-music-card", entity: e || "" };
    }
    setConfig(config) {
      this._config = { ...DEFAULTS, ...config };
      if (config.ma_url && config.ma_token) G.defaultMa = { url: config.ma_url, token: config.ma_token };
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this._player = this._player && (this._config.players || []).includes(this._player) ? this._player : this._config.entity;
      this._tab = this._tab || this._config.start_tab || "now";
      this._lib = this._lib || { type: (this._config.library_types || DEFAULT_TYPES)[0], fav: false, sort: "", q: "", items: null, stack: [] };
      this._built = false;
      this._render();
    }
    getCardSize() { return this._config && this._config.mode === "mini" ? 1 : 10; }
    getGridOptions() { return this._config && this._config.mode === "mini" ? { columns: 12, min_columns: 6, rows: "auto" } : { columns: 12, min_columns: 6, rows: "auto" }; }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (!this._config) return;
      if (IMG.state === "idle" || this._config.ma_image_url) initImages(hass, this._config);
      if (!this._player || !hass.states[this._player]) this._player = this._config.entity || this._players()[0];
      const st = hass.states[this._player];
      const key = st && [st.state, st.last_updated, st.attributes.media_title, st.attributes.volume_level, st.attributes.is_volume_muted, st.attributes.shuffle, st.attributes.repeat, st.attributes.entity_picture_local, st.attributes.group_members && st.attributes.group_members.join()].join("|");
      if (first || !this._built) this._render();
      else if (key !== this._key) this._updateNow();
      this._key = key;
      if (this._tab === "speakers") this._renderSpeakers();
    }
    connectedCallback() {
      this._tick = setInterval(() => this._progress(), 1000);
      if (!this._onImg) this._onImg = () => {
        this._fixImages();
        if (this._conn()) { this._listen(); if (this._tab === "queue") this._loadQueue(); }
      };
      window.addEventListener("holm-music-images", this._onImg);
      if (this.shadowRoot && !this._errHook) {
        this._errHook = true;
        this.shadowRoot.addEventListener("error", (e) => { const t = e.target; if (t && t.tagName === "IMG" && t.id !== "artimg") t.classList.add("broken"); }, true);
        this.shadowRoot.addEventListener("load", (e) => { const t = e.target; if (t && t.tagName === "IMG") t.classList.remove("broken"); }, true);
      }
      if (this._conn()) this._listen();
    }
    disconnectedCallback() {
      clearInterval(this._tick);
      window.removeEventListener("holm-music-images", this._onImg);
      if (this._unlisten) this._unlisten();
      this._unlisten = null;
    }

    // ---------------- données ----------------
    _players() {
      const h = this._hass;
      if (!h) return [];
      const list = (this._config.players && this._config.players.length) ? this._config.players.slice() : Object.keys(h.entities || {}).filter((id) => id.startsWith("media_player.") && h.entities[id].platform === "music_assistant");
      if (this._config.entity && !list.includes(this._config.entity)) list.unshift(this._config.entity);
      return list.filter((id) => h.states[id] && h.states[id].state !== "unavailable");
    }
    _st() { return this._hass && this._hass.states[this._player]; }
    _fixImages() {
      if (!this.shadowRoot) return;
      this.shadowRoot.querySelectorAll("img").forEach((i) => { const src = i.getAttribute("src"); const n = proxied(src); if (n && n !== src) i.src = n; });
    }
    _entry() {
      if (this._config.config_entry_id) return this._config.config_entry_id;
      const h = this._hass, e = h.entities && h.entities[this._player];
      const dev = e && h.devices && h.devices[e.device_id];
      const ids = (dev && dev.config_entries) || [];
      return ids[0];
    }
    _conn() {
      const c = this._config;
      if (c.ma_url && c.ma_token && !insecure(c.ma_url)) return getConn(c.ma_url, c.ma_token);
      if (G.defaultMa && !insecure(G.defaultMa.url)) return getConn(G.defaultMa.url, G.defaultMa.token);
      return ingressConn();
    }
    _listen() {
      const c = this._conn();
      if (!c || this._unlisten) return;
      const fn = (m) => {
        const st = this._st();
        const q = st && st.attributes.active_queue;
        if (!q || m.object_id !== q) return;
        if (m.event === "queue_items_updated" || m.event === "queue_updated") {
          clearTimeout(this._qT);
          this._qT = setTimeout(() => this._tab === "queue" && this._loadQueue(), 400);
        }
      };
      c.listeners.add(fn);
      this._unlisten = () => c.listeners.delete(fn);
      c.connect().catch(() => {});
    }
    _svc(domain, service, data = {}, target, response = false) {
      const msg = { type: "call_service", domain, service, service_data: data };
      if (target) msg.target = target;
      if (response) msg.return_response = true;
      return this._hass.callWS(msg).then((r) => (response ? r.response : r));
    }
    _mp(service, data = {}, entity = this._player) { return this._hass.callService("media_player", service, { entity_id: entity, ...data }); }
    _toast(msg) {
      const t = this.shadowRoot.getElementById("toast");
      if (!t) return;
      t.textContent = msg;
      t.classList.add("show");
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => t.classList.remove("show"), 2200);
    }

    // ---------------- rendu ----------------
    _render() {
      if (!this._hass || !this._config || !this.shadowRoot) return;
      const c = this._config;
      if (c.mode === "mini") return this._renderMini();
      this._built = true;
      const tabs = [["now", "mdi:music-note", "Lecture"], ["queue", "mdi:playlist-music", "File"], ["library", "mdi:bookshelf", "Bibliothèque"]];
      if (c.show_players) tabs.push(["speakers", "mdi:speaker-multiple", "Enceintes"]);
      this.shadowRoot.innerHTML = `<style>${HolmMusicCard.css()}</style>
        <ha-card class="full" style="--h:${Number(c.height) || 640}px">
          <div class="bg" id="bg"></div><div class="bg2"></div>
          <div class="panes">
            <section class="pane" data-p="now" id="p-now"></section>
            <section class="pane" data-p="queue" id="p-queue"></section>
            <section class="pane" data-p="library" id="p-library"></section>
            <section class="pane" data-p="speakers" id="p-speakers"></section>
          </div>
          <nav class="tabs" id="tabs">${tabs.map(([k, i, l]) => `<button data-tab="${k}" title="${l}"><ha-icon icon="${i}"></ha-icon><span>${l}</span></button>`).join("")}<i class="tab-ind" id="tabind"></i></nav>
          <div class="toast" id="toast"></div>
          <div class="sheet" id="sheet"></div>
        </ha-card>`;
      this.shadowRoot.getElementById("tabs").addEventListener("click", (e) => {
        const b = e.target.closest("[data-tab]");
        if (b) this._setTab(b.dataset.tab);
      });
      this._buildNow();
      this._setTab(this._tab, true);
    }
    _setTab(tab, init) {
      this._tab = tab;
      const r = this.shadowRoot;
      r.querySelectorAll(".pane").forEach((p) => p.classList.toggle("on", p.dataset.p === tab));
      const btns = [...r.querySelectorAll(".tabs button")];
      btns.forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
      const i = btns.findIndex((b) => b.dataset.tab === tab), ind = r.getElementById("tabind");
      if (ind && i >= 0) ind.style.transform = `translateX(${i * 100}%)`, (ind.style.width = `${100 / btns.length}%`);
      if (!init) haptic();
      if (tab === "queue") this._loadQueue();
      if (tab === "library" && !this._lib.items && !this._lib.stack.length) this._loadLib();
      else if (tab === "library") this._renderLib();
      if (tab === "speakers") this._renderSpeakers();
    }

    // ---------------- lecture en cours ----------------
    _buildNow() {
      const p = this.shadowRoot.getElementById("p-now");
      p.innerHTML = `
        <header class="np-head">
          <button class="player-chip" data-act="speakers"><ha-icon icon="mdi:speaker"></ha-icon><span id="pname"></span><ha-icon icon="mdi:chevron-down" class="chev"></ha-icon></button>
          <div class="np-r"><div class="eq" id="eq"><i></i><i></i><i></i><i></i></div><button class="ly-btn" data-act="lyrics" id="b-lyr" title="Paroles"><ha-icon icon="mdi:microphone-variant"></ha-icon></button></div>
        </header>
        <div class="art-wrap" id="artwrap">
          <div class="art" id="art"><img id="artimg" alt=""><div class="hole"></div><div class="noart"><ha-icon icon="mdi:music-circle-outline"></ha-icon></div></div>
          <div class="heart" id="heart"><ha-icon icon="mdi:heart"></ha-icon></div>
        </div>
        <div class="lyr" id="lyr"></div>
        <div class="meta">
          <div class="t marq" id="title"><span></span></div>
          <div class="a" id="artist"></div>
          <div class="al" id="album"></div>
        </div>
        <div class="prog">
          <input type="range" id="seek" min="0" max="100" step="1" value="0">
          <div class="times"><span id="pos">0:00</span><span id="dur">0:00</span></div>
        </div>
        <div class="ctrls">
          <button class="sm" data-act="shuffle" id="b-shuffle" title="Aléatoire"><ha-icon icon="mdi:shuffle-variant"></ha-icon></button>
          <button class="md" data-act="prev" title="Précédent"><ha-icon icon="mdi:skip-previous"></ha-icon></button>
          <button class="play" data-act="play" id="b-play" title="Lecture / pause"><ha-icon icon="mdi:play"></ha-icon></button>
          <button class="md" data-act="next" title="Suivant"><ha-icon icon="mdi:skip-next"></ha-icon></button>
          <button class="sm" data-act="repeat" id="b-repeat" title="Répéter"><ha-icon icon="mdi:repeat-off"></ha-icon></button>
        </div>
        <div class="vol">
          <button class="sm" data-act="mute" id="b-mute"><ha-icon icon="mdi:volume-high"></ha-icon></button>
          <input type="range" id="vol" min="0" max="100" step="1">
          <button class="sm" data-act="fav" id="b-fav" title="Favori"><ha-icon icon="mdi:heart-outline"></ha-icon></button>
          <button class="sm" data-act="addpl" id="b-addpl" title="Ajouter à une playlist"><ha-icon icon="mdi:playlist-plus"></ha-icon></button>
        </div>
        <button class="upnext" data-act="queue" id="upnext"></button>`;
      p.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]");
        if (b) this._act(b.dataset.act, b);
      });
      const seek = p.querySelector("#seek"), vol = p.querySelector("#vol");
      seek.addEventListener("input", () => { this._seeking = true; p.querySelector("#pos").textContent = fmt(seek.value); this._fill(seek); });
      seek.addEventListener("change", () => { this._mp("media_seek", { seek_position: Number(seek.value) }); setTimeout(() => (this._seeking = false), 1200); });
      vol.addEventListener("input", () => { this._fill(vol); this._volT = Date.now(); });
      vol.addEventListener("change", () => this._mp("volume_set", { volume_level: vol.value / 100 }));
      this._gestures(p.querySelector("#artwrap"));
      p.querySelector("#lyr").addEventListener("click", (e) => {
        const l = e.target.closest("[data-t]");
        if (l) { haptic(); this._mp("media_seek", { seek_position: Number(l.dataset.t) }); this._lyrLine = -1; }
      });
      this._updateNow();
    }
    _gestures(el) {
      let x0 = null, t0 = 0, lastTap = 0;
      el.addEventListener("pointerdown", (e) => { x0 = e.clientX; t0 = Date.now(); });
      el.addEventListener("pointerup", (e) => {
        if (x0 == null) return;
        const dx = e.clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 50 && Date.now() - t0 < 600) {
          const art = this.shadowRoot.getElementById("art");
          art.classList.remove("swl", "swr");
          void art.offsetWidth;
          art.classList.add(dx < 0 ? "swl" : "swr");
          this._act(dx < 0 ? "next" : "prev");
          return;
        }
        const now = Date.now();
        if (now - lastTap < 320) { this._act("fav"); lastTap = 0; } else lastTap = now;
      });
    }
    _updateNow() {
      const r = this.shadowRoot, st = this._st();
      if (!r.getElementById("p-now") || !st) return this._config.mode === "mini" && this._renderMini();
      const a = st.attributes, playing = st.state === "playing", idle = !a.media_title;
      const $ = (id) => r.getElementById(id);
      $("pname").textContent = a.friendly_name || this._player;
      $("eq").classList.toggle("on", playing);
      const ttl = $("title").firstElementChild;
      ttl.textContent = a.media_title || (st.state === "off" ? "Enceinte éteinte" : "Rien en lecture");
      requestAnimationFrame(() => { const ov = ttl.scrollWidth - $("title").clientWidth; $("title").classList.toggle("go", ov > 4); $("title").style.setProperty("--d", `${-(ov + 24)}px`); });
      $("artist").textContent = a.media_artist || (idle ? "Choisissez une musique dans la bibliothèque" : "");
      $("album").textContent = a.media_album_name || "";
      const pic = a.entity_picture_local || a.entity_picture || "";
      const img = $("artimg");
      if (img.dataset.src !== pic) {
        img.dataset.src = pic;
        $("art").classList.toggle("empty", !pic);
        if (pic) { img.classList.remove("in"); img.onload = () => img.classList.add("in"); img.src = pic; }
        this._applyColor(pic);
      }
      const art = $("art");
      art.classList.toggle("vinyl", this._config.artwork === "vinyl");
      art.classList.toggle("spin", playing);
      art.classList.toggle("paused", !playing);
      $("b-play").innerHTML = `<ha-icon icon="${playing ? "mdi:pause" : "mdi:play"}"></ha-icon>`;
      $("b-shuffle").classList.toggle("act", !!a.shuffle);
      $("b-repeat").classList.toggle("act", a.repeat && a.repeat !== "off");
      $("b-repeat").innerHTML = `<ha-icon icon="${a.repeat === "one" ? "mdi:repeat-once" : a.repeat === "all" ? "mdi:repeat" : "mdi:repeat-off"}"></ha-icon>`;
      const vol = $("vol");
      if (!this._volT || Date.now() - this._volT > 2500) { vol.value = Math.round((a.volume_level || 0) * 100); this._fill(vol); }
      $("b-mute").innerHTML = `<ha-icon icon="${a.is_volume_muted ? "mdi:volume-off" : (a.volume_level || 0) < 0.35 ? "mdi:volume-low" : (a.volume_level || 0) < 0.7 ? "mdi:volume-medium" : "mdi:volume-high"}"></ha-icon>`;
      const seek = $("seek");
      seek.max = Math.max(1, Math.round(a.media_duration || 0));
      $("dur").textContent = a.media_duration ? fmt(a.media_duration) : "";
      this._progress();
      this._upNext();
      if (this._lyrOn && (a.media_content_id || a.media_title) !== this._lyrKey) this._loadLyrics();
    }
    _position(st) {
      const a = st.attributes;
      if (a.media_position == null) return 0;
      let p = a.media_position;
      if (st.state === "playing" && a.media_position_updated_at) p += (Date.now() - new Date(a.media_position_updated_at).getTime()) / 1000;
      return Math.min(p, a.media_duration || p);
    }
    _progress() {
      const st = this._st(), r = this.shadowRoot;
      if (!st || !r) return;
      const pos = this._position(st), dur = st.attributes.media_duration || 0;
      const seek = r.getElementById("seek");
      if (seek && !this._seeking) {
        seek.value = Math.round(pos);
        this._fill(seek);
        r.getElementById("pos").textContent = dur ? fmt(pos) : "";
      }
      const bar = r.getElementById("mbar");
      if (bar) bar.style.transform = `scaleX(${dur ? Math.min(1, pos / dur) : 0})`;
      if (this._lyrOn) this._syncLyrics(pos);
    }
    _fill(inp) { inp.style.setProperty("--v", `${((inp.value - inp.min) / ((inp.max - inp.min) || 1)) * 100}%`); }
    async _applyColor(pic) {
      const host = this.shadowRoot.querySelector("ha-card");
      if (!host) return;
      const base = this._config.accent || DEFAULTS.accent;
      host.style.setProperty("--art", pic ? `url("${pic}")` : "none");
      if (!this._config.dynamic_color || !pic) { host.style.setProperty("--acc", base); return; }
      const c = await colorFor(pic);
      if (!c) return host.style.setProperty("--acc", base);
      const acc = c.acc || c.avg;
      const [r, g, b] = acc;
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const k = lum < 0.45 ? 1.45 : 1;
      host.style.setProperty("--acc", `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`);
      host.style.setProperty("--tint", `rgb(${c.avg.join(",")})`);
    }
    async _upNext() {
      const el = this.shadowRoot.getElementById("upnext");
      if (!el) return;
      const st = this._st();
      if (!st || !st.attributes.media_title) { el.classList.remove("show"); return; }
      const k = st.attributes.media_content_id;
      if (this._nextKey === k && this._nextItem !== undefined) return this._drawUpNext();
      this._nextKey = k;
      try {
        const r = await this._svc("music_assistant", "get_queue", {}, { entity_id: this._player }, true);
        const q = r && r[this._player];
        this._nextItem = q && q.next_item ? q.next_item : null;
        this._queueInfo = q;
      } catch (e) { this._nextItem = null; }
      this._drawUpNext();
    }
    _drawUpNext() {
      const el = this.shadowRoot.getElementById("upnext"), n = this._nextItem;
      if (!el) return;
      el.classList.toggle("show", !!n);
      if (!n) return;
      const m = n.media_item || {};
      el.innerHTML = `<span class="lbl">À suivre</span>${(m.image || (m.album && m.album.image)) ? `<img src="${esc(sized(m.image || (m.album && m.album.image), 96))}" alt="">` : `<span class="noimg"><ha-icon icon="mdi:music-note"></ha-icon></span>`}<span class="nx"><b>${esc(m.name || n.name)}</b><small>${esc(artists(m))}</small></span><ha-icon icon="mdi:chevron-right"></ha-icon>`;
    }
    async _act(act, el) {
      const st = this._st();
      haptic(act === "fav" ? "success" : "light");
      switch (act) {
        case "play": return this._mp("media_play_pause");
        case "next": return this._mp("media_next_track");
        case "prev": return this._mp("media_previous_track");
        case "shuffle": return this._mp("shuffle_set", { shuffle: !(st && st.attributes.shuffle) });
        case "repeat": {
          const cur = (st && st.attributes.repeat) || "off";
          return this._mp("repeat_set", { repeat: cur === "off" ? "all" : cur === "all" ? "one" : "off" });
        }
        case "mute": return this._mp("volume_mute", { is_volume_muted: !(st && st.attributes.is_volume_muted) });
        case "fav": return this._favorite();
        case "lyrics": return this._toggleLyrics();
        case "addpl": return this._addToPlaylist();
        case "vol": return this._miniVol();
        case "queue": return this._setTab("queue");
        case "speakers": return this._config.show_players ? this._setTab("speakers") : this._pickPlayer();
      }
    }
    // ---------------- morceau en cours (Music Assistant) ----------------
    async _currentItem() {
      const c = this._conn(), st = this._st(), qid = st && st.attributes.active_queue;
      if (!c || !qid) throw new Error("Connexion à Music Assistant indisponible");
      const q = await c.send("player_queues/get", { queue_id: qid });
      const it = q && q.current_item, m = it && it.media_item;
      if (!m || !m.uri) throw new Error("Aucun morceau en lecture");
      return m;
    }

    // ---------------- ajouter à une playlist ----------------
    async _addToPlaylist(item) {
      const c = this._conn();
      if (!c) return this._toast("Connexion à Music Assistant indisponible");
      try {
        const m = item || await this._currentItem();
        const all = await c.send("music/playlists/library_items", { limit: 500, offset: 0, order_by: "name" });
        const lists = (all || []).filter((p) => p.is_editable && !(p.provider_mappings || []).some((x) => /smart/.test(x.provider_domain || x.provider_instance || "")));
        if (!lists.length) return this._toast("Aucune playlist modifiable");
        this._sheet(`Ajouter « ${m.name} »`, "Choisissez une playlist", lists.map((p) => ["mdi:playlist-music", esc(p.name), String(p.item_id)]), async (id) => {
          const pl = lists.find((p) => String(p.item_id) === id);
          await c.send("music/playlists/add_playlist_tracks", { db_playlist_id: id, uris: [m.uri] });
          this._toast(`Ajouté à « ${pl ? pl.name : "la playlist"} »`);
          haptic("success");
        });
      } catch (err) { this._toast(err.message || "Action impossible"); }
    }

    // ---------------- paroles ----------------
    _toggleLyrics() {
      this._lyrOn = !this._lyrOn;
      const p = this.shadowRoot.getElementById("p-now");
      p.classList.toggle("lyon", this._lyrOn);
      this.shadowRoot.getElementById("b-lyr").classList.toggle("act", this._lyrOn);
      if (this._lyrOn) this._loadLyrics();
    }
    async _loadLyrics() {
      const box = this.shadowRoot.getElementById("lyr"), st = this._st();
      if (!box || !st) return;
      const key = st.attributes.media_content_id || st.attributes.media_title;
      this._lyrKey = key;
      this._lyr = null; this._lyrLine = -1;
      box.innerHTML = this._loading();
      let text = "", lrc = "";
      try {
        const m = await this._currentItem();
        const cache = (G.lyrics = G.lyrics || {});
        let md = cache[m.uri];
        if (!md) {
          const full = await this._conn().send("music/item_by_uri", { uri: m.uri });
          md = (full && full.metadata) || {};
          cache[m.uri] = { lyrics: md.lyrics || "", lrc_lyrics: md.lrc_lyrics || "" };
          md = cache[m.uri];
        }
        text = md.lyrics; lrc = md.lrc_lyrics;
      } catch (err) {
        if (this._lyrKey === key) box.innerHTML = `<div class="ly-empty"><ha-icon icon="mdi:microphone-off"></ha-icon><b>Paroles indisponibles</b><small>${esc(err.message || "")}</small></div>`;
        return;
      }
      if (this._lyrKey !== key) return;
      const lines = [];
      if (lrc) {
        lrc.split(/\r?\n/).forEach((l) => {
          const tags = [...l.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
          const txt = l.replace(/\[[^\]]*\]/g, "").trim();
          tags.forEach((t) => lines.push({ t: Number(t[1]) * 60 + Number(t[2]), txt }));
        });
        lines.sort((a, b) => a.t - b.t);
      }
      if (lines.length) {
        this._lyr = lines;
        box.innerHTML = `<div class="ly-list synced">${lines.map((l, i) => `<p data-i="${i}" data-t="${l.t.toFixed(2)}">${esc(l.txt) || "♪"}</p>`).join("")}</div>`;
        this._syncLyrics(this._position(st), true);
      } else if (text) {
        box.innerHTML = `<div class="ly-list">${text.split(/\r?\n/).map((l) => `<p>${esc(l) || "&nbsp;"}</p>`).join("")}</div>`;
      } else {
        box.innerHTML = `<div class="ly-empty"><ha-icon icon="mdi:microphone-off"></ha-icon><b>Pas de paroles pour ce titre</b><small>Music Assistant n'en a pas trouvé. Activez un fournisseur de paroles (LRCLIB) dans ses réglages pour en obtenir davantage.</small></div>`;
      }
    }
    _syncLyrics(pos, force) {
      const L = this._lyr;
      if (!L) return;
      let i = -1;
      for (let k = 0; k < L.length; k++) { if (L[k].t <= pos + 0.3) i = k; else break; }
      if (i === this._lyrLine && !force) return;
      this._lyrLine = i;
      const box = this.shadowRoot.getElementById("lyr");
      if (!box) return;
      box.querySelectorAll("p.on, p.past").forEach((p) => p.classList.remove("on", "past"));
      box.querySelectorAll("p").forEach((p, k) => { if (k < i) p.classList.add("past"); });
      const cur = box.querySelector(`p[data-i="${i}"]`);
      if (cur) {
        cur.classList.add("on");
        box.scrollTo({ top: cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2, behavior: force ? "auto" : "smooth" });
      }
    }

    async _favorite() {
      const h = this._hass, e = h.entities[this._player];
      const btn = Object.keys(h.entities).find((id) => id.startsWith("button.") && h.entities[id].device_id === e.device_id && /favorite/.test(id) && h.states[id] && h.states[id].state !== "unavailable");
      const heart = this.shadowRoot.getElementById("heart");
      if (heart) { heart.classList.remove("pop"); void heart.offsetWidth; heart.classList.add("pop"); }
      const fav = this.shadowRoot.getElementById("b-fav");
      if (fav) fav.innerHTML = `<ha-icon icon="mdi:heart"></ha-icon>`, fav.classList.add("act");
      try {
        if (btn) await h.callService("button", "press", { entity_id: btn });
        else if (this._conn()) await this._conn().send("players/add_currently_playing_to_favorites", { player_id: e.unique_id || this._player });
        this._toast("Ajouté aux favoris ♥");
      } catch (err) { this._toast("Impossible d'ajouter aux favoris"); }
    }
    _pickPlayer() {
      const list = this._players();
      const i = list.indexOf(this._player);
      this._player = list[(i + 1) % list.length] || this._player;
      this._key = null;
      this._nextKey = null;
      this._updateNow();
    }

    // ---------------- file d'attente ----------------
    async _loadQueue() {
      const p = this.shadowRoot.getElementById("p-queue"), st = this._st();
      if (!p || !st) return;
      if (!p.dataset.bound) {
        p.dataset.bound = "1";
        p.addEventListener("click", (e) => this._queueClick(e));
      }
      const conn = this._conn();
      const qid = st.attributes.active_queue;
      if (conn && qid) {
        if (!this._qItems) p.innerHTML = this._loading();
        try {
          const [items, q] = await Promise.all([conn.send("player_queues/items", { queue_id: qid, limit: 300, offset: 0 }), conn.send("player_queues/get", { queue_id: qid })]);
          this._qItems = items || [];
          this._qMeta = q || {};
          this._qConn = conn;
          this._listen();
          return this._renderQueue();
        } catch (e) {
          this._qErr = e.message;
        }
      }
      try {
        const r = await this._svc("music_assistant", "get_queue", {}, { entity_id: this._player }, true);
        const q = r && r[this._player];
        this._qItems = null;
        this._qMeta = q;
        this._qConn = null;
        this._renderQueueLite(q);
      } catch (e) {
        p.innerHTML = this._empty("mdi:playlist-remove", "File d'attente indisponible", e.message);
      }
    }
    _qRow(it, i, cur) {
      const m = it.media_item || {};
      const img = this._qConn ? this._qConn.image(imgOf(it) || imgOf(m) || imgOf(m.album), 96) : sized(m.image || (m.album && m.album.image), 96);
      const past = i < cur;
      return `<div class="qrow${i === cur ? " cur" : ""}${past ? " past" : ""}" data-i="${i}" data-id="${esc(it.queue_item_id)}">
        <button class="qmain" data-q="play"><span class="thumb">${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : `<ha-icon icon="mdi:music-note"></ha-icon>`}${i === cur ? `<span class="eq on mini"><i></i><i></i><i></i></span>` : ""}</span>
        <span class="qt"><b>${esc(m.name || it.name)}</b><small>${esc(artists(m) || "")}</small></span><span class="qd">${fmt(it.duration)}</span></button>
        ${this._qConn ? `<button class="qmore" data-q="more"><ha-icon icon="mdi:dots-vertical"></ha-icon></button>` : ""}</div>`;
    }
    _renderQueue() {
      const p = this.shadowRoot.getElementById("p-queue"), items = this._qItems || [], q = this._qMeta || {};
      const cur = q.current_index != null ? q.current_index : -1;
      const left = items.slice(Math.max(cur, 0)).reduce((s, it) => s + (it.duration || 0), 0);
      p.innerHTML = `<header class="phead"><div><h3>File d'attente</h3><small>${items.length} titre${items.length > 1 ? "s" : ""}${left ? ` · ${fmt(left)} restantes` : ""}</small></div>
        <div class="hbtns"><button data-q="save" title="Enregistrer comme playlist"><ha-icon icon="mdi:playlist-plus"></ha-icon></button><button data-q="clear" title="Vider la file"><ha-icon icon="mdi:playlist-remove"></ha-icon></button></div></header>
        <div class="qlist" id="qlist">${items.length ? items.map((it, i) => this._qRow(it, i, cur)).join("") : this._empty("mdi:playlist-music-outline", "La file est vide", "Ajoutez des titres depuis la bibliothèque")}</div>`;
      const curEl = p.querySelector(".qrow.cur");
      if (curEl) requestAnimationFrame(() => curEl.scrollIntoView({ block: "center" }));
    }
    _renderQueueLite(q) {
      const p = this.shadowRoot.getElementById("p-queue");
      if (!q || !q.current_item) { p.innerHTML = this._empty("mdi:playlist-music-outline", "La file est vide", "Ajoutez des titres depuis la bibliothèque"); return; }
      const rows = [q.current_item, q.next_item].filter(Boolean).map((it, i) => this._qRow(it, i, 0)).join("");
      p.innerHTML = `<header class="phead"><div><h3>File d'attente</h3><small>${q.items} titre${q.items > 1 ? "s" : ""} · position ${(q.current_index || 0) + 1}</small></div></header>
        <div class="qlist">${rows}</div>
        <div class="hint"><ha-icon icon="mdi:link-variant"></ha-icon><div><b>Afficher toute la file</b><small>Renseignez l'adresse de Music Assistant et un jeton dans l'éditeur de la carte pour voir, réordonner et modifier toute la file d'attente.${this._qErr ? `<br><em>${esc(this._qErr)}</em>` : ""}</small></div></div>`;
    }
    async _queueClick(e) {
      const b = e.target.closest("[data-q]");
      if (!b) return;
      const row = b.closest(".qrow"), c = this._qConn, st = this._st(), qid = st && st.attributes.active_queue;
      haptic();
      try {
        if (b.dataset.q === "play" && row) {
          if (c) await c.send("player_queues/play_index", { queue_id: qid, index: row.dataset.id });
          else if (Number(row.dataset.i) === 1) await this._mp("media_next_track");
          return;
        }
        if (b.dataset.q === "more" && row) return this._queueSheet(row);
        if (b.dataset.q === "clear" && c) {
          if (!confirm("Vider la file d'attente ?")) return;
          await c.send("player_queues/clear", { queue_id: qid });
          return this._loadQueue();
        }
        if (b.dataset.q === "save" && c) {
          const name = prompt("Nom de la nouvelle playlist", `File ${new Date().toLocaleDateString("fr-FR")}`);
          if (!name) return;
          await c.send("player_queues/save_as_playlist", { queue_id: qid, name });
          this._toast("Playlist créée");
        }
      } catch (err) { this._toast(err.message || "Action impossible"); }
    }
    _queueSheet(row) {
      const i = Number(row.dataset.i), it = this._qItems[i], m = it.media_item || {};
      const cur = (this._qMeta && this._qMeta.current_index) || 0;
      this._sheet(m.name || it.name, artists(m), [
        ["mdi:play", "Lire maintenant", "play"],
        i > cur + 1 ? ["mdi:playlist-play", "Lire ensuite", "next"] : null,
        i > 0 ? ["mdi:arrow-up", "Monter", "up"] : null,
        i < this._qItems.length - 1 ? ["mdi:arrow-down", "Descendre", "down"] : null,
        ["mdi:arrow-collapse-down", "Déplacer à la fin", "end"],
        m.uri ? ["mdi:playlist-plus", "Ajouter à une playlist", "addpl"] : null,
        ["mdi:delete-outline", "Retirer de la file", "del", "danger"],
      ], async (k) => {
        if (k === "addpl") return setTimeout(() => this._addToPlaylist(m), 350);
        const c = this._qConn, qid = this._st().attributes.active_queue, id = it.queue_item_id;
        const cmds = {
          play: ["player_queues/play_index", { queue_id: qid, index: id }],
          next: ["player_queues/move_item", { queue_id: qid, queue_item_id: id, pos_shift: cur + 1 - i }],
          up: ["player_queues/move_item", { queue_id: qid, queue_item_id: id, pos_shift: -1 }],
          down: ["player_queues/move_item", { queue_id: qid, queue_item_id: id, pos_shift: 1 }],
          end: ["player_queues/move_item_end", { queue_id: qid, queue_item_id: id }],
          del: ["player_queues/delete_item", { queue_id: qid, item_id_or_index: id }],
        };
        await c.send(...cmds[k]);
        this._loadQueue();
      });
    }

    // ---------------- bibliothèque ----------------
    _types() { return (this._config.library_types && this._config.library_types.length ? this._config.library_types : DEFAULT_TYPES).filter((t) => TYPES[t]); }
    async _loadLib(more) {
      const L = this._lib;
      if (L.type === "home" && !L.q) return this._loadHome();
      const entry = this._entry();
      if (!entry) { this._libError("Intégration Music Assistant introuvable pour ce lecteur."); return; }
      if (!more) { L.items = null; L.offset = 0; L.end = false; this._renderLib(); }
      const seq = (this._libSeq = (this._libSeq || 0) + 1);
      try {
        if (L.q && (L.global || L.type === "home")) {
          const types = L.type === "home" ? ["artist", "album", "track", "playlist", "radio"] : [L.type];
          const r = await this._svc("music_assistant", "search", { config_entry_id: entry, name: L.q, media_type: types, limit: 25 }, null, true);
          if (seq !== this._libSeq) return;
          L.results = r;
          L.items = [];
          ["artists", "albums", "tracks", "playlists", "radio", "podcasts", "audiobooks"].forEach((k) => (L.items = L.items.concat((r && r[k]) || [])));
          L.end = true;
        } else {
          const data = { config_entry_id: entry, media_type: L.type, limit: 60, offset: L.offset || 0 };
          if (L.fav) data.favorite = true;
          if (L.q) data.search = L.q;
          if (L.sort) data.order_by = L.sort;
          if (L.type === "artist") data.album_artists_only = true;
          const r = await this._svc("music_assistant", "get_library", data, null, true);
          if (seq !== this._libSeq) return;
          const items = (r && r.items) || [];
          L.items = (more ? L.items || [] : []).concat(items);
          L.offset = (L.offset || 0) + items.length;
          L.end = items.length < 60;
          L.results = null;
        }
      } catch (e) {
        return this._libError(e.message);
      }
      this._renderLib();
    }
    async _loadHome() {
      const L = this._lib, entry = this._entry();
      if (!entry) return this._libError("Intégration Music Assistant introuvable pour ce lecteur.");
      L.items = null;
      this._renderLib();
      const q = (media_type, extra) => this._svc("music_assistant", "get_library", { config_entry_id: entry, media_type, limit: 16, ...extra }, null, true).then((r) => (r && r.items) || []).catch(() => []);
      const [recentAlb, recentPl, favPl, favAlb, radios, recentTr] = await Promise.all([
        q("album", { order_by: "last_played_desc" }), q("playlist", { order_by: "last_played_desc" }), q("playlist", { favorite: true }),
        q("album", { favorite: true, order_by: "random" }), q("radio", { favorite: true }), q("track", { order_by: "timestamp_added_desc" }),
      ]);
      L.home = [
        ["Écouté récemment", recentAlb.concat(recentPl).slice(0, 16)],
        ["Playlists favorites", favPl],
        ["Albums coup de cœur", favAlb],
        ["Radios", radios],
        ["Ajouté récemment", recentTr.slice(0, 12)],
      ].filter(([, l]) => l.length);
      L.items = [];
      this._renderLib();
    }
    _libError(msg) {
      const p = this.shadowRoot.getElementById("p-library");
      if (p) p.innerHTML = this._libHead() + this._empty("mdi:alert-circle-outline", "Bibliothèque indisponible", msg);
      this._bindLib();
    }
    _libHead() {
      const L = this._lib;
      return `<div class="lhead">
        <div class="search"><ha-icon icon="mdi:magnify"></ha-icon><input id="lq" type="search" placeholder="${L.global ? "Rechercher partout (tous les services)" : "Rechercher dans la bibliothèque"}" value="${esc(L.q)}">
          <button class="gl${L.global ? " act" : ""}" data-l="global" title="Rechercher aussi sur les services de streaming"><ha-icon icon="mdi:earth"></ha-icon></button></div>
        <div class="chips">${this._types().map((t) => `<button class="chip${L.type === t ? " on" : ""}" data-type="${t}"><ha-icon icon="${TYPES[t].icon}"></ha-icon>${TYPES[t].label}</button>`).join("")}</div>
        ${L.type !== "home" && !(L.q && L.global) ? `<div class="filters"><button class="chip sm${L.fav ? " on" : ""}" data-l="fav"><ha-icon icon="mdi:heart"></ha-icon>Favoris</button>
          <select id="lsort"><option value="">Tri par défaut</option>${Object.entries(SORTS).map(([k, v]) => `<option value="${k}"${L.sort === k ? " selected" : ""}>${v}</option>`).join("")}</select></div>` : ""}
      </div>`;
    }
    _tile(it, i) {
      const round = it.media_type === "artist";
      const img = sized(it.image || (it.album && it.album.image), 300);
      const sub = it.media_type === "album" ? `${artists(it)}${it.year ? ` · ${it.year}` : ""}` : it.media_type === "artist" ? "Artiste" : it.media_type === "playlist" ? (it.owner || "Playlist") : it.media_type === "radio" ? "Radio" : artists(it);
      return `<button class="tile${round ? " round" : ""}" data-i="${i}"><span class="cover">${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : `<ha-icon icon="${(TYPES[it.media_type] || TYPES.track).icon}"></ha-icon>`}<span class="tplay" data-quick="1"><ha-icon icon="mdi:play"></ha-icon></span>${it.favorite ? `<ha-icon class="tfav" icon="mdi:heart"></ha-icon>` : ""}</span><b>${esc(it.name)}</b><small>${esc(sub)}</small></button>`;
    }
    _row(it, i) {
      const img = sized(it.image || (it.album && it.album.image), 96);
      return `<button class="lrow" data-i="${i}"><span class="thumb">${img ? `<img src="${esc(img)}" loading="lazy" alt="">` : `<ha-icon icon="mdi:music-note"></ha-icon>`}</span><span class="qt"><b>${esc(it.name)}</b><small>${esc([artists(it), it.album && it.album.name].filter(Boolean).join(" · "))}</small></span>${it.duration ? `<span class="qd">${fmt(it.duration)}</span>` : ""}<span class="rmore" data-quick="more"><ha-icon icon="mdi:dots-vertical"></ha-icon></span></button>`;
    }
    _renderLib() {
      const p = this.shadowRoot.getElementById("p-library");
      if (!p) return;
      const L = this._lib;
      if (L.stack.length) return this._renderDetail();
      let body;
      this._libList = [];
      if (L.items == null) body = this._loading();
      else if (L.type === "home" && !L.q) {
        body = (L.home || []).map(([title, list]) => {
          const start = this._libList.length;
          this._libList.push(...list);
          return `<div class="shelf"><h4>${title}</h4><div class="hscroll">${list.map((it, k) => this._tile(it, start + k)).join("")}</div></div>`;
        }).join("") || this._empty("mdi:music-box-multiple-outline", "Votre bibliothèque est vide", "Ajoutez des services de musique dans Music Assistant");
      } else if (L.results) {
        const groups = [["artists", "Artistes"], ["albums", "Albums"], ["tracks", "Titres"], ["playlists", "Playlists"], ["radio", "Radios"], ["podcasts", "Podcasts"], ["audiobooks", "Livres audio"]];
        body = groups.map(([k, t]) => {
          const list = (L.results[k] || []);
          if (!list.length) return "";
          const start = this._libList.length;
          this._libList.push(...list);
          return k === "tracks" ? `<div class="shelf"><h4>${t}</h4>${list.slice(0, 12).map((it, j) => this._row(it, start + j)).join("")}</div>` : `<div class="shelf"><h4>${t}</h4><div class="hscroll">${list.map((it, j) => this._tile(it, start + j)).join("")}</div></div>`;
        }).join("") || this._empty("mdi:magnify-close", "Aucun résultat", `pour « ${esc(L.q)} »`);
      } else {
        this._libList = L.items;
        body = !L.items.length ? this._empty("mdi:music-off", L.fav ? "Aucun favori" : "Rien ici", L.q ? `pour « ${esc(L.q)} »` : "") : L.type === "track" ? `<div class="rows">${L.items.map((it, i) => this._row(it, i)).join("")}</div>` : `<div class="grid">${L.items.map((it, i) => this._tile(it, i)).join("")}</div>`;
        if (!L.end && L.items.length) body += `<button class="more" data-l="more">Afficher plus</button>`;
      }
      p.innerHTML = this._libHead() + `<div class="lbody" id="lbody">${body}</div>`;
      this._bindLib();
    }
    _bindLib() {
      const p = this.shadowRoot.getElementById("p-library");
      if (!p || p.dataset.bound) return;
      p.dataset.bound = "1";
      p.addEventListener("click", (e) => {
        const L = this._lib;
        const t = e.target.closest("[data-type]");
        if (t) { L.type = t.dataset.type; L.q = L.q && L.global ? L.q : ""; L.stack = []; haptic(); return this._loadLib(); }
        const l = e.target.closest("[data-l]");
        if (l) {
          haptic();
          if (l.dataset.l === "fav") { L.fav = !L.fav; return this._loadLib(); }
          if (l.dataset.l === "global") { L.global = !L.global; this._renderLib(); if (L.q) this._loadLib(); return; }
          if (l.dataset.l === "more") return this._loadLib(true);
          if (l.dataset.l === "back") { L.stack.pop(); return L.stack.length ? this._renderDetail() : this._renderLib(); }
        }
        const d = e.target.closest("[data-d]");
        if (d) return this._detailAction(d.dataset.d, d);
        const tile = e.target.closest("[data-i]");
        if (tile && p.contains(tile)) {
          const list = L.stack.length ? L.stack[L.stack.length - 1].children : this._libList;
          const it = list && list[Number(tile.dataset.i)];
          if (!it) return;
          const quick = e.target.closest("[data-quick]");
          haptic();
          if (quick && quick.dataset.quick === "1") return this._play(it, "play");
          if (quick && quick.dataset.quick === "more") return this._itemSheet(it);
          if (["album", "artist", "playlist", "podcast", "audiobook"].includes(it.media_type) && !(quick && quick.dataset.quick === "1")) return this._openDetail(it);
          return this._itemSheet(it);
        }
      });
      p.addEventListener("input", (e) => {
        if (e.target.id !== "lq") return;
        clearTimeout(this._qT2);
        this._qT2 = setTimeout(() => { this._lib.q = e.target.value.trim(); this._lib.stack = []; this._loadLib(); }, 450);
      });
      p.addEventListener("change", (e) => {
        if (e.target.id === "lsort") { this._lib.sort = e.target.value; this._loadLib(); }
      });
    }
    async _openDetail(it) {
      const L = this._lib;
      const node = { item: it, children: null };
      L.stack.push(node);
      this._renderDetail();
      try {
        const r = await this._hass.callWS({ type: "media_player/browse_media", entity_id: this._player, media_content_id: it.uri, media_content_type: it.media_type });
        node.children = (r.children || []).map((c) => ({
          name: c.title.includes(" - ") && it.media_type !== "artist" ? c.title.split(" - ").slice(1).join(" - ") : c.title,
          artist: c.title.includes(" - ") && it.media_type !== "artist" ? c.title.split(" - ")[0] : "",
          uri: c.media_content_id,
          media_type: c.media_class === "album" ? "album" : c.media_class === "track" ? "track" : c.media_content_type === "music" ? "track" : c.media_class,
          image: c.thumbnail,
          expand: c.can_expand,
        }));
      } catch (e) {
        node.error = e.message;
      }
      if (L.stack[L.stack.length - 1] === node) this._renderDetail();
    }
    _renderDetail() {
      const p = this.shadowRoot.getElementById("p-library"), L = this._lib, node = L.stack[L.stack.length - 1], it = node.item;
      const img = sized(it.image, 500);
      const tracks = node.children || [];
      const isArtist = it.media_type === "artist";
      const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
      let list = this._loading();
      if (node.error) list = this._empty("mdi:alert-circle-outline", "Contenu indisponible", node.error);
      else if (node.children) list = isArtist ? `<div class="grid">${tracks.map((t, i) => this._tile(t, i)).join("")}</div>` : `<div class="rows">${tracks.map((t, i) => `<button class="lrow" data-i="${i}"><span class="num">${i + 1}</span><span class="qt"><b>${esc(t.name)}</b><small>${esc(t.artist)}</small></span><span class="rmore" data-quick="more"><ha-icon icon="mdi:dots-vertical"></ha-icon></span></button>`).join("")}</div>`;
      p.innerHTML = `<div class="detail">
        <button class="back" data-l="back"><ha-icon icon="mdi:arrow-left"></ha-icon>Retour</button>
        <div class="dhead${isArtist ? " artist" : ""}"><span class="dcover">${img ? `<img src="${esc(img)}" alt="">` : `<ha-icon icon="${TYPES[it.media_type] ? TYPES[it.media_type].icon : "mdi:music"}"></ha-icon>`}</span>
          <div class="dinfo"><small>${esc((TYPES[it.media_type] || {}).label || "")}</small><h3>${esc(it.name)}</h3><p>${esc(isArtist ? "" : artists(it))}${it.year ? ` · ${it.year}` : ""}${node.children && !isArtist ? ` · ${tracks.length} titres` : ""}${total ? ` · ${fmt(total)}` : ""}</p>
          <div class="dact"><button class="pbtn" data-d="play"><ha-icon icon="mdi:play"></ha-icon>Lire</button><button class="ibtn" data-d="shuffle" title="Lecture aléatoire"><ha-icon icon="mdi:shuffle-variant"></ha-icon></button><button class="ibtn" data-d="radio" title="Radio (titres similaires)"><ha-icon icon="mdi:radio-tower"></ha-icon></button><button class="ibtn" data-d="more" title="Plus d'options"><ha-icon icon="mdi:dots-horizontal"></ha-icon></button></div></div></div>
        ${list}</div>`;
    }
    async _detailAction(k) {
      const node = this._lib.stack[this._lib.stack.length - 1], it = node.item;
      haptic();
      if (k === "play") return this._play(it, "play");
      if (k === "radio") return this._play(it, "play", true);
      if (k === "more") return this._itemSheet(it);
      if (k === "shuffle") {
        await this._mp("shuffle_set", { shuffle: true }).catch(() => {});
        return this._play(it, "replace");
      }
    }
    _itemSheet(it) {
      const radioable = ["track", "artist", "album", "playlist"].includes(it.media_type);
      this._sheet(it.name, artists(it) || (TYPES[it.media_type] || {}).label, [
        ["mdi:play", "Lire maintenant", "play"],
        ["mdi:playlist-play", "Lire ensuite", "next"],
        ["mdi:playlist-plus", "Ajouter à la file", "add"],
        ["mdi:playlist-remove", "Remplacer la file", "replace"],
        radioable ? ["mdi:radio-tower", "Lancer une radio (titres similaires)", "radio"] : null,
        ["album", "artist", "playlist"].includes(it.media_type) ? ["mdi:open-in-new", "Ouvrir", "open"] : null,
      ], (k) => (k === "open" ? this._openDetail(it) : this._play(it, k === "radio" ? "play" : k, k === "radio")));
    }
    async _play(it, enqueue = "play", radio = false) {
      const data = { media_id: it.uri, enqueue };
      if (it.media_type && it.media_type !== "folder") data.media_type = it.media_type;
      if (radio) data.radio_mode = true;
      try {
        await this._hass.callService("music_assistant", "play_media", data, { entity_id: this._player });
        this._toast({ play: "Lecture…", replace: "Lecture…", next: "Lu ensuite", add: "Ajouté à la file", replace_next: "Ajouté" }[enqueue] || "OK");
        if (enqueue === "play" || enqueue === "replace") setTimeout(() => this._setTab("now"), 350);
        this._nextKey = null;
      } catch (e) {
        this._toast(e.message || "Lecture impossible");
      }
    }

    // ---------------- enceintes ----------------
    _renderSpeakers() {
      const p = this.shadowRoot.getElementById("p-speakers");
      if (!p) return;
      const h = this._hass, list = this._players(), cur = this._st();
      const members = (cur && cur.attributes.group_members) || [];
      const html = list.map((id) => {
        const s = h.states[id], a = s.attributes, active = id === this._player, grouped = members.includes(id) && !active;
        const vol = Math.round((a.volume_level || 0) * 100);
        const pic = a.entity_picture_local || a.entity_picture;
        return `<div class="spk${active ? " active" : ""}${s.state === "playing" ? " playing" : ""}" data-id="${id}">
          <button class="spk-main" data-s="select"><span class="spk-ic">${pic ? `<img src="${esc(pic)}" alt="">` : `<ha-icon icon="${a.icon || "mdi:speaker"}"></ha-icon>`}${s.state === "playing" ? `<span class="eq on mini"><i></i><i></i><i></i></span>` : ""}</span>
            <span class="qt"><b>${esc(a.friendly_name || id)}</b><small>${s.state === "playing" ? esc([a.media_title, a.media_artist].filter(Boolean).join(" · ")) : { idle: "Disponible", off: "Éteinte", paused: "En pause" }[s.state] || s.state}</small></span>
            ${active ? `<span class="badge">Actif</span>` : ""}</button>
          <div class="spk-ctl"><ha-icon icon="mdi:volume-medium"></ha-icon><input type="range" min="0" max="100" value="${vol}" data-s="vol" style="--v:${vol}%">
          ${!active ? `<button class="mini-btn${grouped ? " on" : ""}" data-s="group" title="${grouped ? "Retirer du groupe" : "Écouter aussi ici"}"><ha-icon icon="${grouped ? "mdi:link-variant-off" : "mdi:link-variant-plus"}"></ha-icon></button><button class="mini-btn" data-s="transfer" title="Transférer la lecture ici"><ha-icon icon="mdi:swap-horizontal"></ha-icon></button>` : ""}</div></div>`;
      }).join("");
      const sig = list.map((id) => { const a = h.states[id]; return a.state + a.attributes.volume_level + a.attributes.media_title; }).join() + this._player + members.join();
      if (p.dataset.sig === sig) return;
      if (p.contains(this.shadowRoot.activeElement)) return;
      p.dataset.sig = sig;
      p.innerHTML = `<header class="phead"><div><h3>Enceintes</h3><small>Choisissez, regroupez ou transférez la musique</small></div></header><div class="spks">${html || this._empty("mdi:speaker-off", "Aucune enceinte Music Assistant", "")}</div>`;
      if (!p.dataset.bound) {
        p.dataset.bound = "1";
        p.addEventListener("click", (e) => this._spkClick(e));
        p.addEventListener("change", (e) => {
          const r = e.target.closest("[data-s=vol]");
          if (r) this._mp("volume_set", { volume_level: r.value / 100 }, r.closest(".spk").dataset.id);
        });
        p.addEventListener("input", (e) => { if (e.target.matches("input[type=range]")) this._fill(e.target); });
      }
    }
    async _spkClick(e) {
      const b = e.target.closest("[data-s]");
      if (!b || b.dataset.s === "vol") return;
      const id = b.closest(".spk").dataset.id;
      haptic();
      try {
        if (b.dataset.s === "select") {
          this._player = id;
          this._key = null;
          this._nextKey = null;
          this._qItems = null;
          if (this._unlisten) { this._unlisten(); this._unlisten = null; }
          this._updateNow();
          this.shadowRoot.getElementById("p-speakers").dataset.sig = "";
          return this._setTab("now");
        }
        if (b.dataset.s === "transfer") {
          await this._hass.callService("music_assistant", "transfer_queue", { source_player: this._player, auto_play: true }, { entity_id: id });
          this._player = id;
          this._key = null;
          this._toast("Lecture transférée");
          return this._setTab("now");
        }
        if (b.dataset.s === "group") {
          const members = this._st().attributes.group_members || [];
          if (members.includes(id)) await this._hass.callService("media_player", "unjoin", { entity_id: id });
          else await this._hass.callService("media_player", "join", { entity_id: this._player, group_members: [id] });
          this._toast(members.includes(id) ? "Enceinte retirée du groupe" : "Enceinte ajoutée au groupe");
        }
      } catch (err) { this._toast(err.message || "Action impossible"); }
    }

    // ---------------- vue mini ----------------
    _renderMini() {
      const st = this._st(), r = this.shadowRoot;
      if (!r) return;
      if (!r.getElementById("mini")) {
        this._built = true;
        r.innerHTML = `<style>${HolmMusicCard.css()}</style><ha-card class="mini" id="mini"><div class="bg" id="bg"></div>
          <button class="m-open" id="mopen"><span class="m-art"><img id="martimg" alt=""><ha-icon icon="mdi:music"></ha-icon></span><span class="m-txt"><b id="mt"></b><small id="ma"></small></span></button>
          <div class="m-vol" id="mvol"><ha-icon icon="mdi:volume-high" id="mvolic"></ha-icon><input type="range" id="mvolr" min="0" max="100" step="1"></div>
          <div class="m-btns">${this._config.mini_prev ? `<button data-act="prev" class="m-sm"><ha-icon icon="mdi:skip-previous"></ha-icon></button>` : ""}<button data-act="play" id="mplay" class="m-play"><ha-icon icon="mdi:play"></ha-icon></button><button data-act="next" class="m-sm"><ha-icon icon="mdi:skip-next"></ha-icon></button>${this._config.mini_volume ? `<button data-act="vol" class="m-sm" id="mvolb" title="Volume"><ha-icon icon="mdi:volume-high"></ha-icon></button>` : ""}</div>
          <i class="m-bar" id="mbar"></i></ha-card>`;
        r.querySelector(".m-btns").addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) this._act(b.dataset.act); });
        const vr = r.getElementById("mvolr");
        vr.addEventListener("input", () => { this._fill(vr); this._volT = Date.now(); this._miniVolKeep(); });
        vr.addEventListener("change", () => { this._mp("volume_set", { volume_level: vr.value / 100 }); this._miniVolKeep(); });
        r.getElementById("mopen").addEventListener("click", () => this._openPopup());
      }
      if (!st) return;
      const a = st.attributes, playing = st.state === "playing";
      r.getElementById("mt").textContent = a.media_title || (st.state === "off" ? "Enceinte éteinte" : "Rien en lecture");
      r.getElementById("ma").textContent = [a.media_artist, a.friendly_name].filter(Boolean).join(" · ");
      r.getElementById("mplay").innerHTML = `<ha-icon icon="${playing ? "mdi:pause" : "mdi:play"}"></ha-icon>`;
      r.getElementById("mini").classList.toggle("playing", playing);
      const vr = r.getElementById("mvolr"), vl = a.volume_level || 0;
      if (vr && (!this._volT || Date.now() - this._volT > 2500)) { vr.value = Math.round(vl * 100); this._fill(vr); }
      const vic = a.is_volume_muted ? "mdi:volume-off" : vl < 0.35 ? "mdi:volume-low" : vl < 0.7 ? "mdi:volume-medium" : "mdi:volume-high";
      const vb = r.getElementById("mvolb");
      if (vb) vb.innerHTML = `<ha-icon icon="${vic}"></ha-icon>`;
      r.getElementById("mvolic").setAttribute("icon", vic);
      const pic = a.entity_picture_local || a.entity_picture || "", img = r.getElementById("martimg");
      if (img.dataset.src !== pic) { img.dataset.src = pic; img.style.display = pic ? "" : "none"; if (pic) img.src = pic; this._applyColor(pic); }
      this._progress();
    }
    // volume de la vue mini : le curseur remplace le titre quelques secondes
    _miniVol() {
      const m = this.shadowRoot.getElementById("mini");
      if (!m) return;
      const on = !m.classList.contains("vol-on");
      const btns = m.querySelector(".m-btns"), v = this.shadowRoot.getElementById("mvol"), art = m.querySelector(".m-art");
      if (btns && v) { v.style.right = `${btns.offsetWidth + 14}px`; v.style.left = `${(art ? art.offsetWidth : 54) + 20}px`; }
      m.classList.toggle("vol-on", on);
      if (on) this._miniVolKeep(); else clearTimeout(this._mvT);
    }
    _miniVolKeep() {
      clearTimeout(this._mvT);
      this._mvT = setTimeout(() => { const m = this.shadowRoot && this.shadowRoot.getElementById("mini"); if (m) m.classList.remove("vol-on"); }, 4000);
    }
    _openPopup() {
      haptic();
      const pop = document.createElement("holm-music-popup");
      pop.setup({ ...this._config, mode: "full", entity: this._player }, this._hass, this);
      document.body.appendChild(pop);
    }

    // ---------------- utilitaires UI ----------------
    _sheet(title, sub, actions, cb) {
      const s = this.shadowRoot.getElementById("sheet");
      if (!s) return;
      s.innerHTML = `<div class="sh-scrim"></div><div class="sh-box"><div class="sh-grip"></div><div class="sh-t"><b>${esc(title)}</b><small>${esc(sub || "")}</small></div>
        ${actions.filter(Boolean).map(([i, l, k, cls]) => `<button class="sh-a ${cls || ""}" data-k="${k}"><ha-icon icon="${i}"></ha-icon>${l}</button>`).join("")}</div>`;
      s.classList.add("open");
      const close = () => s.classList.remove("open");
      s.onclick = async (e) => {
        if (e.target.classList.contains("sh-scrim")) return close();
        const b = e.target.closest("[data-k]");
        if (!b) return;
        close();
        haptic();
        try { await cb(b.dataset.k); } catch (err) { this._toast(err.message || "Action impossible"); }
      };
    }
    _loading() { return `<div class="loading"><span></span><span></span><span></span></div>`; }
    _empty(icon, t, s) { return `<div class="empty"><ha-icon icon="${icon}"></ha-icon><b>${esc(t)}</b><small>${esc(s || "")}</small></div>`; }

    static css() {
      return `
      :host { display: block; --acc: #26c6da; }
      * { box-sizing: border-box; }
      button { font: inherit; color: inherit; border: 0; background: none; padding: 0; cursor: pointer; -webkit-tap-highlight-color: transparent; }
      ha-card { position: relative; overflow: hidden; border-radius: var(--ha-card-border-radius, 24px); color: #eef6f8; isolation: isolate;
        background: #0e141b; border: 1px solid rgba(255,255,255,.08); box-shadow: 0 10px 30px rgba(0,0,0,.35); --tint: #1c2733; }
      .bg { position: absolute; inset: -40px; z-index: -2; background-image: var(--art, none); background-size: cover; background-position: center; filter: blur(46px) saturate(1.5) brightness(.55); transform: scale(1.1); transition: background-image .8s; opacity: .95; }
      .bg2 { position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 30%, rgba(10,14,20,.35)), rgba(10,14,20,.82) 70%); }
      .full { height: var(--h, 640px); display: flex; flex-direction: column; }
      .panes { position: relative; flex: 1; min-height: 0; }
      .pane { position: absolute; inset: 0; overflow-y: auto; overflow-x: hidden; padding: 14px 16px 10px; opacity: 0; pointer-events: none; transform: translateY(10px); transition: opacity .3s, transform .35s cubic-bezier(.3,1.3,.5,1); scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.2) transparent; }
      .pane.on { opacity: 1; pointer-events: auto; transform: none; }
      .tabs { position: relative; display: flex; margin: 0 10px 10px; padding: 4px; border-radius: 20px; background: rgba(8,12,18,.55); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,.07); }
      .tabs button { position: relative; z-index: 1; flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 6px; border-radius: 16px; color: rgba(230,240,245,.6); font-size: 12px; font-weight: 700; transition: color .3s; }
      .tabs button span { display: none; }
      .tabs button.on { color: #fff; }
      .tabs button.on span { display: inline; }
      .tabs button ha-icon { --mdc-icon-size: 22px; }
      .tab-ind { position: absolute; left: 4px; top: 4px; bottom: 4px; border-radius: 16px; background: color-mix(in srgb, var(--acc) 32%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acc) 55%, transparent), 0 0 18px color-mix(in srgb, var(--acc) 30%, transparent); transition: transform .45s cubic-bezier(.34,1.4,.55,1), background .6s; width: 25%; max-width: calc(100% - 8px); }

      /* lecture */
      #p-now { display: flex; flex-direction: column; align-items: center; gap: 8px; padding-top: 10px; overflow: hidden; }
      #p-now > * { flex-shrink: 0; }
      .np-head { width: 100%; display: flex; align-items: center; justify-content: space-between; }
      .player-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px 6px 8px; border-radius: 14px; background: rgba(255,255,255,.08); font-size: 12.5px; font-weight: 700; }
      .player-chip ha-icon { --mdc-icon-size: 18px; color: var(--acc); transition: color .6s; }
      .player-chip .chev { color: rgba(255,255,255,.5); --mdc-icon-size: 16px; }
      .eq { display: inline-flex; align-items: flex-end; gap: 2px; height: 16px; opacity: .25; }
      .eq i { width: 3px; height: 30%; border-radius: 2px; background: var(--acc); }
      .eq.on { opacity: 1; }
      .eq.on i { animation: eq 1s ease-in-out infinite; }
      .eq.on i:nth-child(2) { animation-delay: -.4s; } .eq.on i:nth-child(3) { animation-delay: -.7s; } .eq.on i:nth-child(4) { animation-delay: -.2s; }
      @keyframes eq { 0%,100% { height: 25%; } 50% { height: 100%; } }
      .eq.mini { position: absolute; inset: auto 0 0 0; height: 100%; justify-content: center; align-items: center; background: rgba(0,0,0,.45); border-radius: inherit; gap: 2px; }
      .eq.mini i { width: 3px; }
      .art-wrap { position: relative; flex: 1 1 0 !important; min-height: 110px; max-height: 300px; max-width: 86%; aspect-ratio: 1; margin: 4px 0; touch-action: pan-y; user-select: none; }
      .art { position: absolute; inset: 0; border-radius: 22px; overflow: hidden; background: rgba(255,255,255,.06); box-shadow: 0 22px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.06); transition: border-radius .6s, transform .5s cubic-bezier(.3,1.4,.5,1), box-shadow .6s; }
      .art img { width: 100%; height: 100%; object-fit: cover; opacity: 0; transition: opacity .6s; display: block; }
      .art img.in { opacity: 1; }
      .art .noart { position: absolute; inset: 0; display: none; place-items: center; color: rgba(255,255,255,.25); }
      .art .noart ha-icon { --mdc-icon-size: 88px; }
      .art.empty .noart { display: grid; } .art.empty img { display: none; }
      .art.paused:not(.vinyl) { transform: scale(.93); box-shadow: 0 12px 30px rgba(0,0,0,.45); }
      .art .hole { display: none; }
      .art.vinyl { border-radius: 50%; background: repeating-radial-gradient(circle, #111 0 2px, #1a1a1a 2px 4px); }
      .art.vinyl img { position: absolute; inset: 22%; width: 56%; height: 56%; border-radius: 50%; }
      .art.vinyl .hole { display: block; position: absolute; left: 50%; top: 50%; width: 5%; height: 5%; margin: -2.5% 0 0 -2.5%; border-radius: 50%; background: #0e141b; box-shadow: 0 0 0 3px rgba(255,255,255,.15); }
      .art.vinyl.spin { animation: spin 7s linear infinite; }
      .art.vinyl.paused { animation: spin 7s linear infinite paused; }
      @keyframes spin { to { transform: rotate(360deg); } }
      .art.swl { animation: swl .45s ease; } .art.swr { animation: swr .45s ease; }
      @keyframes swl { 40% { transform: translateX(-30%) rotate(-6deg); opacity: .4; } }
      @keyframes swr { 40% { transform: translateX(30%) rotate(6deg); opacity: .4; } }
      .heart { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%) scale(0); color: #ff4d8d; opacity: 0; pointer-events: none; filter: drop-shadow(0 6px 20px rgba(255,77,141,.6)); }
      .heart ha-icon { --mdc-icon-size: 96px; }
      .heart.pop { animation: heart .9s cubic-bezier(.3,1.6,.5,1); }
      @keyframes heart { 30% { transform: translate(-50%,-50%) scale(1.15); opacity: 1; } 70% { transform: translate(-50%,-50%) scale(1); opacity: 1; } 100% { transform: translate(-50%,-50%) scale(1.3); opacity: 0; } }
      .meta { width: 100%; text-align: center; min-width: 0; }
      .meta .t { font-size: 21px; font-weight: 800; letter-spacing: -.01em; overflow: hidden; white-space: nowrap; }
      .meta .t span { display: inline-block; }
      .meta .t.go { text-align: left; mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); -webkit-mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent); }
      .meta .t.go span { animation: marq 12s ease-in-out infinite alternate; }
      @keyframes marq { 0%, 18% { transform: translateX(0); } 82%, 100% { transform: translateX(var(--d, 0px)); } }
      .meta .a { margin-top: 3px; font-size: 14.5px; font-weight: 600; color: var(--acc); transition: color .6s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .meta .al { margin-top: 1px; font-size: 12.5px; color: rgba(230,240,245,.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 22px; background: transparent; cursor: pointer; --v: 0%; margin: 0; }
      input[type=range]::-webkit-slider-runnable-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--acc) var(--v), rgba(255,255,255,.14) var(--v)); }
      input[type=range]::-moz-range-track { height: 6px; border-radius: 3px; background: linear-gradient(90deg, var(--acc) var(--v), rgba(255,255,255,.14) var(--v)); }
      input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -5px; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.4), 0 0 0 4px color-mix(in srgb, var(--acc) 35%, transparent); transition: transform .2s; }
      input[type=range]::-moz-range-thumb { width: 16px; height: 16px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.4); }
      input[type=range]:active::-webkit-slider-thumb { transform: scale(1.3); }
      .prog { width: 100%; }
      .times { display: flex; justify-content: space-between; font-size: 11.5px; color: rgba(230,240,245,.6); font-variant-numeric: tabular-nums; margin-top: -2px; }
      .ctrls { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 2px 0; }
      .ctrls button, .vol button { display: grid; place-items: center; border-radius: 50%; transition: transform .15s, background .3s, color .3s; }
      .ctrls button:active, .vol button:active { transform: scale(.88); }
      .sm { width: 40px; height: 40px; color: rgba(230,240,245,.7); }
      .sm.act { color: var(--acc); background: color-mix(in srgb, var(--acc) 16%, transparent); }
      .sm ha-icon { --mdc-icon-size: 22px; }
      .md { width: 52px; height: 52px; }
      .md ha-icon { --mdc-icon-size: 34px; }
      .play { width: 70px; height: 70px; background: var(--acc); color: #0b1016; box-shadow: 0 10px 30px color-mix(in srgb, var(--acc) 45%, transparent); transition: background .6s, box-shadow .6s, transform .15s; }
      .play ha-icon { --mdc-icon-size: 38px; }
      .vol { width: 100%; display: flex; align-items: center; gap: 8px; }
      .upnext { display: none; width: 100%; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 16px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.06); text-align: left; margin-top: auto; }
      .upnext.show { display: flex; }
      .upnext .lbl { font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--acc); writing-mode: vertical-rl; transform: rotate(180deg); }
      .upnext img { width: 38px; height: 38px; border-radius: 9px; object-fit: cover; background: rgba(255,255,255,.08); }
      .upnext .noimg { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 9px; display: grid; place-items: center; background: rgba(255,255,255,.08); color: rgba(255,255,255,.4); }
      .upnext .noimg ha-icon { --mdc-icon-size: 20px; }
      img.broken { opacity: 0 !important; }
      .upnext .nx { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .upnext b, .qt b { font-size: 13.5px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .upnext small, .qt small { font-size: 11.5px; color: rgba(230,240,245,.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

      /* listes */
      .phead { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
      .phead h3 { margin: 0; font-size: 19px; font-weight: 800; }
      .phead small { color: rgba(230,240,245,.55); font-size: 12px; }
      .hbtns { display: flex; gap: 4px; }
      .hbtns button { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; background: rgba(255,255,255,.07); }
      .qlist, .rows { display: flex; flex-direction: column; gap: 2px; }
      .qrow { display: flex; align-items: center; border-radius: 14px; transition: background .2s; }
      .qrow:hover, .lrow:hover { background: rgba(255,255,255,.05); }
      .qrow.cur { background: color-mix(in srgb, var(--acc) 16%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--acc) 35%, transparent); }
      .qrow.past { opacity: .5; }
      .qmain, .lrow { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 8px; text-align: left; border-radius: 14px; }
      .thumb { position: relative; flex: 0 0 44px; width: 44px; height: 44px; border-radius: 10px; overflow: hidden; display: grid; place-items: center; background: rgba(255,255,255,.07); color: rgba(255,255,255,.4); }
      .thumb img { width: 100%; height: 100%; object-fit: cover; }
      .qt { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .qrow.cur .qt b { color: var(--acc); }
      .qd { font-size: 11.5px; color: rgba(230,240,245,.5); font-variant-numeric: tabular-nums; }
      .qmore, .rmore { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; color: rgba(230,240,245,.6); flex: 0 0 auto; }
      .num { width: 26px; text-align: center; font-size: 12px; font-weight: 700; color: rgba(230,240,245,.45); font-variant-numeric: tabular-nums; }
      .hint { display: flex; gap: 10px; margin-top: 14px; padding: 12px; border-radius: 16px; background: rgba(255,255,255,.05); border: 1px dashed rgba(255,255,255,.15); }
      .hint ha-icon { color: var(--acc); flex: 0 0 auto; }
      .hint div { display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
      .hint small { color: rgba(230,240,245,.6); line-height: 1.4; }

      /* bibliothèque */
      .lhead { position: sticky; top: -14px; z-index: 2; margin: -14px -16px 8px; padding: 14px 16px 8px; background: linear-gradient(180deg, rgba(12,17,24,.92) 70%, transparent); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
      .search { display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 6px 0 12px; border-radius: 14px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.07); }
      .search:focus-within { border-color: color-mix(in srgb, var(--acc) 60%, transparent); }
      .search ha-icon { color: rgba(230,240,245,.55); --mdc-icon-size: 20px; }
      .search input { flex: 1; min-width: 0; height: 100%; border: 0; outline: 0; background: none; color: #fff; font: inherit; font-size: 14px; }
      .gl { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; color: rgba(230,240,245,.5); }
      .gl.act { color: var(--acc); background: color-mix(in srgb, var(--acc) 18%, transparent); }
      .chips { display: flex; gap: 6px; overflow-x: auto; padding: 10px 0 2px; scrollbar-width: none; }
      .chips::-webkit-scrollbar, .hscroll::-webkit-scrollbar { display: none; }
      .chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px; border-radius: 16px; background: rgba(255,255,255,.07); font-size: 12.5px; font-weight: 700; color: rgba(230,240,245,.8); transition: background .25s, color .25s; }
      .chip ha-icon { --mdc-icon-size: 16px; }
      .chip.on { background: var(--acc); color: #0b1016; }
      .chip.sm { height: 28px; font-size: 12px; }
      .filters { display: flex; align-items: center; gap: 8px; padding-top: 8px; }
      .filters select { height: 28px; border-radius: 14px; border: 0; padding: 0 10px; background: rgba(255,255,255,.07); color: #fff; font: inherit; font-size: 12px; outline: 0; }
      .filters select option { background: #1a222c; }
      .shelf { margin-bottom: 14px; }
      .shelf h4 { margin: 4px 0 8px; font-size: 15px; font-weight: 800; }
      .hscroll { display: grid; grid-auto-flow: column; grid-auto-columns: 128px; gap: 12px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x mandatory; scrollbar-width: none; }
      .hscroll .tile { scroll-snap-align: start; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
      .tile { display: flex; flex-direction: column; gap: 3px; text-align: left; min-width: 0; }
      .cover { position: relative; width: 100%; aspect-ratio: 1; border-radius: 14px; overflow: hidden; background: rgba(255,255,255,.07); display: grid; place-items: center; color: rgba(255,255,255,.35); box-shadow: 0 8px 18px rgba(0,0,0,.3); }
      .cover > ha-icon { --mdc-icon-size: 40px; }
      .cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; transition: transform .4s; }
      .tile:hover .cover img { transform: scale(1.06); }
      .tile.round .cover { border-radius: 50%; }
      .tplay { position: absolute; right: 8px; bottom: 8px; width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--acc); color: #0b1016; box-shadow: 0 6px 16px rgba(0,0,0,.4); opacity: 0; transform: translateY(8px) scale(.8); transition: opacity .25s, transform .3s cubic-bezier(.3,1.5,.5,1); }
      .tile:hover .tplay, .tile:focus-visible .tplay { opacity: 1; transform: none; }
      @media (hover: none) { .tplay { opacity: .95; transform: none; width: 30px; height: 30px; } .tplay ha-icon { --mdc-icon-size: 18px; } }
      .tile.round .tplay { display: none; }
      .tfav { position: absolute; left: 8px; top: 8px; color: #ff4d8d; --mdc-icon-size: 16px; filter: drop-shadow(0 1px 3px rgba(0,0,0,.6)); }
      .tile b { font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 4px; }
      .tile small { font-size: 11.5px; color: rgba(230,240,245,.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tile.round b, .tile.round small { text-align: center; }
      .more { display: block; margin: 14px auto 4px; padding: 8px 18px; border-radius: 14px; background: rgba(255,255,255,.08); font-weight: 700; font-size: 13px; }
      .detail .back { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; color: rgba(230,240,245,.75); margin-bottom: 10px; }
      .dhead { display: flex; gap: 14px; align-items: flex-end; margin-bottom: 14px; }
      .dcover { flex: 0 0 132px; width: 132px; height: 132px; border-radius: 16px; overflow: hidden; background: rgba(255,255,255,.07); display: grid; place-items: center; box-shadow: 0 14px 30px rgba(0,0,0,.45); }
      .dcover img { width: 100%; height: 100%; object-fit: cover; }
      .dhead.artist .dcover { border-radius: 50%; }
      .dinfo { min-width: 0; flex: 1; }
      .dinfo small { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--acc); }
      .dinfo h3 { margin: 2px 0; font-size: 20px; font-weight: 800; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
      .dinfo p { margin: 0 0 10px; font-size: 12.5px; color: rgba(230,240,245,.6); }
      .dact { display: flex; gap: 8px; align-items: center; }
      .pbtn { display: inline-flex; align-items: center; gap: 4px; height: 38px; padding: 0 16px 0 12px; border-radius: 19px; background: var(--acc); color: #0b1016; font-weight: 800; font-size: 13.5px; box-shadow: 0 8px 20px color-mix(in srgb, var(--acc) 35%, transparent); }
      .ibtn { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 50%; background: rgba(255,255,255,.08); }

      /* enceintes */
      .spks { display: flex; flex-direction: column; gap: 8px; }
      .spk { padding: 8px; border-radius: 18px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.06); transition: background .3s, border-color .3s; }
      .spk.active { background: color-mix(in srgb, var(--acc) 14%, rgba(255,255,255,.04)); border-color: color-mix(in srgb, var(--acc) 45%, transparent); }
      .spk-main { width: 100%; display: flex; align-items: center; gap: 10px; text-align: left; }
      .spk-ic { position: relative; flex: 0 0 42px; width: 42px; height: 42px; border-radius: 12px; overflow: hidden; display: grid; place-items: center; background: rgba(255,255,255,.08); }
      .spk-ic img { width: 100%; height: 100%; object-fit: cover; }
      .badge { font-size: 10.5px; font-weight: 800; padding: 3px 8px; border-radius: 10px; background: var(--acc); color: #0b1016; }
      .spk-ctl { display: flex; align-items: center; gap: 8px; margin-top: 6px; padding: 0 4px; color: rgba(230,240,245,.6); }
      .spk-ctl ha-icon { --mdc-icon-size: 18px; }
      .mini-btn { flex: 0 0 34px; height: 34px; display: grid; place-items: center; border-radius: 11px; background: rgba(255,255,255,.08); color: rgba(230,240,245,.8); }
      .mini-btn.on { background: var(--acc); color: #0b1016; }

      /* états */
      .loading { display: flex; justify-content: center; gap: 6px; padding: 40px 0; }
      .loading span { width: 8px; height: 8px; border-radius: 50%; background: var(--acc); animation: ld 1s ease-in-out infinite; }
      .loading span:nth-child(2) { animation-delay: .15s; } .loading span:nth-child(3) { animation-delay: .3s; }
      @keyframes ld { 50% { transform: translateY(-8px); opacity: .4; } }
      .empty { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; padding: 36px 12px; color: rgba(230,240,245,.6); }
      .empty ha-icon { --mdc-icon-size: 44px; color: rgba(255,255,255,.25); margin-bottom: 6px; }
      .empty b { color: #fff; }
      .toast { position: absolute; left: 50%; bottom: 76px; transform: translate(-50%, 20px); opacity: 0; padding: 8px 14px; border-radius: 14px; background: rgba(20,28,36,.95); border: 1px solid rgba(255,255,255,.1); font-size: 13px; font-weight: 700; pointer-events: none; transition: opacity .3s, transform .35s cubic-bezier(.3,1.5,.5,1); z-index: 5; white-space: nowrap; }
      .toast.show { opacity: 1; transform: translate(-50%, 0); }
      .sheet { position: absolute; inset: 0; z-index: 6; pointer-events: none; }
      .sh-scrim { position: absolute; inset: 0; background: rgba(0,0,0,.5); opacity: 0; transition: opacity .3s; }
      .sh-box { position: absolute; left: 8px; right: 8px; bottom: 8px; padding: 8px 8px 10px; border-radius: 22px; background: rgba(22,30,40,.97); border: 1px solid rgba(255,255,255,.1); box-shadow: 0 -10px 40px rgba(0,0,0,.5); transform: translateY(110%); transition: transform .4s cubic-bezier(.3,1.25,.5,1); }
      .sheet.open { pointer-events: auto; }
      .sheet.open .sh-scrim { opacity: 1; }
      .sheet.open .sh-box { transform: none; }
      .sh-grip { width: 36px; height: 4px; border-radius: 2px; background: rgba(255,255,255,.25); margin: 0 auto 8px; }
      .sh-t { display: flex; flex-direction: column; padding: 0 10px 8px; border-bottom: 1px solid rgba(255,255,255,.08); margin-bottom: 4px; }
      .sh-t b { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .sh-t small { font-size: 12px; color: rgba(230,240,245,.55); }
      .sh-a { width: 100%; display: flex; align-items: center; gap: 12px; padding: 11px 10px; border-radius: 12px; font-size: 14px; font-weight: 600; text-align: left; }
      .sh-a:hover { background: rgba(255,255,255,.06); }
      .sh-a ha-icon { color: var(--acc); }
      .sh-a.danger, .sh-a.danger ha-icon { color: #f87171; }

      /* paroles */
      .np-r { display: flex; align-items: center; gap: 8px; }
      .ly-btn { width: 34px; height: 34px; border-radius: 12px; display: grid; place-items: center; background: rgba(255,255,255,.08); color: rgba(230,240,245,.8); transition: background .3s, color .3s; }
      .ly-btn ha-icon { --mdc-icon-size: 19px; }
      .ly-btn.act { background: var(--acc); color: #0b1016; }
      .lyr { display: none; }
      #p-now.lyon .art-wrap { display: none; }
      #p-now.lyon .lyr { display: block; flex: 1 1 0 !important; min-height: 0; width: 100%; overflow-y: auto; scrollbar-width: none; -webkit-mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent); animation: lyin .4s ease; }
      #p-now.lyon .lyr::-webkit-scrollbar { display: none; }
      @keyframes lyin { from { opacity: 0; transform: translateY(10px); } }
      .ly-list { padding: 30% 6px; text-align: center; }
      .ly-list p { margin: 0 0 10px; font-size: 17px; font-weight: 700; line-height: 1.35; color: rgba(235,242,247,.85); }
      .ly-list.synced p { color: rgba(235,242,247,.38); cursor: pointer; transition: color .4s, transform .4s, text-shadow .4s; transform-origin: center; }
      .ly-list.synced p.past { color: rgba(235,242,247,.55); }
      .ly-list.synced p.on { color: #fff; transform: scale(1.06); text-shadow: 0 0 18px color-mix(in srgb, var(--acc) 70%, transparent); }
      .ly-empty { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; text-align: center; padding: 20px; color: rgba(235,242,247,.7); }
      .ly-empty ha-icon { --mdc-icon-size: 40px; color: var(--acc); opacity: .7; }
      .ly-empty small { font-size: 12px; opacity: .7; max-width: 280px; }
      .sh-box { max-height: 80%; overflow-y: auto; }

      /* mini */
      .mini { display: flex; align-items: center; gap: 6px; height: 76px; padding: 0 8px 0 10px; border-radius: 20px; }
      .mini .bg { filter: blur(30px) saturate(1.6) brightness(.45); }
      .m-open { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; text-align: left; height: 100%; }
      .m-art { position: relative; flex: 0 0 54px; width: 54px; height: 54px; border-radius: 12px; overflow: hidden; display: grid; place-items: center; background: rgba(255,255,255,.08); color: rgba(255,255,255,.4); box-shadow: 0 4px 12px rgba(0,0,0,.35); }
      .m-art img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .mini.playing .m-art { animation: breathe 3s ease-in-out infinite; }
      @keyframes breathe { 50% { box-shadow: 0 4px 18px color-mix(in srgb, var(--acc) 60%, transparent); } }
      .m-txt { min-width: 0; display: flex; flex-direction: column; }
      .m-txt b { font-size: 14px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .m-txt small { font-size: 12px; color: var(--acc); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: color .6s; }
      .m-btns { display: flex; align-items: center; gap: 0; }
      .m-btns button { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; transition: transform .15s, background .3s; }
      .m-btns .m-play { width: 46px; height: 46px; margin: 0 2px; background: var(--acc); color: #0b1016; }
      .m-btns .m-sm ha-icon { --mdc-icon-size: 22px; }
      .mini.vol-on #mvolb { background: color-mix(in srgb, var(--acc) 30%, transparent); }
      .m-vol { position: absolute; left: 76px; right: 190px; top: 50%; display: flex; align-items: center; gap: 8px; transform: translateY(-50%) scale(.96); opacity: 0; pointer-events: none; transition: opacity .25s, transform .3s cubic-bezier(.3,1.3,.5,1); }
      .m-vol ha-icon { --mdc-icon-size: 20px; color: var(--acc); flex: 0 0 auto; }
      .m-vol input { flex: 1; min-width: 0; }
      .mini.vol-on .m-vol { opacity: 1; pointer-events: auto; transform: translateY(-50%); }
      .mini.vol-on .m-txt { opacity: 0; }
      .m-txt { transition: opacity .2s; }
      .m-btns button:active { transform: scale(.88); }
      .m-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--acc); transform-origin: left; transform: scaleX(0); transition: transform 1s linear; opacity: .9; }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
      `;
    }
  }

  // ------------------------------------------------------------------
  //  Fenêtre (ouverte depuis la vue mini)
  // ------------------------------------------------------------------
  class HolmMusicPopup extends HTMLElement {
    setup(config, hass, owner) {
      this._config = config;
      this._owner = owner;
      this.attachShadow({ mode: "open" });
      this.shadowRoot.innerHTML = `<style>
        :host { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; }
        .scrim { position: absolute; inset: 0; background: rgba(0,0,0,.55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); opacity: 0; transition: opacity .3s; }
        .box { position: relative; width: min(440px, calc(100vw - 16px)); transform: translateY(40px) scale(.96); opacity: 0; transition: transform .45s cubic-bezier(.3,1.3,.5,1), opacity .3s; }
        :host(.in) .scrim { opacity: 1; } :host(.in) .box { transform: none; opacity: 1; }
        .x { position: absolute; top: -48px; right: 4px; z-index: 10; width: 40px; height: 40px; border-radius: 50%; border: 1px solid rgba(255,255,255,.18); background: rgba(20,28,36,.75); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); color: #fff; display: grid; place-items: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.4); transition: transform .2s; }
        .x:hover { transform: scale(1.08); } .x:active { transform: scale(.92); }
        @media (max-width: 600px) { :host { place-items: end center; } .box { width: 100vw; } .box holm-music-card { --ha-card-border-radius: 24px 24px 0 0; } }
      </style><div class="scrim"></div><div class="box"><button class="x" title="Fermer"><ha-icon icon="mdi:close"></ha-icon></button></div>`;
      const card = document.createElement("holm-music-card");
      const h = Math.min(720, Math.round(window.innerHeight * (window.innerWidth <= 600 ? 0.86 : 0.84)) - 8);
      card.setConfig({ ...config, height: h });
      card.hass = hass;
      this._card = card;
      this.shadowRoot.querySelector(".box").appendChild(card);
      const close = () => { this.classList.remove("in"); setTimeout(() => this.remove(), 300); };
      this.shadowRoot.querySelector(".scrim").addEventListener("click", close);
      this.shadowRoot.querySelector(".x").addEventListener("click", close);
      this._esc = (e) => e.key === "Escape" && close();
      window.addEventListener("keydown", this._esc);
      this._sync = setInterval(() => { const hs = owner && owner._hass; if (hs && hs !== card._hass) card.hass = hs; }, 500);
      requestAnimationFrame(() => this.classList.add("in"));
    }
    disconnectedCallback() {
      clearInterval(this._sync);
      window.removeEventListener("keydown", this._esc);
    }
  }

  // ------------------------------------------------------------------
  //  Éditeur visuel
  // ------------------------------------------------------------------
  class HolmMusicCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = { ...config };
      if (this._form) this._form.data = this._data();
    }
    set hass(hass) {
      this._hass = hass;
      if (!this._form) this._build();
      else this._form.hass = hass;
    }
    _data() { return { ...DEFAULTS, ...this._config }; }
    _build() {
      const f = document.createElement("ha-form");
      f.hass = this._hass;
      f.schema = [
        { name: "entity", required: true, selector: { entity: { filter: { domain: "media_player", integration: "music_assistant" } } } },
        { name: "mode", selector: { select: { mode: "list", options: [{ value: "full", label: "Complet (lecture, file, bibliothèque, enceintes)" }, { value: "mini", label: "Mini (barre compacte, s'ouvre en grand au toucher)" }] } } },
        { type: "expandable", name: "", title: "Apparence", icon: "mdi:palette-outline", schema: [
          { type: "grid", name: "", schema: [
            { name: "artwork", selector: { select: { mode: "dropdown", options: [{ value: "square", label: "Pochette" }, { value: "vinyl", label: "Vinyle qui tourne" }] } } },
            { name: "start_tab", selector: { select: { mode: "dropdown", options: [{ value: "now", label: "Lecture" }, { value: "queue", label: "File d'attente" }, { value: "library", label: "Bibliothèque" }, { value: "speakers", label: "Enceintes" }] } } },
          ] },
          { type: "grid", name: "", schema: [
            { name: "dynamic_color", selector: { boolean: {} } },
            { name: "accent", selector: { text: {} } },
          ] },
          { name: "height", selector: { number: { min: 420, max: 1000, step: 10, mode: "slider", unit_of_measurement: "px" } } },
        ] },
        { type: "expandable", name: "", title: "Vue mini", icon: "mdi:dock-bottom", schema: [
          { type: "grid", name: "", schema: [
            { name: "mini_prev", selector: { boolean: {} } },
            { name: "mini_volume", selector: { boolean: {} } },
          ] },
        ] },
        { type: "expandable", name: "", title: "Bibliothèque et enceintes", icon: "mdi:bookshelf", schema: [
          { name: "library_types", selector: { select: { multiple: true, mode: "list", options: Object.entries(TYPES).map(([k, v]) => ({ value: k, label: v.label })) } } },
          { name: "show_players", selector: { boolean: {} } },
          { name: "players", selector: { entity: { multiple: true, filter: { domain: "media_player", integration: "music_assistant" } } } },
        ] },
        { type: "expandable", name: "", title: "Serveur Music Assistant séparé (hors add-on)", icon: "mdi:link-variant", schema: [
          { name: "ma_url", selector: { text: { type: "url" } } },
          { name: "ma_token", selector: { text: { type: "password" } } },
        ] },
        { type: "expandable", name: "", title: "Pochettes (avancé)", icon: "mdi:image-outline", schema: [
          { name: "ma_image_url", selector: { text: { type: "url" } } },
        ] },
      ];
      const L = {
        entity: "Lecteur Music Assistant", mode: "Présentation", artwork: "Style de pochette", start_tab: "Onglet d'ouverture",
        dynamic_color: "Couleurs tirées de la pochette", accent: "Couleur d'accent (par défaut)", height: "Hauteur de la carte",
        library_types: "Rubriques de la bibliothèque", show_players: "Onglet Enceintes (multiroom)", players: "Enceintes proposées (vide = toutes)",
        ma_url: "Adresse de Music Assistant (ex. http://192.168.1.10:8095)", ma_token: "Jeton d'accès Music Assistant",
        ma_image_url: "Adresse HTTPS des images Music Assistant (facultatif)",
        mini_prev: "Bouton Précédent", mini_volume: "Réglage du volume",
      };
      const H = {
        ma_url: "Inutile avec l'add-on Music Assistant : la carte s'y connecte automatiquement via Home Assistant. À renseigner seulement pour un serveur séparé.",
        ma_token: "Music Assistant → Paramètres → Profil → Jetons d'accès (serveur séparé uniquement).",
        ma_image_url: "Inutile avec l'add-on Music Assistant (les pochettes passent automatiquement par Home Assistant). Sinon : l'adresse HTTPS de votre serveur Music Assistant, joignable par le navigateur.",
        players: "Laissez vide pour proposer toutes les enceintes Music Assistant.",
      };
      f.computeLabel = (s) => L[s.name] || s.name;
      f.computeHelper = (s) => H[s.name];
      f.data = this._data();
      f.addEventListener("value-changed", (e) => {
        const v = { ...e.detail.value };
        Object.keys(v).forEach((k) => (v[k] === "" || v[k] == null || (Array.isArray(v[k]) && !v[k].length && k !== "library_types")) && delete v[k]);
        Object.keys(DEFAULTS).forEach((k) => JSON.stringify(v[k]) === JSON.stringify(DEFAULTS[k]) && delete v[k]);
        this._config = { type: this._config.type || "custom:holm-music-card", ...v };
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: clone(this._config) }, bubbles: true, composed: true }));
      });
      this._form = f;
      this.appendChild(f);
    }
  }

  if (!customElements.get("holm-music-card")) customElements.define("holm-music-card", HolmMusicCard);
  if (!customElements.get("holm-music-popup")) customElements.define("holm-music-popup", HolmMusicPopup);
  if (!customElements.get("holm-music-card-editor")) customElements.define("holm-music-card-editor", HolmMusicCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "holm-music-card")) {
    window.customCards.push({ type: "holm-music-card", name: "HOLM Musique", description: "Lecteur Music Assistant : lecture, file d'attente, bibliothèque, recherche, multiroom et vue mini.", preview: true });
  }
  console.info(`%c HOLM-MUSIC %c ${VERSION} `, "background:#26c6da;color:#0b1016;border-radius:3px 0 0 3px", "background:#123;color:#fff;border-radius:0 3px 3px 0");
})();
