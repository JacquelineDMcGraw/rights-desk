// Apply the saved palette before styles paint, without waiting for app data.
(() => {
  const palettes = ['graffiti', 'sky', 'caramellatte', 'sage', 'midnight', 'highcontrast'];
  const browserColors = { graffiti: '#121214', sky: '#142f53', caramellatte: '#fff7ed', sage: '#fbfaf6', midnight: '#2b2825', highcontrast: '#ffffff' };
  let theme = 'graffiti';
  try {
    const saved = localStorage.getItem('rights-desk-theme-v1');
    if (palettes.includes(saved)) theme = saved;
  } catch { /* The default also works when browser storage is disabled. */ }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', browserColors[theme]);
})();
