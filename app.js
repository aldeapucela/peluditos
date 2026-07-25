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
const INITIAL_WEEKS = 2;   // se muestran, de inicio, las publicaciones de las 2 últimas semanas
const WEEKS_STEP = 2;      // "Mostrar más" revela 2 semanas más (más antiguas) en cada pulsación
let shownWeeks = INITIAL_WEEKS;
const pager = document.getElementById('pager');

const escapeHtml = (s) =>
  (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

const fmtDay = (iso) => {
  const s = new Date(iso).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid',
  });
  return s.charAt(0).toUpperCase() + s.slice(1); // solo la primera letra en mayúscula
};

// Clave estable del día (AAAA-MM-DD en hora de Madrid) para el id del ancla de cada jornada.
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });

// Aviso efímero (p. ej. al copiar el enlace de un día).
let toastTimer;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
}

function card(p) {
  // Texto: teaser (excerpt, ≤180 car.) + descripción completa desplegable con "más" (estilo Instagram).
  const full = (p.caption || '').trim();
  const collapsed = full.replace(/\s+/g, ' ').trim();
  const short = (p.excerpt && p.excerpt.length) ? p.excerpt : collapsed;
  const hasMore = collapsed !== short; // hay más texto que el del teaser

  // imágenes: array nuevo (carrusel) o, retrocompat, la única `image`; si no hay, placeholder
  const imgs = (Array.isArray(p.images) && p.images.length) ? p.images : (p.image ? [p.image] : [PLACEHOLDER]);
  const multi = imgs.length > 1;
  const href = escapeHtml(safeUrl(p.permalink)); // escapado también para el contexto de atributo HTML
  const alt = `Publicación de ${escapeHtml(p.shelter)}`;
  const vids = new Set(Array.isArray(p.videos) ? p.videos : []); // índices de diapositivas que son vídeo
  const slides = imgs.map((s, i) => `
        <a class="carousel__slide" href="${href}" target="_blank" rel="noopener" aria-label="${(multi ? `Foto ${i + 1} de ${imgs.length} — ` : '') + alt + (vids.has(i) ? ' (vídeo)' : '')}">
          <img class="card__img" loading="lazy" alt="${alt}" src="${escapeHtml(s)}" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
          ${vids.has(i) ? '<span class="carousel__play" aria-hidden="true"></span>' : ''}
        </a>`).join('');

  const art = document.createElement('article');
  art.className = 'card';
  if (p.id) art.id = `post-${p.id}`; // ancla estable por publicación (para enlazar/compartir)
  art.innerHTML = `
    <div class="card__media">
      <div class="carousel"${multi ? ` role="group" aria-roledescription="carrusel" aria-label="Carrusel de ${imgs.length} imágenes"` : ''}>${slides}</div>
      ${multi ? `
      <button class="carousel__nav carousel__nav--prev" type="button" aria-label="Imagen anterior" hidden>‹</button>
      <button class="carousel__nav carousel__nav--next" type="button" aria-label="Imagen siguiente">›</button>
      <span class="carousel__count" role="status" aria-live="polite">1/${imgs.length}</span>
      <div class="carousel__dots" aria-hidden="true">${imgs.map((_, i) => `<span class="carousel__dot${i === 0 ? ' is-active' : ''}"></span>`).join('')}</div>` : ''}
    </div>
    <div class="card__body">
      <span class="card__shelter">${escapeHtml(p.shelter)}</span>
      <div class="badges">
        <span class="badge">${TYPE_LABEL[p.type] || '🐾 Otro'}</span>
        ${CAT_LABEL[p.tipo] ? `<span class="badge badge--cat">${CAT_LABEL[p.tipo]}</span>` : ''}
      </div>
      <p class="card__text"><span class="card__caption">${escapeHtml(short)}</span>${hasMore ? ` <button type="button" class="card__more" aria-expanded="false">más</button>` : ''}</p>
      <div class="card__meta">
        <a class="card__cta" href="${href}" target="_blank" rel="noopener">Ver en Instagram →</a>
        <button type="button" class="card__share" aria-label="Copiar enlace a esta ficha" title="Copiar enlace a esta ficha">🔗</button>
      </div>
    </div>`;

  if (multi) {
    const carousel = art.querySelector('.carousel');
    carousel.addEventListener('scroll', () => syncCarousel(carousel), { passive: true });
    syncCarousel(carousel, 0); // estado inicial: sin flecha izquierda, contador 1/N, punto 1 activo
  }
  const moreBtn = art.querySelector('.card__more');
  if (moreBtn) { moreBtn._full = full; moreBtn._short = short; } // textos para el toggle "más/menos"
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
  const count = media.querySelector('.carousel__count');
  if (count) count.textContent = `${idx + 1}/${n}`;
  const prev = media.querySelector('.carousel__nav--prev');
  const next = media.querySelector('.carousel__nav--next');
  if (prev) prev.hidden = idx === 0;         // sin flecha izquierda en la 1ª foto
  if (next) next.hidden = idx === n - 1;      // sin flecha derecha en la última
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

// "más/menos": despliega o repliega la descripción completa de la publicación.
// Ancla del día: copia al portapapeles el enlace directo a esa jornada (para compartir/Telegram).
grid.addEventListener('click', (e) => {
  const more = e.target.closest('.card__more');
  if (more) {
    const expanded = more.getAttribute('aria-expanded') === 'true';
    const cap = more.parentElement.querySelector('.card__caption');
    cap.textContent = expanded ? more._short : more._full;
    more.textContent = expanded ? 'más' : 'menos';
    more.setAttribute('aria-expanded', String(!expanded));
    return;
  }
  const share = e.target.closest('.card__share');
  if (share) {
    const art = share.closest('.card');
    if (!art || !art.id) return;
    history.replaceState(null, '', '#' + art.id); // deja la URL de la ficha lista para copiar
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(location.origin + location.pathname + '#' + art.id)
        .then(() => toast('Enlace de la ficha copiado 🔗'))
        .catch(() => {});
    }
  }
});

// Al abrir con un #post-<id> (o #dia-AAAA-MM-DD), desplaza hasta esa ficha/jornada. El
// contenido se pinta async y algunos navegadores (webview de Telegram, etc.) reinician el
// scroll tras cargar, así que reafirmamos la posición durante ~1,5 s hasta que se estabilice.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
function scrollToHash() {
  const id = decodeURIComponent((location.hash || '').slice(1));
  if (!id) return;
  let tries = 0, lastY = null;
  const step = () => {
    const el = document.getElementById(id);
    if (el) {
      // Resalta la ficha enlazada con una clase propia: :target no siempre aplica cuando el
      // contenido se inserta de forma asíncrona (tras el fetch/render).
      if (el.classList.contains('card')) {
        document.querySelectorAll('.card.is-target').forEach((c) => c.classList.remove('is-target'));
        el.classList.add('is-target');
      }
      el.scrollIntoView({ block: 'start' });
      const y = Math.round(window.scrollY);
      if (y === lastY) return;   // posición ya estable → listo
      lastY = y;
    }
    if (++tries < 15) setTimeout(step, 100); // reintenta si la ficha aún no está o el layout se mueve
  };
  requestAnimationFrame(step);
}
// Reapertura desde Telegram reutilizando la pestaña: solo cambia el hash, sin recargar.
// Si la ficha enlazada aún no está en la ventana visible, la amplía antes de desplazarse.
window.addEventListener('hashchange', () => {
  const id = decodeURIComponent((location.hash || '').slice(1));
  if (id) {
    const before = shownWeeks;
    ensureAnchorVisible(id);
    if (shownWeeks !== before) render();
  }
  scrollToHash();
});

function filteredPosts() {
  return posts.filter(
    (p) =>
      (filterType === 'todos' || (p.type || 'otro') === filterType) &&
      (filterCat === 'todas' || (p.tipo || 'otro') === filterCat) &&
      (filterShelter === 'todas' || p.shelter === filterShelter)
  );
}

// Publicaciones dentro de la ventana visible: las de las últimas `weeks` semanas contadas
// desde la publicación más reciente del listado filtrado (así también funciona con filtros).
function windowed(list, weeks) {
  if (!list.length) return list;
  const cutoff = Date.parse(list[0].date) - weeks * 7 * 864e5;
  return list.filter((p) => Date.parse(p.date) >= cutoff);
}

// Amplía la ventana lo justo para que el ancla (#post-<id> o #dia-<clave>) quede visible,
// de modo que los enlaces (Telegram, compartir) muestren la ficha aunque sea más antigua.
function ensureAnchorVisible(id) {
  const list = filteredPosts();
  if (!list.length) return;
  const anchor = Date.parse(list[0].date);
  let target = null;
  if (id.startsWith('post-')) { const pid = id.slice(5); const p = list.find((x) => x.id === pid); if (p) target = Date.parse(p.date); }
  else if (id.startsWith('dia-')) { const key = id.slice(4); const p = list.find((x) => dayKey(x.date) === key); if (p) target = Date.parse(p.date); }
  if (target == null) return;
  const need = Math.ceil((anchor - target) / (7 * 864e5));
  if (need > shownWeeks) shownWeeks = need;
}

function render() {
  const list = filteredPosts();
  const visible = windowed(list, shownWeeks);

  grid.innerHTML = '';
  empty.hidden = list.length > 0;

  let cards = null;
  let lastDay = '';
  for (const p of visible) {
    const key = dayKey(p.date); // agrupar por jornada (AAAA-MM-DD, hora de Madrid)
    if (key !== lastDay) {
      lastDay = key;
      const h = document.createElement('h2');
      h.className = 'day';
      h.id = `dia-${key}`; // se conserva por compatibilidad con enlaces de día ya compartidos
      h.textContent = fmtDay(p.date);
      grid.appendChild(h);
      cards = document.createElement('div');
      cards.className = 'cards';
      grid.appendChild(cards);
    }
    cards.appendChild(card(p));
  }
  renderMore(visible.length, list);
}

// Botón "Mostrar más": revela las 2 semanas siguientes (más antiguas). Si esa ventana no
// añadiese ninguna publicación (un hueco sin posts), sigue ampliando hasta encontrar más.
// Se oculta cuando ya se muestran todas.
function renderMore(visibleCount, list) {
  if (!pager) return;
  pager.innerHTML = '';
  if (visibleCount >= list.length) { pager.hidden = true; return; }
  pager.hidden = false;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'show-more';
  b.textContent = 'Mostrar más';
  b.addEventListener('click', () => {
    let w = shownWeeks;
    do { w += WEEKS_STEP; } while (windowed(list, w).length === visibleCount && windowed(list, w).length < list.length);
    shownWeeks = w;
    render();
  });
  pager.appendChild(b);
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
    shownWeeks = INITIAL_WEEKS; // al cambiar de filtro, vuelve a las 2 últimas semanas
    render();
  });
  typeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      typeBtns.forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      filterType = b.dataset.type;
      shownWeeks = INITIAL_WEEKS;
      render();
    })
  );
  catBtns.forEach((b) =>
    b.addEventListener('click', () => {
      catBtns.forEach((x) => x.classList.remove('is-active'));
      b.classList.add('is-active');
      filterCat = b.dataset.cat;
      shownWeeks = INITIAL_WEEKS;
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
    // Si venimos con un ancla, amplía la ventana para incluir esa ficha antes de pintar.
    const initId = decodeURIComponent((location.hash || '').slice(1));
    if (initId) ensureAnchorVisible(initId);
    render();
    scrollToHash();
  })
  .catch(() => {
    empty.hidden = false;
  });
