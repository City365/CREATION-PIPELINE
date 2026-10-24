'use strict';
(function (root) {
  const presets = [
    { id: 'day-sea', label: '晴空海岸', wallpaper: '/skins/anime-sea.png', hint: '海边车站、蓝天与樱花', dark: false },
    { id: 'day-garden', label: '春日花房', wallpaper: '/skins/anime-garden.png', hint: '阳光、绿植与阅读时光', dark: false },
    { id: 'day-sea-live', label: '海风与花瓣', wallpaper: '/skins/anime-sea.png', hint: '晴空海岸 · 花瓣缓缓飘落', dark: false, animated: true, motion: 'petals' },
    { id: 'day-garden-live', label: '花房光尘', wallpaper: '/skins/anime-garden.png', hint: '春日花房 · 细小光尘浮动', dark: false, animated: true, motion: 'dust' },
    { id: 'real-cafe', label: '海边午后', wallpaper: '/skins/real-cafe.png', hint: '真人风格 · 明亮海边咖啡馆', dark: false },
    { id: 'real-reading', label: '晴日阅读', wallpaper: '/skins/real-reading.png', hint: '真人风格 · 阳光阅读室', dark: false },
    { id: 'real-cafe-live', label: '海边午后 · 动态照片', wallpaper: '/skins/real-cafe.mp4', poster: '/skins/real-cafe.png', hint: '真人风格 · 轻微镜头移动 · 静音循环', dark: false, animated: true, kind: 'video' },
    { id: 'real-reading-live', label: '晴日阅读 · 动态照片', wallpaper: '/skins/real-reading.mp4', poster: '/skins/real-reading.png', hint: '真人风格 · 轻微镜头移动 · 静音循环', dark: false, animated: true, kind: 'video' },
  ].map((p) => ({ ...p, day: true, kind: p.kind || 'image', sw: ['#eaf4ff', '#a6c5ef'] }));

  function catalog(ui = {}, legacy = []) {
    const imported = (Array.isArray(ui.wallpapers) ? ui.wallpapers : []).filter((p) => p && typeof p.path === 'string' && /^user-wp-[\w-]+$/.test(p.id || ''));
    return presets.concat(imported.map((p) => ({ ...p, wallpaper: '/api/file?path=' + encodeURIComponent(p.path),
      dark: false, day: true, custom: true, animated: ['gif', 'video', 'animated-image'].includes(p.kind),
      sw: ['#f4f7fb', '#b7c8e3'], hint: p.kind === 'video' ? '本机视频 · 静音循环' : p.kind === 'gif' ? '本机 GIF 动画' : p.kind === 'animated-image' ? '本机动态图片' : '本机静态图片' })), legacy);
  }

  function classify(file) {
    const extension = String(file.name || '').split('.').pop().toLowerCase();
    if (['mp4', 'webm'].includes(extension)) return 'video';
    if (extension === 'gif') return 'gif';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'image';
    throw new Error('支持 JPG、PNG、WebP、GIF、MP4 和 WebM');
  }

  function rotationPool(themes, kind) {
    return themes.filter((t) => t.day && (kind === 'all' || (kind === 'dynamic' ? t.animated : !t.animated)));
  }

  async function inspect(file) {
    const kind = classify(file);
    if (kind === 'image' && /\.(webp|png)$/i.test(file.name)) {
      const bytes = new Uint8Array(await file.slice(0, 262144).arrayBuffer());
      const png = bytes[0] === 137 && bytes[1] === 80;
      let offset = png ? 8 : 12;
      while (offset + 8 <= bytes.length) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
        const nameOffset = png ? offset + 4 : offset;
        const tag = String.fromCharCode(...bytes.slice(nameOffset, nameOffset + 4));
        if (tag === 'acTL' || tag === 'ANIM') return 'animated-image';
        const size = view.getUint32(png ? 0 : 4, !png);
        offset += png ? size + 12 : size + 8 + (size % 2);
      }
    }
    return kind;
  }

  const api = { presets, catalog, classify, inspect, rotationPool };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WallpaperLibrary = api;
})(typeof window !== 'undefined' ? window : globalThis);
