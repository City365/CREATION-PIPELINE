'use strict';
/**
 * 剪辑台 V1 —— 照 Slint 前端（ui/app.slint + title-bar + editor + preview-pane +
 * media-pane + lanes + theme/dark.slint）重排的网页版：标题栏 / 左侧素材面板 /
 * 中间监视器 / 右侧 DETAILS / 下段时间线（工具栏 + 标尺 + 轨道头 + 电平表）。
 *
 * 它是 Concat 原生服务的客户端：打开是 project.open，读是 project.document，
 * 拖是 edit.apply + moveClips，撤销是 edit.undo。方法名和错误码都是引擎的。
 *
 * 引擎没有的两样（缩略图、波形）由本地的素材缓存出（/api/concat/assets/*），
 * 那是原生窗口在自己进程里做的事，浏览器只能让服务端代劳。
 */
(function () {
  var PL = window.CONCAT_PLACING;
  var RPC = window.CONCAT_RPC;
  var STORE = 'wmd.concat.project';
  var SHELF_FAV = 'wmd.concat.music.fav';
  var SHELF_RECENT = 'wmd.concat.music.recent';
  var DRAG_SNAP_PX = 8;

  /* 挂载参数。产品路由（app.js）把这个创作台工程的 id / 名字 / 提示函数传进来，
     页面据此决定「这个工程该开哪个 Concat 工程」——以前 mount 只收 host，
     于是不管从哪个工程点进来，打开的都是同一份上次留下的工程。 */
  var DEPS = {};

  /** 一个创作台工程一份记忆：它上次打开的是哪个 Concat 工程目录。 */
  function storeKey() { return STORE + '.' + (DEPS.projectId || 'default'); }

  /** 提示：页面自己那行 notice 保留，同时交给外面的 toast（有就给）。 */
  function toast(message) {
    if (!message) return;
    try { if (typeof DEPS.toast === 'function') DEPS.toast(message); } catch (error) { /* ignore */ }
  }

  var TRACK_HEIGHT = { video: 64, audio: 56, text: 40, image: 56 };

  /* 左侧页签：和剪映同一排（数字人、智能包装这两个我们不做，跳过），
     名字压到两个字以内。调节不在这里：13 根滑杆只放在右栏「详情 → 调节」一处，
     剪映的左栏「调节」是 LUT 预设浏览器，我们已经有「滤镜」那一栏了。 */
  var TABS = [
    { key: 'media', label: '素材', icon: '▤' },
    { key: 'audio', label: '音频', icon: '♫' },
    { key: 'text', label: '文本', icon: 'T' },
    { key: 'sticker', label: '贴纸', icon: '❖' },
    { key: 'effect', label: '特效', icon: '✦' },
    { key: 'transition', label: '转场', icon: '⇄' },
    { key: 'subtitle', label: '字幕', icon: '≡' },
    { key: 'filter', label: '滤镜', icon: '◐' },
    { key: 'template', label: '模板', icon: '▣' },
  ];

  /* 贴纸页签的「基础图形」：引擎的 ShapeKind，点一下就是 addShapeClip */
  var SHAPES = [
    { kind: 'square', label: '方块', fill: '#cbf53f', path: 'none' },
    { kind: 'circle', label: '圆形', fill: '#cbf53f', path: 'circle(50%)' },
    { kind: 'triangle', label: '三角', fill: '#7cc4ff', path: 'polygon(50% 0%, 100% 100%, 0% 100%)' },
    { kind: 'star', label: '星形', fill: '#ffc85c', path: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' },
    { kind: 'heart', label: '心形', fill: '#ff6f91', path: 'polygon(50% 92%, 8% 52%, 8% 26%, 30% 10%, 50% 26%, 70% 10%, 92% 26%, 92% 52%)' },
    { kind: 'arrow', label: '箭头', fill: '#a1a1a6', path: 'polygon(0% 35%, 60% 35%, 60% 10%, 100% 50%, 60% 90%, 60% 65%, 0% 65%)' },
    { kind: 'polygon', label: '多边形', fill: '#9f63d6', path: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)' },
    { kind: 'line', label: '直线', fill: '#f5f5f7', path: 'none' },
  ];

  /* 引擎的调整参数是英文标签，面板给中文（键名是 concat.adjust 的，别改） */
  var ADJUST_LABELS = {
    temperature: '色温', tint: '色调', saturation: '饱和度', exposure: '曝光',
    brightness: '亮度', light: '光感', contrast: '对比度', highlights: '高光',
    shadows: '阴影', whites: '白色', blacks: '黑色', clarity: '清晰',
    sharpen: '锐化', fade: '褪色', vignette: '暗角', grain: '颗粒',
    lift: '提升', gamma: '伽马', gain: '增益', luma: '明度曲线', red: '红曲线',
    green: '绿曲线', blue: '蓝曲线',
  };

  /* 曲库分类：剪映的「分类」其实就是一组题材词，搜的时候用的是同一套关键词，
     所以这里直接拿词去搜（数据还是剪映素材平台的，只是一个词一个词地看） */
  var MUSIC_TOPICS = {
    music: ['治愈', '轻快', '钢琴', '吉他', '电子', '摇滚', '古风', '国风', '旅行', 'Vlog', '浪漫', '史诗'],
    sound: ['转场', '自然', '机械', '生活', '打击', '笑声', '提示音', '氛围', '上升音', '故障'],
  };

  var SUB_DEFAULTS = {
    media: 'all', audio: 'bin', text: 'list', subtitle: 'list',
    sticker: 'shape', effect: 'all', transition: 'all', template: 'all',
    filter: 'all',
  };

  /* 这些页签的内容区是同一套「卡片列表」渲染：检索 / 布局 / 排序 都吃同一份数据 */
  var CARD_TABS = { text: 1, subtitle: 1, sticker: 1, effect: 1, transition: 1, filter: 1, template: 1 };

  var SEARCH_HINT = {
    media: '搜素材（名字）', audio: '搜音频（名字）', text: '搜文字片段', subtitle: '搜文字片段',
    sticker: '搜图形', effect: '搜特效', transition: '搜转场', filter: '搜滤镜',
    template: '搜模板', adjust: '搜参数',
  };

  var TEMPLATE = [
    '<div class="ce-shell">',

    /* ---------------------------------------------------------- 标题栏 */
    '  <header class="ce-titlebar">',
    '    <nav class="ce-menu">',
    '      <div class="ce-menu-item">',
    '        <button :class="{ on: openMenu === \'file\' }" @pointerdown.stop @click.stop="toggleMenu(\'file\')">文件</button>',
    '        <div v-if="openMenu === \'file\'" class="ce-dropdown" @pointerdown.stop>',
    '          <button @click="menuPick(\'new\')">新建工程…</button>',
    '          <button @click="menuPick(\'import\')" :disabled="!doc">导入素材…</button>',
    '          <button @click="menuPick(\'open\')">打开工程…</button>',
    '          <button @click="menuPick(\'save\')" :disabled="!doc">保存　Ctrl+S</button>',
    '          <button @click="menuPick(\'reload\')" :disabled="!doc">重新读取</button>',
    '          <span class="ce-dd-sep"></span>',
    '          <button @click="menuPick(\'export\')" :disabled="!doc">导出 MP4…</button>',
    '        </div>',
    '      </div>',
    '      <div class="ce-menu-item">',
    '        <button :class="{ on: openMenu === \'edit\' }" @pointerdown.stop @click.stop="toggleMenu(\'edit\')">编辑</button>',
    '        <div v-if="openMenu === \'edit\'" class="ce-dropdown" @pointerdown.stop>',
    '          <button @click="menuPick(\'undo\')" :disabled="!canUndo">撤销　Ctrl+Z</button>',
    '          <button @click="menuPick(\'redo\')" :disabled="!canRedo">重做　Ctrl+Y</button>',
    '          <span class="ce-dd-sep"></span>',
    '          <button @click="menuPick(\'split\')" :disabled="!doc">在播放头切开　S</button>',
    '          <button @click="menuPick(\'remove\')" :disabled="!selection.length">删除所选　Del</button>',
    '        </div>',
    '      </div>',
    '      <div class="ce-menu-item">',
    '        <button :class="{ on: openMenu === \'view\' }" @pointerdown.stop @click.stop="toggleMenu(\'view\')">视图</button>',
    '        <div v-if="openMenu === \'view\'" class="ce-dropdown" @pointerdown.stop>',
    '          <button @click="menuPick(\'fit\')" :disabled="!doc">适应窗口</button>',
    '          <button @click="menuPick(\'zoomin\')" :disabled="!doc">放大</button>',
    '          <button @click="menuPick(\'zoomout\')" :disabled="!doc">缩小</button>',
    '          <span class="ce-dd-sep"></span>',
    '          <button @click="menuPick(\'play\')" :disabled="!doc">{{ playing ? \'暂停\' : \'播放\' }}　空格</button>',
    '        </div>',
    '      </div>',
    '    </nav>',
    '    <div class="ce-titlebar-center">',
    '      <span class="ce-docname">{{ projectName || "Concat" }}</span>',
    '      <span class="ce-saved" v-if="doc">{{ saved ? "已保存" : "未保存" }}</span>',
    '    </div>',
    '    <div class="ce-titlebar-right">',
    '      <button class="ce-plain" @click="showPicker = !showPicker" title="切换工程">▦</button>',
    '      <button class="ce-export" @click="exportTimeline" :disabled="!doc || !!exportJob" title="导出这条时间线"><b>⬆</b> {{ exportJob ? exportPercent + \'%\' : \'导出\' }}</button>',
    '    </div>',
    '  </header>',

    /* ---------------------------------------------------------- 工程选择 */
    '  <div v-if="!doc || showPicker" class="ce-picker">',
    '    <div class="ce-picker-card">',
    '      <h3>打开工程</h3>',
    '      <p v-if="bootError" class="ce-err">{{ bootError }}</p>',
    '      <p v-else-if="!projects.length" class="ce-dim">没有最近的工程。</p>',
    '      <ul class="ce-projects">',
    '        <li v-for="item in projects" :key="item.path">',
    '          <button @click="openProject(item.path)">',
    '            <strong>{{ item.name }}</strong>',
    '            <span>{{ item.width }}×{{ item.height }} · {{ item.rateNum }}fps</span>',
    '            <em>{{ item.path }}</em>',
    '          </button>',
    '        </li>',
    '      </ul>',
    '      <div class="ce-path-open">',
    '        <input v-model="pathInput" placeholder="工程目录（含 concat.json）" @keyup.enter="openProject(pathInput)" />',
    '        <button class="ce-btn-accent" @click="openProject(pathInput)">打开</button>',
    '      </div>',
    '      <div class="ce-path-open">',
    '        <input v-model="newProjectName" placeholder="新工程名（建在引擎根目录下）" @keyup.enter="createProject" />',
    '        <button class="ce-btn-accent" :disabled="newProjectBusy" @click="createProject">{{ newProjectBusy ? \'建中…\' : \'新建\' }}</button>',
    '      </div>',
    '    </div>',
    '  </div>',

    /* ---------------------------------------------------------- 三栏 */
    '  <div v-else class="ce-work">',

    /* 左：素材面板（一排页签 + 二级竖菜单 + 内容区） */
    '    <section class="ce-pane ce-pane-left" :class="{ \'is-wide\': leftWide }">',
    '      <div class="ce-tabstrip">',
    '        <button v-for="tab in tabs" :key="tab.key" class="ce-tab" :class="{ \'is-active\': activeTab === tab.key }"',
    '                :title="tab.label" @click="setTab(tab.key)"><i>{{ tab.icon }}</i><span>{{ tab.label }}</span></button>',
    '        <button class="ce-tab-more" :title="leftWide ? \'收起素材面板\' : \'展开素材面板\'" @click="toggleLeftWide">{{ leftWide ? \'«\' : \'»\' }}</button>',
    '      </div>',
    '      <div class="ce-left-split">',
    '        <nav class="ce-subnav">',
    '          <button class="ce-subnav-head" v-if="activeTab === \'media\'" @click="importMedia">导入 <em>⌄</em></button>',
    '          <button v-for="row in subRows" :key="row.key" class="ce-subnav-row" :class="{ on: subKey === row.key }"',
    '                  :title="row.hint || row.label" @click="setSub(row.key)">',
    '            <span>{{ row.label }}</span><em v-if="row.count !== null">{{ row.count }}</em>',
    '          </button>',
    '        </nav>',
    '        <div class="ce-left-body">',

    /* 内容区顶栏：检索 / 布局 / 排序，每个页签都有（剪映也是这么一条） */
    '        <div class="ce-panel-bar" v-if="activeTab !== \'audio\'">',
    '          <button class="ce-bar-btn wide" v-if="activeTab === \'media\'" :disabled="importBusy" @click="importMedia"><b>⬇</b> {{ importBusy ? \'导入中…\' : \'导入\' }}</button>',
    '          <span class="ce-panel-search">',
    '            <input ref="panelInput" v-model="panelQuery" :placeholder="searchHint" />',
    '            <button v-if="panelQuery" @click="panelQuery = \'\'" title="清空">✕</button>',
    '          </span>',
    '          <button class="ce-bar-btn" @click="panelView = panelView === \'grid\' ? \'list\' : \'grid\'"',
    '                  :title="panelView === \'grid\' ? \'切成列表\' : \'切成网格\'">{{ panelView === \'grid\' ? \'▦\' : \'☰\' }}</button>',
    '          <select class="ce-bar-select" v-model="panelSort" title="排序">',
    '            <option value="default">默认</option>',
    '            <option value="name">名称 ↑</option>',
    '            <option value="name-desc">名称 ↓</option>',
    '            <option value="meta">分类</option>',
    '          </select>',
    '        </div>',

    /* 素材 / 音频（工程音频）：素材卡 */
    '        <template v-if="activeTab === \'media\' || (activeTab === \'audio\' && subKey === \'bin\')">',
    '          <div class="ce-tiles" :class="panelView">',
    '            <div class="ce-tile" v-for="item in filteredMedia" :key="item.id" :class="\'kind-\' + item.kind"',
    '                 :title="item.path" @dblclick="addToTimeline(item)">',
    '              <div class="ce-tile-art">',
    '                <img v-if="item.kind !== \'audio\'" :src="thumbUrl(item.path, Math.min(1, (item.duration || 0) / 2), 220)" alt="">',
    '                <svg v-else class="ce-tile-wave" viewBox="0 0 200 80" preserveAspectRatio="none">',
    '                  <path :d="waveArea(item)" />',
    '                </svg>',
    '                <span class="ce-tile-dur">{{ fmt(item.duration) }}</span>',
    '              </div>',
    '              <span class="ce-tile-name">{{ item.name }}</span>',
    '            </div>',
    '            <p v-if="!filteredMedia.length" class="ce-dim ce-tiles-empty">这一栏没有素材</p>',
    '          </div>',
    '        </template>',

    /* 剪映曲库：搜音乐 / 音效，试听，直接放进时间线 */
    '        <template v-else-if="activeTab === \'audio\'">',
    '          <div class="ce-search">',
    '            <span class="ce-search-field">',
    '              <input ref="musicInput" v-model="musicQuery" placeholder="搜曲库（如 治愈 钢琴）" @keyup.enter="searchMusic" />',
    '              <button v-if="musicQuery" class="ce-search-clear" @click="musicQuery = \'\'" title="清空">✕</button>',
    '            </span>',
    '            <button class="ce-btn-sq" title="联网搜剪映曲库" :disabled="musicSearching" @click="searchMusic">{{ musicSearching ? \'…\' : \'⌕\' }}</button>',
    '          </div>',
    '          <div class="ce-chips">',
    '            <button :class="{ on: musicKind === \'music\' }" @click="setMusicKind(\'music\')">音乐</button>',
    '            <button :class="{ on: musicKind === \'sound\' }" @click="setMusicKind(\'sound\')">音效</button>',
    '            <button :class="{ on: musicKind === \'local\' }" @click="setMusicKind(\'local\')">本机<em>{{ musicIndexCount }}</em></button>',
    '            <button :class="{ on: musicKind === \'fav\' }" @click="setMusicKind(\'fav\')">收藏<em>{{ musicFav.length }}</em></button>',
    '            <button :class="{ on: musicKind === \'recent\' }" @click="setMusicKind(\'recent\')">最近<em>{{ musicRecent.length }}</em></button>',
    '          </div>',
    '          <div class="ce-chips ce-chips-topics" v-if="musicTopics.length">',
    '            <button v-for="topic in musicTopics" :key="topic" @click="pickTopic(topic)">{{ topic }}</button>',
    '          </div>',
    '          <p class="ce-music-note is-err" v-if="musicError">{{ musicError }}<button class="ce-music-retry" @click="retryMusic">重试</button></p>',
    '          <p class="ce-music-note" v-else-if="musicNote">{{ musicNote }}</p>',
    '          <ul class="ce-music-list">',
    '            <li v-for="item in musicView" :key="musicKeyOf(item)" :class="{ playing: previewing === musicKeyOf(item) }">',
    '              <div class="ce-music-main">',
    '                <strong :title="item.title">{{ item.title }}</strong>',
    '                <em>{{ musicMeta(item) }}</em>',
    '              </div>',
    '              <span class="ce-music-badge" :class="{ paid: isPaid(item) }">{{ paidLabel(item) }}</span>',
    '              <button class="ce-music-act" :class="{ starred: isFav(item) }" :title="isFav(item) ? \'取消收藏\' : \'收藏\'" @click="toggleFav(item)">{{ isFav(item) ? \'★\' : \'☆\' }}</button>',
    '              <button class="ce-music-act" :title="previewing === musicKeyOf(item) ? \'停止试听\' : \'试听\'" @click="togglePreview(item)">{{ previewing === musicKeyOf(item) ? \'❚❚\' : \'▶\' }}</button>',
    '              <button class="ce-music-act add" title="放进时间线" :disabled="musicBusy === musicKeyOf(item)" @click="useMusic(item)">{{ musicBusy === musicKeyOf(item) ? \'…\' : \'＋\' }}</button>',
    '            </li>',
    '          </ul>',
    '        </template>',


    /* 文本 / 字幕 / 贴纸 / 特效 / 转场 / 滤镜 / 模板：同一套卡片列表 */
    '        <template v-else>',
    '          <div class="ce-compose" v-if="activeTab === \'text\' || activeTab === \'subtitle\'">',
    '            <textarea v-model="textDraft" rows="2" placeholder="打字，回车落到播放头（默认 3 秒）"',
    '                      @keydown.enter.exact.prevent="addText"></textarea>',
    '            <button class="ce-btn-accent" :disabled="textBusy" @click="addText">{{ textBusy ? \'加入中…\' : \'加入字幕\' }}</button>',
    '          </div>',
    '          <div class="ce-compose ce-compose-wrap" v-if="activeTab === \'subtitle\'">',
    '            <button class="ce-btn-accent" :disabled="subBusy" @click="importSubtitle">{{ subBusy ? \'读字幕…\' : \'导入 SRT / VTT…\' }}</button>',
    '            <label class="ce-inline-field" title="每行最多几个字">每行',
    '              <input type="number" min="6" max="48" step="1" v-model.number="subMaxChars" /> 字',
    '            </label>',
    '            <button class="ce-btn-ghost" :disabled="subBusy" @click="splitDraft">按标点拆上面那段</button>',
    '          </div>',
    '          <p class="ce-note" v-if="activeTab === \'subtitle\' && subNote">{{ subNote }}</p>',
    '          <div class="ce-compose" v-if="activeTab === \'template\'">',
    '            <input v-model="templateName" placeholder="模板名：把当前工程存成模板" @keyup.enter="saveTemplate" />',
    '            <button class="ce-btn-accent" :disabled="templateBusy" @click="saveTemplate">{{ templateBusy ? \'保存中…\' : \'存为模板\' }}</button>',
    '          </div>',
    '          <div class="ce-slotbox" v-if="activeTab === \'template\' && slotPick">',
    '            <p class="ce-note">「{{ slotPick.name }}」有 {{ slotPick.template.slots.length }} 个占位要填文件</p>',
    '            <div class="ce-slot-row" v-for="slot in slotPick.template.slots" :key="slot.mediaId">',
    '              <span class="ce-slot-name">{{ slot.name }}<em>{{ slotKindLabel(slot) }}</em></span>',
    '              <button class="ce-btn-sq" :disabled="slotPick.busy" @click="slotChoose(slot)">{{ slotFileLabel(slot.mediaId) ? \'换\' : \'选文件\' }}</button>',
    '              <span class="ce-slot-file ce-dim">{{ slotFileLabel(slot.mediaId) || \'还没选\' }}</span>',
    '            </div>',
    '            <div class="ce-compose">',
    '              <input v-model="slotPick.outName" placeholder="新工程名" @keyup.enter="slotGo" />',
    '              <button class="ce-btn-accent" :disabled="slotPick.busy || !slotReady" @click="slotGo">{{ slotPick.busy ? \'建工程…\' : \'填好，建工程\' }}</button>',
    '            </div>',
    '            <p class="ce-dhint" v-if="!slotReady">每个占位都要给一个文件，引擎的 template.instantiate 不接受空着的槽。</p>',
    '            <p class="ce-dim" v-if="slotPick.error">{{ slotPick.error }}</p>',
    '          </div>',
    '          <p class="ce-note" v-if="panelNote">{{ panelNote }}</p>',
    '          <p class="ce-dim ce-tiles-empty" v-if="catalogError">{{ catalogError }}</p>',
    '          <p class="ce-dim ce-tiles-empty" v-if="templateNote">{{ templateNote }}</p>',
    '          <ul class="ce-cards" :class="panelView">',
    '            <li v-for="item in panelItems" :key="item.key" :title="item.hint || item.title"',
    '                :class="{ \'is-tall\': item.kind === \'shape\' }" @click="panelPick(item)">',
    '              <span class="ce-card-art" v-if="item.kind === \'shape\'" :style="shapeStyle(item.payload)"></span>',
    '              <strong>{{ item.title }}</strong>',
    '              <em>{{ item.meta }}</em>',
    '              <span class="ce-applied" v-if="item.applied">已用</span>',
    '            </li>',
    '          </ul>',
    '          <p v-if="!panelItems.length" class="ce-dim ce-tiles-empty">{{ panelEmpty }}</p>',
    '        </template>',
    '        </div>',
    '      </div>',
    '    </section>',

    /* 中：监视器 */
    '    <section class="ce-pane ce-pane-center">',
    '      <div class="ce-pane-head">',
    '        <span class="ce-pane-title">预览</span>',
    '        <span class="ce-pane-meta">{{ canvas.width }} × {{ canvas.height }} · {{ fpsLabel }}</span>',
    '      </div>',
    '      <div class="ce-stage" ref="stage" :class="{ \'is-brush\': brushOn && !!activeClip.id }"',
    '           @pointerdown="onStrokeDown" @pointermove="onStrokeMove" @pointerup="onStrokeUp" @pointerleave="onStrokeUp">',
    '        <img v-if="frameSrc" :src="frameSrc" alt="" />',
    '        <div v-else class="ce-stage-empty"><span>▦</span><p>{{ stageMessage }}</p></div>',
    '      </div>',
    '      <div class="ce-transport">',
    '        <span class="ce-tc">{{ timecodeLong(playhead) }}</span>',
    '        <span class="ce-tc-total">/ {{ timecodeLong(duration) }}</span>',
    '        <div class="ce-transport-mid">',
    '          <button @click="seek(0)" title="开头">⏮</button>',
    '          <button @click="stepFrame(-1)" title="上一帧">◀◀</button>',
    '          <button class="ce-play" @click="togglePlay" :title="playing ? \'暂停\' : \'播放\'">{{ playing ? "❚❚" : "▶" }}</button>',
    '          <button @click="stepFrame(1)" title="下一帧">▶▶</button>',
    '          <button @click="seek(duration)" title="结尾">⏭</button>',
    '        </div>',
    '        <select v-model.number="playRate" class="ce-select" title="播放速度"><option :value="0.5">0.5×</option><option :value="1">1×</option><option :value="2">2×</option></select>',
    '        <select v-model="previewQuality" class="ce-select" title="预览质量"><option>草稿</option><option>半清</option><option>全清</option></select>',
    '        <button class="ce-btn-sq" :class="{ on: soundOn }" @click="toggleSound" :title="soundOn ? \'预览声音：开\' : \'预览声音：关\'">♪</button>',
    '        <button class="ce-btn-sq" title="全屏" @click="toggleFullscreen">⛶</button>',
    '      </div>',
    '    </section>',

    /* 右：详情 */
    '    <section class="ce-pane ce-pane-right">',
    '      <div class="ce-pane-head">',
    '        <span class="ce-pane-title">详情</span>',
    '      </div>',
    '      <div class="ce-details">',
    '        <template v-if="activeClip.id">',
    
        /* ---------------- 基础：位置 / 缩放 / 旋转 / 分轴拉伸（setClipTransform） */
    '          <div class="ce-dgroup">',
    '            <span class="ce-dgroup-title">基础</span>',
    '            <div class="ce-drow" :class="{ \'has-kf\': field.kf }" v-for="field in transformFields" :key="field.key">',
    '              <label>{{ field.label }}</label>',
    '              <input type="number" :step="field.step" :min="field.min" :max="field.max"',
    '                     :value="num(activeClip[field.key], field.fallback)"',
    '                     @change="patchClip(field.key, $event.target.value)" />',
    '              <button v-if="field.kf" class="ce-kf" :class="{ on: keyCountOf(field.key) }" @click="toggleClipKey(field.key)"',
    '                      title="关键帧：在播放头位置打点 / 取消">◆</button>',
    '            </div>',
    '          </div>',
    
        /* ---------------- 画面：混合模式 + 不透明度 */
    '          <div class="ce-dgroup">',
    '            <span class="ce-dgroup-title">画面</span>',
    '            <div class="ce-drow">',
    '              <label>混合模式</label>',
    '              <select :value="blendValue()" @change="setBlend($event.target.value)">',
    '                <option v-for="mode in blendModes" :key="mode.key" :value="mode.key">{{ mode.label }}</option>',
    '              </select>',
    '            </div>',
    '            <div class="ce-drow" :class="{ \'has-kf\': field.kf }" v-for="field in pictureFields" :key="field.key">',
    '              <label>{{ field.label }}</label>',
    '              <input type="number" :step="field.step" :min="field.min" :max="field.max"',
    '                     :value="num(activeClip[field.key], field.fallback)"',
    '                     @change="patchClip(field.key, $event.target.value)" />',
    '              <button v-if="field.kf" class="ce-kf" :class="{ on: keyCountOf(field.key) }" @click="toggleClipKey(field.key)"',
    '                      title="关键帧：在播放头位置打点 / 取消">◆</button>',
    '            </div>',
    '          </div>',
    
        /* ---------------- 调节：concat.adjust 的 13 根滑杆 + 3 色轮 + 4 曲线，只在这一处 */
    '          <div class="ce-dgroup" v-if="activeClip.kind !== \'audio\' && adjustParams.length">',
    '            <span class="ce-dgroup-title">调节</span>',
    '            <div class="ce-slider-row" v-for="p in adjustSliders" :key="p.key">',
    '              <label :title="p.key">{{ adjustLabel(p) }}</label>',
    '              <input type="range" :min="p.min" :max="p.max" :step="p.step || 0.01" :value="adjustValue(p)"',
    '                     :disabled="adjustBusy" @input="setAdjust(p, $event.target.value)" />',
    '              <em>{{ adjustValue(p) }}{{ p.unit }}</em>',
    '            </div>',
    '            <div class="ce-wheel-row" v-for="p in adjustWheels" :key="p.key">',
    '              <span class="ce-wheel-name">{{ adjustLabel(p) }}</span>',
    '              <span class="ce-wheel" @pointerdown="wheelDown($event, p)">',
    '                <i class="ce-wheel-dot" :style="wheelState(p).dot"></i>',
    '              </span>',
    '              <span class="ce-wheel-master">',
    '                <input type="range" :min="p.min" :max="p.max" :step="p.step || 0.01"',
    '                       :value="wheelState(p).m" @input="setWheelMaster(p, $event.target.value)" />',
    '                <em>{{ wheelState(p).m }}</em>',
    '              </span>',
    '              <button class="ce-chain-x" title="复位" @click="resetWheel(p)">↺</button>',
    '            </div>',
    '            <div class="ce-curve-row" v-for="p in adjustCurves" :key="p.key">',
    '              <span class="ce-wheel-name">{{ adjustLabel(p) }}</span>',
    '              <svg class="ce-curve" viewBox="0 0 100 100" preserveAspectRatio="none"',
    '                   @pointerdown="curveDown($event, p)">',
    '                <path class="ce-curve-grid" d="M0 100 L100 0" />',
    '                <path class="ce-curve-line" :d="curvePath(p)" />',
    '                <circle v-for="(pt, i) in curvePoints(p)" :key="i" class="ce-curve-dot" r="3.5"',
    '                        :cx="pt.x * 100" :cy="(1 - pt.y) * 100"',
    '                        @pointerdown.stop="curveGrab($event, p, i)"',
    '                        @dblclick.stop="curveDrop($event, p, i)"></circle>',
    '              </svg>',
    '              <span class="ce-curve-meta">{{ curvePoints(p).length }} 点</span>',
    '              <button class="ce-chain-x" title="复位成直线" @click="resetCurve(p)">↺</button>',
    '            </div>',
    '            <button class="ce-block-btn" @click="clearAdjust">清掉调节</button>',
    '          </div>',
    
        /* ---------------- 文字（只有文字片段） */
    '          <div class="ce-dgroup" v-if="activeClip.kind === \'text\'">',
    '            <span class="ce-dgroup-title">文字</span>',
    '            <textarea class="ce-dtext" rows="3" :value="(activeClip.text && activeClip.text.content) || \'\'"',
    '                      @change="setTextContent($event.target.value)"></textarea>',
    '            <p class="ce-dhint">改完按回车或点别处生效（保留字体/字号/颜色）。</p>',
    '          </div>',
    
        /* ---------------- 画面链：特效 / 滤镜（点一条展开参数） */
    '          <div class="ce-dgroup" v-if="chainRows.length">',
    '            <span class="ce-dgroup-title">效果与滤镜</span>',
    '            <div class="ce-chain" v-for="row in chainRows" :key="row.id + \':\' + row.index">',
    '              <div class="ce-dchain" @click="toggleChain(row.id)">',
    '                <span>{{ row.label }}<em v-if="row.params.length" class="ce-dim"> · {{ row.params.length }} 参数</em></span>',
    '                <button class="ce-chain-x" title="移除" @click.stop="removeEffect(row.id, row.index)">✕</button>',
    '              </div>',
    '              <div class="ce-chain-params" v-if="row.open">',
    '                <template v-for="p in row.params" :key="p.key">',
    '                  <div class="ce-slider-row" :class="{ \'has-kf\': p.animate }" v-if="p.type === \'float\' || p.type === \'int\'">',
    '                    <label :title="p.key">{{ p.label }}</label>',
    '                    <input type="range" :min="p.min" :max="p.max" :step="p.step" :value="effectValue(row.index, p)"',
    '                           @input="setEffectParam(row.index, p, $event.target.value)" />',
    '                    <em>{{ effectValue(row.index, p) }}{{ p.unit }}</em>',
    '                    <button v-if="p.animate" class="ce-kf" :class="{ on: p.keyed }" @click="toggleEffectKey(row.index, p)"',
    '                            title="在播放头位置打关键帧（引擎标记这个参数可以动）">◆</button>',
    '                  </div>',
    '                  <div class="ce-wheel-row" v-if="p.type === \'wheel\'">',
    '                    <span class="ce-wheel-name">{{ p.label }}</span>',
    '                    <span class="ce-wheel" @pointerdown="chainWheelDown($event, row.index, p)">',
    '                      <i class="ce-wheel-dot" :style="chainWheel(row.index, p).dot"></i>',
    '                    </span>',
    '                    <span class="ce-wheel-master">',
    '                      <input type="range" :min="p.min" :max="p.max" :step="p.step || 0.01"',
    '                             :value="chainWheel(row.index, p).m" @input="chainWheelMaster(row.index, p, $event.target.value)" />',
    '                      <em>{{ chainWheel(row.index, p).m }}</em>',
    '                    </span>',
    '                    <button class="ce-chain-x" title="复位" @click="chainResetWheel(row.index, p)">↺</button>',
    '                  </div>',
    '                  <div class="ce-curve-row" v-if="p.type === \'curve\'">',
    '                    <span class="ce-wheel-name">{{ p.label }}</span>',
    '                    <svg class="ce-curve" viewBox="0 0 100 100" preserveAspectRatio="none"',
    '                         @pointerdown="chainCurveDown($event, row.index, p)">',
    '                      <path class="ce-curve-grid" d="M0 100 L100 0" />',
    '                      <path class="ce-curve-line" :d="chainCurvePath(row.index, p)" />',
    '                      <circle v-for="(pt, i) in chainCurvePoints(row.index, p)" :key="i" class="ce-curve-dot" r="3.5"',
    '                              :cx="pt.x * 100" :cy="(1 - pt.y) * 100"',
    '                              @pointerdown.stop="chainCurveGrab($event, row.index, p, i)"',
    '                              @dblclick.stop="chainCurveDrop($event, row.index, p, i)"></circle>',
    '                    </svg>',
    '                    <span class="ce-curve-meta">{{ chainCurvePoints(row.index, p).length }} 点</span>',
    '                    <button class="ce-chain-x" title="复位成直线" @click="chainResetCurve(row.index, p)">↺</button>',
    '                  </div>',
    '                </template>',
    '                <p class="ce-dhint" v-if="!row.params.length">这一条没有可调参数（转场/打包效果由引擎自己算）。</p>',
    '              </div>',
    '            </div>',
    '          </div>',
    
        /* ---------------- 蒙版 */
    '          <div class="ce-dgroup" v-if="activeClip.kind !== \'audio\'">',
    '            <span class="ce-dgroup-title">蒙版</span>',
    '            <div class="ce-drow">',
    '              <label>形状</label>',
    '              <select :value="maskValue(\'shape\')" @change="setMask({ shape: $event.target.value })">',
    '                <option v-for="shape in maskShapes" :key="shape.key" :value="shape.key">{{ shape.label }}</option>',
    '              </select>',
    '            </div>',
    '            <div class="ce-drow" :class="{ \'has-kf\': field.key !== \'invert\' }" v-for="field in maskFields" :key="field.key">',
    '              <label>{{ field.label }}</label>',
    '              <input type="range" :min="field.min" :max="field.max" :step="field.step"',
    '                     :value="maskValue(field.key)" @input="setMask({ [field.key]: $event.target.value })" />',
    '              <em class="ce-dval">{{ maskValue(field.key) }}</em>',
    '              <button class="ce-kf" :class="{ on: keyCountOf(field.keyProp) }" @click="toggleClipKey(field.keyProp)"',
    '                      :title="\'给「\' + field.label + \'」打关键帧（引擎的 \' + field.keyProp + \'）\'">◆</button>',
    '            </div>',
    '            <label class="ce-check"><input type="checkbox" :checked="maskValue(\'invert\')"',
    '                   @change="setMask({ invert: $event.target.checked })" /> 反转（留下外面）</label>',
    '            <button class="ce-block-btn" :disabled="!activeClip.mask" @click="clearMask">去掉蒙版</button>',
    '          </div>',
    
        /* ---------------- 抠像：模式 / 主体 / 羽化 + 四支笔 */
    '          <div class="ce-dgroup" v-if="activeClip.kind === \'video\' || activeClip.kind === \'image\'">',
    '            <span class="ce-dgroup-title">抠像</span>',
    '            <div class="ce-drow">',
    '              <label>模式</label>',
    '              <select :value="cutoutValue(\'mode\')" @change="setCutout({ mode: $event.target.value })">',
    '                <option value="auto">自动（模型判定）</option>',
    '                <option value="custom">自定义（叠笔画修正）</option>',
    '              </select>',
    '            </div>',
    '            <div class="ce-drow">',
    '              <label>主体</label>',
    '              <select :value="cutoutValue(\'subject\')" @change="setCutout({ subject: $event.target.value })">',
    '                <option value="auto">自动</option>',
    '                <option value="person">人</option>',
    '                <option value="object">物体</option>',
    '              </select>',
    '            </div>',
    '            <div class="ce-drow">',
    '              <label>羽化</label>',
    '              <input type="range" min="0" max="0.1" step="0.002" :value="cutoutValue(\'feather\')"',
    '                     @input="setCutout({ feather: $event.target.value })" />',
    '              <em class="ce-dval">{{ cutoutValue(\'feather\') }}</em>',
    '            </div>',
    '            <div class="ce-drow">',
    '              <label>笔画</label>',
    '              <select v-model="brushTool">',
    '                <option v-for="tool in brushTools" :key="tool.key" :value="tool.key">{{ tool.label }}</option>',
    '              </select>',
    '            </div>',
    '            <div class="ce-drow">',
    '              <label>粗细</label>',
    '              <input type="range" min="0.005" max="0.5" step="0.005" v-model.number="brushSize" />',
    '              <em class="ce-dval">{{ brushSize }}</em>',
    '            </div>',
    '            <label class="ce-check"><input type="checkbox" :checked="brushOn"',
    '                   @change="brushOn = $event.target.checked" /> 在预览上画（关掉就不会误画）</label>',
    '            <div class="ce-dchain" v-for="(stroke, i) in cutoutStrokes" :key="i">',
    '              <span>{{ brushLabel(stroke.tool) }} · {{ (stroke.points || []).length }} 点 · 粗 {{ stroke.size }}</span>',
    '              <button class="ce-chain-x" title="删掉这一笔" @click="removeStroke(i)">✕</button>',
    '            </div>',
    '            <button class="ce-block-btn" :disabled="!cutoutStrokes.length" @click="clearStrokes">清掉全部笔画</button>',
    '            <button class="ce-block-btn" :disabled="!activeClip.cutout" @click="clearCutout">去掉抠像</button>',
    '            <p class="ce-dhint">引擎出第一帧时跑抠像模型（本机没有会自动取）；不画笔画时「自定义」和「自动」是一回事。</p>',
    '          </div>',
    
        /* ---------------- 音频 */
    '          <div class="ce-dgroup">',
    '            <span class="ce-dgroup-title">音频</span>',
    '            <div class="ce-drow" :class="{ \'has-kf\': field.kf }" v-for="field in audioFields" :key="field.key">',
    '              <label>{{ field.label }}</label>',
    '              <input type="number" :step="field.step" :min="field.min" :max="field.max"',
    '                     :value="num(activeClip[field.key], field.fallback)"',
    '                     @change="patchClip(field.key, $event.target.value)" />',
    '              <button v-if="field.kf" class="ce-kf" :class="{ on: keyCountOf(field.key) }" @click="toggleClipKey(field.key)"',
    '                      title="关键帧：在播放头位置打点 / 取消">◆</button>',
    '            </div>',
    '          </div>',
    
        /* ---------------- 变速 */
    '          <div class="ce-dgroup">',
    '            <span class="ce-dgroup-title">变速</span>',
    '            <div class="ce-drow" v-for="field in speedFields" :key="field.key">',
    '              <label>{{ field.label }}</label>',
    '              <input type="number" :step="field.step" :min="field.min" :max="field.max"',
    '                     :value="num(activeClip[field.key], field.fallback)"',
    '                     @change="patchClip(field.key, $event.target.value)" />',
    '            </div>',
    '          </div>',
    
        /* ---------------- 关键帧 */
    '          <div class="ce-dgroup" v-if="clipKeyRows.length">',
    '            <span class="ce-dgroup-title">关键帧</span>',
    '            <div class="ce-dchain" v-for="row in clipKeyRows" :key="row.key">',
    '              <span>{{ row.label }} · {{ row.count }} 个</span>',
    '              <button class="ce-chain-x" title="清掉这一路全部关键帧" @click="clearClipKeys(row.key)">✕</button>',
    '            </div>',
    '            <p class="ce-dhint">◆ 在播放头位置打点；同一个位置再点一次就取消。</p>',
    '          </div>',
    
        /* ---------------- 转场 */
    '          <div class="ce-dgroup" v-if="activeClip.transitionIn">',
    '            <span class="ce-dgroup-title">转场</span>',
    '            <div class="ce-drow"><label>类型</label><span>{{ transitionLabel(activeClip.transitionIn.id) }}</span></div>',
    '            <div class="ce-drow"><label>时长</label><span>{{ activeClip.transitionIn.duration }} 秒</span></div>',
    '            <button class="ce-block-btn" @click="clearTransition">去掉转场</button>',
    '          </div>',
    
        /* ---------------- 信息（原来在最上面的「片段」，挪到最后，剪映也是这么收的） */
    '          <div class="ce-dgroup">',
    '            <span class="ce-dgroup-title">信息</span>',
    '            <div class="ce-drow"><label>名称</label><span class="ce-wrap">{{ activeClip.name }}</span></div>',
    '            <div class="ce-drow"><label>类型</label><span>{{ kindLabel(activeClip.kind) }}</span></div>',
    '            <div class="ce-drow"><label>入点</label><span>{{ timecodeShort(activeClip.start) }}</span></div>',
    '            <div class="ce-drow"><label>时长</label><span>{{ timecodeShort(activeClip.duration) }}</span></div>',
    '            <div class="ce-drow"><label>源入点</label><span>{{ timecodeShort(activeClip.sourceStart || 0) }}</span></div>',
    '            <div class="ce-drow"><label>轨道</label><span>{{ activeClip.trackId }}</span></div>',
    '          </div>',
    '        </template>',
    '        <template v-else>',
    '          <div class="ce-dgroup">',
    '            <span class="ce-dgroup-title">工程</span>',
    '            <div class="ce-drow"><label>名称</label><span class="ce-wrap">{{ projectName }}</span></div>',
    '            <div class="ce-drow"><label>文件夹</label><span class="ce-wrap ce-dim">{{ projectPath }}</span></div>',
    '          </div>',
    '          <div class="ce-dgroup">',
    '            <span class="ce-dgroup-title">时间线</span>',
    '            <div class="ce-drow"><label>名称</label><span>{{ timelineName }}</span></div>',
    '            <div class="ce-drow"><label>画面</label><span>{{ canvas.width }} × {{ canvas.height }}</span></div>',
    '            <div class="ce-drow"><label>帧率</label><span>{{ fpsLabel }}</span></div>',
    '            <div class="ce-drow"><label>时长</label><span>{{ timecodeLong(duration) }}</span></div>',
    '          </div>',
    '          <div class="ce-dgroup">',
    '            <span class="ce-dgroup-title">内容</span>',
    '            <div class="ce-drow"><label>素材</label><span>{{ media.length }}</span></div>',
    '            <div class="ce-drow"><label>轨道</label><span>{{ tracks.length }}</span></div>',
    '            <div class="ce-drow"><label>片段</label><span>{{ clips.length }}</span></div>',
    '          </div>',
    '        </template>',
    '      </div>',
    '      <div class="ce-pane-foot"><button class="ce-btn-ghost" @click="inspectorHint">修改</button></div>',
    '    </section>',
    '  </div>',

    /* 时间线上面那条分割条：拖着改时间线高度（剪映也是这么分的，默认约 40%） */
    '  <div v-if="doc" class="ce-splitter" title="拖动改时间线高度，双击复原"',
    '       @pointerdown="onSplitDown" @dblclick="resetTimelineHeight(true)"></div>',

    /* ---------------------------------------------------------- 时间线 */
    '  <section v-if="doc" class="ce-tl" :style="timelineStyle">',
    '    <div class="ce-tl-tabs">',
    '      <button v-for="tab in timelineTabs" :key="tab.id" class="ce-tl-tab" :class="{ \'is-active\': tab.active }"',
    '              @click="selectTimeline(tab.id)">{{ tab.label }}</button>',
    '      <button class="ce-tl-tab-add" title="新建时间线" @click="addTimeline">+</button>',
    '    </div>',
    '    <div class="ce-tl-tools">',
    '      <button class="ce-tool" title="新建轨道" @click="addTrack">+</button>',
    '      <button class="ce-tool" @click="undo" :disabled="!canUndo" title="撤销 (Ctrl+Z)">↶</button>',
    '      <button class="ce-tool" @click="redo" :disabled="!canRedo" title="重做 (Ctrl+Y)">↷</button>',
    '      <span class="ce-tool-sep"></span>',
    '      <button class="ce-tool" @click="splitAtPlayhead" title="切开 (S)">✂</button>',
    '      <button class="ce-tool" :class="{ on: snap }" @click="snap = !snap" title="吸附">⌖</button>',
    '      <span class="ce-tool-sep"></span>',
    '      <button class="ce-tool" @click="stepFrame(-1)" title="上一帧">◀</button>',
    '      <button class="ce-tool" @click="stepFrame(1)" title="下一帧">▶</button>',
    '      <span class="ce-tools-right">',
    '        <button class="ce-tool" @click="fitZoom" title="适应窗口">⛶</button>',
    '        <button class="ce-tool" @click="zoomBy(0.8)" title="缩小">−</button>',
    '        <button class="ce-tool" @click="zoomBy(1.25)" title="放大">＋</button>',
    '      </span>',
    '    </div>',
    '    <div class="ce-tl-body">',
    '      <div class="ce-tl-heads">',
    '        <div class="ce-ruler-corner"></div>',
    '        <div v-for="track in tracksDesc" :key="track.id" class="ce-lane-head" :style="{ height: track.height + \'px\' }">',
    '          <button class="ce-fl" :class="{ off: !track.visible }" @click="toggleFlag(track.id, \'visible\')" title="显示/隐藏">👁</button>',
    '          <button class="ce-fl" :class="{ off: !track.muted }" @click="toggleFlag(track.id, \'muted\')" title="静音">🔈</button>',
    '          <span class="ce-lane-tag" :class="\'kind-\' + track.kind">{{ track.label }}</span>',
    '        </div>',
    '      </div>',
    '      <div class="ce-tl-scroll" ref="tlScroll" :class="{ \'is-panning\': panning }" @wheel="onWheel" @pointerdown="onLaneDown">',
    '        <div class="ce-ruler" :style="{ width: contentWidth + \'px\' }"',
    '             @pointerdown="onRulerDown">',
    '          <span v-for="tick in ticks" :key="tick.at" class="ce-tick" :style="{ left: (tick.at * zoom) + \'px\' }"><em>{{ tick.label }}</em></span>',
    '        </div>',
    '        <div v-for="track in tracksDesc" :key="track.id" class="ce-lane"',
    '             :class="[\'lane-\' + track.kind, { alt: track.alt }]" :data-track="track.id"',
    '             :style="{ width: contentWidth + \'px\', height: track.height + \'px\' }">',
    '          <div v-for="clip in clipsOf(track.id)" :key="clip.id" class="ce-clip"',
    '               :class="[\'kind-\' + clip.kind, { selected: isSelected(clip.id), ghost: !!dragGhost[clip.id] }]"',
    '               :style="clipStyle(clip)" :data-clip="clip.id"',
    '               @pointerdown.stop="onClipDown($event, clip, \'move\')"',
    '               @dblclick.stop="seek(clip.start)">',
    '            <div class="ce-clip-head"><span>{{ clipLabel(clip) }}</span></div>',
    '            <div class="ce-clip-body">',
    '              <template v-if="clip.kind === \'video\' || clip.kind === \'image\'">',
    '                <img v-for="(shot, i) in filmstrip(clip)" :key="i" :src="shot" alt="" />',
    '              </template>',
    '              <svg v-else-if="clip.kind === \'audio\'" class="ce-wave" viewBox="0 0 1000 100" preserveAspectRatio="none">',
    '                <path :d="waveArea(clip)" />',
    '              </svg>',
    '            </div>',
    '            <span class="ce-edge left" @pointerdown.stop="onClipDown($event, clip, \'trim-start\')"></span>',
    '            <span class="ce-edge right" @pointerdown.stop="onClipDown($event, clip, \'trim-end\')"></span>',
    '          </div>',
    '        </div>',
    '        <div class="ce-playhead" :style="{ left: (playhead * zoom) + \'px\' }" @pointerdown.stop="onRulerDown"></div>',
    '        <div class="ce-marquee" v-if="marquee && marquee.moved" :style="marqueeStyle()"></div>',
    '      </div>',
    '      <div class="ce-meters">',
    '        <div class="ce-meter-scale"><span>0</span><span>-6</span><span>-12</span><span>-24</span><span>-36</span><span>-48</span><span>-60</span></div>',
    '        <div class="ce-meter-pair"><i :style="meterStyle(\'l\')"></i><i :style="meterStyle(\'r\')"></i><em>L R</em></div>',
    '      </div>',
    '    </div>',
    '  </section>',

    /* ---------------------------------------------------------- 试听 */
    '  <audio ref="musicAudio" preload="none" class="ce-audio-sink" @ended="stopPreview" @error="previewFailed"></audio>',

    /* ---------------------------------------------------------- 状态栏 */
    '  <footer class="ce-status">',
    '    <span v-if="exportJob" class="ce-export-bar">',
    '      <b>{{ exportPercent }}%</b><span>{{ exportStageLabel }}</span>',
    '      <button @click="cancelExport">取消</button>',
    '    </span>',
    '    <span v-else-if="notice">{{ notice }}</span>',
    '    <span v-else-if="error" class="ce-err">{{ error }}</span>',
    '    <span v-else-if="healthWarnings.length" class="ce-err" :title="healthTitle">{{ healthWarnings[0] }}</span>',
    '    <span v-else class="ce-dim">拖片段移动 · 拖两端裁剪 · S 切开 · Del 删除 · ←/→ 逐帧 · 空格播放 · 中键拖动平移 · Ctrl+滚轮缩放</span>',
    '    <span class="ce-status-right">{{ engineOn ? "引擎 " + apiVersion : "引擎未启动" }}</span>',
    '  </footer>',
    '</div>',
  ].join('\n');

  function createApp() {
    return Vue.createApp({
      template: TEMPLATE,
      data: function () {
        return {
          client: null,
          engineOn: false,
          apiVersion: '',
          engineError: '',
          projects: [],
          pathInput: '',
          projectPath: '',
          projectName: '',
          doc: null,
          view: null,
          selection: [],
          dragGhost: {},
          playhead: 0,
          playCursor: 0,
          zoom: 60,
          playing: false,
          playRate: 1,
          previewQuality: '半清',
          /* 播放时读素材的代理档（引擎的 proxy 开关）；预热邻帧（同 nearest/rev 一起用） */
          previewProxy: true,
          proxyPrefetch: true,
          snap: true,
          frameSrc: '',
          revision: 0,
          busy: false,
          error: '',
          notice: '',
          saved: true,
          showPicker: false,
          bootError: '',
          sections: { media: true, generated: true },
          mediaFilter: 'all',
          audioSource: 'bin',
          musicQuery: '',
          musicKind: 'local',
          musicItems: [],
          musicNote: '',
          musicError: '',
          musicSearching: false,
          musicBusy: '',
          musicIndexCount: 0,
          musicStatus: null,
          /* 曲库二期：收藏 / 最近（本机记，键是 resource_id / path） */
          musicFav: [],
          musicRecent: [],
          /* 框选：时间线空白处拖出来的矩形 */
          marquee: null,
          /* 环境自检（引擎写不了 titles/ 时预览里会没有字，别让人以为是 bug） */
          healthWarnings: [],
          previewing: '',
          activeTab: 'media',
          subKey: 'all',
          leftWide: false,
          openMenu: '',
          tabs: TABS,
          shapePresets: SHAPES,
          catalog: { effect: [], transition: [], filter: [] },
          catalogError: '',
          templates: [],
          templateError: '',
          adjustBusy: false,
          adjustValues: {},
          /* 调节面板：拖动时先记在这，松手才写一次引擎（点号键，色轮/曲线都是它） */
          adjustDraft: {},
          adjustTimer: 0,
          wheelDrag: null,
          curveDrag: null,
          panelQuery: '',
          panelSort: 'default',
          panelView: 'grid',
          /* 导入 / 导出 / 新建：都是真调引擎，不是占位 */
          importBusy: false,
          exportJob: '',
          exportPercent: 0,
          exportStage: '',
          exportOutput: '',
          exportTimer: 0,
          newProjectName: '',
          newProjectBusy: false,
          /* 文本页签：打字即落一条 addTextClip */
          textDraft: '',
          textBusy: false,
          /* 模板页签：把当前工程存成模板 */
          templateName: '',
          templateBusy: false,
          templateNote: '',
          /* 模板填槽：选出来的模板 + 每个占位给的文件 */
          slotPick: null,
          /* 字幕导入 / 按标点拆行 */
          subBusy: false,
          subNote: '',
          subMaxChars: 16,
          /* 引擎的写入根目录（template.instantiate 要一个落在它下面的 location） */
          engineRoot: '',
          /* 预览声音：按片段同步 <audio>，电平表吃 AnalyserNode */
          soundOn: true,
          audioCtx: null,
          analyser: null,
          meterL: 12,
          meterR: 12,
          audioEls: {},
          peaks: {},
          drag: null,
          rulerDrag: false,
          panning: false,
          playTimer: 0,
          lastFrameAt: 0,
          frameTimer: 0,
          settleTimer: 0,
          /* 基础：位置 / 缩放 / 旋转 / 分轴缩放 —— 全部走 setClipTransform，
             不能塞进 updateClip 的 patch（那里没有这几项，塞了会被静默丢掉） */
          transformFields: [
            { key: 'scale', label: '缩放', step: 0.05, min: 0.05, max: 8, fallback: 1, kf: true },
            { key: 'offsetX', label: '位置 X', step: 0.01, min: -3, max: 3, fallback: 0, kf: true },
            { key: 'offsetY', label: '位置 Y', step: 0.01, min: -3, max: 3, fallback: 0, kf: true },
            { key: 'rotation', label: '旋转', step: 1, min: -180, max: 180, fallback: 0, kf: true },
            { key: 'stretchX', label: '横向拉伸', step: 0.02, min: 0.05, max: 8, fallback: 1, kf: false },
            { key: 'stretchY', label: '纵向拉伸', step: 0.02, min: 0.05, max: 8, fallback: 1, kf: false },
          ],
          /* 画面：不透明度 + 混合模式（引擎的 Blend 六个） */
          pictureFields: [
            { key: 'opacity', label: '不透明度', step: 0.05, min: 0, max: 1, fallback: 1, kf: true },
          ],
          blendModes: [
            { key: 'normal', label: '正常' },
            { key: 'multiply', label: '正片叠底' },
            { key: 'screen', label: '滤色' },
            { key: 'add', label: '相加' },
            { key: 'lighten', label: '变亮' },
            { key: 'darken', label: '变暗' },
          ],
          /* 音频 */
          audioFields: [
            { key: 'volume', label: '音量', step: 0.05, min: 0, max: 4, fallback: 1, kf: true },
            { key: 'fadeIn', label: '淡入(秒)', step: 0.1, min: 0, max: 60, fallback: 0, kf: false },
            { key: 'fadeOut', label: '淡出(秒)', step: 0.1, min: 0, max: 60, fallback: 0, kf: false },
          ],
          /* 变速 */
          speedFields: [
            { key: 'speed', label: '速度', step: 0.05, min: 0.0625, max: 16, fallback: 1, kf: false },
          ],
          /* 画面链里展开的是哪一条（按包 id） */
          chainOpen: '',
          effectDraft: {},
          effectTimer: 0,
          /* 蒙版：引擎的 ClipMask，形状 6 种（剪映的「蒙版」），数字都是画面比例 */
          maskShapes: [
            { key: 'linear', label: '线性' },
            { key: 'mirror', label: '镜面' },
            { key: 'circle', label: '圆形' },
            { key: 'rectangle', label: '矩形' },
            { key: 'heart', label: '爱心' },
            { key: 'star', label: '星形' },
            { key: 'triangle', label: '三角形' },
          ],
          /* 蒙版七项，每项都能打关键帧 —— 引擎把蒙版的每个数都做成了 KeyProperty：
             maskX / maskY / maskWidth / maskHeight / maskRotation / maskRoundness / maskFeather */
          maskFields: [
            { key: 'x', keyProp: 'maskX', label: '横向', min: -2, max: 2, step: 0.01 },
            { key: 'y', keyProp: 'maskY', label: '纵向', min: -2, max: 2, step: 0.01 },
            { key: 'width', keyProp: 'maskWidth', label: '宽', min: 0.01, max: 4, step: 0.01 },
            { key: 'height', keyProp: 'maskHeight', label: '高', min: 0.01, max: 4, step: 0.01 },
            { key: 'rotation', keyProp: 'maskRotation', label: '旋转', min: -180, max: 180, step: 1 },
            { key: 'roundness', keyProp: 'maskRoundness', label: '圆角', min: 0, max: 1, step: 0.02 },
            { key: 'feather', keyProp: 'maskFeather', label: '羽化', min: 0, max: 1, step: 0.02 },
          ],
          maskDraft: {},
          maskTimer: 0,
          /* 抠像（Cutout）：模式 / 主体 / 羽化 + 四支笔的笔画 */
          cutoutDraft: {},
          cutoutTimer: 0,
          /* 笔画：smartBrush | brush | smartEraser | eraser（引擎的 BrushTool） */
          brushTools: [
            { key: 'smartBrush', label: '智能画笔' },
            { key: 'brush', label: '画笔' },
            { key: 'smartEraser', label: '智能橡皮' },
            { key: 'eraser', label: '橡皮' },
          ],
          brushTool: 'smartBrush',
          brushSize: 0.06,
          brushOn: false,
          stroke: null,
          /* 时间线高度：默认占整页 40%，拖中间那条分割条改 */
          timelineHeight: 0,
        };
      },
      computed: {
        timeline: function () {
          if (!this.doc) return null;
          var list = this.doc.timelines || [];
          for (var i = 0; i < list.length; i++) if (list[i].id === this.doc.activeTimelineId) return list[i];
          return list[0] || null;
        },
        timelineName: function () {
          var name = (this.timeline && this.timeline.name) || 'Timeline';
          // 引擎默认建的时间线叫 "Timeline 1"，界面上按中文显示
          var hit = /^Timeline\s+(\d+)$/i.exec(name);
          return hit ? '时间线 ' + hit[1] : name;
        },
        /* 时间线页签：引擎里有几条就画几个，点一下就切过去 */
        timelineTabs: function () {
          var active = this.doc ? this.doc.activeTimelineId : '';
          var list = (this.doc && this.doc.timelines) || [];
          return list.map(function (row) {
            var hit = /^Timeline\s+(\d+)$/i.exec(row.name || '');
            return {
              id: row.id,
              label: hit ? '时间线 ' + hit[1] : (row.name || row.id),
              active: row.id === active,
            };
          });
        },
        clips: function () {
          var tl = this.timeline;
          var list = (tl && tl.clips) || (this.doc && this.doc.clips) || [];
          return list.slice().sort(function (a, b) { return (a.start || 0) - (b.start || 0); });
        },
        media: function () { return (this.doc && this.doc.media) || []; },
        fps: function () {
          var video = (this.timeline && this.timeline.video) || (this.doc && this.doc.video) || {};
          var num = Number(video.rateNum) || 24;
          var den = Number(video.rateDen) || 1;
          return den ? num / den : 24;
        },
        fpsLabel: function () {
          return (Math.round(this.fps * 100) / 100).toFixed(2) + ' fps';
        },
        frame: function () { return PL.frameSec(this.fps); },
        canvas: function () {
          var video = (this.timeline && this.timeline.video) || (this.doc && this.doc.video) || {};
          return { width: Number(video.width) || 1920, height: Number(video.height) || 1080 };
        },
        duration: function () {
          var end = 0;
          this.clips.forEach(function (clip) { end = Math.max(end, (clip.start || 0) + (clip.duration || 0)); });
          return end;
        },
        contentWidth: function () { return Math.max(600, (this.duration + 8) * this.zoom); },
        tracks: function () {
          var list = ((this.timeline && this.timeline.tracks) || (this.doc && this.doc.tracks) || []);
          var self = this;
          return list.map(function (track, index) {
            var kind = 'video';
            for (var i = 0; i < self.clips.length; i++) {
              var clip = self.clips[i];
              if (clip.trackId !== track.id) continue;
              kind = clip.kind === 'audio' ? 'audio' : (clip.kind === 'text' ? 'text' : (clip.kind === 'image' ? 'image' : 'video'));
              break;
            }
            var prefix = kind === 'audio' ? 'A' : (kind === 'text' ? 'T' : (kind === 'image' ? 'I' : 'V'));
            return {
              id: track.id,
              kind: kind,
              visible: track.visible !== false,
              muted: track.muted === true,
              height: TRACK_HEIGHT[kind] || 56,
              label: prefix + (index + 1),
            };
          });
        },
        // 原生窗口把高轨排在上面：文字 / 音频 / 视频依次往下
        tracksDesc: function () {
          var rows = this.tracks.slice().reverse();
          return rows.map(function (row, index) {
            return Object.assign({}, row, { alt: index % 2 === 1 });
          });
        },
        selectionClips: function () {
          var ids = this.selection;
          return this.clips.filter(function (clip) { return ids.indexOf(clip.id) >= 0; });
        },
        activeClip: function () { return this.selectionClips[0] || {}; },
        canUndo: function () { return Boolean(this.view && this.view.canUndo); },
        canRedo: function () { return Boolean(this.view && this.view.canRedo); },
        filters: function () {
          return [
            { kind: 'all', label: '全部素材', count: this.media.length },
            { kind: 'video', label: '视频', count: this.countOf('video') },
            { kind: 'audio', label: '音频', count: this.countOf('audio') },
            { kind: 'image', label: '图片', count: this.countOf('image') },
          ];
        },
        mediaTotal: function () {
          var kind = this.activeTab === 'audio' ? 'audio' : this.subKey;
          return kind === 'all' || kind === 'speech' || kind === 'processed' ? this.media.length : this.countOf(kind);
        },
        /* 二级竖菜单：每个页签自己那一列，照剪映的「导入 / 素材 / 我的 / AI 生成…」 */
        subRows: function () {
          var rows = [];
          if (this.activeTab === 'media') {
            rows = [
              { key: 'all', label: '全部素材', count: this.media.length },
              { key: 'video', label: '视频', count: this.countOf('video') },
              { key: 'audio', label: '音频', count: this.countOf('audio') },
              { key: 'image', label: '图片', count: this.countOf('image') },
              { key: 'speech', label: '语音', count: 0 },
              { key: 'processed', label: '已处理', count: 0 },
            ];
          } else if (this.activeTab === 'audio') {
            rows = [
              { key: 'bin', label: '工程音频', count: this.countOf('audio') },
              { key: 'library', label: '剪映曲库', count: this.musicIndexCount || null },
            ];
          } else if (this.activeTab === 'text') {
            rows = [{ key: 'list', label: '文字片段', count: this.textClips.length }];
          } else if (this.activeTab === 'subtitle') {
            rows = [
              { key: 'list', label: '文字片段', count: this.textClips.length },
              { key: 'auto', label: '自动字幕', count: null, hint: '引擎没有转写方法（docs 缺口 4）' },
            ];
          } else if (this.activeTab === 'sticker') {
            rows = [{ key: 'shape', label: '基础图形', count: this.shapePresets.length }];
          } else if (this.activeTab === 'template') {
            rows = [{ key: 'all', label: '模板', count: this.templates.length }];
          } else {
            var shelf = this.catalog[this.activeTab] || [];
            rows = [{ key: 'all', label: '全部', count: shelf.length }];
            var seen = {};
            for (var i = 0; i < shelf.length; i++) {
              var cat = shelf[i].category || '其他';
              if (seen[cat]) { seen[cat].count++; continue; }
              seen[cat] = { key: 'cat:' + cat, label: cat, count: 1 };
              rows.push(seen[cat]);
            }
          }
          return rows;
        },
        /* 当前货架上要显示的包（按二级菜单的分类筛） */
        shelfList: function () {
          var shelf = this.catalog[this.activeTab] || [];
          if (this.subKey.indexOf('cat:') !== 0) return shelf;
          var cat = this.subKey.slice(4);
          return shelf.filter(function (pkg) { return (pkg.category || '其他') === cat; });
        },
        /* concat.adjust 这个包就是剪映的「调节」面板，参数逐个来自引擎目录 */
        adjustPkg: function () {
          var list = this.catalog.filter || [];
          for (var i = 0; i < list.length; i++) if (list[i].id === 'concat.adjust') return list[i];
          return null;
        },
        /* concat.adjust 的 20 个参数一个不落：13 根滑杆 + 3 个色轮 + 4 条曲线 */
        adjustAll: function () { return (this.adjustPkg && this.adjustPkg.params) || []; },
        adjustParams: function () {
          var query = String(this.panelQuery || '').trim().toLowerCase();
          return this.adjustAll.filter(function (p) {
            if (!query) return true;
            var label = ADJUST_LABELS[p.key] || p.label;
            return (label + ' ' + p.key).toLowerCase().indexOf(query) >= 0;
          });
        },
        adjustSliders: function () {
          return this.adjustParams.filter(function (p) { return p.type === 'float' || p.type === 'int'; });
        },
        adjustWheels: function () {
          return this.adjustParams.filter(function (p) { return p.type === 'wheel'; });
        },
        adjustCurves: function () {
          return this.adjustParams.filter(function (p) { return p.type === 'curve'; });
        },
        adjustEntry: function () {
          var chain = (this.activeClip && this.activeClip.videoEffects) || [];
          for (var i = 0; i < chain.length; i++) if (chain[i].id === 'concat.adjust') return chain[i];
          return null;
        },
        /* 详情栏的「画面链」：把 videoEffects 翻成中文名，并带上这一条自己的参数 */
        chainRows: function () {
          var self = this;
          var chain = (this.activeClip && this.activeClip.videoEffects) || [];
          return chain.map(function (entry, index) {
            var pkg = self.packageOf(entry.id) || { name: self.packageLabel(entry.id), params: [] };
            var bag = entry.params || {};
            var keys = entry.keys || {};
            var params = (pkg.params || []).map(function (p) {
              var held = bag[p.key];
              var value = typeof held === 'number' ? held : Number(p.default) || 0;
              return {
                key: p.key,
                type: p.type || 'float',
                label: ADJUST_LABELS[p.key] || p.label,
                min: p.min,
                max: p.max,
                step: p.step || 0.01,
                unit: p.unit || '',
                default: Number(p.default) || 0,
                animate: Boolean(p.animate),
                value: Math.round(value * 100) / 100,
                keyed: Array.isArray(keys[p.key]) ? keys[p.key].length : 0,
              };
            });
            return {
              id: entry.id,
              index: index,
              label: pkg.name || self.packageLabel(entry.id),
              params: params,
              open: self.chainOpen === entry.id,
              enabled: entry.enabled !== false,
            };
          });
        },
        /* 片段属性上已经打了几个关键帧 */
        clipKeyRows: function () {
          var clip = this.activeClip || {};
          var keys = clip.keys || [];
          var seen = {};
          var out = [];
          var labels = {};
          this.transformFields.forEach(function (f) { labels[f.key] = f.label; });
          this.pictureFields.forEach(function (f) { labels[f.key] = f.label; });
          this.audioFields.forEach(function (f) { labels[f.key] = f.label; });
          // 蒙版的七项在引擎里叫 maskX / maskY ……
          this.maskFields.forEach(function (f) { labels[f.keyProp] = '蒙版 ' + f.label; });
          keys.forEach(function (key) {
            var name = key.property;
            if (!seen[name]) {
              seen[name] = { key: name, label: labels[name] || name, count: 0 };
              out.push(seen[name]);
            }
            seen[name].count++;
          });
          return out;
        },
        /* 时间线高度：默认占整页 40%，拖分割条改，双击复原 */
        timelineStyle: function () {
          return this.timelineHeight > 0 ? { height: this.timelineHeight + 'px' } : {};
        },
        /* 抠像已有的笔画（引擎的 Cutout.strokes） */
        cutoutStrokes: function () {
          var cutout = (this.activeClip && this.activeClip.cutout) || null;
          return (cutout && Array.isArray(cutout.strokes)) ? cutout.strokes : [];
        },
        /* 转场落在哪个片段上：选中的视频/图片，否则播放头之后最近的视频片段 */
        transitionTarget: function () {
          var clip = this.activeClip;
          if (clip && clip.id && (clip.kind === 'video' || clip.kind === 'image')) return clip;
          var at = this.playhead;
          var rows = this.clips.filter(function (row) {
            return (row.kind === 'video' || row.kind === 'image') && Number(row.start) >= at - 1e-6;
          }).sort(function (a, b) { return a.start - b.start; });
          if (rows.length) return rows[0];
          var visual = this.clips.filter(function (row) { return row.kind === 'video' || row.kind === 'image'; });
          return visual.length ? visual[visual.length - 1] : null;
        },
        /* 曲库分类：音乐 / 音效 各有自己的一组题材词（收藏、最近、本机不显示） */
        musicTopics: function () {
          return MUSIC_TOPICS[this.musicKind] || [];
        },
        /* 曲库列表：收藏 / 最近 是本机记的，其余是搜出来的 */
        musicView: function () {
          if (this.musicKind === 'fav') return this.musicFav;
          if (this.musicKind === 'recent') return this.musicRecent;
          return this.musicItems;
        },
        /* 模板填槽：每个占位都给到文件才算齐 */
        slotReady: function () {
          var pick = this.slotPick;
          if (!pick || !pick.template || !Array.isArray(pick.template.slots)) return false;
          if (!pick.template.slots.length) return false;
          var fills = pick.fills || {};
          return pick.template.slots.every(function (slot) { return Boolean(fills[slot.mediaId]); });
        },
        exportStageLabel: function () {          var stage = this.exportStage || '';
          var map = {
            'cutout': '抠像分析', 'stabilize': '防抖测量', 'rendering': '渲染画面',
            'rendering in software': '软件渲染', 'mixing audio': '混音', 'muxing': '封装',
          };
          if (map[stage]) return map[stage];
          if (stage) return stage;
          return this.exportPercent >= 99 ? '收尾' : '准备';
        },
        /* 预览质量：草稿 / 半清 / 全清 真的换帧宽 */
        qualityWidth: function () {
          if (this.previewQuality === '草稿') return 420;
          if (this.previewQuality === '半清') return Math.min(760, Math.max(480, Math.round(this.canvas.width * 0.5)));
          return Math.min(1280, this.canvas.width);
        },

        /* ---------------------------------------------- 内容区：卡片列表 */
        searchHint: function () { return SEARCH_HINT[this.activeTab] || '搜一下'; },
        isCardTab: function () { return Boolean(CARD_TABS[this.activeTab]); },
        /* 每个页签把手上的数据摆成同一种 {key,title,meta,kind,payload}，检索/排序/布局共用 */
        panelSource: function () {
          var rows = [];
          var i;
          if (this.activeTab === 'text' || this.activeTab === 'subtitle') {
            rows = this.textClips.map(function (clip) {
              return { key: clip.id, title: clip.name || clip.id, meta: this.timecodeShort(clip.start), kind: 'clip', payload: clip };
            }, this);
          } else if (this.activeTab === 'sticker') {
            rows = this.shapePresets.map(function (shape) {
              return { key: shape.kind, title: shape.label, meta: '图形', kind: 'shape', payload: shape };
            });
          } else if (this.activeTab === 'template') {
            rows = this.templates.map(function (tpl) {
              return { key: tpl.path, title: tpl.name, meta: tpl.width + '×' + tpl.height, kind: 'template', payload: tpl };
            });
          } else if (this.activeTab === 'effect' || this.activeTab === 'transition' || this.activeTab === 'filter') {
            var self = this;
            rows = this.shelfList.map(function (pkg) {
              return { key: pkg.id, title: pkg.name, meta: pkg.category, hint: pkg.description, kind: 'package', payload: pkg, applied: self.isApplied(pkg.id) };
            });
          }
          return rows;
        },
        panelItems: function () {
          var query = String(this.panelQuery || '').trim().toLowerCase();
          var rows = this.panelSource.filter(function (row) {
            if (!query) return true;
            return (row.title + ' ' + row.meta).toLowerCase().indexOf(query) >= 0;
          });
          var sort = this.panelSort;
          if (sort === 'name') rows = rows.slice().sort(function (a, b) { return String(a.title).localeCompare(String(b.title), 'zh'); });
          else if (sort === 'name-desc') rows = rows.slice().sort(function (a, b) { return String(b.title).localeCompare(String(a.title), 'zh'); });
          else if (sort === 'meta') rows = rows.slice().sort(function (a, b) { return String(a.meta).localeCompare(String(b.meta), 'zh'); });
          return rows;
        },
        panelNote: function () {
          if (this.activeTab === 'subtitle') return '打字回车就落一条文字片段（addTextClip）；自动识别字幕还没接：引擎没有转写方法（docs 缺口 4）。';
          if (this.activeTab === 'text') return '打字回车就落一条文字片段（addTextClip，播放头处 3 秒）；点卡片可跳到它，右边改字。';
          if (this.activeTab === 'sticker') return '基础图形直接落到播放头（3 秒，新轨道），颜色跟主题走。';
          if (this.activeTab === 'effect') return '点条目 = 挂到选中片段的画面链（updateClip → videoEffects）。';
          if (this.activeTab === 'filter') return '点条目 = 挂到选中片段的画面链（updateClip → videoEffects）。';
          if (this.activeTab === 'transition') return '点条目 = 写到目标片段的切入处（updateClip → transitionIn），引擎默认时长 1 秒。';
          if (this.activeTab === 'template') return '模板库读的是本机 template.list（引擎配置目录下的 templates/）。';
          return '';
        },
        panelEmpty: function () {
          if (this.activeTab === 'template') return '本机没有模板包：右边填个名字可以把这个工程存成模板。';
          if (this.activeTab === 'text' || this.activeTab === 'subtitle') return '时间线上还没有文字片段';
          return '这一架是空的';
        },
        filteredMedia: function () {
          var kind = this.activeTab === 'audio' ? 'audio' : this.subKey;
          var query = String(this.panelQuery || '').trim().toLowerCase();
          var list = this.media.filter(function (item) {
            // 「语音」「已处理」是剪映的分组，引擎的素材箱里没有对应的 kind
            if (kind === 'speech' || kind === 'processed') return false;
            if (kind !== 'all' && item.kind !== kind) return false;
            if (!query) return true;
            return String(item.name || '').toLowerCase().indexOf(query) >= 0;
          });
          if (this.panelSort === 'name') list = list.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });
          else if (this.panelSort === 'name-desc') list = list.slice().sort(function (a, b) { return String(b.name).localeCompare(String(a.name), 'zh'); });
          else if (this.panelSort === 'meta') list = list.slice().sort(function (a, b) { return String(a.kind).localeCompare(String(b.kind)); });
          return list;
        },
        textClips: function () {
          return this.clips.filter(function (clip) { return clip.kind === 'text'; });
        },
        stageMessage: function () {
          if (!this.projectPath) return '还没有工程';
          var at = this.playhead;
          var covering = this.clips.filter(function (clip) {
            return at >= (clip.start || 0) - 1e-6 && at < (clip.start || 0) + (clip.duration || 0) - 1e-6;
          });
          if (!covering.length) return '播放头下面没有画面';
          return '正在取帧…';
        },
        ticks: function () {
          var steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
          var step = steps[steps.length - 1];
          for (var i = 0; i < steps.length; i++) {
            if (steps[i] * this.zoom >= 112) { step = steps[i]; break; }
          }
          var out = [];
          var span = this.contentWidth / this.zoom;
          for (var at = 0; at <= span; at += step) out.push({ at: at, label: this.timecodeLong(at), major: true });
          return out;
        },
      },
      watch: {
        /* 页面里那一行提示照旧；外面要 toast 就同时给它一份 */
        notice: function (value) { toast(value); },
        playhead: function () {
          var self = this;
          this.queueFrame(1);
          clearTimeout(this.settleTimer);
          this.settleTimer = setTimeout(function () { self.queueFrame(0, true); }, 420);
        },
      },
      mounted: function () {
        var self = this;
        this.client = RPC.create();
        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        document.addEventListener('pointerdown', this.closeMenu);
        var last = '';
        try { last = localStorage.getItem(storeKey()) || localStorage.getItem(STORE) || ''; } catch (error) { /* ignore */ }
        this.pathInput = last;
        this.client.engine().then(function (status) {
          self.engineOn = Boolean(status && status.running);
          self.apiVersion = (status && status.apiVersion) || '';
          // 引擎允许写盘的根目录：模板建工程要一个落在它下面的 location
          self.engineRoot = (status && status.root) || '';
        }).catch(function (error) {
          self.engineOn = false;
          self.engineError = error.message;
        });
        this.loadProjects();
        // 产品路由点名要开的工程：先看本工程记过的目录，再退回全局上次的目录
        this.projectName = DEPS.projectName || '';
        this.newProjectName = DEPS.projectName || '';
        if (DEPS.projectPath) this.openProject(DEPS.projectPath);
        else if (last) this.openProject(last);
        else this.showPicker = true;
        // 曲库状态先探一次：进音频页签之前就知道索引条数 / 下家起没起
        this.loadMusicStatus();
        this.loadMusicShelf();
        // 环境自检：引擎的写盘目录、titles 能不能写（写不了预览里就没字）
        this.checkHealth();
        // 目录三架先取好：特效 / 滤镜（含调节的 20 个参数）/ 转场，进页签即用
        this.loadCatalogue('effect');
        this.loadCatalogue('filter');
        this.loadCatalogue('transition');
        // 时间线默认占整页 40%，窗口变了跟着重算（拖过分割条就按拖的来）
        this.$nextTick(function () { self.resetTimelineHeight(); });
        window.addEventListener('resize', this.onResize);
      },
      beforeUnmount: function () {
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('resize', this.onResize);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        document.removeEventListener('pointerdown', this.closeMenu);
        clearTimeout(this.exportTimer);
        this.stopPlay();
        this.soundStop();
        if (this.audioCtx) { try { this.audioCtx.close(); } catch (error) { /* ignore */ } }
      },
      methods: {
        /* --------------------------------------------------- 显示 */
        fmt: function (value) { return PL.shortDuration(value, this.fps); },
        timecodeLong: function (seconds) {
          var rate = Math.max(1, Math.round(this.fps));
          var total = Math.max(0, Number(seconds) || 0);
          var frames = Math.round(total * rate);
          var f = frames % rate;
          var rest = Math.floor(frames / rate);
          var s = rest % 60;
          var m = Math.floor(rest / 60) % 60;
          var h = Math.floor(rest / 3600);
          var pad = function (n) { return String(n).padStart(2, '0'); };
          return pad(h) + ':' + pad(m) + ':' + pad(s) + '.' + pad(f);
        },
        timecodeShort: function (seconds) { return this.timecodeLong(seconds); },
        num: function (value, fallback) {
          var n = Number(value);
          return Number.isFinite(n) ? n : (fallback || 0);
        },
        countOf: function (kind) {
          if (kind === 'speech' || kind === 'processed') return 0;
          return this.media.filter(function (item) { return item.kind === kind; }).length;
        },
        clipLabel: function (clip) {
          var prefix = clip.kind === 'text' ? 'T' : (clip.kind === 'audio' ? 'A' : (clip.kind === 'image' ? 'I' : ''));
          return (prefix ? prefix + '  ' : '') + (clip.name || clip.kind);
        },
        thumbUrl: function (file, time, width) {
          return '/api/concat/assets/thumb?path=' + encodeURIComponent(file || '')
            + '&t=' + Number(Math.max(0, Number(time) || 0)).toFixed(3)
            + '&w=' + Math.round(Number(width) || 160);
        },
        waveUrl: function (file, buckets) {
          return '/api/concat/assets/wave?path=' + encodeURIComponent(file || '') + '&b=' + (buckets || 600);
        },
        mediaOf: function (id) {
          var rows = this.media;
          for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
          return null;
        },
        ensurePeaks: function (item) {
          if (!item || !item.path || this.peaks[item.id]) return;
          var self = this;
          this.peaks[item.id] = [];
          fetch(this.waveUrl(item.path, 800), { credentials: 'same-origin' })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (data) {
              if (!data || !Array.isArray(data.peaks)) return;
              var next = Object.assign({}, self.peaks);
              next[item.id] = data.peaks;
              self.peaks = next;
            })
            .catch(function () { /* 波形拿不到就不画 */ });
        },
        /** 波形路径：0..1 的 1000×100 视图，缩放时不用重算 */
        waveArea: function (clipOrItem) {
          var item = (clipOrItem && clipOrItem.path) ? clipOrItem : this.mediaOf(clipOrItem && clipOrItem.mediaId);
          if (!item) return '';
          this.ensurePeaks(item);
          var peaks = this.peaks[item.id];
          if (!peaks || !peaks.length) return '';
          var top = [];
          var bottom = [];
          var n = peaks.length;
          for (var i = 0; i < n; i++) {
            var x = (i / (n - 1)) * 1000;
            var h = Math.max(1, Math.min(50, peaks[i] * 50));
            top.push(x.toFixed(1) + ' ' + (50 - h).toFixed(1));
            bottom.push(x.toFixed(1) + ' ' + (50 + h).toFixed(1));
          }
          return 'M' + top.join(' L') + ' L' + bottom.reverse().join(' L') + ' Z';
        },
        filmstrip: function (clip) {
          var item = this.mediaOf(clip.mediaId);
          if (!item || !item.path) return [];
          var width = Math.max(40, clip.duration * this.zoom);
          var count = Math.max(1, Math.min(24, Math.round(width / 90)));
          var out = [];
          var source = Number(clip.sourceStart) || 0;
          var span = Number(clip.duration) || 0;
          for (var i = 0; i < count; i++) {
            var at = source + span * ((i + 0.5) / count);
            out.push(this.thumbUrl(item.path, at, 160));
          }
          return out;
        },

        /* --------------------------------------------------- 工程 */
        kindLabel: function (kind) {
          var map = { video: '视频', audio: '音频', image: '图片', text: '文字', shape: '形状', layer: '图层', transition: '转场' };
          return map[kind] || kind || '';
        },
        setTab: function (name) {
          this.activeTab = name;
          this.subKey = SUB_DEFAULTS[name] || 'all';
          if (name === 'effect' || name === 'transition' || name === 'filter') this.loadCatalogue(name);
          if (name === 'template') this.loadTemplates();
          if (name === 'audio' && this.subKey === 'library') this.loadMusicStatus();
        },
        setSub: function (key) {
          if (key === 'auto') {
            this.notice = '自动字幕还没接：引擎没有转写方法（见 docs 缺口 4）';
            return;
          }
          this.subKey = key;
          if (this.activeTab === 'audio') this.setAudioSource(key);
        },
        /* 页签条最右那个 » ：素材面板加宽 / 收回（剪映同款） */
        toggleLeftWide: function () {
          this.leftWide = !this.leftWide;
        },
        catalogOf: function (tab) {
          return this.catalog[tab] || [];
        },
        loadCatalogue: function (tab) {
          var self = this;
          if (!this.projectPath) return Promise.resolve();
          if (this.catalog[tab] && this.catalog[tab].length) return Promise.resolve();
          var kind = tab === 'transition' ? 'transition' : (tab === 'filter' ? 'filter' : 'effect');
          return this.client.call('catalogue.list', { kind: kind }).then(function (list) {
            var next = Object.assign({}, self.catalog);
            next[tab] = Array.isArray(list) ? list : [];
            self.catalog = next;
            self.catalogError = '';
          }).catch(function (error) { self.catalogError = error.message; });
        },
        loadTemplates: function () {
          var self = this;
          if (!this.projectPath) return Promise.resolve();
          return this.client.call('template.list', {}).then(function (list) {
            self.templates = Array.isArray(list) ? list : [];
            self.templateError = '';
          }).catch(function (error) { self.templates = []; self.templateError = error.message; });
        },
        /* 点一个特效 / 滤镜：挂到选中片段的视频链末尾（引擎的 videoEffects） */
        isApplied: function (id) {
          if (this.activeTab === 'transition') {
            var target = this.transitionTarget;
            return Boolean(target && target.transitionIn && target.transitionIn.id === id);
          }
          var chain = (this.activeClip && this.activeClip.videoEffects) || [];
          return chain.some(function (entry) { return entry.id === id; });
        },
        /* 引擎包里只有 id，面板要说人话：到目录里翻名字 */
        packageLabel: function (id) {
          var shelves = [this.catalog.effect, this.catalog.filter, this.catalog.transition];
          for (var s = 0; s < shelves.length; s++) {
            var list = shelves[s] || [];
            for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i].name;
          }
          if (id === 'concat.adjust') return '调节';
          return id;
        },
        transitionLabel: function (id) { return this.packageLabel(id || ''); },
        applyChain: function (pkg, params) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) { this.notice = '先在时间线上选一个片段，' + pkg.name + ' 是挂在片段上的'; return; }
          if (clip.kind === 'audio') { this.notice = '音频片段不走画面链：' + pkg.name + ' 只能挂视频/图片/文字'; return; }
          var chain = (clip.videoEffects || []).slice();
          chain.push({ id: pkg.id, params: params || {}, enabled: true });
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { videoEffects: chain } }).then(function () {
            self.notice = '已把「' + pkg.name + '」挂到 ' + (clip.name || clip.id);
          }).catch(function () { /* 已经提示过 */ });
        },
        pickPackage: function (pkg) {
          if (this.activeTab === 'transition') { this.applyTransition(pkg); return; }
          this.applyChain(pkg);
        },
        /* 转场：写到目标片段的切入处（引擎的 clip.transitionIn，不是另开一条片段） */
        applyTransition: function (pkg) {
          var self = this;
          var target = this.transitionTarget;
          if (!target || !target.id) { this.notice = '时间线上还没有视频片段，转场要挂在切入处'; return; }
          return this.applyCommand({
            op: 'updateClip',
            clipId: target.id,
            patch: { transitionIn: { id: pkg.id, duration: 1 } },
          }).then(function () {
            self.notice = '已把「' + pkg.name + '」挂在 ' + (target.name || target.id) + ' 的切入处（1 秒）';
          }).catch(function () { /* 已提示 */ });
        },
        clearTransition: function () {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { transitionIn: null } })
            .then(function () { self.notice = '已去掉转场'; })
            .catch(function () { /* 已提示 */ });
        },
        /* 画面链：把一个包从选中片段上摘下来（按序号摘，同名的第二个不会跟着走） */
        removeEffect: function (id, index) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          var chain = (clip.videoEffects || []).slice();
          var at = typeof index === 'number' ? index : -1;
          if (at >= 0 && chain[at] && chain[at].id === id) chain.splice(at, 1);
          else chain = chain.filter(function (entry) { return entry.id !== id; });
          return this.writeChain(chain)
            .then(function () { self.notice = '已移除「' + self.packageLabel(id) + '」'; })
            .catch(function () { /* 已提示 */ });
        },
        /* 目录里找一条包（特效 / 滤镜 / 转场共用） */
        packageOf: function (id) {
          var shelves = [this.catalog.effect, this.catalog.filter, this.catalog.transition];
          for (var s = 0; s < shelves.length; s++) {
            var list = shelves[s] || [];
            for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
          }
          return null;
        },
        toggleChain: function (id) { this.chainOpen = this.chainOpen === id ? '' : id; },
        writeChain: function (chain) {
          var clip = this.activeClip;
          if (!clip || !clip.id) return Promise.resolve();
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { videoEffects: chain } })
            .catch(function () { /* 已经提示过 */ });
        },
        /* 画面链的参数：拖动时先记草稿，停手才写一次引擎 */
        effectValue: function (index, p) {
          var name = index + ':' + p.key;
          if (Object.prototype.hasOwnProperty.call(this.effectDraft, name)) {
            var held = this.effectDraft[name];
            return held === null ? p.default : held;
          }
          return p.value;
        },
        /* 链上某一条的某个数字参数（点号键也行：lift.x / luma.0.y） */
        entryNum: function (index, key, fallback) {
          var name = index + ':' + key;
          if (Object.prototype.hasOwnProperty.call(this.effectDraft, name)) {
            var held = this.effectDraft[name];
            return held === null ? fallback : held;
          }
          var entry = (this.activeClip && this.activeClip.videoEffects && this.activeClip.videoEffects[index]) || {};
          var bag = entry.params || {};
          var value = bag[key];
          return typeof value === 'number' ? value : fallback;
        },
        setEffectParam: function (index, p, raw) {
          var value = Math.round(Number(raw) * 1000) / 1000;
          if (!Number.isFinite(value)) return;
          var next = Object.assign({}, this.effectDraft);
          next[index + ':' + p.key] = value;
          this.effectDraft = next;
          clearTimeout(this.effectTimer);
          this.effectTimer = setTimeout(this.flushEffectDraft, 220);
        },
        draftChain: function (index, patch) {
          var next = Object.assign({}, this.effectDraft);
          Object.keys(patch).forEach(function (key) { next[index + ':' + key] = patch[key]; });
          this.effectDraft = next;
        },
        flushEffectDraft: function () {
          clearTimeout(this.effectTimer);
          this.effectTimer = 0;
          var draft = this.effectDraft || {};
          var names = Object.keys(draft);
          if (!names.length) return Promise.resolve();
          var clip = this.activeClip;
          if (!clip || !clip.id) { this.effectDraft = {}; return Promise.resolve(); }
          var chain = (clip.videoEffects || []).slice();
          names.forEach(function (name) {
            var split = name.indexOf(':');
            var index = Number(name.slice(0, split));
            var key = name.slice(split + 1);
            var entry = chain[index];
            if (!entry) return;
            var params = Object.assign({}, entry.params || {});
            if (draft[name] === null) delete params[key];
            else params[key] = draft[name];
            chain[index] = Object.assign({}, entry, { params: params });
          });
          this.effectDraft = {};
          return this.writeChain(chain);
        },
        /* 链上的色轮（点号键 <key>.x/.y/.m） */
        chainWheel: function (index, p) {
          var x = this.entryNum(index, p.key + '.x', 0);
          var y = this.entryNum(index, p.key + '.y', 0);
          var len = Math.sqrt(x * x + y * y);
          if (len > 1) { x = x / len; y = y / len; }
          return {
            m: Math.round(this.entryNum(index, p.key + '.m', p.default) * 100) / 100,
            dot: { left: (50 + x * 44) + '%', top: (50 + y * 44) + '%' },
          };
        },
        chainWheelDown: function (event, index, p) {
          event.preventDefault();
          event.stopPropagation();
          var rect = event.currentTarget.getBoundingClientRect();
          this.wheelDrag = { index: index, key: p.key, rect: rect };
          this.wheelTrack(event);
        },
        chainWheelMaster: function (index, p, raw) {
          var value = Math.round(Number(raw) * 1000) / 1000;
          if (!Number.isFinite(value)) return;
          this.draftChain(index, { [p.key + '.m']: value });
          clearTimeout(this.effectTimer);
          this.effectTimer = setTimeout(this.flushEffectDraft, 220);
        },
        chainResetWheel: function (index, p) {
          var patch = {};
          patch[p.key + '.x'] = null;
          patch[p.key + '.y'] = null;
          patch[p.key + '.m'] = null;
          this.draftChain(index, patch);
          return this.flushEffectDraft();
        },
        /* 链上的曲线（最多 8 点，<key>.<n>.x/.y） */
        chainCurvePoints: function (index, p) {
          var rows = [];
          for (var n = 0; n < 8; n++) {
            var x = this.entryNum(index, p.key + '.' + n + '.x', null);
            var y = this.entryNum(index, p.key + '.' + n + '.y', null);
            if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
            rows.push({ x: x, y: y });
          }
          if (rows.length < 2) return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
          rows.sort(function (a, b) { return a.x - b.x; });
          return rows;
        },
        chainCurvePath: function (index, p) { return this.curvePathOf(this.chainCurvePoints(index, p)); },
        chainCurveDraft: function (index, p, points) {
          var patch = {};
          for (var n = 0; n < 8; n++) {
            if (n < points.length) {
              patch[p.key + '.' + n + '.x'] = Math.round(points[n].x * 1000) / 1000;
              patch[p.key + '.' + n + '.y'] = Math.round(points[n].y * 1000) / 1000;
            } else {
              patch[p.key + '.' + n + '.x'] = null;
              patch[p.key + '.' + n + '.y'] = null;
            }
          }
          this.draftChain(index, patch);
        },
        chainCurveDown: function (event, index, p) {
          event.preventDefault();
          var rect = event.currentTarget.getBoundingClientRect();
          var points = this.chainCurvePoints(index, p);
          if (points.length >= 8) { this.notice = '曲线最多 8 个点'; return; }
          points.push({
            x: Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width))),
            y: Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / Math.max(1, rect.height))),
          });
          points.sort(function (a, b) { return a.x - b.x; });
          this.chainCurveDraft(index, p, points);
          return this.flushEffectDraft();
        },
        chainCurveGrab: function (event, index, p, at) {
          event.preventDefault();
          event.stopPropagation();
          var svg = event.currentTarget.closest ? event.currentTarget.closest('svg') : null;
          var rect = (svg || event.currentTarget).getBoundingClientRect();
          this.curveDrag = {
            chain: true, entry: index, key: p.key, point: at, rect: rect,
            points: this.chainCurvePoints(index, p),
          };
        },
        chainCurveDrop: function (event, index, p, at) {
          event.preventDefault();
          event.stopPropagation();
          var points = this.chainCurvePoints(index, p);
          if (points.length <= 2) { this.notice = '直线至少两个点'; return; }
          points.splice(at, 1);
          this.chainCurveDraft(index, p, points);
          return this.flushEffectDraft();
        },
        chainResetCurve: function (index, p) {
          var patch = {};
          for (var n = 0; n < 8; n++) {
            patch[p.key + '.' + n + '.x'] = null;
            patch[p.key + '.' + n + '.y'] = null;
          }
          this.draftChain(index, patch);
          return this.flushEffectDraft();
        },
        /* 效果参数的关键帧：引擎的 setEffectKey / clearEffectKey，at 是片内比例 */
        toggleEffectKey: function (index, p) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          var at = Math.round(this.keyFraction(clip) * 10000) / 10000;
          var entry = (clip.videoEffects || [])[index] || {};
          var list = (entry.keys && Array.isArray(entry.keys[p.key])) ? entry.keys[p.key] : [];
          var hit = list.filter(function (key) { return Math.abs(key.at - at) < 0.002; })[0];
          var command = hit
            ? { op: 'clearEffectKey', clipId: clip.id, entry: index, key: p.key, at: hit.at }
            : { op: 'setEffectKey', clipId: clip.id, entry: index, key: p.key, at: at, value: this.effectValue(index, p) };
          return this.applyCommand(command).then(function () {
            var percent = Math.round(at * 100);
            self.notice = hit
              ? '已去掉「' + p.label + '」在 ' + percent + '% 处的关键帧'
              : '已给「' + p.label + '」打点（' + percent + '%）';
          }).catch(function () { /* 已提示 */ });
        },
        /* 播放头在片段里的位置，0..1（关键帧的 at 就是这个） */
        keyFraction: function (clip) {
          var duration = Number(clip && clip.duration) || 0;
          if (duration <= 0) return 0;
          var at = (this.playhead - (Number(clip && clip.start) || 0)) / duration;
          return Math.min(1, Math.max(0, at));
        },
        propertyLabel: function (property) {
          var all = this.transformFields.concat(this.pictureFields, this.audioFields);
          for (var i = 0; i < all.length; i++) if (all[i].key === property) return all[i].label;
          for (var j = 0; j < this.maskFields.length; j++) {
            if (this.maskFields[j].keyProp === property) return '蒙版 ' + this.maskFields[j].label;
          }
          return property;
        },
        /* 打点时用的「当前值」：蒙版那七项存在 clip.mask 里，不在 clip 顶层 */
        keyValueOf: function (property) {
          var clip = this.activeClip || {};
          for (var i = 0; i < this.maskFields.length; i++) {
            var field = this.maskFields[i];
            if (field.keyProp !== property) continue;
            var mask = clip.mask || {};
            var held = Number(mask[field.key]);
            return Number.isFinite(held) ? held : Number(field.min) || 0;
          }
          var value = Number(clip[property]);
          if (Number.isFinite(value)) return value;
          if (property === 'opacity' || property === 'volume' || property === 'scale') return 1;
          return 0;
        },
        /* 混合模式：引擎的 updateClip.patch.blend 收任意字符串但只认六个名字，
           别的都会在渲染时当 normal —— 所以列表只摆六个 */
        blendValue: function () {
          var clip = this.activeClip || {};
          var held = String(clip.blend || 'normal');
          for (var i = 0; i < this.blendModes.length; i++) if (this.blendModes[i].key === held) return held;
          return 'normal';
        },
        setBlend: function (name) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { blend: String(name) } })
            .then(function () { self.notice = '混合模式：' + self.blendLabel(name); })
            .catch(function () { /* 已提示 */ });
        },
        blendLabel: function (name) {
          for (var i = 0; i < this.blendModes.length; i++) if (this.blendModes[i].key === name) return this.blendModes[i].label;
          return name;
        },
        /* 片段属性的关键帧：引擎的 setClipKey / clearClipKey / clearClipKeys */
        toggleClipKey: function (property) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          var at = Math.round(this.keyFraction(clip) * 10000) / 10000;
          var keys = clip.keys || [];
          var hit = keys.filter(function (key) {
            return key.property === property && Math.abs(key.at - at) < 0.002;
          })[0];
          var value = this.keyValueOf(property);
          var command = hit
            ? { op: 'clearClipKey', clipId: clip.id, property: property, at: hit.at }
            : { op: 'setClipKey', clipId: clip.id, property: property, at: at, value: value };
          return this.applyCommand(command).then(function () {
            var percent = Math.round(at * 100);
            self.notice = hit
              ? '已去掉「' + self.propertyLabel(property) + '」的关键帧'
              : '已给「' + self.propertyLabel(property) + '」打点（' + percent + '% / 值 ' + (Math.round(value * 100) / 100) + '）';
          }).catch(function () { /* 已提示 */ });
        },
        keyCountOf: function (property) {
          var keys = (this.activeClip && this.activeClip.keys) || [];
          var count = 0;
          keys.forEach(function (key) { if (key.property === property) count++; });
          return Boolean(count);
        },
        clearClipKeys: function (property) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          return this.applyCommand({ op: 'clearClipKeys', clipId: clip.id, property: property })
            .then(function () { self.notice = '已清掉「' + self.propertyLabel(property) + '」的全部关键帧'; })
            .catch(function () { /* 已提示 */ });
        },
        /* 蒙版：引擎的 ClipMask（updateClip → patch.mask，整份替换） */
        maskValue: function (key) {
          var draft = this.maskDraft || {};
          if (Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
          var mask = (this.activeClip && this.activeClip.mask) || null;
          if (mask && mask[key] !== undefined && mask[key] !== null) return mask[key];
          var defaults = {
            shape: 'circle', x: 0, y: 0, width: 0.5, height: 0.5,
            rotation: 0, roundness: 0, feather: 0, invert: false,
          };
          return defaults[key];
        },
        setMask: function (patch) {
          var next = Object.assign({}, this.maskDraft);
          Object.keys(patch).forEach(function (key) {
            var raw = patch[key];
            if (key === 'shape') { next[key] = String(raw); return; }
            if (key === 'invert') { next[key] = Boolean(raw); return; }
            var value = Math.round(Number(raw) * 1000) / 1000;
            if (Number.isFinite(value)) next[key] = value;
          });
          this.maskDraft = next;
          clearTimeout(this.maskTimer);
          this.maskTimer = setTimeout(this.commitMask, 200);
        },
        commitMask: function () {
          clearTimeout(this.maskTimer);
          this.maskTimer = 0;
          var self = this;
          var clip = this.activeClip;
          var draft = this.maskDraft || {};
          var keys = Object.keys(draft);
          if (!clip || !clip.id || !keys.length) return Promise.resolve();
          var mask = Object.assign({}, clip.mask || {});
          keys.forEach(function (key) { mask[key] = draft[key]; });
          this.maskDraft = {};
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { mask: mask } })
            .then(function () { self.notice = '蒙版已更新'; })
            .catch(function () { /* 已提示 */ });
        },
        clearMask: function () {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          this.maskDraft = {};
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { mask: null } })
            .then(function () { self.notice = '已去掉蒙版'; })
            .catch(function () { /* 已提示 */ });
        },
        /* 抠像：引擎的 Cutout（setClipCutout），模型出第一帧时跑 */
        cutoutValue: function (key) {
          var draft = this.cutoutDraft || {};
          if (Object.prototype.hasOwnProperty.call(draft, key)) return draft[key];
          var cutout = (this.activeClip && this.activeClip.cutout) || null;
          if (cutout && cutout[key] !== undefined && cutout[key] !== null) return cutout[key];
          var defaults = { mode: 'auto', subject: 'auto', feather: 0.004 };
          return defaults[key];
        },
        setCutout: function (patch) {
          var next = Object.assign({}, this.cutoutDraft);
          Object.keys(patch).forEach(function (key) {
            var raw = patch[key];
            if (key === 'feather') {
              var value = Math.round(Number(raw) * 10000) / 10000;
              if (Number.isFinite(value)) next[key] = value;
              return;
            }
            next[key] = String(raw);
          });
          this.cutoutDraft = next;
          clearTimeout(this.cutoutTimer);
          this.cutoutTimer = setTimeout(this.commitCutout, 220);
        },
        commitCutout: function () {
          clearTimeout(this.cutoutTimer);
          this.cutoutTimer = 0;
          var self = this;
          var clip = this.activeClip;
          var draft = this.cutoutDraft || {};
          var keys = Object.keys(draft);
          if (!clip || !clip.id || !keys.length) return Promise.resolve();
          // 已有抠像的笔画要留着：整份替换，缺了就被清掉
          var cutout = Object.assign({ mode: 'auto', subject: 'auto', feather: 0.004 }, clip.cutout || {});
          keys.forEach(function (key) { cutout[key] = draft[key]; });
          this.cutoutDraft = {};
          return this.applyCommand({ op: 'setClipCutout', clipId: clip.id, cutout: cutout })
            .then(function () { self.notice = '抠像已更新（引擎出帧时跑模型）'; })
            .catch(function () { /* 已提示 */ });
        },
        clearCutout: function () {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          this.cutoutDraft = {};
          return this.applyCommand({ op: 'setClipCutout', clipId: clip.id, cutout: null })
            .then(function () { self.notice = '已去掉抠像'; })
            .catch(function () { /* 已提示 */ });
        },
        brushLabel: function (tool) {
          for (var i = 0; i < this.brushTools.length; i++) if (this.brushTools[i].key === tool) return this.brushTools[i].label;
          return tool || '';
        },
        /* 一笔就是引擎的 Stroke { tool, size, points:[[x,y]…], at }：
           x/y 是「按画面宽/高归一化」的源坐标，size 是画面短边的比例 */
        addStroke: function (points) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return Promise.resolve();
          if (!points || points.length < 2) return Promise.resolve();
          var stroke = {
            tool: this.brushTool,
            size: Math.round(Number(this.brushSize) * 1000) / 1000,
            points: points,
            at: Math.round((Number(clip.sourceStart) || 0) * 1000) / 1000,
          };
          return this.applyCommand({ op: 'addCutoutStroke', clipId: clip.id, stroke: stroke })
            .then(function () { self.notice = '加了一笔' + self.brushLabel(stroke.tool) + '（' + points.length + ' 点）'; })
            .catch(function () { /* 已提示 */ });
        },
        removeStroke: function (index) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return Promise.resolve();
          var list = this.cutoutStrokes.slice();
          list.splice(index, 1);
          var cutout = Object.assign({ mode: 'custom', subject: 'auto', feather: 0.004 }, clip.cutout || {}, { strokes: list });
          return this.applyCommand({ op: 'setClipCutout', clipId: clip.id, cutout: cutout })
            .then(function () { self.notice = '删掉了一笔'; })
            .catch(function () { /* 已提示 */ });
        },
        clearStrokes: function () {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return Promise.resolve();
          var cutout = Object.assign({ mode: 'auto', subject: 'auto', feather: 0.004 }, clip.cutout || {}, { strokes: [] });
          return this.applyCommand({ op: 'setClipCutout', clipId: clip.id, cutout: cutout })
            .then(function () { self.notice = '笔画清空了'; })
            .catch(function () { /* 已提示 */ });
        },
        /* 预览上画一笔：把指针位置换算成归一化的源坐标（0..1） */
        stagePoint: function (event) {
          var stage = this.$refs.stage;
          var img = stage && stage.querySelector ? stage.querySelector('img') : null;
          var box = (img || stage || {}).getBoundingClientRect ? (img || stage).getBoundingClientRect() : null;
          if (!box || !box.width || !box.height) return null;
          var x = (event.clientX - box.left) / box.width;
          var y = (event.clientY - box.top) / box.height;
          return [Math.max(0, Math.min(1, Math.round(x * 1000) / 1000)), Math.max(0, Math.min(1, Math.round(y * 1000) / 1000))];
        },
        onStrokeDown: function (event) {
          if (!this.brushOn) return;
          if (!this.activeClip.id) return;
          var point = this.stagePoint(event);
          if (!point) return;
          event.preventDefault();
          this.stroke = { points: [point], moved: true };
        },
        onStrokeMove: function (event) {
          if (!this.stroke) return;
          var point = this.stagePoint(event);
          if (!point) return;
          var last = this.stroke.points[this.stroke.points.length - 1];
          if (last && Math.abs(last[0] - point[0]) < 0.004 && Math.abs(last[1] - point[1]) < 0.004) return;
          this.stroke.points.push(point);
        },
        onStrokeUp: function () {
          if (!this.stroke) return;
          var points = this.stroke.points;
          this.stroke = null;
          this.addStroke(points);
        },
        /* 卡片列表里点一下：按卡片种类分派 */
        panelPick: function (item) {
          if (!item) return;
          if (item.kind === 'clip') { this.pickClip(item.payload); return; }
          if (item.kind === 'shape') { this.addShape(item.payload); return; }
          if (item.kind === 'package') { this.pickPackage(item.payload); return; }
          if (item.kind === 'template') {
            this.useTemplate(item.payload);
            return;
          }
        },
        /* 模板：实例化要每个占位都填文件（引擎要求 slots 全填），本机没有可填的占位就说明白 */
        /* 模板填槽：逐个占位选文件 → template.instantiate（引擎要求每个槽都有文件） */
        useTemplate: function (tpl) {
          if (!tpl || !tpl.path) return;
          // 引擎的 TemplateInfo.slots 是数组（每个占位一项），不是个数
          var slots = Array.isArray(tpl.slots) ? tpl.slots : [];
          if (!slots.length) {
            this.notice = '「' + tpl.name + '」没有占位，可以直接当工程模板用';
            this.slotPick = null;
            return;
          }
          this.slotPick = {
            template: tpl,
            name: tpl.name,
            outName: tpl.name + ' 副本',
            fills: {},
            busy: false,
            error: '',
          };
          this.notice = '「' + tpl.name + '」有 ' + slots.length + ' 个占位，填好文件就能建工程';
        },
        slotKindLabel: function (slot) {
          var kind = (slot && slot.kind) || '';
          var map = { video: '视频', audio: '音频', image: '图片', text: '文字' };
          var seconds = Number(slot && slot.seconds) || 0;
          return ' · ' + (map[kind] || kind) + ' · ' + (Math.round(seconds * 10) / 10) + 's';
        },
        slotFileLabel: function (mediaId) {
          var path = (this.slotPick && this.slotPick.fills && this.slotPick.fills[mediaId]) || '';
          if (!path) return '';
          var parts = String(path).split('\\');
          return parts[parts.length - 1];
        },
        slotChoose: function (slot) {
          var self = this;
          if (!this.slotPick || this.slotPick.busy) return Promise.resolve();
          return this.apiCall('/api/concat/pick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ single: true, title: '给「' + (slot.name || slot.mediaId) + '」选一个文件' }),
          }).then(function (picked) {
            var file = ((picked && picked.files) || [])[0];
            if (!file) return null;
            var next = Object.assign({}, self.slotPick);
            next.fills = Object.assign({}, next.fills);
            next.fills[slot.mediaId] = file;
            next.error = '';
            self.slotPick = next;
            return file;
          }).catch(function (error) {
            if (self.slotPick) self.slotPick.error = error.message;
          });
        },
        slotGo: function () {
          var self = this;
          var pick = this.slotPick;
          if (!pick || pick.busy) return Promise.resolve();
          if (!this.slotReady) { pick.error = '还有占位没填文件'; return Promise.resolve(); }
          var location = this.engineRoot || '';
          if (!location) { pick.error = '不知道引擎的写入目录（root），先刷新一下页面'; return Promise.resolve(); }
          var fills = pick.template.slots.map(function (slot) {
            return { mediaId: slot.mediaId, file: pick.fills[slot.mediaId] };
          });
          pick.busy = true;
          pick.error = '';
          return this.client.call('template.instantiate', {
            template: pick.template.path,
            location: location,
            name: pick.outName || pick.template.name,
            fills: fills,
          }).then(function () {
            // 引擎建好就打开了：按 folder_name 的规则认目录，再走页面自己的打开那条路
            var folder = location + '\\' + self.folderName(pick.outName || pick.template.name);
            self.slotPick = null;
            return self.openProject(folder);
          }).then(function () {
            self.notice = '已按模板建好工程';
          }).catch(function (error) {
            if (self.slotPick) {
              self.slotPick.busy = false;
              self.slotPick.error = '建不了：' + error.message;
            }
          });
        },
        /* 字幕：导入 SRT / VTT → 一次 edit.apply 的 batch 落一堆 addTextClip */
        importSubtitle: function () {
          var self = this;
          if (this.subBusy) return Promise.resolve();
          if (!this.projectPath) { this.error = '先打开工程'; return Promise.resolve(); }
          this.subBusy = true;
          this.subNote = '选字幕文件…';
          return this.apiCall('/api/concat/pick', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ single: true, exts: ['.srt', '.vtt'], title: '选 SRT / VTT 字幕' }),
          }).then(function (picked) {
            var file = ((picked && picked.files) || [])[0];
            if (!file) { self.subNote = '没有选字幕文件'; return null; }
            return fetch('/api/concat/assets/doc?path=' + encodeURIComponent(file), { credentials: 'same-origin' })
              .then(function (response) {
                if (!response.ok) throw Error('读不到字幕文件（' + response.status + '）');
                return response.json();
              })
              .then(function (doc) {
                var cues = self.parseSubtitles(doc.text || '');
                if (!cues.length) { self.subNote = '这个文件里没认出时间轴（SRT 要 00:00:01,000 --> 00:00:03,000 这种）'; return null; }
                return self.applyCues(cues).then(function (count) {
                  self.subNote = '已从「' + doc.name + '」落 ' + count + ' 条字幕';
                  self.notice = self.subNote;
                });
              });
          }).catch(function (error) {
            self.subNote = '导入失败：' + error.message;
          }).then(function () { self.subBusy = false; });
        },
        /* SRT / VTT 都认：序号可有可无，时间轴行以 --> 为准，毫秒点号逗号都行 */
        parseSubtitles: function (text) {
          var lines = String(text || '').replace(/\r/g, '').split('\n');
          var cues = [];
          var at = -1;
          var stamp = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/;
          for (var i = 0; i < lines.length; i++) {
            var hit = stamp.exec(lines[i]);
            if (hit) {
              var start = Number(hit[1]) * 3600 + Number(hit[2]) * 60 + Number(hit[3]) + Number(hit[4]) / 1000;
              var end = Number(hit[5]) * 3600 + Number(hit[6]) * 60 + Number(hit[7]) + Number(hit[8]) / 1000;
              cues.push({ start: start, end: end, text: [] });
              at = cues.length - 1;
              continue;
            }
            if (at < 0) continue;
            var line = String(lines[i] || '').trim();
            if (!line) {
              if (cues[at].text.length) at = -1;
              continue;
            }
            if (/^\d+$/.test(line) && !cues[at].text.length) continue;
            if (/^WEBVTT|^NOTE |^STYLE|^REGION/.test(line)) continue;
            cues[at].text.push(line);
          }
          return cues
            .map(function (cue) {
              var words = cue.text.join(' ').replace(/<[^>]+>/g, '').trim();
              var duration = Math.max(0.4, cue.end - cue.start);
              return { start: Math.max(0, cue.start), duration: duration, text: words };
            })
            .filter(function (cue) { return cue.text; });
        },
        /* 一堆字幕 → 一条 batch（一个撤销步），引擎的 addTextClip 支持 duration */
        applyCues: function (cues) {
          var self = this;
          if (!cues.length) return Promise.resolve(0);
          var commands = cues.map(function (cue) {
            return {
              op: 'addTextClip',
              above: true,
              start: Math.round(cue.start * 1000) / 1000,
              duration: Math.round(cue.duration * 1000) / 1000,
              style: { content: cue.text },
            };
          });
          return this.applyCommand({ op: 'batch', commands: commands }).then(function () {
            return commands.length;
          });
        },
        /* 把上面那段文字按标点拆成一条条字幕，从播放头往后排 */
        splitDraft: function () {
          var self = this;
          var raw = String(this.textDraft || '').replace(/\s+/g, ' ').trim();
          if (!raw) { this.subNote = '先在上面那段框里贴上文字'; return Promise.resolve(); }
          var limit = Math.max(6, Math.min(48, Number(this.subMaxChars) || 16));
          var pieces = [];
          var chunks = raw.split(/(?<=[。！？!?；;…])\s*/);
          chunks.forEach(function (chunk) {
            var text = String(chunk || '').trim();
            while (text.length > limit) {
              var cut = text.slice(0, limit);
              var comma = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf(','), cut.lastIndexOf(' '));
              if (comma > limit * 0.4) cut = cut.slice(0, comma + 1);
              pieces.push(cut.trim());
              text = text.slice(cut.length).trim();
            }
            if (text) pieces.push(text);
          });
          pieces = pieces.filter(Boolean);
          if (!pieces.length) { this.subNote = '没拆出东西'; return Promise.resolve(); }
          var at = this.playhead;
          var cues = pieces.map(function (text) {
            var seconds = Math.max(1.2, Math.min(6, text.length / 5));
            var cue = { start: at, duration: Math.round(seconds * 10) / 10, text: text };
            at += cue.duration;
            return cue;
          });
          return this.applyCues(cues).then(function (count) {
            self.subNote = '按标点拆出 ' + count + ' 条，从 ' + self.timecodeShort(self.playhead) + ' 排到 ' + self.timecodeShort(at);
            self.notice = self.subNote;
          });
        },
        /* 模板：把当前工程存成模板（引擎 template.save，写到配置目录的 templates/） */
        saveTemplate: function () {
          var self = this;
          var name = String(this.templateName || '').trim();
          if (!name) { this.notice = '先填一个模板名'; return Promise.resolve(); }
          if (!this.projectPath) { this.error = '先打开工程'; return Promise.resolve(); }
          this.templateBusy = true;
          this.templateNote = '';
          return this.client.call('template.save', { path: this.projectPath, name: name }).then(function () {
            self.templateName = '';
            return self.loadTemplates();
          }).then(function () {
            self.notice = '已存成模板「' + name + '」，模板页签里能看到了';
          }).catch(function (error) {
            self.templateNote = '存不了：' + error.message + '（引擎要能写自己的配置目录 templates/）';
          }).then(function () { self.templateBusy = false; });
        },
        /* 文本 / 字幕：打字 → addTextClip，落到播放头，默认 3 秒 */
        addText: function () {
          var self = this;
          var words = String(this.textDraft || '').replace(/\s+$/, '');
          if (!words) { this.notice = '先打字'; return Promise.resolve(); }
          if (!this.projectPath) { this.error = '先打开工程'; return Promise.resolve(); }
          this.textBusy = true;
          return this.applyCommand({
            op: 'addTextClip',
            above: true,
            start: this.playhead,
            duration: 3,
            style: { content: words },
          }).then(function () {
            self.textDraft = '';
            self.notice = '已放入文字片段（' + self.timecodeShort(self.playhead) + '，3 秒）';
          }).catch(function () { /* 已提示 */ }).then(function () { self.textBusy = false; });
        },
        /* 详情栏改字：保留原来的字体/字号/颜色，只换 content */
        setTextContent: function (value) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id || clip.kind !== 'text') return;
          var words = String(value || '');
          if (!words.trim()) { this.notice = '文字不能空着'; return; }
          var style = Object.assign({}, clip.text || {}, { content: words });
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { text: style } })
            .then(function () { self.notice = '文字已改'; })
            .catch(function () { /* 已提示 */ });
        },
        /* 调节面板：把 concat.adjust 的 params 写回选中片段 */
        adjustLabel: function (p) { return ADJUST_LABELS[p.key] || p.label; },
        /* 一个参数的值：拖动中的草稿优先，其次片段里存的，最后包的默认值 */
        adjustNum: function (key, fallback) {
          var draft = this.adjustDraft || {};
          if (Object.prototype.hasOwnProperty.call(draft, key)) {
            var value = draft[key];
            return value === null ? fallback : value;
          }
          var entry = this.adjustEntry;
          var bag = (entry && entry.params) || {};
          var held = bag[key];
          return typeof held === 'number' ? held : fallback;
        },
        adjustValue: function (p) {
          var value = this.adjustNum(p.key, p.default);
          return Math.round(Number(value) * 100) / 100;
        },
        /* 一次写：整条 videoEffects 换掉（引擎要的是全量，不是 diff） */
        mutateAdjust: function (mutate) {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return Promise.resolve();
          var chain = (clip.videoEffects || []).slice();
          var at = -1;
          for (var i = 0; i < chain.length; i++) if (chain[i].id === 'concat.adjust') at = i;
          var entry = at >= 0 ? Object.assign({}, chain[at]) : { id: 'concat.adjust', params: {}, enabled: true };
          var params = Object.assign({}, entry.params || {});
          mutate(params);
          var tidy = {};
          Object.keys(params).forEach(function (key) {
            var value = Number(params[key]);
            if (Number.isFinite(value)) tidy[key] = value;
          });
          entry.id = 'concat.adjust';
          entry.params = tidy;
          entry.enabled = entry.enabled !== false;
          if (at >= 0) chain[at] = entry; else chain.push(entry);
          this.adjustBusy = true;
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { videoEffects: chain } })
            .then(function () { self.adjustBusy = false; }, function () { self.adjustBusy = false; });
        },
        /* 草稿落盘：null 表示把这个键从包里删掉（曲线点变少就是它） */
        commitAdjust: function () {
          clearTimeout(this.adjustTimer);
          this.adjustTimer = 0;
          var draft = this.adjustDraft || {};
          var keys = Object.keys(draft);
          if (!keys.length) return Promise.resolve();
          var payload = {};
          keys.forEach(function (key) { payload[key] = draft[key]; });
          this.adjustDraft = {};
          return this.mutateAdjust(function (params) {
            keys.forEach(function (key) {
              if (payload[key] === null) delete params[key];
              else params[key] = payload[key];
            });
          });
        },
        setAdjust: function (p, raw) {
          var value = Math.round(Number(raw) * 1000) / 1000;
          if (!Number.isFinite(value)) return;
          var draft = Object.assign({}, this.adjustDraft);
          draft[p.key] = value;
          this.adjustDraft = draft;
          clearTimeout(this.adjustTimer);
          this.adjustTimer = setTimeout(this.commitAdjust, 220);
        },
        /* 色轮：圆盘里那一点是偏色（<key>.x / <key>.y 落在单位圆里），滑杆是 <key>.m */
        wheelState: function (p) {
          var x = this.adjustNum(p.key + '.x', 0);
          var y = this.adjustNum(p.key + '.y', 0);
          var len = Math.sqrt(x * x + y * y);
          if (len > 1) { x = x / len; y = y / len; }
          return {
            x: x,
            y: y,
            m: Math.round(this.adjustNum(p.key + '.m', p.default) * 100) / 100,
            dot: { left: (50 + x * 44) + '%', top: (50 + y * 44) + '%' },
          };
        },
        wheelDown: function (event, p) {
          event.preventDefault();
          event.stopPropagation();
          var rect = event.currentTarget.getBoundingClientRect();
          this.wheelDrag = { key: p.key, rect: rect };
          this.wheelTrack(event);
        },
        wheelTrack: function (event) {
          var drag = this.wheelDrag;
          if (!drag) return;
          var rect = drag.rect;
          var radius = Math.max(8, Math.min(rect.width, rect.height) / 2 - 5);
          var x = (event.clientX - (rect.left + rect.width / 2)) / radius;
          var y = (event.clientY - (rect.top + rect.height / 2)) / radius;
          var len = Math.sqrt(x * x + y * y);
          if (len > 1) { x = x / len; y = y / len; }
          x = Math.round(x * 1000) / 1000;
          y = Math.round(y * 1000) / 1000;
          if (typeof drag.index === 'number') {
            // 链上某一条的色轮
            var patch = {};
            patch[drag.key + '.x'] = x;
            patch[drag.key + '.y'] = y;
            this.draftChain(drag.index, patch);
            return;
          }
          var draft = Object.assign({}, this.adjustDraft);
          draft[drag.key + '.x'] = x;
          draft[drag.key + '.y'] = y;
          this.adjustDraft = draft;
        },
        setWheelMaster: function (p, raw) {
          var value = Math.round(Number(raw) * 1000) / 1000;
          if (!Number.isFinite(value)) return;
          var draft = Object.assign({}, this.adjustDraft);
          draft[p.key + '.m'] = value;
          this.adjustDraft = draft;
          clearTimeout(this.adjustTimer);
          this.adjustTimer = setTimeout(this.commitAdjust, 220);
        },
        resetWheel: function (p) {
          var draft = Object.assign({}, this.adjustDraft);
          draft[p.key + '.x'] = null;
          draft[p.key + '.y'] = null;
          draft[p.key + '.m'] = null;
          this.adjustDraft = draft;
          return this.commitAdjust();
        },
        /* 曲线：最多 8 个点，存成 <key>.<n>.x / <key>.<n>.y；一个都没有就是 0,0 → 1,1 那条直线 */
        curvePoints: function (p) {
          var rows = [];
          for (var n = 0; n < 8; n++) {
            var x = this.adjustNum(p.key + '.' + n + '.x', null);
            var y = this.adjustNum(p.key + '.' + n + '.y', null);
            if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y)) continue;
            rows.push({ x: x, y: y });
          }
          if (rows.length < 2) return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
          rows.sort(function (a, b) { return a.x - b.x; });
          return rows;
        },
        curvePath: function (p) { return this.curvePathOf(this.curvePoints(p)); },
        /* 一条平滑曲线（Catmull-Rom 转贝塞尔）：控制点就是引擎存的那几个 */
        curvePathOf: function (points) {
          var pts = points.map(function (pt) {
            return { x: pt.x * 100, y: (1 - pt.y) * 100 };
          });
          var round = function (value) { return Math.round(value * 10) / 10; };
          var d = 'M' + round(pts[0].x) + ' ' + round(pts[0].y);
          for (var i = 0; i < pts.length - 1; i++) {
            var prev = pts[i - 1] || pts[i];
            var from = pts[i];
            var to = pts[i + 1];
            var next = pts[i + 2] || to;
            var c1 = { x: from.x + (to.x - prev.x) / 6, y: from.y + (to.y - prev.y) / 6 };
            var c2 = { x: to.x - (next.x - from.x) / 6, y: to.y - (next.y - from.y) / 6 };
            d += ' C' + round(c1.x) + ' ' + round(c1.y) + ' ' + round(c2.x) + ' ' + round(c2.y) + ' ' + round(to.x) + ' ' + round(to.y);
          }
          return d;
        },
        curveDraft: function (p, points) {
          var draft = Object.assign({}, this.adjustDraft);
          for (var n = 0; n < 8; n++) {
            var xk = p.key + '.' + n + '.x';
            var yk = p.key + '.' + n + '.y';
            if (n < points.length) {
              draft[xk] = Math.round(points[n].x * 1000) / 1000;
              draft[yk] = Math.round(points[n].y * 1000) / 1000;
            } else {
              draft[xk] = null;
              draft[yk] = null;
            }
          }
          this.adjustDraft = draft;
        },
        curveGrab: function (event, p, at) {
          event.preventDefault();
          event.stopPropagation();
          var svg = event.currentTarget.closest ? event.currentTarget.closest('svg') : null;
          var rect = (svg || event.currentTarget).getBoundingClientRect();
          this.curveDrag = { key: p.key, point: at, rect: rect, points: this.curvePoints(p) };
        },
        curveTrack: function (event) {
          var drag = this.curveDrag;
          if (!drag) return;
          var rect = drag.rect;
          var x = (event.clientX - rect.left) / Math.max(1, rect.width);
          var y = 1 - (event.clientY - rect.top) / Math.max(1, rect.height);
          x = Math.min(1, Math.max(0, x));
          y = Math.min(1, Math.max(0, y));
          var points = drag.points.map(function (pt) { return { x: pt.x, y: pt.y }; });
          points[drag.point] = { x: x, y: y };
          points.sort(function (a, b) { return a.x - b.x; });
          drag.points = points;
          var pkg = { key: drag.key };
          if (drag.chain) this.chainCurveDraft(drag.entry, pkg, points);
          else this.curveDraft(pkg, points);
        },
        curvePkgFor: function (key) {
          var list = this.adjustCurves;
          for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
          return { key: key };
        },
        /* 点空处加一个点 */
        curveDown: function (event, p) {
          event.preventDefault();
          var rect = event.currentTarget.getBoundingClientRect();
          var points = this.curvePoints(p);
          if (points.length >= 8) { this.notice = '曲线最多 8 个点'; return; }
          var x = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
          var y = Math.min(1, Math.max(0, 1 - (event.clientY - rect.top) / Math.max(1, rect.height)));
          points.push({ x: x, y: y });
          points.sort(function (a, b) { return a.x - b.x; });
          this.curveDraft(p, points);
          return this.commitAdjust();
        },
        /* 双击一个点去掉它（两个端点留着） */
        curveDrop: function (event, p, index) {
          event.preventDefault();
          event.stopPropagation();
          var points = this.curvePoints(p);
          if (points.length <= 2) { this.notice = '直线至少两个点'; return; }
          points.splice(index, 1);
          this.curveDraft(p, points);
          return this.commitAdjust();
        },
        resetCurve: function (p) {
          var draft = Object.assign({}, this.adjustDraft);
          for (var n = 0; n < 8; n++) {
            draft[p.key + '.' + n + '.x'] = null;
            draft[p.key + '.' + n + '.y'] = null;
          }
          this.adjustDraft = draft;
          return this.commitAdjust();
        },
        clearAdjust: function () {
          var self = this;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          clearTimeout(this.adjustTimer);
          this.adjustDraft = {};
          var chain = (clip.videoEffects || []).filter(function (entry) { return entry.id !== 'concat.adjust'; });
          return this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: { videoEffects: chain } }).then(function () {
            self.notice = '已清掉调节';
          }).catch(function () { /* 已提示过 */ });
        },
        /* 贴纸：基础图形直接落一条 shape 片段（引擎 addShapeClip） */
        shapeStyle: function (shape) {
          var style = { background: shape.fill };
          if (shape.path && shape.path !== 'none') style.clipPath = shape.path;
          if (shape.kind === 'line') { style.height = '6px'; style.borderRadius = '3px'; }
          if (shape.kind === 'circle') style.borderRadius = '50%';
          return style;
        },
        addShape: function (shape) {
          var self = this;
          var style = { kind: shape.kind, width: 0.3, fill: shape.fill, sides: shape.kind === 'polygon' ? 6 : 5, points: 5, innerRadius: 0.5 };
          return this.applyCommand({
            op: 'addShapeClip',
            above: true,
            start: this.playhead,
            duration: 3,
            name: shape.label,
            style: style,
          }).then(function () {
            self.notice = '已放入「' + shape.label + '」（3 秒，播放头处）';
          }).catch(function () { /* 已提示过 */ });
        },
        pickClip: function (clip) {
          this.selection = [clip.id];
          this.seek(clip.start, true);
        },
        toggleMenu: function (id) { this.openMenu = this.openMenu === id ? '' : id; },
        closeMenu: function () { this.openMenu = ''; },
        menuPick: function (action) {
          this.openMenu = '';
          if (action === 'new') { this.loadProjects(); this.showPicker = true; return; }
          if (action === 'import') { this.importMedia(); return; }
          if (action === 'export') { this.exportTimeline(); return; }
          if (action === 'open') { this.loadProjects(); this.showPicker = true; return; }
          if (action === 'save') { this.save(); return; }
          if (action === 'reload') { this.reload(); return; }
          if (action === 'undo') { this.undo(); return; }
          if (action === 'redo') { this.redo(); return; }
          if (action === 'split') { this.splitAtPlayhead(); return; }
          if (action === 'remove') { this.removeSelected(); return; }
          if (action === 'fit') { this.fitZoom(); return; }
          if (action === 'zoomin') { this.zoomBy(1.25); return; }
          if (action === 'zoomout') { this.zoomBy(0.8); return; }
          if (action === 'play') { this.togglePlay(); return; }
        },
        /* 导入素材：弹本机文件框 → 逐个 media.import → 刷新素材箱 */
        importMedia: function () {
          var self = this;
          if (this.importBusy) return Promise.resolve();
          if (!this.projectPath) { this.error = '先打开工程'; return Promise.resolve(); }
          this.importBusy = true;
          this.notice = '选文件…';
          return this.apiCall('/api/concat/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
            .then(function (picked) {
              var files = (picked && picked.files) || [];
              if (!files.length) { self.notice = '没有选文件'; return null; }
              return self.importBatch(files).then(function (summary) { return summary; });
            })
            .then(function (summary) {
              if (!summary) return null;
              return self.reload().then(function () {
                self.notice = summary.failed
                  ? '导入 ' + summary.done + ' / ' + summary.total + ' 个文件，' + summary.failed + ' 个没进去'
                  : '已导入 ' + summary.done + ' 个文件（左边素材箱里）';
              });
            })
            .catch(function (error) {
              self.notice = '';
              self.error = '导入失败：' + error.message;
            })
            .then(function () { self.importBusy = false; });
        },
        /* 批量导入：一次请求塞 8 条 media.import，省掉几十次往返（引擎仍然按序处理） */
        importBatch: function (files) {
          var self = this;
          var chunk = 8;
          var done = 0;
          var failed = 0;
          var index = 0;
          this.notice = '导入 ' + files.length + ' 个文件…';
          var step = function () {
            if (index >= files.length) return Promise.resolve({ done: done, failed: failed, total: files.length });
            var slice = files.slice(index, index + chunk);
            index += slice.length;
            var rows = slice.map(function (file) {
              return { id: file, method: 'media.import', params: { path: self.projectPath, file: file } };
            });
            return self.client.callMany(rows).then(function (replies) {
              replies.forEach(function (reply) {
                if (reply && reply.ok) done += 1;
                else {
                  failed += 1;
                  var name = String((reply && reply.id) || '').split('\\').pop();
                  self.error = '「' + name + '」导入失败：' + ((reply && reply.error && reply.error.message) || '引擎没给原因');
                }
              });
              self.notice = '导入 ' + (done + failed) + ' / ' + files.length + '…';
              return step();
            });
          };
          return step();
        },
        /* 导出：export.run 起一条渲染，之后轮询 export.status 报进度 */
        exportTimeline: function () {
          var self = this;
          if (!this.projectPath) { this.error = '先打开工程'; return Promise.resolve(); }
          if (this.exportJob) { this.notice = '已经在导出：' + this.exportPercent + '%'; return Promise.resolve(); }
          if (!this.duration) { this.notice = '时间线是空的，没得导出'; return Promise.resolve(); }
          var stamp = this.stampNow();
          var output = this.projectPath.replace(/[\\/]+$/, '') + '\\导出-' + stamp + '.mp4';
          this.exportPercent = 0;
          this.exportStage = '';
          this.exportOutput = '';
          this.error = '';
          this.notice = '导出中…';
          return this.client.call('export.run', { path: this.projectPath, output: output, crf: 20 })
            .then(function (started) {
              self.exportJob = (started && started.job) || '';
              self.exportOutput = (started && started.output) || output;
              self.notice = '';
              self.pollExport();
            })
            .catch(function (error) {
              self.notice = '';
              self.error = '导出起不来：' + error.message;
            });
        },
        pollExport: function () {
          var self = this;
          if (!this.exportJob) return;
          var job = this.exportJob;
          this.client.call('export.status', { job: job }).then(function (status) {
            if (!status || self.exportJob !== job) return;
            var fraction = Number(status.fraction);
            self.exportPercent = self.exportPercentOf(status.stage, Number.isFinite(fraction) ? fraction : 0);
            self.exportStage = status.stage || '';
            if (status.output) self.exportOutput = status.output;
            if (status.state === 'running') {
              self.exportTimer = setTimeout(function () { self.pollExport(); }, 700);
              return;
            }
            self.exportJob = '';
            if (status.state === 'done') {
              self.exportPercent = 100;
              self.notice = '导出完成：' + self.exportOutput
                + (status.width ? '（' + status.width + '×' + status.height + '）' : '');
            } else if (status.state === 'cancelled') {
              self.notice = '导出已取消';
            } else {
              self.error = '导出失败：' + ((status.error && status.error.message) || status.state);
            }
          }).catch(function (error) {
            self.exportJob = '';
            self.error = '导出状态读不到：' + error.message;
          });
        },
        /* 引擎的 fraction 是「当前阶段」的进度，混音一开头又回 0；按阶段给权重才是整条进度 */
        exportPercentOf: function (stage, fraction) {
          var spans = {
            'cutout': [0, 0.06],
            'stabilize': [0.06, 0.12],
            'rendering': [0.12, 0.84],
            'rendering in software': [0.12, 0.84],
            'mixing audio': [0.84, 0.95],
            'muxing': [0.95, 1],
          };
          var span = spans[String(stage || '')];
          var value = span ? span[0] + (span[1] - span[0]) * Math.max(0, Math.min(1, fraction)) : fraction;
          return Math.max(0, Math.min(100, Math.round(value * 100)));
        },
        cancelExport: function () {
          var self = this;
          var job = this.exportJob;
          if (!job) return Promise.resolve();
          clearTimeout(this.exportTimer);
          this.exportJob = '';
          return this.client.call('export.cancel', { job: job })
            .then(function () { self.notice = '已取消导出'; })
            .catch(function (error) { self.error = error.message; });
        },
        stampNow: function () {
          var d = new Date();
          var pad = function (n) { return String(n).padStart(2, '0'); };
          return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-'
            + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
        },
        /* 新建工程：project.create → 到 project.list 里认出它的目录 → 打开 */
        createProject: function () {
          var self = this;
          var name = String(this.newProjectName || '').trim();
          if (!name) { this.notice = '先给工程起个名字'; return Promise.resolve(); }
          if (this.newProjectBusy) return Promise.resolve();
          this.newProjectBusy = true;
          this.error = '';
          return this.client.engine().then(function (status) {
            var location = (status && status.root) || '';
            if (!location) throw Error('引擎没报根目录');
            return self.client.call('project.create', { location: location, name: name });
          }).then(function () {
            return self.loadProjects();
          }).then(function () {
            var wanted = self.folderName(name).toLowerCase();
            var hit = null;
            for (var i = 0; i < self.projects.length; i += 1) {
              var row = self.projects[i];
              var tail = String(row.path || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop().toLowerCase();
              if (tail === wanted) { hit = row; break; }
            }
            if (!hit) hit = self.projects[0];
            if (!hit || !hit.path) throw Error('建好了但没在工程列表里找到它');
            self.newProjectName = '';
            return self.openProject(hit.path);
          }).catch(function (error) {
            self.error = '新建失败：' + error.message;
          }).then(function () { self.newProjectBusy = false; });
        },
        /* 引擎自己的目录名规则（projects::folder_name）：非法字符换 -，首尾点/空格去掉 */
        folderName: function (name) {
          var cleaned = String(name || '').trim().replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-');
          var trimmed = cleaned.replace(/^[. ]+|[. ]+$/g, '');
          return trimmed || 'Untitled project';
        },
        addTimeline: function () {
          var self = this;
          return this.applyCommand({ op: 'addTimeline' })
            .then(function () { self.notice = '已新建时间线'; })
            .catch(function () { /* 已提示 */ });
        },
        selectTimeline: function (id) {
          var self = this;
          var current = this.doc && this.doc.activeTimelineId;
          if (!id || id === current) return Promise.resolve();
          return this.applyCommand({ op: 'selectTimeline', timelineId: id })
            .then(function () {
              self.selection = [];
              self.seek(0, true);
              self.notice = '已切到 ' + self.timelineName;
            })
            .catch(function () { /* 已提示 */ });
        },
        addTrack: function () {
          var self = this;
          return this.applyCommand({ op: 'addTrack' })
            .then(function () { self.notice = '已在最上面加了一条轨道'; })
            .catch(function () { /* 已提示 */ });
        },
        toggleFullscreen: function () {
          var host = this.$refs.stage;
          if (!host) return;
          if (document.fullscreenElement) { document.exitFullscreen(); return; }
          if (host.requestFullscreen) host.requestFullscreen().catch(function () { /* 浏览器不让就算了 */ });
        },
        /* 详情栏的「修改」：文字片段直接把光标送到改字框，别的一律指到下面的分组 */
        inspectorHint: function () {
          var clip = this.activeClip;
          if (!clip || !clip.id) { this.notice = '先在时间线上选一个片段'; return; }
          var box = this.$el && this.$el.querySelector ? this.$el.querySelector('.ce-dtext') : null;
          if (box) { box.focus(); box.select(); return; }
          this.notice = '这条片段的可改项都在上面的分组里（变换 / 音频与时间' + (clip.kind === 'text' ? '' : ' / 画面链') + '）';
        },
        loadProjects: function () {
          var self = this;
          return this.client.call('project.list', {}).then(function (list) {
            self.projects = Array.isArray(list) ? list : [];
            self.bootError = '';
          }).catch(function (error) {
            self.projects = [];
            self.bootError = error.message;
          });
        },
        openProject: function (targetPath) {
          var target = String(targetPath || '').trim();
          if (!target) return Promise.resolve();
          var self = this;
          this.busy = true;
          this.error = '';
          return this.client.call('project.open', { path: target }).then(function () {
            self.projectPath = target;
            // 两份都记：一份给本创作台工程（下次从同一个工程进来就开它），一份全局兜底
            try { localStorage.setItem(storeKey(), target); } catch (error) { /* ignore */ }
            try { localStorage.setItem(STORE, target); } catch (error) { /* ignore */ }
            return self.reload();
          }).then(function () {
            self.showPicker = false;
            self.seek(self.firstClipStart(), true);
            // 工程开好了才取目录：三架包一次拿齐，进页签当即有内容（调节的 20 个参数就在 filter 里）
            self.loadCatalogue('effect');
            self.loadCatalogue('filter');
            self.loadCatalogue('transition');
            // 打开工程是后台完成的：别把用户刚点出来的提示盖掉
            if (!self.notice || self.notice.indexOf('已打开 ') === 0) {
              self.notice = '已打开 ' + (self.projectName || target);
            }
          }).catch(function (error) {
            self.error = error.message;
          }).then(function () { self.busy = false; });
        },
        reload: function () {
          var self = this;
          if (!this.projectPath) return Promise.resolve();
          return Promise.all([
            this.client.call('project.document', { path: this.projectPath }),
            this.client.call('project.get', { path: this.projectPath }),
          ]).then(function (rows) {
            var document = rows[0] && (rows[0].document || rows[0]);
            self.doc = document || null;
            self.projectName = (document && document.name) || '';
            self.view = rows[1] || null;
            self.selection = self.selection.filter(function (id) {
              return (self.clips || []).some(function (clip) { return clip.id === id; });
            });
            self.revision += 1;
            self.seek(self.playhead, true);
          }).catch(function (error) { self.error = error.message; });
        },
        firstClipStart: function () {
          var visual = Infinity;
          var any = Infinity;
          this.clips.forEach(function (clip) {
            var start = Number(clip.start) || 0;
            any = Math.min(any, start);
            if (clip.kind === 'video' || clip.kind === 'image') visual = Math.min(visual, start);
          });
          if (Number.isFinite(visual)) return visual;
          return Number.isFinite(any) ? any : 0;
        },
        save: function () {
          var self = this;
          this.notice = '保存中…';
          this.client.call('project.save', { path: this.projectPath }).then(function () {
            self.notice = '已保存';
            self.saved = true;
            return self.reload();
          }).catch(function (error) {
            self.error = error.message;
            self.notice = '';
          });
        },
        undo: function () {
          var self = this;
          this.client.call('edit.undo', { path: this.projectPath }).then(function (view) {
            self.view = view || self.view;
            return self.reload();
          }).catch(function (error) { self.error = error.message; });
        },
        redo: function () {
          var self = this;
          this.client.call('edit.redo', { path: this.projectPath }).then(function (view) {
            self.view = view || self.view;
            return self.reload();
          }).catch(function (error) { self.error = error.message; });
        },

        /* --------------------------------------------------- 命令 */
        applyCommand: function (command) {
          var self = this;
          this.busy = true;
          this.error = '';
          return this.client.call('edit.apply', { path: this.projectPath, command: command })
            .then(function (view) {
              self.view = view || self.view;
              self.saved = false;
              return self.reload();
            })
            .catch(function (error) {
              self.error = error.message;
              throw error;
            })
            .then(function () { self.busy = false; }, function () { self.busy = false; });
        },
        patchClip: function (key, rawValue) {
          var value = Number(rawValue);
          if (!Number.isFinite(value)) return;
          var clip = this.activeClip;
          if (!clip || !clip.id) return;
          if (['scale', 'offsetX', 'offsetY', 'rotation', 'stretchX', 'stretchY'].indexOf(key) >= 0) {
            var transform = { op: 'setClipTransform', clipId: clip.id };
            transform[key] = value;
            this.applyCommand(transform);
            return;
          }
          if (key === 'speed') {
            this.applyCommand({ op: 'setClipSpeed', clipId: clip.id, speed: value, ripple: false });
            return;
          }
          var patch = {};
          patch[key] = value;
          this.applyCommand({ op: 'updateClip', clipId: clip.id, patch: patch });
        },
        toggleFlag: function (trackId, flag) {
          var track = this.tracks.filter(function (row) { return row.id === trackId; })[0];
          if (!track) return;
          var next = flag === 'visible' ? !track.visible : !track.muted;
          this.applyCommand({ op: 'setTrackFlag', trackId: trackId, flag: flag, value: next }).catch(function () { /* 已提示 */ });
        },
        addToTimeline: function (item) {
          var self = this;
          if (!item || !item.id) return;
          var track = this.tracks.filter(function (row) {
            return row.kind === (item.kind === 'audio' ? 'audio' : (item.kind === 'image' ? 'video' : 'video'));
          })[0] || this.tracks[this.tracks.length - 1];
          if (!track) return;
          this.applyCommand({ op: 'addClip', mediaId: item.id, trackId: track.id, start: this.playhead, ripple: false }).then(function () {
            self.notice = '已放入 ' + (item.name || '');
          }).catch(function () { /* 已提示 */ });
        },

        /* --------------------------------------------------- 剪映曲库 */
        setAudioSource: function (value) {
          this.audioSource = value;
          this.stopPreview();
          if (value !== 'library') { this.musicNote = ''; return; }
          this.loadMusicStatus();
          if (this.musicItems.length) return;
          this.musicKind = 'local';
          this.loadLocalMusic();
        },
        setMusicKind: function (kind) {
          this.musicKind = kind;
          this.stopPreview();
          if (kind === 'local') { this.loadLocalMusic(); return; }
          if (kind === 'fav' || kind === 'recent') {
            // 收藏 / 最近是本机记的：不联网
            this.musicItems = [];
            this.musicNote = kind === 'fav'
              ? (this.musicFav.length ? '收藏的 ' + this.musicFav.length + ' 条' : '还没收藏：列表里那颗 ☆ 点一下就收藏')
              : (this.musicRecent.length ? '最近放进时间线的 ' + this.musicRecent.length + ' 条' : '还没有最近用过的曲子');
            return;
          }
          this.musicItems = [];
          if (String(this.musicQuery || '').trim()) { this.searchMusic(); return; }
          this.musicNote = '输入关键词后回车，联网搜剪映曲库（和剪映里搜的一样）';
          this.$nextTick(function () {
            var input = this.$refs.musicInput;
            if (input) input.focus();
          }.bind(this));
        },
        loadMusicStatus: function (attempt) {
          var self = this;
          var tries = attempt || 0;
          this.apiCall('/api/music/status').then(function (payload) {
            self.musicStatus = payload;
            self.musicError = '';
            if (payload && payload.index) self.musicIndexCount = payload.index.count || 0;
            if (payload && payload.up === false) self.musicError = payload.error || '剪映 API 没起来';
          }).catch(function (error) {
            if (tries < 2) {
              setTimeout(function () { self.loadMusicStatus(tries + 1); }, 900 * (tries + 1));
              return;
            }
            self.musicError = '曲库状态读不到：' + error.message;
          });
        },
        retryMusic: function () {
          this.musicError = '';
          this.loadMusicStatus(2);
          if (this.audioSource !== 'library') return;
          if (this.musicKind === 'local') this.loadLocalMusic();
          else if (String(this.musicQuery || '').trim()) this.searchMusic();
        },
        // Creation-Studio 的接口统一是 {ok, data} 信封，这里拆掉
        apiCall: function (url, options) {
          return fetch(url, options).then(function (res) {
            return res.text().then(function (text) {
              var body = null;
              try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
              if (!res.ok || (body && body.ok === false)) {
                throw Error((body && (body.error || body.message)) || ('接口 ' + res.status));
              }
              return (body && Object.prototype.hasOwnProperty.call(body, 'data')) ? body.data : body;
            });
          });
        },
        loadLocalMusic: function () {
          var self = this;
          this.musicSearching = true;
          this.apiCall('/api/music/search?limit=100').then(function (payload) {
            var rows = (payload && payload.items) || [];
            self.musicItems = rows.filter(function (row) { return row.path; }).map(function (row) {
              return {
                title: row.name || '(无题)',
                duration: row.duration,
                path: row.path,
                music_id: row.music_id,
                type: row.type,
                paid_mode: 'local',
              };
            });
            var total = (payload && payload.total_in_index) || self.musicIndexCount || self.musicItems.length;
            self.musicIndexCount = total;
            self.musicNote = '本机已缓存 ' + self.musicItems.length + ' / ' + total +
              ' 条（在剪映里搜过并用过的歌/音效，不用下载就能直接用）';
          }).catch(function (error) {
            self.musicItems = [];
            self.musicError = '读不到本机曲库：' + error.message;
          }).then(function () { self.musicSearching = false; });
        },
        searchMusic: function () {
          var self = this;
          var query = String(this.musicQuery || '').trim();
          if (!query) { this.musicNote = '先输入关键词'; return; }
          this.musicSearching = true;
          this.musicNote = '';
          this.stopPreview();
          this.apiCall('/api/music/native?q=' + encodeURIComponent(query) +
                       '&type=' + (this.musicKind === 'sound' ? 'sound' : 'music') + '&limit=24')
            .then(function (payload) {
              self.musicItems = ((payload && payload.items) || []).map(function (row) {
                return Object.assign({}, row, { title: row.title || row.name || '(无题)' });
              });
              self.musicNote = self.musicItems.length
                ? ('命中 ' + self.musicItems.length + ' 条 · 联网曲库')
                : '没搜到，换个词试试（曲名 / 风格 / 情绪）';
            })
            .catch(function (error) {
              self.musicItems = [];
              self.musicError = '搜不了：' + error.message;
            })
            .then(function () { self.musicSearching = false; });
        },
        musicKeyOf: function (item) {
          if (!item) return '';
          return String(item.resource_id || item.music_id || item.path || item.title || '');
        },
        musicMeta: function (item) {
          var parts = [];
          if (item.author) parts.push(item.author);
          if (item.duration) parts.push(this.fmt(item.duration));
          if (item.path) parts.push('已缓存');
          return parts.join(' · ') || '—';
        },
        isPaid: function (item) {
          return Boolean(item.paid_mode && item.paid_mode !== 'free' && item.paid_mode !== 'local');
        },
        paidLabel: function (item) {
          if (item.paid_mode === 'local' || (item.path && !item.resource_id)) return '本机';
          if (item.paid_mode === 'free') return '免费';
          if (item.paid_mode) return 'VIP';
          return '';
        },
        togglePreview: function (item) {
          var self = this;
          var key = this.musicKeyOf(item);
          if (this.previewing === key) { this.stopPreview(); return; }
          var audio = this.$refs.musicAudio;
          if (!audio) { this.musicNote = '试听控件还没挂上，再点一次'; return; }
          // 本地已缓存的直接流；联网曲目走同源转发（CDN 直连在浏览器里会 403/被策略挡）
          var url = item.path
            ? '/api/music/audio?path=' + encodeURIComponent(item.path)
            : (item.preview_url ? '/api/music/preview?url=' + encodeURIComponent(item.preview_url) : '');
          if (!url) { this.musicNote = '这条没有试听地址'; return; }
          this.previewing = key;
          this.musicNote = '试听：' + (item.title || '');
          audio.src = url;
          audio.volume = 0.7;
          var played = audio.play();
          if (played && played.catch) {
            played.catch(function (error) {
              self.previewing = '';
              self.musicNote = '试听起不来：' + (error && error.name === 'NotAllowedError'
                ? '浏览器挡了自动播放，再点一次 ▶'
                : (error && error.message) || '未知原因');
            });
          }
        },
        stopPreview: function () {
          var audio = this.$refs.musicAudio;
          if (audio) { try { audio.pause(); } catch (e) { /* 无所谓 */ } }
          this.previewing = '';
        },
        previewFailed: function () {
          this.previewing = '';
          this.musicNote = '试听失败：这条的试听地址取不到（VIP 曲目也可能如此）';
        },
        useMusic: function (item) {
          var self = this;
          if (!this.projectPath) { this.error = '先打开工程'; return; }
          var key = this.musicKeyOf(item);
          if (this.musicBusy === key) return;
          this.musicBusy = key;
          this.error = '';
          this.notice = '取音频…';
          var file = item.path;
          var ready = file ? Promise.resolve(file) : this.apiCall('/api/music/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              resource_id: item.resource_id,
              title: item.title,
              type: item.type || (this.musicKind === 'sound' ? 'sound' : 'music'),
            }),
          }).then(function (payload) {
            if (!payload || !payload.path) throw Error('下载没有返回文件路径');
            return payload.path;
          });
          ready.then(function (localPath) {
            self.notice = '导入 ' + (item.title || '音频') + '…';
            return self.importAudio(localPath);
          }).then(function () {
            self.notice = '已加入时间线：' + (item.title || '');
            // 最近用过的记住（曲库二期）
            self.rememberRecent(Object.assign({}, item, { path: item.path || '' }));
          }).catch(function (error) {
            self.notice = '';
            self.error = error.message;
          }).then(function () { self.musicBusy = ''; });
        },
        // media.import → 找到新条目的 id → addClip 落到音频轨
        importAudio: function (file) {
          var self = this;
          return this.client.call('media.import', { path: this.projectPath, file: file })
            .then(function () {
              return self.client.call('project.document', { path: self.projectPath });
            })
            .then(function (doc) {
              if (doc) self.doc = doc;
              var media = (doc && doc.media) || [];
              var norm = function (value) { return String(value || '').replace(/\\/g, '/').toLowerCase(); };
              var hit = null;
              for (var i = media.length - 1; i >= 0; i -= 1) {
                if (norm(media[i].path) === norm(file)) { hit = media[i]; break; }
              }
              if (!hit) hit = media[media.length - 1];
              if (!hit || !hit.id) throw Error('导入后没在素材箱里找到这条');
              return hit;
            })
            .then(function (medium) {
              var track = self.tracks.filter(function (row) { return row.kind === 'audio'; })[0]
                || self.tracks[self.tracks.length - 1];
              if (!track) throw Error('时间线上没有轨道');
              return self.applyCommand({
                op: 'addClip',
                mediaId: medium.id,
                trackId: track.id,
                start: self.playhead,
                ripple: false,
              });
            });
        },

        /* --------------------------------------------------- 选择 */
        isSelected: function (id) { return this.selection.indexOf(id) >= 0; },
        selectClip: function (clip, additive) {
          if (!additive) { this.selection = [clip.id]; return; }
          var index = this.selection.indexOf(clip.id);
          if (index >= 0) this.selection.splice(index, 1);
          else this.selection.push(clip.id);
        },
        clipsOf: function (trackId) {
          return this.clips.filter(function (clip) { return clip.trackId === trackId; });
        },
        clipStyle: function (clip) {
          var ghost = this.dragGhost[clip.id];
          var start = ghost ? ghost.start : clip.start;
          var duration = ghost ? ghost.duration : clip.duration;
          return {
            left: (start * this.zoom) + 'px',
            width: Math.max(8, duration * this.zoom) + 'px',
          };
        },

        /* --------------------------------------------------- 平移时间轴 */
        /* 中键按住拖（标尺上则是 Shift+左键）左右平移视图。左键留给拖片段/裁剪/框选，
           中键在整个剪辑软件里都是「拖画面」的那只手，不会误触任何编辑动作。 */
        startPan: function (event) {
          var host = this.$refs.tlScroll;
          if (!host) return;
          event.preventDefault();
          var self = this;
          var startX = event.clientX;
          var startLeft = host.scrollLeft;
          this.panning = true;
          var move = function (e) {
            /* 鼠标往右拖，内容跟着往右走，所以是减 */
            host.scrollLeft = startLeft - (e.clientX - startX);
          };
          var up = function () {
            self.panning = false;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        },

        /* --------------------------------------------------- 拖动/裁剪 */
        /* 框选：空白处按下拖一个矩形，松手选中框里的片段（Shift/Ctrl 追加） */
        onLaneDown: function (event) {
          if (event.button === 1) { this.startPan(event); return; }
          if (event.button !== 0) return;
          var target = event.target;
          if (target && target.closest && (target.closest('.ce-clip') || target.closest('.ce-ruler') || target.closest('.ce-playhead'))) return;
          this.marquee = {
            cx1: event.clientX, cy1: event.clientY,
            cx2: event.clientX, cy2: event.clientY,
            add: Boolean(event.shiftKey || event.ctrlKey || event.metaKey),
            moved: false,
          };
        },
        marqueeStyle: function () {
          var m = this.marquee;
          var host = this.$refs.tlScroll;
          if (!m || !host) return null;
          var rect = host.getBoundingClientRect();
          return {
            left: Math.max(0, Math.min(m.cx1, m.cx2) - rect.left + host.scrollLeft) + 'px',
            top: Math.max(0, Math.min(m.cy1, m.cy2) - rect.top + host.scrollTop) + 'px',
            width: Math.abs(m.cx2 - m.cx1) + 'px',
            height: Math.abs(m.cy2 - m.cy1) + 'px',
          };
        },
        marqueeTrack: function (event) {
          var m = this.marquee;
          if (!m) return;
          m.cx2 = event.clientX;
          m.cy2 = event.clientY;
          if (Math.abs(m.cx2 - m.cx1) > 3 || Math.abs(m.cy2 - m.cy1) > 3) m.moved = true;
          this.marquee = Object.assign({}, m);
        },
        marqueeCommit: function () {
          var m = this.marquee;
          this.marquee = null;
          if (!m) return;
          var host = this.$refs.tlScroll;
          if (!host) return;
          if (!m.moved) {
            if (!m.add) this.selection = [];
            return;
          }
          var left = Math.min(m.cx1, m.cx2);
          var right = Math.max(m.cx1, m.cx2);
          var top = Math.min(m.cy1, m.cy2);
          var bottom = Math.max(m.cy1, m.cy2);
          var ids = [];
          Array.prototype.slice.call(host.querySelectorAll('.ce-clip')).forEach(function (el) {
            var box = el.getBoundingClientRect();
            var hit = !(box.right < left || box.left > right || box.bottom < top || box.top > bottom);
            if (hit) ids.push(el.getAttribute('data-clip'));
          });
          if (m.add) {
            var base = this.selection.slice();
            ids.forEach(function (id) { if (base.indexOf(id) < 0) base.push(id); });
            this.selection = base;
          } else {
            this.selection = ids;
          }
          this.notice = ids.length ? '框选 ' + ids.length + ' 段' : '框里没有片段';
        },
        /* 分类：点一个题材词就按它搜一次（和手打关键词是同一条路） */
        pickTopic: function (topic) {
          this.musicQuery = String(topic || '');
          if (!this.musicQuery) return undefined;
          return this.searchMusic();
        },
        /* 曲库二期：收藏 / 最近，键和曲目一起存在本机 */
        loadMusicShelf: function () {
          try {
            this.musicFav = JSON.parse(localStorage.getItem(SHELF_FAV) || '[]');
            this.musicRecent = JSON.parse(localStorage.getItem(SHELF_RECENT) || '[]');
          } catch (error) {
            this.musicFav = [];
            this.musicRecent = [];
          }
          if (!Array.isArray(this.musicFav)) this.musicFav = [];
          if (!Array.isArray(this.musicRecent)) this.musicRecent = [];
        },
        persistMusicShelf: function () {
          try {
            localStorage.setItem(SHELF_FAV, JSON.stringify(this.musicFav.slice(0, 80)));
            localStorage.setItem(SHELF_RECENT, JSON.stringify(this.musicRecent.slice(0, 40)));
          } catch (error) { /* 存不下就只留内存 */ }
        },
        isFav: function (item) {
          var key = this.musicKeyOf(item);
          return this.musicFav.some(function (row) { return this.musicKeyOf(row) === key; }, this);
        },
        toggleFav: function (item) {
          var key = this.musicKeyOf(item);
          var has = this.musicFav.some(function (row) { return this.musicKeyOf(row) === key; }, this);
          if (has) this.musicFav = this.musicFav.filter(function (row) { return this.musicKeyOf(row) !== key; }, this);
          else this.musicFav = [item].concat(this.musicFav).slice(0, 80);
          this.persistMusicShelf();
          this.notice = has ? '已取消收藏「' + (item.title || '') + '」' : '已收藏「' + (item.title || '') + '」';
        },
        rememberRecent: function (item) {
          var self = this;
          var key = this.musicKeyOf(item);
          var rows = this.musicRecent.filter(function (row) { return self.musicKeyOf(row) !== key; });
          rows.unshift(item);
          this.musicRecent = rows.slice(0, 40);
          this.persistMusicShelf();
        },
        /* 环境自检：引擎写不了 titles/ 时预览里就没有文字和图形 */
        healthTitle: function () {
          return (this.healthWarnings || []).join('\n');
        },
        checkHealth: function () {
          var self = this;
          return this.apiCall('/api/concat/health').then(function (payload) {
            self.healthWarnings = (payload && payload.warnings) || [];
          }).catch(function () { self.healthWarnings = []; });
        },
        onClipDown: function (event, clip, mode) {          event.preventDefault();
          if (event.shiftKey || event.ctrlKey || event.metaKey) this.selectClip(clip, true);
          else if (!this.isSelected(clip.id)) this.selectClip(clip, false);
          var selected = this.selectionClips.length ? this.selectionClips : [clip];
          this.drag = {
            mode: mode,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
            snapshot: selected.map(function (row) {
              return { id: row.id, start: row.start, duration: row.duration, trackId: row.trackId, sourceStart: row.sourceStart || 0, kind: row.kind };
            }),
            primary: { id: clip.id, start: clip.start, duration: clip.duration, trackId: clip.trackId, sourceStart: clip.sourceStart || 0, kind: clip.kind },
          };
          this.selectClip(clip, false);
        },
        onPointerMove: function (event) {
          // 色轮 / 曲线在拖：先归它们，片段拖动那条路走不到的
          if (this.wheelDrag) { this.wheelTrack(event); return; }
          if (this.curveDrag) { this.curveTrack(event); return; }
          if (this.marquee) { this.marqueeTrack(event); return; }
          var drag = this.drag;
          if (!drag) return;
          var dx = event.clientX - drag.startX;
          var dy = event.clientY - drag.startY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
          var delta = PL.quantizeDelta(dx / this.zoom, this.frame);
          var ghost = {};

          if (drag.mode === 'move') {
            var targetTrack = drag.primary.trackId;
            var hit = document.elementFromPoint(event.clientX, event.clientY);
            var lane = hit && hit.closest ? hit.closest('[data-track]') : null;
            if (lane) targetTrack = lane.getAttribute('data-track');
            var plan = PL.resolveMove({
              clips: this.clips,
              moving: drag.snapshot,
              deltaTime: delta,
              trackId: targetTrack,
              frame: this.frame,
              fps: this.fps,
              playhead: this.playhead,
              snapThreshold: (event.altKey || !this.snap) ? 0 : DRAG_SNAP_PX / this.zoom,
            });
            for (var i = 0; i < plan.length; i++) {
              var row = plan[i];
              var snap = drag.snapshot.filter(function (item) { return item.id === row.clipId; })[0];
              if (!snap) continue;
              ghost[row.clipId] = { start: row.start, duration: snap.duration, trackId: row.trackId };
            }
            drag.plan = plan;
          } else {
            var clip = drag.primary;
            var edge = drag.mode === 'trim-start' ? 'start' : 'end';
            var clamped = PL.clampTrim({
              clip: clip, clips: this.clips, edge: edge, delta: delta, fps: this.fps, ripple: false,
            });
            drag.clampedDelta = clamped;
            if (edge === 'start') {
              ghost[clip.id] = { start: Math.max(0, clip.start + clamped), duration: Math.max(PL.MIN_DURATION, clip.duration - clamped) };
            } else {
              ghost[clip.id] = { start: clip.start, duration: Math.max(PL.MIN_DURATION, clip.duration + clamped) };
            }
          }
          this.dragGhost = ghost;
          this.queueFrame(1);
        },
        onPointerUp: function () {
          // 框选松手：把框里的片段选中
          if (this.marquee) { this.marqueeCommit(); return; }
          // 色轮 / 曲线松手：草稿一次写回引擎
          if (this.wheelDrag || this.curveDrag) {
            var onChain = Boolean(
              (this.wheelDrag && typeof this.wheelDrag.index === 'number')
              || (this.curveDrag && this.curveDrag.chain)
            );
            this.wheelDrag = null;
            this.curveDrag = null;
            if (onChain) this.flushEffectDraft(); else this.commitAdjust();
            return;
          }
          var drag = this.drag;
          this.drag = null;
          if (!drag) return;
          this.dragGhost = {};
          if (!drag.moved) return;
          if (drag.mode === 'move') {
            var plan = drag.plan || [];
            if (!plan.length) return;
            this.applyCommand({
              op: 'moveClips',
              moves: plan.map(function (row) {
                return { clipId: row.clipId, start: row.start, trackId: row.trackId };
              }),
            });
            return;
          }
          var delta = Number(drag.clampedDelta) || 0;
          if (!delta) return;
          this.applyCommand({
            op: 'trimClip',
            clipId: drag.primary.id,
            edge: drag.mode === 'trim-start' ? 'start' : 'end',
            delta: delta,
            ripple: false,
          });
        },

        /* --------------------------------------------------- 播放头 */
        seek: function (time, force) {
          var next = PL.quantize(Math.max(0, Number(time) || 0), this.frame);
          this.playCursor = next;
          if (next === this.playhead && !force) return;
          this.playhead = next;
          if (force) this.queueFrame(0, true);
        },
        onRulerDown: function (event) {
          /* 标尺上左键 = 拖播放头（老手感保留）；中键或 Shift+左键 = 平移视图，
             这样想横向滑的时候不用去够滚动条，也不会把播放头带跑。 */
          if (event.button === 1 || event.shiftKey) { this.startPan(event); return; }
          if (event.button !== 0) return;
          this.startScrub(event);
        },
        /* 拖播放头：move/up 挂在 window 上。原先挂在标尺元素上，鼠标一移出
           26px 高的标尺（往下拖到轨道区、或拖出容器）就触发 pointerleave 断掉，
           手感上就是「拖不住」。 */
        startScrub: function (event) {
          var self = this;
          this.rulerDrag = true;
          this.seekAtPoint(event);
          var move = function (e) { self.seekAtPoint(e); };
          var up = function () {
            self.rulerDrag = false;
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        },
        onRulerMove: function (event) { if (this.rulerDrag) this.seekAtPoint(event); },
        onRulerUp: function () { this.rulerDrag = false; },
        seekAtPoint: function (event) {
          var host = this.$refs.tlScroll;
          if (!host) return;
          var rect = host.getBoundingClientRect();
          this.seek((event.clientX - rect.left + host.scrollLeft) / this.zoom);
        },
        stepFrame: function (delta) { this.seek(this.playhead + delta * this.frame); },
        togglePlay: function () { if (this.playing) this.stopPlay(); else this.startPlay(); },
        startPlay: function () {
          var self = this;
          this.playing = true;
          this.playCursor = this.playhead;
          this.soundStart();
          var last = performance.now();
          var loop = function (now) {
            if (!self.playing) return;
            var dt = ((now - last) / 1000) * self.playRate;
            last = now;
            // 时间游标不取整：取整后再加一帧的量，floor 会永远落回同一帧（播放头原地不动）
            self.playCursor += dt;
            if (self.playCursor >= self.duration) {
              self.playhead = PL.quantize(self.duration, self.frame);
              self.stopPlay();
              return;
            }
            self.playhead = PL.quantize(self.playCursor, self.frame, 'floor');
            self.soundSync();
            self.readMeters();
            self.playTimer = requestAnimationFrame(loop);
          };
          this.playTimer = requestAnimationFrame(loop);
        },
        stopPlay: function () {
          this.playing = false;
          if (this.playTimer) cancelAnimationFrame(this.playTimer);
          this.playTimer = 0;
          this.soundStop();
          this.meterL = 12;
          this.meterR = 12;
        },

        /* ---------------------------------------------- 预览声音（按片段同步 <audio>） */
        mediaUrlOf: function (clip) {
          var item = this.mediaOf(clip && clip.mediaId);
          if (!item || !item.path) return '';
          return '/api/concat/assets/media?path=' + encodeURIComponent(item.path);
        },
        audioFor: function (clip) {
          if (!clip || !clip.id) return null;
          if (clip.kind !== 'audio' && clip.kind !== 'video') return null;
          if (clip.kind === 'video' && clip.muted) return null;
          if (this.audioEls[clip.id]) return this.audioEls[clip.id];
          var item = this.mediaOf(clip.mediaId);
          if (!item || !item.path) return null;
          if (clip.kind === 'video' && (item.hasAudio === false)) return null;
          var el = document.createElement('audio');
          el.preload = 'auto';
          el.src = this.mediaUrlOf(clip);
          this.audioEls[clip.id] = el;
          return el;
        },
        /* 把每个音频元素接到一条 AnalyserNode 上，电平表才有真数据 */
        attachMeter: function (el) {
          if (!el || el.__metered) return;
          try {
            if (!this.audioCtx) {
              var Ctx = window.AudioContext || window.webkitAudioContext;
              if (!Ctx) return;
              this.audioCtx = new Ctx();
              this.analyser = this.audioCtx.createAnalyser();
              this.analyser.fftSize = 512;
              this.analyser.connect(this.audioCtx.destination);
            }
            var source = this.audioCtx.createMediaElementSource(el);
            source.connect(this.analyser);
            el.__metered = true;
          } catch (error) {
            // 接不上分析器不影响出声：很多浏览器一个元素只许接一次
            el.__metered = false;
          }
        },
        readMeters: function () {
          if (!this.analyser) return;
          if (!this.meterBuf || this.meterBuf.length !== this.analyser.fftSize) {
            this.meterBuf = new Uint8Array(this.analyser.fftSize);
          }
          this.analyser.getByteTimeDomainData(this.meterBuf);
          var sum = 0;
          for (var i = 0; i < this.meterBuf.length; i += 1) {
            var v = (this.meterBuf[i] - 128) / 128;
            sum += v * v;
          }
          var rms = Math.sqrt(sum / this.meterBuf.length);
          var db = 20 * Math.log10(Math.max(rms, 1e-5));
          var level = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
          this.meterL = level;
          this.meterR = level;
        },
        meterStyle: function () {
          var height = Math.max(2, Math.round(this.meterL));
          return { height: height + '%' };
        },
        soundStart: function () {
          if (!this.soundOn) return;
          if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume().catch(function () { /* 用户手势之后一般都能起 */ });
          }
          this.soundSync();
        },
        soundSync: function () {
          if (!this.soundOn) return;
          var at = this.playhead;
          var rate = Number(this.playRate) || 1;
          var keys = Object.keys(this.audioEls);
          var self = this;
          var live = {};
          this.clips.forEach(function (clip) {
            var inside = at >= (clip.start || 0) - 0.04 && at < (clip.start || 0) + (clip.duration || 0);
            if (!inside) return;
            var el = self.audioFor(clip);
            if (!el) return;
            live[clip.id] = true;
            self.attachMeter(el);
            var want = (Number(clip.sourceStart) || 0) + Math.max(0, at - clip.start);
            if (Math.abs(el.currentTime - want) > 0.25) {
              try { el.currentTime = want; } catch (error) { /* 还没元数据，下帧再来 */ }
            }
            el.playbackRate = Math.max(0.25, Math.min(4, rate));
            el.volume = Math.max(0, Math.min(1, Number(clip.volume) || 1));
            if (el.paused) {
              var played = el.play();
              if (played && played.catch) played.catch(function () { /* 自动播放被挡，等下一次手势 */ });
            }
          });
          keys.forEach(function (id) {
            if (live[id]) return;
            var el = self.audioEls[id];
            if (el && !el.paused) el.pause();
          });
        },
        soundStop: function () {
          var self = this;
          Object.keys(this.audioEls).forEach(function (id) {
            var el = self.audioEls[id];
            if (el && !el.paused) { try { el.pause(); } catch (error) { /* ignore */ } }
          });
        },
        toggleSound: function () {
          this.soundOn = !this.soundOn;
          if (!this.soundOn) { this.soundStop(); this.meterL = 12; this.meterR = 12; }
          else if (this.playing) this.soundStart();
        },

        /* --------------------------------------------------- 预览帧 */
        queueFrame: function (quality, force) {
          var self = this;
          if (!this.projectPath) return;
          var now = performance.now();
          var level = quality === undefined ? 1 : quality;
          // 优化过的引擎二进制，960×540 一张 16~26ms（1080p 58ms），
          // 所以节流窗口可以压到 32/24ms：拖播放头才跟手
          var gap = this.playing ? 32 : 24;
          if (!force && now - this.lastFrameAt < gap) {
            clearTimeout(this.frameTimer);
            this.frameTimer = setTimeout(function () { self.queueFrame(level); }, gap);
            return;
          }
          this.lastFrameAt = now;
          // 播放时降档取帧：一半宽度，播放完 settle 那一下再给全清
          var base = this.qualityWidth;
          var width = level === 0 ? base : Math.round(base * (this.playing ? 0.5 : 0.65));
          // 拖播放头 / 播放中：拿最近一帧先顶上（引擎的 nearest），
          // 播放时还能直接读素材的代理档（proxy）
          var scrub = this.playing || this.drag || this.marquee || this.rulerDrag;
          var src = this.client.frameUrl(this.projectPath, this.playhead, width, 0)
            + (scrub ? '&nearest=1' : '')
            + (this.playing && this.previewProxy ? '&proxy=1' : '')
            + '&rev=' + this.revision;
          this.frameSrc = src;
          // 停下来之后，悄悄把前后各一帧也烘好：下一次拖动一开始就有图
          if (force && !this.playing) this.prefetchNeighbours(width);
        },
        /** 空闲时预热邻帧：只是让浏览器/CDN 之外的那一层（引擎帧缓存）先热起来 */
        prefetchNeighbours: function (width) {
          if (!this.projectPath || !this.proxyPrefetch) return;
          var list = [this.playhead - 1 / Math.max(1, this.fps), this.playhead + 1 / Math.max(1, this.fps)];
          for (var i = 0; i < list.length; i += 1) {
            var at = list[i];
            if (at < 0 || at > this.duration) continue;
            var url = this.client.frameUrl(this.projectPath, at, width, 0) + '&nearest=1&rev=' + this.revision;
            var img = new Image();
            img.decoding = 'async';
            img.src = url;
          }
        },

        /* --------------------------------------------------- 视图 */
        zoomBy: function (factor) {
          var next = Math.min(400, Math.max(5, this.zoom * factor));
          var host = this.$refs.tlScroll;
          if (host) {
            var anchor = (host.scrollLeft + host.clientWidth / 2) / this.zoom;
            this.zoom = next;
            this.$nextTick(function () { host.scrollLeft = anchor * next - host.clientWidth / 2; });
          } else this.zoom = next;
        },
        fitZoom: function () {
          var host = this.$refs.tlScroll;
          if (!host) return;
          this.zoom = Math.min(400, Math.max(5, (host.clientWidth - 48) / Math.max(1, this.duration + 1)));
        },
        /* ------------------------------------------- 时间线高度（分割条） */
        onResize: function () { this.resetTimelineHeight(); },
        resetTimelineHeight: function (force) {
          var shell = this.$el && this.$el.classList && this.$el.classList.contains('ce-shell') ? this.$el : null;
          var box = shell || (this.$el && this.$el.querySelector ? this.$el.querySelector('.ce-shell') : null);
          var height = (box && box.clientHeight) || (window.innerHeight || 900);
          if (!force && this.timelineHeight > 0) return;
          this.timelineHeight = Math.max(120, Math.round(height * 0.4));
        },
        onSplitDown: function (event) {
          if (event.button !== undefined && event.button !== 0) return;
          event.preventDefault();
          var self = this;
          var startY = event.clientY;
          var startH = this.timelineHeight || Math.round((this.$el.clientHeight || 900) * 0.4);
          var limit = Math.max(200, Math.round((this.$el.clientHeight || 900) * 0.78));
          var move = function (e) {
            var next = startH - (e.clientY - startY);
            self.timelineHeight = Math.min(limit, Math.max(96, Math.round(next)));
          };
          var up = function () {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        },
        onWheel: function (event) {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            this.zoomBy(event.deltaY < 0 ? 1.12 : 0.89);
            return;
          }
          var host = this.$refs.tlScroll;
          if (!host) return;
          /* 触控板横扫、Shift+滚轮都是「时间轴左右滑」；普通竖滚留给轨道列表上下滚 */
          var dx = event.deltaX;
          if (!dx && event.shiftKey) dx = event.deltaY;
          if (!dx) return;
          event.preventDefault();
          host.scrollLeft += dx;
        },
        onKeyDown: function (event) {
          var tag = (event.target && event.target.tagName) || '';
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
          if (!this.doc) return;
          var key = event.key;
          if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'z') {
            event.preventDefault();
            if (event.shiftKey) this.redo(); else this.undo();
            return;
          }
          if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'y') { event.preventDefault(); this.redo(); return; }
          if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 's') { event.preventDefault(); this.save(); return; }
          if (key === ' ') { event.preventDefault(); this.togglePlay(); return; }
          if (key === '/' && this.$refs.panelInput) {
            event.preventDefault();
            this.$refs.panelInput.focus();
            this.$refs.panelInput.select();
            return;
          }
          if (key === 'ArrowLeft') { event.preventDefault(); this.stepFrame(-1); return; }
          if (key === 'ArrowRight') { event.preventDefault(); this.stepFrame(1); return; }
          if (key === 'Home') { event.preventDefault(); this.seek(0); return; }
          if (key === 'End') { event.preventDefault(); this.seek(this.duration); return; }
          if (key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) { event.preventDefault(); this.splitAtPlayhead(); return; }
          if (key === 'Delete' || key === 'Backspace') { event.preventDefault(); this.removeSelected(); }
        },
        splitAtPlayhead: function () {
          var ids = this.selection.slice();
          if (!ids.length) {
            var at = this.playhead;
            ids = this.clips.filter(function (clip) {
              return at > (clip.start || 0) + 1e-6 && at < (clip.start || 0) + (clip.duration || 0) - 1e-6;
            }).map(function (clip) { return clip.id; });
          }
          if (!ids.length) { this.notice = '播放头下面没有片段'; return; }
          this.applyCommand({ op: 'splitClips', clipIds: ids, time: this.playhead });
        },
        removeSelected: function () {
          if (!this.selection.length) return;
          var self = this;
          this.applyCommand({ op: 'removeClips', clipIds: this.selection.slice(), ripple: false })
            .then(function () { self.selection = []; })
            .catch(function () { /* 已提示 */ });
        },
      },
    });
  }

  var instance = null;

  window.CONCAT_EDITOR = {
    /**
     * 挂到 host 上。
     * @param {Element} host 宿主节点
     * @param {{projectId?:string, projectName?:string, projectPath?:string, toast?:Function}} [options]
     *        projectId   创作台的工程 id：决定「本工程上次开的 Concat 工程」
     *        projectName 工程名：没有 Concat 工程时拿它当新建的默认名
     *        projectPath 直接点名要开的 Concat 工程目录（优先级最高）
     *        toast       一次性提示
     */
    mount: function (host, options) {
      if (!host) return null;
      if (instance) {
        try { instance.unmount(); } catch (error) { /* ignore */ }
        instance = null;
      }
      DEPS = options || {};
      host.innerHTML = '';
      instance = createApp().mount(host);
      // 调试/自测用：页面上的实例从这里拿（E2E 里读 playhead / audioEls 之类）
      window.CONCAT_EDITOR.instance = instance;
      return instance;
    },
    /** 当前挂载参数（自测与排障用） */
    options: function () { return Object.assign({}, DEPS); },
  };
}());
