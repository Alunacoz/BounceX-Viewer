window._bxConfigP = fetch('/config.json', { cache: 'no-store' })
  .then(r => r.json())
  .then(cfg => {
    const el = document.getElementById('managerLink');
    if (el) el.href = 'http://' + location.hostname + ':' + cfg.managerPort + '/manager.html';
    return cfg;
  })
  .catch(() => null);
