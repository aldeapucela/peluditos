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
  const a = document.createElement('a');
  a.className = 'card';
  a.href = safeUrl(p.permalink);
  a.target = '_blank';
  a.rel = 'noopener';
  a.innerHTML = `
    <img class="card__img" loading="lazy" alt="Publicación de ${escapeHtml(p.shelter)}"
         src="${p.image || PLACEHOLDER}" onerror="this.onerror=null;this.src='${PLACEHOLDER}'">
    <div class="card__body">
      <span class="card__shelter">${escapeHtml(p.shelter)}</span>
      <div class="badges">
        <span class="badge">${TYPE_LABEL[p.type] || '🐾 Otro'}</span>
        ${CAT_LABEL[p.tipo] ? `<span class="badge badge--cat">${CAT_LABEL[p.tipo]}</span>` : ''}
      </div>
      <p class="card__text">${escapeHtml(p.excerpt)}</p>
      <div class="card__meta">
        <span class="card__cta">Ver en Instagram →</span>
      </div>
    </div>`;
  return a;
}

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
