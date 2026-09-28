/* App shell: gallery, photo import, and switching to the painting screen. */
(function () {
  'use strict';

  // size = working resolution (long side); minArea / minThick keep every
  // region big enough for a readable number (no fiddly tiny areas)
  const DIFFICULTY = {
    relaxed: { label: 'Relaxed', size: 700, colors: 14, minArea: 700, minThick: 8 },
    balanced: { label: 'Balanced', size: 900, colors: 22, minArea: 450, minThick: 6 },
    detailed: { label: 'Detailed', size: 1100, colors: 32, minArea: 260, minThick: 4.5 },
  };
  const MAX_IMPORT_SIDE = 1600; // imported photos live in localStorage

  const $ = sel => document.querySelector(sel);
  const galleryEl = $('#gallery');
  const gameEl = $('#game');
  const grid = $('#grid');
  const toastEl = $('#toast');
  const importDialog = $('#importDialog');
  const fileInput = $('#fileInput');
  const diffEl = $('#difficulty');

  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  const game = new Game(gameEl, {
    onBack: () => showGallery(),
    toast,
  });
  window.tapPainter = { game };

  let difficulty = Store.get('difficulty', 'balanced');
  if (!DIFFICULTY[difficulty]) difficulty = 'balanced';

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = url;
    });
  }

  // Draws img into a new canvas scaled by k (never upscaled)
  function canvasAt(img, k) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    k = Math.min(1, k);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * k));
    c.height = Math.max(1, Math.round(ih * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  const longSide = img => Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const pixels = img => (img.naturalWidth || img.width) * (img.naturalHeight || img.height);

  // ------------------------------------------------------------- entries
  function makeEntry(pic, builtin) {
    const d = DIFFICULTY[difficulty];
    return {
      id: pic.id + '@' + difficulty,
      title: pic.title,
      builtin,
      thumb: pic.thumb,
      async loadSource() {
        const img = await loadImage(pic.src);
        return {
          base: canvasAt(img, d.size / longSide(img)),
          hi: maxPixels => canvasAt(img, Math.sqrt(maxPixels / pixels(img))),
        };
      },
      opts: { colors: d.colors, minArea: d.minArea, minThick: d.minThick },
    };
  }

  const galleryPictures = () => (window.GALLERY || []).map(p => makeEntry(p, true));
  const importPictures = () => Store.imports().map(p => makeEntry({ id: p.id, title: p.title, src: p.dataUrl, thumb: p.dataUrl }, false));

  // -------------------------------------------------------------- gallery
  function renderGallery() {
    grid.innerHTML = '';
    $('#galHints').textContent = Store.hints();
    for (const b of diffEl.querySelectorAll('button')) b.classList.toggle('on', b.dataset.difficulty === difficulty);

    const add = document.createElement('div');
    add.className = 'card add';
    add.setAttribute('role', 'button');
    add.tabIndex = 0;
    add.innerHTML = '<div class="thumb"><span class="plus">+</span><span class="add-label">Paint your own photo</span></div>' +
      '<div class="meta"><span class="title">New from photo</span></div>';
    add.addEventListener('click', () => fileInput.click());
    grid.appendChild(add);

    for (const entry of [...importPictures(), ...galleryPictures()]) {
      const meta = Store.meta(entry.id);
      const thumb = Store.thumb(entry.id);
      const card = document.createElement('div');
      card.className = 'card' + (meta.done ? ' done' : '');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      const img = document.createElement('img');
      img.alt = entry.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      if (thumb) img.src = thumb;
      else { img.src = entry.thumb; img.className = 'sketch'; }
      const th = document.createElement('div');
      th.className = 'thumb';
      th.appendChild(img);
      if (meta.done) th.insertAdjacentHTML('beforeend', '<span class="badge">✓</span>');
      card.appendChild(th);
      const m = document.createElement('div');
      m.className = 'meta';
      m.innerHTML = `<span class="title"></span><span class="pct">${meta.pct ? meta.pct + '%' : ''}</span>`;
      m.querySelector('.title').textContent = entry.title;
      card.appendChild(m);
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.innerHTML = `<i style="width:${meta.pct}%"></i>`;
      card.appendChild(bar);
      const menu = document.createElement('button');
      menu.className = 'menu';
      menu.setAttribute('aria-label', 'Options');
      menu.textContent = '⋯';
      menu.addEventListener('click', e => {
        e.stopPropagation();
        cardMenu(entry, meta);
      });
      card.appendChild(menu);
      card.addEventListener('click', () => openGame(entry));
      card.addEventListener('keydown', e => { if (e.key === 'Enter') openGame(entry); });
      grid.appendChild(card);
    }
  }

  function cardMenu(entry, meta) {
    if (!entry.builtin) {
      if (confirm(`Delete “${entry.title}”?`)) {
        const baseId = entry.id.split('@')[0];
        Store.saveImports(Store.imports().filter(i => i.id !== baseId));
        for (const d of Object.keys(DIFFICULTY)) Store.reset(baseId + '@' + d);
        renderGallery();
      }
      return;
    }
    if (meta.pct === 0 && !Store.thumb(entry.id)) { toast('Nothing to restart yet'); return; }
    if (confirm(`Restart “${entry.title}” from a blank canvas?`)) {
      Store.reset(entry.id);
      renderGallery();
    }
  }

  function openGame(entry) {
    Sound.unlock();
    galleryEl.classList.remove('active');
    gameEl.classList.add('active');
    game.open(entry).catch(err => {
      console.error(err);
      toast(location.protocol === 'file:'
        ? 'Pictures need a web server – see the README'
        : 'Sorry, that picture could not be prepared');
      showGallery();
    });
  }

  function showGallery() {
    game.close();
    gameEl.classList.remove('active');
    galleryEl.classList.add('active');
    renderGallery();
  }

  diffEl.addEventListener('click', e => {
    const b = e.target.closest('[data-difficulty]');
    if (!b || b.dataset.difficulty === difficulty) return;
    difficulty = b.dataset.difficulty;
    Store.set('difficulty', difficulty);
    renderGallery();
  });

  // --------------------------------------------------------------- import
  let pendingImport = null;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const c = canvasAt(img, MAX_IMPORT_SIDE / longSide(img));
      pendingImport = { dataUrl: c.toDataURL('image/jpeg', 0.86), name: file.name.replace(/\.[^.]+$/, '') };
      $('#importPreview').src = pendingImport.dataUrl;
      $('#importTitle').value = pendingImport.name.slice(0, 40) || 'My photo';
      $('#importDiff').textContent = DIFFICULTY[difficulty].label;
      importDialog.classList.add('show');
    } catch (e) {
      toast('That file could not be opened as an image');
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  importDialog.addEventListener('click', e => {
    if (e.target === importDialog || e.target.closest('[data-cancel]')) {
      importDialog.classList.remove('show');
      pendingImport = null;
      return;
    }
    if (!e.target.closest('[data-start]') || !pendingImport) return;
    const imp = {
      id: 'imp-' + Date.now().toString(36),
      title: $('#importTitle').value.trim() || 'My photo',
      dataUrl: pendingImport.dataUrl,
    };
    const list = Store.imports();
    list.unshift(imp);
    if (!Store.saveImports(list)) {
      toast('Storage is full – delete an old photo first');
      return;
    }
    importDialog.classList.remove('show');
    pendingImport = null;
    openGame(importPictures()[0]);
  });

  // keep the page itself from zooming/scrolling on iPad
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  window.addEventListener('pagehide', () => game.save(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(true); });

  renderGallery();
})();
