const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const shelterSel = document.getElementById('shelter');
const typeBtns = document.querySelectorAll('[data-type]');
const catBtns = document.querySelectorAll('[data-cat]');
const PLACEHOLDER = 'img/placeholder.svg';
const TYPE_LABEL = { perro: '🐶 Perro', gato: '🐱 Gato', otro: '🐾 Otro' };
const CAT_LABEL = { adopcion: '🏠 Adopción', acogida: '🤝 Acogida', perdido: '🔍 Perdido', donacion: '💚 Donación', evento: '📅 Evento' };

let posts = [];
let filterType = 'todos';
let filterCat = 'todas';
let filterShelter = 'todas';

const escapeHtml = (s) =>
  (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

const fmtDay = (iso) => {
  const s = new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid',
  });
  return s.charAt(0).toUpperCase() + s.slice(1); // solo la primera letra en mayúscula
};

function card(p) {
  // imágenes: array nuevo (carrusel) o, retrocompat, la única `image`; si no hay, placeholder
  const imgs = (Array.isArray(p.images) && p.images.length) ? p.images : (p.image ? [p.image] : [PLACEHOLDER]);
  const multi = imgs.length > 1;
  const href = escapeHtml(safeUrl(p.permalink)); // escapado también para el contexto de atributo HTML
  const alt = `Publicación de ${escapeHtml(p.shelter)}`;
  const slides = imgs.map((s, i) => `
        <a class="carousel__slide" href="${href}" target="_blank" rel="noopener" aria-label="${multi ? `Foto ${i + 1} de ${imgs.length} — ${alt}` : alt}">
          <img class="card__img" loading="lazy" alt="${alt}" src="${escapeHtml(s)}" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
        </a>`).join('');

  const art = document.createElement('article');
  art.className = 'card';
  art.innerHTML = `
    <div class="card__media">
      <div class="carousel"${multi ? ` role="group" aria-roledescription="carrusel" aria-label="Carrusel de ${imgs.length} imágenes"` : ''}>${slides}</div>
      ${multi ? `
      <button class="carousel__nav carousel__nav--prev" type="button" aria-label="Imagen anterior">‹</button>
      <button class="carousel__nav carousel__nav--next" type="button" aria-label="Imagen siguiente">›</button>
      <div class="carousel__dots" aria-hidden="true">${imgs.map((_, i) => `<span class="carousel__dot${i === 0 ? ' is-active' : ''}"></span>`).join('')}</div>
      <span class="carousel__sr sr-only" role="status" aria-live="polite">Foto 1 de ${imgs.length}</span>` : ''}
    </div>
    <a class="card__body" href="${href}" target="_blank" rel="noopener">
      <span class="card__shelter">${escapeHtml(p.shelter)}</span>
      <div class="badges">
        <span class="badge">${TYPE_LABEL[p.type] || '🐾 Otro'}</span>
        ${CAT_LABEL[p.tipo] ? `<span class="badge badge--cat">${CAT_LABEL[p.tipo]}</span>` : ''}
      </div>
      <p class="card__text">${escapeHtml(p.excerpt)}</p>
      <div class="card__meta">
        <span class="card__cta">Ver en Instagram →</span>
      </div>
    </a>`;

  if (multi) {
    const carousel = art.querySelector('.carousel');
    carousel.addEventListener('scroll', () => syncCarousel(carousel), { passive: true });
  }
  return art;
}

// Flechas del carrusel: delegación en #grid (persiste entre re-renders). Los botones son
// hermanos del enlace, así que no navegan a Instagram; solo desplazan una imagen.
// Sincroniza el punto activo y el anuncio para lector de pantalla con la imagen visible.
function syncCarousel(carousel, idx) {
  const media = carousel.closest('.card__media');
  const dots = media.querySelectorAll('.carousel__dot');
  const n = dots.length;
  if (!n) return;
  if (idx == null) idx = Math.round(carousel.scrollLeft / (carousel.clientWidth || 1));
  idx = Math.max(0, Math.min(idx, n - 1));
  dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
  const sr = media.querySelector('.carousel__sr');
  if (sr) sr.textContent = `Foto ${idx + 1} de ${n}`;
}

grid.addEventListener('click', (e) => {
  const btn = e.target.closest('.carousel__nav');
  if (!btn) return;
  e.preventDefault();
  const carousel = btn.closest('.card__media').querySelector('.carousel');
  const w = carousel.clientWidth || 1;
  const n = carousel.querySelectorAll('.carousel__slide').length;
  const dir = btn.classList.contains('carousel__nav--next') ? 1 : -1;
  const idx = Math.max(0, Math.min(Math.round(carousel.scrollLeft / w) + dir, n - 1));
  carousel.scrollTo({ left: idx * w });
  syncCarousel(carousel, idx);
});

function render() {
  const list = posts.filter(
    (p) =>
      (filterType === 'todos' || (p.type || 'otro') === filterType) &&
      (filterCat === 'todas' || (p.tipo || 'otro') === filterCat) &&
      (filterShelter === 'todas' || p.shelter === filterShelter)
  );

  grid.innerHTML = '';
  empty.hidden = list.length > 0;

  let cards = null;
  let lastDay = '';
  for (const p of list) {
    const day = fmtDay(p.date); // agrupar por la MISMA etiqueta que se muestra (hora de Madrid)
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement('h2');
      h.className = 'day';
      h.textContent = day;
      grid.appendChild(h);
      cards = document.createElement('div');
      cards.className = 'cards';
      grid.appendChild(cards);
    }
    cards.appendChild(card(p));
  }
}

function initFilters() {
  for (const n of [...new Set(posts.map((p) => p.shelter))].sort()) {
    const o = document.createElement('option');
    o.value = n;
    o.textContent = n;
    shelterSel.appendChild(o);
  }
  shelterSel.addEventListener('change', () => {
    filterShelter = shelterSel.value;
    render();
  });
  typeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      typeBtns.forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      filterType = b.dataset.type;
      render();
    })
  );
  catBtns.forEach((b) =>
    b.addEventListener('click', () => {
      catBtns.forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      filterCat = b.dataset.cat;
      render();
    })
  );
}

// Carga el archivo por años: índice → un fichero JSON por año → todo junto.
async function loadArchive() {
  const idx = await fetch('data/archive/index.json').then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const years = (Array.isArray(idx) ? idx : []).map((y) => y.year);
  const arrs = await Promise.all(
    years.map((y) => fetch(`data/archive/${y}.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []))
  );
  return arrs.flat();
}

const source = document.body.dataset.source === 'archive'
  ? loadArchive()
  : fetch('data/posts.json').then((r) => (r.ok ? r.json() : []));

source
  .then((data) => {
    posts = Array.isArray(data) ? data : [];
    initFilters();
    render();
  })
  .catch(() => {
    empty.hidden = false;
  });
