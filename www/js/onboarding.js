/* ============================================================
 * onboarding.js —— V2 新手引导（首次打开时全屏向导）
 * 步骤：欢迎 → 选场景/建模块 → 加每日任务 → 完成
 * 只依赖：Seed（预设）、h()（app.js 的 DOM 工具）、ApiBridge.toast
 * ============================================================ */
(function () {
  'use strict';

  let obEl = null;
  let step = 1;
  let obModules = []; // [{id, name, order, weights}]
  let obTasks = [];   // [{title, moduleId, minutes, daily:true, weekdays:[]}]
  let ctx = null;     // {S, save, done}
  const STEP_LABELS = ['欢迎', '模块', '任务', '完成'];

  function mkMod(name, order) {
    return { id: 'ob' + Date.now().toString(36) + Math.floor(Math.random() * 999), name: name.trim(), order, weights: { A: 10 }, stageNotes: {} };
  }

  function start(S, save, done, todayISO) {
    ctx = { S, save, done, today: todayISO };
    obModules = [];
    obTasks = [];
    step = 1;
    ensure();
    render();
  }
  function ensure() {
    if (obEl) return;
    obEl = h('div', { class: 'ob-overlay' });
    document.body.append(obEl);
  }
  function finish() {
    if (!obModules.length) obModules = [mkMod('学习', 1)];
    ctx.S.modules = obModules;
    const tpl = ctx.S.weeklyTemplate;
    tpl.base.daily = obTasks.map(t => ({
      slot: 'ob' + Date.now().toString(36) + Math.floor(Math.random() * 999),
      title: t.title, moduleId: t.moduleId, minutes: t.minutes || 0
    }));
    tpl.base.byWeekday = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    // 引导前可能已生成当日空计划快照 → 作废，让今日任务按新配置重新生成
    const r = ctx.S.records[ctx.today];
    if (r && !r.done && !(r.logs || []).length && !r.note) delete ctx.S.records[ctx.today];
    else if (r) delete r.plan;
    ctx.S.onboarded = true;
    ctx.save(true);
    obEl.remove();
    obEl = null;
    ctx.done();
    ApiBridge.toast('设置完成，开始打卡吧！');
  }
  function skip() {
    if (!confirm('跳过引导：将创建一个默认「学习」模块，之后随时可在设置里添加任务。确定跳过？')) return;
    finish();
  }

  /* ---------- 步骤渲染 ---------- */
  function stepsBar() {
    const wrap = h('div', { class: 'ob-steps2' });
    STEP_LABELS.forEach((lb, i) => {
      const n = i + 1;
      wrap.append(h('div', { class: 'ob-step' + (n === step ? ' on' : '') + (n < step ? ' done' : '') },
        h('div', { class: 'ob-sdot' }, n < step ? '✓' : String(n)),
        h('div', { class: 'ob-slabel' }, lb)));
      if (n < STEP_LABELS.length) wrap.append(h('div', { class: 'ob-sline' + (n < step ? ' on' : '') }));
    });
    return wrap;
  }
  function render() {
    const box = obEl;
    box.innerHTML = '';
    const card = h('div', { class: 'ob-card' });
    card.append(stepsBar());
    if (step === 1) card.append(...[].concat(stepWelcome()));
    if (step === 2) card.append(...[].concat(stepModules()));
    if (step === 3) card.append(...[].concat(stepTasks()));
    if (step === 4) card.append(...[].concat(stepDone()));
    box.append(card);
  }
  function navBtns(backOk, nextText, nextFn, backText) {
    return h('div', { class: 'ob-nav' },
      backOk ? h('button', { class: 'btn', onclick: () => { step--; render(); } }, backText || '上一步') : h('span'),
      h('button', { class: 'btn primary', onclick: nextFn }, nextText));
  }

  function stepWelcome() {
    return [
      h('div', { class: 'ob-head' },
        h('div', { class: 'ob-brand' }, '✓ 学习打卡'),
        step < 4 ? h('a', { class: 'ob-skip', href: 'javascript:void(0)', onclick: skip }, '跳过引导，直接进入 →') : h('span')),
      h('h1', null, '欢迎使用学习打卡'),
      h('p', { class: 'ob-sub' }, '三步设置，开始你的每日学习打卡'),
      h('div', { class: 'ob-feats' },
        ['✓ 每日任务勾选打卡与达成率', '✓ 一键计时，达标自动完成', '✓ 番茄钟面板', '✓ 日历回看全部历史', '✓ 数据本地存储，可导出分析'].map(t => h('div', { class: 'ob-feat' }, t))),
      navBtns(false, '开始设置（约 1 分钟）', () => { step = 2; render(); })
    ];
  }

  function stepModules() {
    const list = h('div', { class: 'ob-list' });
    const renderList = () => {
      list.innerHTML = '';
      if (!obModules.length) list.append(h('div', { class: 'empty' }, '还没有模块——选一个上方预设，或在下方添加'));
      obModules.forEach((m, i) => {
        list.append(h('div', { class: 'ob-row' },
          h('span', { class: 'mod-dot', style: { background: MOD_COLORS[i % MOD_COLORS.length] } }),
          h('span', { class: 'ob-mod-name' }, m.name),
          h('button', {
            class: 'icon-btn', title: '删除', onclick: () => { obModules.splice(i, 1); renderList(); }
          }, '×')));
      });
    };
    const inp = h('input', { type: 'text', placeholder: '模块名称，如：数学、听力、算法（回车添加）' });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && inp.value.trim()) { obModules.push(mkMod(inp.value, obModules.length + 1)); inp.value = ''; renderList(); }
    });
    const addBtn = () => { if (inp.value.trim()) { obModules.push(mkMod(inp.value, obModules.length + 1)); inp.value = ''; renderList(); } };

    const presetBox = h('div', { class: 'ob-presets' });
    for (const [key, p] of Object.entries(Seed.PRESETS)) {
      presetBox.append(h('button', {
        class: 'ob-preset',
        onclick: () => {
          obModules = p.modules.map((n, i) => mkMod(n, i + 1));
          obTasks = p.tasks.map(t => ({ title: t.title, moduleId: obModules[t.moduleId] ? obModules[t.moduleId].id : null, minutes: t.minutes, daily: true, weekdays: [] }));
          render();
        }
      }, p.label, h('div', { class: 'small muted' }, p.modules.length ? p.modules.join(' · ') : '什么都不预置')));
    }
    renderList();
    return [
      h('div', { class: 'ob-head' }, h('div', { class: 'ob-brand' }, '✓ 学习打卡'),
        h('a', { class: 'ob-skip', href: 'javascript:void(0)', onclick: skip }, '跳过引导，直接进入 →')),
      h('h1', null, '你在学什么？'),
      h('p', { class: 'ob-sub' }, '选一个常见场景一键开始，或自己添加学习模块（模块 = 学习内容的分类）'),
      presetBox,
      list,
      h('div', { class: 'inline-form' }, inp, h('button', { class: 'btn small', onclick: addBtn }, '添加模块')),
      navBtns(true, obModules.length ? '下一步：加任务' : '跳过，直接完成', () => { step = obModules.length ? 3 : 4; render(); })
    ];
  }

  function stepTasks() {
    const list = h('div', { class: 'ob-list' });
    const modSel = () => h('select', null,
      h('option', { value: '' }, '未分类'),
      obModules.map(m => h('option', { value: m.id }, m.name)));
    const renderList = () => {
      list.innerHTML = '';
      if (!obTasks.length) list.append(h('div', { class: 'empty' }, '还没有任务——也可以跳过，以后随时加'));
      obTasks.forEach((t, i) => {
        list.append(h('div', { class: 'ob-row' },
          h('span', { class: 'ob-mod-name' }, t.title),
          h('span', { class: 'small muted' }, (obModules.find(m => m.id === t.moduleId) || { name: '未分类' }).name + (t.minutes ? ' · ' + t.minutes + 'min' : '') + ' · 每天'),
          h('button', { class: 'icon-btn', onclick: () => { obTasks.splice(i, 1); renderList(); } }, '×')));
      });
    };
    const iT = h('input', { type: 'text', placeholder: '任务名，如：背单词' });
    const iM = modSel();
    const iMin = h('input', { type: 'number', min: 0, max: 600, placeholder: '分钟', style: { width: '70px', flex: 'none' } });
    const add = () => {
      if (!iT.value.trim()) { ApiBridge.toast('请填写任务名', true); return; }
      obTasks.push({ title: iT.value.trim(), moduleId: iM.value || null, minutes: Math.max(0, Number(iMin.value) || 0), daily: true, weekdays: [] });
      iT.value = ''; iMin.value = ''; renderList();
    };
    iT.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    renderList();
    return [
      h('div', { class: 'ob-head' }, h('div', { class: 'ob-brand' }, '✓ 学习打卡'),
        h('a', { class: 'ob-skip', href: 'javascript:void(0)', onclick: skip }, '跳过引导，直接进入 →')),
      h('h1', null, '每天要做哪些任务？'),
      h('p', { class: 'ob-sub' }, '填写「期望时长」后，计时达到它就会自动勾选完成'),
      list,
      h('div', { class: 'inline-form' }, iT, iM, iMin, h('button', { class: 'btn small', onclick: add }, '添加任务')),
      navBtns(true, obTasks.length ? '完成设置' : '跳过，完成设置', () => { step = 4; render(); })
    ];
  }

  function stepDone() {
    return [
      h('div', { class: 'ob-head' }, h('div', { class: 'ob-brand' }, '✓ 学习打卡')),
      h('div', { class: 'ob-success' }, '🎉'),
      h('h1', { style: { textAlign: 'center' } }, '设置完成！'),
      h('p', { class: 'ob-sub', style: { textAlign: 'center' } }, obModules.length + ' 个模块 · ' + obTasks.length + ' 个每日任务'),
      h('div', { class: 'ob-feats' },
        ['点任务前的方框打卡', '点 ▶ 开始计时，达到目标时长自动完成', '右侧「番茄钟」开关可打开计时面板', '「历史」里点任意日期回看或补记', '「设置」里随时加模块、改任务'].map(t => h('div', { class: 'ob-feat' }, t))),
      navBtns(true, '开始使用', finish)
    ];
  }

  window.Onboarding = { start };
})();
