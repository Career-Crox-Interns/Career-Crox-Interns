
(function() {
  const html = document.documentElement;
  const buttons = document.querySelectorAll('[data-theme]');
  const stored = localStorage.getItem('career_crox_theme') || 'corporate-light';
  html.setAttribute('data-theme', stored);

  function syncActive(theme) {
    buttons.forEach(btn => {
      btn.classList.toggle('active-theme', btn.dataset.theme === theme);
    });
  }

  syncActive(stored);

  buttons.forEach(btn => {
    btn.addEventListener('click', function() {
      const theme = this.dataset.theme;
      html.setAttribute('data-theme', theme);
      localStorage.setItem('career_crox_theme', theme);
      syncActive(theme);
    });
  });
})();
