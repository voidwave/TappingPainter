/* App shell: gallery, photo import, and switching to the painting screen. */
(function () {
  'use strict';

  const DIFFICULTY = {
    relaxed: { label: 'Relaxed', size: 600, colors: 12, minArea: 110, minThick: 3 },
    balanced: { label: 'Balanced', size: 800, colors: 20, minArea: 70, minThick: 2.5 },
    detailed: { label: 'Detailed', size: 1000, colors: 30, minArea: 45, minThick: 2 },
  };

  const $ = sel => document.querySelector(sel);
  const galleryEl = $('#gallery');
  const gameEl = $('#game');
  const grid = $('#grid');
  const toastEl = $('#toast');
  const importDialog = $('#importDialog');
  const fileInput = $('#fileInput');

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

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = url;
    });
  }

  function scaledCanvas(img, longSide) {
    const k = Math.min(1, longSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * k));
    c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * k));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }

  // ------------------------------------------------------------- entries
  const previewCache = new Map();
  function builtinEntries() {
    return Artworks.list.map(art => ({
      id: 'art-' + art.id,
      title: art.title,
      builtin: true,
      loadSource: async () => Artworks.render(art),
      preview: () => {
        if (!previewCache.has(art.id)) {
          const full = Artworks.render(art);
          previewCache.set(art.id, scaledCanvas(full, 320).toDataURL('image/jpeg', 0.8));
        }
        return previewCache.get(art.id);
      },
      opts: { palette: Artworks.palette(art), minArea: 30, minThick: 2 },
    }));
  }

  function importEntries() {
    return Store.imports().map(imp => {
      const d = DIFFICULTY[imp.difficulty] || DIFFICULTY.balanced;
      return {
        id: imp.id,
        title: imp.title,
        builtin: false,
        loadSource: async () => scaledCanvas(await loadImage(imp.dataUrl), d.size),
        preview: () => imp.dataUrl,
        opts: { colors: d.colors, minArea: d.minArea, minThick: d.minThick, smooth: true },
        difficulty: d.label,
      };
    });
  }

  // -------------------------------------------------------------- gallery
  function renderGallery() {
    grid.innerHTML = '';
    $('#galHints').textContent = Store.hints();

    const add = document.createElement('div');
    add.className = 'card add';
    add.setAttribute('role', 'button');
    add.tabIndex = 0;
    add.innerHTML = '<div class="thumb"><span class="plus">+</span><span class="add-label">Paint your own photo</span></div>' +
      '<div class="meta"><span class="title">New from photo</span></div>';
    add.addEventListener('click', () => fileInput.click());
    grid.appendChild(add);

    for (const entry of [...importEntries(), ...builtinEntries()]) {
      const meta = Store.meta(entry.id);
      const thumb = Store.thumb(entry.id);
      const card = document.createElement('div');
      card.className = 'card' + (meta.done ? ' done' : '');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      const img = document.createElement('img');
      img.alt = entry.title;
      img.loading = 'lazy';
      if (thumb) img.src = thumb;
      else { img.src = entry.preview(); img.className = 'sketch'; }
      const th = document.createElement('div');
      th.className = 'thumb';
      th.appendChild(img);
      if (meta.done) th.insertAdjacentHTML('beforeend', '<span class="badge">✓</span>');
      else if (!thumb) th.insertAdjacentHTML('beforeend', '<span class="badge new">New</span>');
      card.appendChild(th);
      const m = document.createElement('div');
      m.className = 'meta';
      m.innerHTML = `<span class="title"></span><span class="pct">${meta.pct}%</span>`;
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
        Store.saveImports(Store.imports().filter(i => i.id !== entry.id));
        Store.reset(entry.id);
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
      toast('Sorry, that picture could not be prepared');
      showGallery();
    });
  }

  function showGallery() {
    game.close();
    gameEl.classList.remove('active');
    galleryEl.classList.add('active');
    renderGallery();
  }

  // --------------------------------------------------------------- import
  let pendingImport = null;
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const c = scaledCanvas(img, 1000);
      pendingImport = { dataUrl: c.toDataURL('image/jpeg', 0.86), name: file.name.replace(/\.[^.]+$/, '') };
      $('#importPreview').src = pendingImport.dataUrl;
      $('#importTitle').value = pendingImport.name.slice(0, 40) || 'My photo';
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
    const btn = e.target.closest('[data-difficulty]');
    if (!btn || !pendingImport) return;
    const imp = {
      id: 'imp-' + Date.now().toString(36),
      title: $('#importTitle').value.trim() || 'My photo',
      difficulty: btn.dataset.difficulty,
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
    const entry = importEntries().find(e => e.id === imp.id);
    openGame(entry);
  });

  // keep the page itself from zooming/scrolling on iPad
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault());
  window.addEventListener('pagehide', () => game.save(true));
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(true); });

  renderGallery();
})();
