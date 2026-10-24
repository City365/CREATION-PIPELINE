'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const library = require('../web/wallpaper-library');

test('白昼预设明确区分静态与场景动画，引用真实本地图片', () => {
  assert.equal(library.presets.filter((p) => p.animated).length, 4);
  assert.equal(library.presets.filter((p) => !p.animated).length, 4);
  for (const p of library.presets) {
    assert.equal(p.day, true);
    assert.equal(p.dark, false);
    assert.ok(fs.existsSync(path.join(__dirname, '../web', p.wallpaper)));
    if (p.animated) assert.ok(p.motion || p.kind === 'video');
    if (p.kind === 'video') {
      assert.ok(fs.existsSync(path.join(__dirname, '../web', p.poster)));
      assert.match(p.wallpaper, /\.mp4$/);
    }
  }
});

test('本机壁纸集合可扩展，视频、GIF 与图片分类独立且路径被编码', () => {
  const wallpapers = Array.from({ length: 35 }, (_, i) => ({ id: 'user-wp-' + i, label: '壁纸' + i, path: 'D:/我的壁纸/' + i + '#.png', kind: i % 3 === 0 ? 'video' : i % 3 === 1 ? 'gif' : 'image' }));
  const all = library.catalog({ wallpapers });
  assert.equal(all.length, library.presets.length + 35);
  assert.ok(all.find((p) => p.id === 'user-wp-0').animated);
  assert.ok(all.find((p) => p.id === 'user-wp-1').animated);
  assert.equal(all.find((p) => p.id === 'user-wp-2').animated, false);
  assert.ok(all.find((p) => p.custom).wallpaper.includes('%23'));
  assert.equal(library.catalog({ wallpapers: [{ id: '<script>', path: 'x' }] }).length, library.presets.length);
});

test('轮换只选所指定的静态或动态壁纸', () => {
  const all = library.catalog({}, [{ id: 'studio-light' }]);
  assert.ok(library.rotationPool(all, 'static').every((p) => !p.animated));
  assert.ok(library.rotationPool(all, 'dynamic').every((p) => p.animated));
  assert.equal(library.rotationPool(all, 'all').length, library.presets.length);
});

test('导入格式检测支持静态图、GIF 和视频，并拒绝不支持的文件', () => {
  assert.equal(library.classify({ name: 'image.JPG' }), 'image');
  assert.equal(library.classify({ name: 'animation.gif' }), 'gif');
  assert.equal(library.classify({ name: 'anime.mp4' }), 'video');
  assert.equal(library.classify({ name: 'anime.webm' }), 'video');
  assert.throws(() => library.classify({ name: 'theme.exe' }));
});

test('动态 WebP、APNG 不会混入静态图片分类', async () => {
  const animatedWebp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPANIM'), Buffer.alloc(4)]);
  const apng = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4), Buffer.from('acTL'), Buffer.alloc(4)]);
  for (const [name, bytes] of [['motion.webp', animatedWebp], ['motion.png', apng]]) {
    const blob = new Blob([bytes]);
    blob.name = name;
    assert.equal(await library.inspect(blob), 'animated-image');
  }
  const still = new Blob([Buffer.from('RIFF\0\0\0\0WEBPVP8 \0\0\0\0')]);
  still.name = 'still.webp';
  assert.equal(await library.inspect(still), 'image');
});
