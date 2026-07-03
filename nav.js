// Menú hamburguesa (solo visible en móvil).
(function () {
  const btn = document.querySelector('.nav-toggle');
  const nav = document.getElementById('mainnav');
  if (!btn || !nav) return;
  btn.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
})();
