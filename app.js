const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const shelterSel = document.getElementById('shelter');
const PLACEHOLDER = 'img/placeholder.svg';

let posts = [];
let filterShelter = 'todas';

const escapeHtml = (s) =>
  (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

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
      <p class="card__text">${escapeHtml(p.excerpt)}</p>
      <div class="card__meta">
        <span class="card__shelter">${escapeHtml(p.shelter)}</span>
        <span class="card__cta">Ver en Instagram →</span>
      </div>
    </div>`;
  return a;
}

function render() {
  const list = posts.filter((p) => filterShelter === 'todas' || p.shelter === filterShelter);

  grid.innerHTML = '';
  empty.hidden = list.length > 0;

  let cards = null;
  let lastDay = '';
  for (const p of list) {
    const day = (p.date || '').slice(0, 10);
    if (day !== lastDay) {
      lastDay = day;
      const h = document.createElement('h2');
      h.className = 'day';
      h.textContent = fmtDay(p.date);
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
}

fetch('data/posts.json')
  .then((r) => (r.ok ? r.json() : []))
  .then((data) => {
    posts = Array.isArray(data) ? data : [];
    initFilters();
    render();
  })
  .catch(() => {
    empty.hidden = false;
  });
