'use strict';
// 在首屏绘制前应用主题，避免深色主题闪白。由各页面 head 同步加载。
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem('creative-desk-appearance') || '{}');
    var themes = ['mint', 'sky', 'peach', 'aurora', 'sakura', 'midnight', 'graphite'];
    var theme = themes.indexOf(prefs.theme) >= 0 ? prefs.theme : 'mint';
    var components = ['rounded', 'outline', 'compact'].indexOf(prefs.components) >= 0 ? prefs.components : 'rounded';
    var motion = ['full', 'soft', 'off'].indexOf(prefs.motion) >= 0 ? prefs.motion : 'full';
    var dark = theme === 'midnight' || theme === 'graphite';
    var root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.components = components;
    root.dataset.motion = motion;
    root.dataset.scheme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name=color-scheme]');
    if (meta) meta.content = dark ? 'dark' : 'light';
  } catch (error) { /* 首次访问没有偏好时用默认主题 */ }
})();
