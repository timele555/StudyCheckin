/* ============================================================
 * app.js —— UI 层（无框架，直接操作 DOM）
 *  页面：今日（首页6模块）/ 历史（日历回看）/ 设置（阶段·权重·模板·数据）
 * ============================================================ */
'use strict';
const P = window.Planner;
const Seed = window.Seed;
let S = null;            // 全局状态（learning_data.json 的内容）
let API = null;          // 桥接
let VIEW = 'today';      // today | history | settings
let catalogStage = null; // 目录卡当前查看的阶段
let expandedModule = null;
let editingResId = null;
let selDate = null;      // 历史页选中日期
let histY = 0, histM = 0;// 历史页年月（histM: 1-12）
let saveTimer = null;

/* ---------------- 基础工具 ---------------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else if (k === 'value') el.value = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = s => document.querySelector(s);
const toast = (m, err) => window.ApiBridge && ApiBridge.toast(m, err);
function fmtMin(m) { m = Math.max(0, Math.round(m)); return m < 60 ? m + 'min' : Math.floor(m / 60) + 'h' + (m % 60 ? (m % 60) + 'min' : ''); }
function pct(x) { return Math.round(x * 100) + '%'; }
const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
// 周一在前的展示顺序（值为 getDay()：0=周日）
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];
const isSafeUrl = u => /^https?:\/\//i.test(String(u || ''));
const MOD_COLORS = ['#D97757', '#7D9A68', '#6A8BA4', '#B08D57', '#97719F', '#C25B5B', '#5F8D85', '#A8763E', '#8A8F6A', '#B56A79', '#77839B', '#C084A2'];
function modColor(id) {
  const i = S.modules.findIndex(m => m.id === id);
  return MOD_COLORS[(i < 0 ? 99 : i) % MOD_COLORS.length];
}
function modName(id) { const m = S.modules.find(x => x.id === id); return m ? m.name : '未分类'; }
const ICON = {
  today: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6l1.2 1.2L7 4.8"/>',
  hist: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  set: '<path d="M4 8h9M19 8h1M4 16h3M13 16h7"/><circle cx="16" cy="8" r="2.4"/><circle cx="10" cy="16" r="2.4"/>',
  play: '<path d="M8 5.2 18.5 12 8 18.8z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4 7h16M9.5 7V4.8h5V7M7 7l1 13.2h8L17 7M10 11v6M14 11v6"/>',
  edit: '<path d="M4 20l4.2-1L20 7.2 16.8 4 5.2 15.6zM14.5 6.3l3.2 3.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  left: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  right: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 3.8v5h-5"/>'
};
function icon(name, size) {
  const fill = (name === 'play' || name === 'stop');
  return h('span', { html: `<svg viewBox="0 0 24 24" width="${size || 16}" height="${size || 16}" fill="${fill ? 'currentColor' : 'none'}" stroke="${fill ? 'none' : 'currentColor'}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>` });
}

/* ---------------- 保存 ---------------- */
function save(immediate) {
  const doSave = async () => {
    try { await API.saveState(JSON.stringify(S)); }
    catch (e) { toast('保存失败：' + e, true); }
  };
  clearTimeout(saveTimer);
  if (immediate) doSave(); else saveTimer = setTimeout(doSave, 500);
}

/* ---------------- 日期记录操作 ---------------- */
function rec(dateISO) { return P.ensureRecord(S, dateISO); }
function toggleTask(dateISO, slot) {
  const r = rec(dateISO);
  if (r.done[slot]) {
    delete r.done[slot];
    // 手动取消「自动达标完成」的任务 → 记入豁免，计时达标不再自动勾回
    if (r.autoDone && r.autoDone[slot]) {
      delete r.autoDone[slot];
      if (!r.autoDoneOff) r.autoDoneOff = {};
      r.autoDoneOff[slot] = true;
    }
  } else {
    r.done[slot] = true;
    if (r.autoDoneOff) delete r.autoDoneOff[slot];
    if (r.autoDone) delete r.autoDone[slot];
  }
  save(true); renderView();
}
// 计时累计达标 → 静默自动勾选完成（不弹窗、不打断计时），只做页面内的就地更新
function autoCheckDone() {
  if (!S || !API) return;
  let changed = [];
  for (const dateISO of Object.keys(S.records)) {
    const r = S.records[dateISO];
    const run = (r.logs || []).find(l => !l.end);
    if (!run) continue;
    if (!r.autoDone) r.autoDone = {};
    if (!r.autoDoneOff) r.autoDoneOff = {};
    const slot = run.taskId;
    if (!slot || r.done[slot] || r.autoDoneOff[slot]) continue;
    const task = P.allTasks(S, dateISO).find(t => t.slot === slot);
    if (!task || !task.minutes) continue;
    const totalLogged = (r.logs || []).filter(l => l.taskId === slot).reduce((s2, l) => s2 + P.logMinutes(l), 0);
    if (totalLogged >= task.minutes) {
      r.done[slot] = true; r.autoDone[slot] = true; changed.push([dateISO, slot]);
    }
  }
  if (changed.length) {
    save(true);
    for (const [dateISO, slot] of changed) applyAutoDoneDom(dateISO, slot);
  }
}
function applyAutoDoneDom(dateISO, slot) {
  document.querySelectorAll('.task-row').forEach(row => {
    if (row.dataset.slot === slot) {
      row.classList.add('done');
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = true;
    }
  });
  const ring = document.querySelector('#page-today .head-right');
  if (ring && dateISO === P.todayISO()) {
    ring.innerHTML = '';
    ring.append(streakChip(P.streak(S, P.todayISO())), ringSvg(P.dayStats(S, P.todayISO())));
  }
}
function addExtra(dateISO, title, moduleId, minutes) {
  title = String(title || '').trim();
  if (!title) { toast('任务内容不能为空', true); return; } // 底层兜底：UI 校验被绕过时也不入库
  const r = rec(dateISO);
  r.extras.push({ id: 'x' + Date.now().toString(36) + Math.floor(Math.random() * 100), title, moduleId: moduleId || null, minutes: Math.max(0, Number(minutes) || 0) });
  save(true); renderView();
}
// V2 快速加任务：可同时保存为「每日固定任务」，让明天以后每天自动出现
function quickAddTask(dateISO, title, moduleId, minutes, asFixed) {
  title = String(title || '').trim();
  if (!title) { toast('请填写任务内容', true); return; }
  minutes = Math.max(0, Math.min(600, Number(minutes) || 0));
  if (asFixed) {
    S.weeklyTemplate.base.daily.push({
      slot: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 99),
      title, moduleId: moduleId || null, minutes
    });
    delete rec(dateISO).plan;      // 重新生成当日计划，今天立即生效（勾选记录保留）
    P.planOf(S, dateISO);
    save(true); renderView();
    toast('已添加并保存为每日固定任务（设置页可管理）');
  } else {
    addExtra(dateISO, title, moduleId, minutes);
  }
}
function removeExtra(dateISO, id) {
  const r = rec(dateISO);
  r.extras = r.extras.filter(x => x.id !== id);
  delete r.done[id];
  if (r.autoDone) delete r.autoDone[id];
  if (r.autoDoneOff) delete r.autoDoneOff[id];
  save(true); renderView();
}
function runningLog(dateISO) { return (rec(dateISO).logs || []).find(l => !l.end) || null; }
function startTimer(dateISO, task) {
  // 全局单计时：先结束任何日期上仍在进行的日志（含历史页遗留），避免多条并行累计
  const now = new Date();
  for (const d of Object.keys(S.records)) {
    for (const l of ((S.records[d] || {}).logs || [])) {
      if (!l.end) {
        l.end = P.hm(now);
        if (d !== dateISO) toast('已自动结束「' + d + '」的遗留计时');
      }
    }
  }
  const r = rec(dateISO);
  r.logs.push({ id: 'l' + Date.now().toString(36), taskId: task.slot || task.id || null, moduleId: task.moduleId || null, start: P.hm(now), end: null, startedAt: now.toISOString(), note: '' });
  save(true); renderView();
}
function stopTimer(dateISO) {
  const run = runningLog(dateISO);
  if (!run) return;
  run.end = P.hm(new Date());
  // 结束计时那一刻同样做达标检查（静默勾选）
  const slot = run.taskId;
  const r = rec(dateISO);
  const task = slot && P.allTasks(S, dateISO).find(t => t.slot === slot);
  if (task && task.minutes && !r.done[slot] && !(r.autoDoneOff && r.autoDoneOff[slot])) {
    const total = (r.logs || []).filter(l => l.taskId === slot).reduce((s2, l) => s2 + P.logMinutes(l), 0);
    if (total >= task.minutes) {
      r.done[slot] = true;
      if (!r.autoDone) r.autoDone = {};
      r.autoDone[slot] = true;
    }
  }
  save(true); renderView();
}
function addLog(dateISO, f) {
  rec(dateISO).logs.push({ id: 'l' + Date.now().toString(36), taskId: f.taskId || null, moduleId: f.moduleId || null, start: f.start, end: f.end || null, startedAt: null, note: f.note || '' });
  save(true); renderView();
}
function removeLog(dateISO, id) {
  const r = rec(dateISO);
  r.logs = r.logs.filter(l => l.id !== id);
  save(true); renderView();
}
function setNote(dateISO, text) {
  rec(dateISO).note = text;
  save(false);
  const hint = $('#note-hint');
  if (hint) hint.textContent = '已自动保存 ' + P.hm(new Date());
}
function regenPlan(dateISO) {
  delete rec(dateISO).plan;
  P.planOf(S, dateISO);
  save(true); renderView();
  toast('已按最新计划重新生成该日任务');
}

/* ---------------- 共享组件 ---------------- */
function ringSvg(st, size) {
  const R = 25, C = 2 * Math.PI * R, off = C * (1 - st.rate);
  const s = size || 66;
  return h('div', { class: 'ring-box' },
    h('div', { html: `<svg width="${s}" height="${s}" viewBox="0 0 60 60">
      <circle cx="30" cy="30" r="${R}" fill="none" stroke="#EFEDE4" stroke-width="6"/>
      <circle cx="30" cy="30" r="${R}" fill="none" stroke="#D97757" stroke-width="6" stroke-linecap="round"
        stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 30 30)"/>
      <text x="30" y="35" text-anchor="middle" class="ring-num" font-size="14">${Math.round(st.rate * 100)}%</text>
    </svg>` }),
    h('div', { class: 'small muted', style: { marginTop: '-6px' } }, `已完成 ${st.done}/${st.total} · 加权 ${pct(st.weightedRate)}`)
  );
}
function streakChip(n, label) {
  return h('div', { class: 'streak-chip' },
    h('div', { class: 'num' }, String(n)),
    h('div', { class: 'lbl' }, (label || '连续打卡'), h('br'), '（天）')
  );
}
function modTag(moduleId) {
  return h('span', { class: 'mod-tag' },
    h('span', { class: 'mod-dot', style: { background: modColor(moduleId) } }),
    moduleId ? modName(moduleId) : '未分类'
  );
}
// 任务列表（今日页 / 历史详情共用）
function taskListComponent(dateISO) {
  const tasks = P.allTasks(S, dateISO);
  const r = rec(dateISO);
  const run = runningLog(dateISO);
  const loggedBy = {};
  for (const l of (r.logs || [])) {
    const k = l.taskId || '_';
    loggedBy[k] = (loggedBy[k] || 0) + P.logMinutes(l);
  }
  const box = h('div');
  if (!tasks.length) box.append(h('div', { class: 'empty' }, '该日没有生成任务（阶段模板为空）'));
  for (const t of tasks) {
    const isDone = !!(r.done[t.slot]);
    const isRun = run && run.taskId === t.slot;
    const logged = loggedBy[t.slot] || 0;
    box.append(h('div', { class: 'task-row' + (isDone ? ' done' : ''), 'data-slot': t.slot },
      h('input', { type: 'checkbox', checked: isDone, onchange: () => toggleTask(dateISO, t.slot) }),
      h('div', { class: 't-title' },
        t.moduleId ? h('span', { class: 'mod-dot', title: '模块：' + modName(t.moduleId), style: { background: modColor(t.moduleId), display: 'inline-block', marginRight: '7px', verticalAlign: 'middle' } }) : null,
        t.title,
        t.type === 'extra' ? h('span', { class: 't-extra-meta' }, '（临时）') : null
      ),
      t.minutes ? h('span', { class: 't-min' }, fmtMin(t.minutes)) : null,
      logged ? h('span', { class: 't-logged' }, '已记 ' + fmtMin(logged)) : null,
      h('div', { class: 'task-actions' },
        t.type === 'extra'
          ? h('button', { class: 'icon-btn', title: '删除临时任务', onclick: () => { if (confirm('删除这条临时任务？')) removeExtra(dateISO, t.id); } }, icon('trash', 13))
          : null,
        h('button', {
          class: 'icon-btn' + (isRun ? ' run' : ''), title: isRun ? '结束计时' : '开始计时',
          onclick: () => isRun ? stopTimer(dateISO) : startTimer(dateISO, t)
        }, icon(isRun ? 'stop' : 'play', 13))
      )
    ));
  }
  // 添加任务（V2：可选期望时长 + 一键存为每日固定任务）
  const sel = h('select', null, h('option', { value: '' }, '未分类'), S.modules.map(m => h('option', { value: m.id }, m.name)));
  const inp = h('input', { type: 'text', placeholder: '添加任务，回车或点按钮', style: { flex: '2' } });
  const iMin = h('input', { type: 'number', min: 0, max: 600, placeholder: '目标min', style: { width: '72px', flex: 'none' } });
  const fixChk = h('input', { type: 'checkbox', id: 'fix-' + dateISO, title: '同时保存为每日固定任务（以后每天自动出现）' });
  const submit = () => quickAddTask(dateISO, inp.value, sel.value, iMin.value, fixChk.checked);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  box.append(h('div', { class: 'inline-form' },
    inp, sel, iMin,
    h('label', { class: 'fix-label', for: 'fix-' + dateISO }, fixChk, '每日固定'),
    h('button', { class: 'btn small', onclick: submit }, '添加')));
  return box;
}
// 时间记录组件
function logsComponent(dateISO) {
  const r = rec(dateISO);
  const box = h('div');
  const run = runningLog(dateISO);
  if (run) {
    const title = (() => {
      const t = P.allTasks(S, dateISO).find(x => x.slot === run.taskId);
      return t ? t.title : (run.moduleId ? modName(run.moduleId) : '未指定任务');
    })();
    const elapsedEl = h('span', { class: 'elapsed running-elapsed', 'data-start': run.startedAt }, fmtMin(P.logMinutes(run)));
    box.append(h('div', { class: 'running-bar' },
      elapsedEl,
      h('span', { class: 'rt' }, '正在计时：', title),
      h('button', { class: 'btn small primary', onclick: () => stopTimer(dateISO) }, '结束')
    ));
  }
  const logs = r.logs || [];
  if (!logs.length) {
    box.append(h('div', { class: 'empty' }, '暂无时间记录 —— 点任务右侧 ▶ 开始计时，或在下方手动补录'));
  } else {
    const tb = h('table', { class: 'tbl' },
      h('tr', null, h('th', null, '任务'), h('th', null, '开始'), h('th', null, '结束'), h('th', null, '时长'), h('th', null, '备注'), h('th', null, '')));
    const taskTitle = id => { const t = P.allTasks(S, dateISO).find(x => x.slot === id); return t ? t.title : (id ? id : '—'); };
    for (const l of logs) {
      tb.append(h('tr', null,
        h('td', null, l.taskId ? taskTitle(l.taskId) : (l.moduleId ? modName(l.moduleId) : '未指定')),
        h('td', { class: 'num' }, l.start),
        h('td', { class: 'num' }, l.end || h('span', { class: 'muted' }, '进行中')),
        h('td', { class: 'num' }, fmtMin(P.logMinutes(l))),
        h('td', { class: 'small muted' }, l.note || ''),
        h('td', null, h('button', { class: 'icon-btn', title: '删除记录', onclick: () => removeLog(dateISO, l.id) }, icon('trash', 13)))
      ));
    }
    box.append(tb);
  }
  // 手动补录
  const selTask = h('select', { style: { flex: '2' } },
    h('option', { value: '' }, '未指定任务'),
    P.allTasks(S, dateISO).map(t => h('option', { value: t.slot }, t.title)));
  const iStart = h('input', { type: 'time' });
  const iEnd = h('input', { type: 'time' });
  const iNote = h('input', { type: 'text', placeholder: '备注（可选）' });
  const submit = () => {
    if (!iStart.value || !iEnd.value) { toast('请选择开始和结束时间', true); return; }
    const task = P.allTasks(S, dateISO).find(x => x.slot === selTask.value);
    addLog(dateISO, { taskId: selTask.value || null, moduleId: task ? task.moduleId : null, start: iStart.value, end: iEnd.value, note: iNote.value.trim() });
  };
  box.append(h('div', { class: 'inline-form' }, selTask, iStart, iEnd, iNote, h('button', { class: 'btn small', onclick: submit }, '补录')));
  return box;
}
// 笔记组件
function noteComponent(dateISO) {
  const r = rec(dateISO);
  const ta = h('textarea', { class: 'note-area', placeholder: '今日记录 / 复盘：调试日志、遇到的问题、明天重点……' });
  ta.value = r.note || '';
  ta.addEventListener('input', () => setNote(dateISO, ta.value));
  return h('div', null, ta, h('div', { class: 'save-hint', id: 'note-hint' }, ''));
}
// 学习资料列表（某模块）
function resListComponent(moduleId, compact) {
  const list = S.resources.filter(r => r.moduleId === moduleId);
  const box = h('div', { class: 'res-list' });
  if (!list.length) box.append(h('div', { class: 'empty' }, '暂无资料，可在下方添加（网址 / 本地路径 / 检索关键词）'));
  for (const r of list) {
    if (r.id === editingResId) {
      const iLabel = h('input', { type: 'text', value: r.label, style: { flex: '2' } });
      const iType = h('select', null,
        h('option', { value: 'url', selected: r.type === 'url' }, '网址'),
        h('option', { value: 'path', selected: r.type === 'path' }, '本地路径'),
        h('option', { value: 'keyword', selected: r.type === 'keyword' }, '检索关键词'));
      const iVal = h('input', { type: 'text', value: r.value, style: { flex: '2' } });
      const iStar = h('input', { type: 'checkbox', checked: !!r.starred, title: '重点' });
      box.append(h('div', { class: 'res-item' },
        iStar, iLabel, iType, iVal,
        h('button', {
          class: 'btn small primary', onclick: () => {
            if (!iLabel.value.trim() || !iVal.value.trim()) { toast('名称和内容不能为空', true); return; }
            r.label = iLabel.value.trim(); r.type = iType.value; r.value = iVal.value.trim(); r.starred = iStar.checked;
            editingResId = null; save(true); renderView();
          }
        }, '保存'),
        h('button', { class: 'btn small', onclick: () => { editingResId = null; renderView(); } }, '取消')
      ));
      continue;
    }
    const isUrl = r.type === 'url' && isSafeUrl(r.value);
    const labelEl = isUrl
      ? h('a', {
        href: r.value, target: '_blank', rel: 'noopener', class: 'r-label', title: r.value,
        onclick: (e) => { if (API && API.mode === 'desktop') { e.preventDefault(); API.openUrl(r.value); } }
      }, r.label)
      : h('span', { class: 'r-label', title: r.value }, r.label);
    box.append(h('div', { class: 'res-item' },
      r.starred ? h('span', { class: 'star' }, '★') : null,
      labelEl,
      h('span', { class: 'r-type' }, r.type === 'url' ? '链接' : r.type === 'path' ? '路径' : '检索'),
      h('button', { class: 'icon-btn', title: '编辑', onclick: () => { editingResId = r.id; renderView(); } }, icon('edit', 12)),
      h('button', {
        class: 'icon-btn', title: '删除', onclick: () => {
          if (!confirm('删除资料「' + r.label + '」？')) return;
          S.resources = S.resources.filter(x => x.id !== r.id);
          save(true); renderView();
        }
      }, icon('trash', 12))
    ));
  }
  // 添加
  const iLabel = h('input', { type: 'text', placeholder: '资料名称', style: { flex: '2' } });
  const iType = h('select', null, h('option', { value: 'url' }, '网址'), h('option', { value: 'path' }, '本地路径'), h('option', { value: 'keyword', selected: true }, '检索关键词'));
  const iVal = h('input', { type: 'text', placeholder: isPathHint(), style: { flex: '2' } });
  function isPathHint() { return iType.value === 'url' ? 'https://…' : iType.value === 'path' ? 'D:\\资料\\… 或文件夹' : '搜索关键词 / 平台'; }
  iType.addEventListener('change', () => { iVal.placeholder = isPathHint(); });
  const iStar = h('input', { type: 'checkbox', title: '标记为重点' });
  box.append(h('div', { class: 'inline-form' },
    iStar, iLabel, iType, iVal,
    h('button', {
      class: 'btn small', onclick: () => {
        if (!iLabel.value.trim() || !iVal.value.trim()) { toast('请填写名称和内容', true); return; }
        S.resources.push({ id: 'res-' + Date.now().toString(36), moduleId, label: iLabel.value.trim(), type: iType.value, value: iVal.value.trim(), starred: iStar.checked });
        save(true); renderView();
      }
    }, '添加资料')
  ));
  return box;
}
// 学习内容目录卡（按当前阶段权重排序）
function catalogComponent(todayISO) {
  const todayStage = P.getStage(S, todayISO);
  const stageId = catalogStage || todayStage.id;
  const single = P.sortedStages(S).length <= 1; // V2 通用模式：单阶段隐藏阶段切换
  const box = h('div');
  if (!single) box.append(h('div', { class: 'stage-chips', style: { marginBottom: '10px' } },
    P.sortedStages(S).map(s => h('button', {
      class: 'chip' + (s.id === stageId ? ' active' : ''),
      onclick: () => { catalogStage = s.id; expandedModule = null; renderView(); }
    }, s.id, s.id === todayStage.id ? h('span', { class: 'cur' }, '●当前') : null)
  )));
  const mods = P.modulesForStage(S, stageId);
  for (const m of mods) {
    const frozen = m.weight === 0;
    const open = expandedModule === m.id;
    box.append(h('div', { class: 'cat-row' },
      h('div', { class: 'cat-head', onclick: () => { expandedModule = open ? null : m.id; renderView(); } },
        h('span', { class: 'mod-dot', style: { background: modColor(m.id) } }),
        h('span', { class: 'cat-name' + (frozen ? ' frozen' : '') }, m.name),
        frozen ? h('span', { class: 'frozen-tag' }, '冻结') : h('span', { class: 'w-pct', title: '当前阶段权重（目录按此排序）' }, m.weight + '%')
      ),
      (m.stageNotes && m.stageNotes[stageId]) ? h('div', { class: 'cat-note' }, m.stageNotes[stageId]) : null,
      open ? resListComponent(m.id) : null
    ));
  }
  return box;
}

/* ---------------- 侧栏 & 路由 ---------------- */
function buildNav() {
  const items = [
    ['today', '今日', ICON.today],
    ['history', '历史', ICON.hist],
    ['settings', '设置', ICON.set]
  ];
  const nav = $('#nav');
  nav.innerHTML = '';
  for (const [id, label, ic] of items) {
    nav.append(h('button', {
      class: 'nav-item' + (VIEW === id ? ' active' : ''),
      onclick: () => { VIEW = id; buildNav(); renderView(); }
    }, h('span', { html: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>` }), label));
  }
  nav.append(h('div', { class: 'nav-sep' }));
  nav.append(h('button', {
    class: 'nav-item' + (pomoOpen ? ' active' : ''),
    onclick: () => togglePomo()
  }, h('span', { html: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9.5v3.5l2.5 2.5M9.5 2h5"/></svg>` }), '番茄钟'));
}
function renderView() {
  $('#page-today').classList.toggle('active', VIEW === 'today');
  $('#page-history').classList.toggle('active', VIEW === 'history');
  $('#page-settings').classList.toggle('active', VIEW === 'settings');
  if (VIEW === 'today') renderToday();
  else if (VIEW === 'history') renderHistory();
  else renderSettings();
}
function updateFoot() {
  const t = P.todayISO();
  const s = P.getStage(S, t);
  $('#foot-stage').innerHTML = '';
  if (P.sortedStages(S).length > 1) {
    $('#foot-stage').append(
      h('div', null, h('b', null, s.name)),
      h('div', null, s.start + ' ~ ' + s.end)
    );
  } else {
    const n = P.allTasks(S, t).length;
    $('#foot-stage').append(
      h('div', null, h('b', null, S.modules.length + ' 个模块')),
      h('div', null, '今日 ' + n + ' 项任务')
    );
  }
}

/* ---------------- 今日页 ---------------- */
function renderToday() {
  const today = P.todayISO();
  const stage = P.getStage(S, today);
  P.planOf(S, today);
  const st = P.dayStats(S, today);
  const page = $('#page-today');
  page.innerHTML = '';
  const d = P.fromISO(today);

  page.append(h('div', { class: 'page-head' },
    h('div', null,
      h('h1', null, (d.getMonth() + 1) + '月' + d.getDate() + '日', ' · 周' + WEEK_CN[d.getDay()]),
      h('div', { class: 'sub' },
        P.sortedStages(S).length > 1 ? h('span', { class: 'badge' }, stage.name) : null,
        (stage.short && P.sortedStages(S).length > 1) ? h('span', { class: 'muted small' }, stage.short) : null,
        !S.modules.length ? h('button', { class: 'btn small', onclick: () => Onboarding.start(S, save, () => { buildNav(); renderView(); }) }, '＋ 创建学习模块') : null,
        today < stage.start ? h('span', { class: 'badge gray' }, '阶段尚未正式开始') : null,
        today > stage.end ? h('span', { class: 'badge gray' }, '阶段已结束') : null
      )
    ),
    h('div', { class: 'head-right' },
      streakChip(P.streak(S, today)),
      ringSvg(st)
    )
  ));

  const grid = h('div', { class: 'grid-2' });
  const left = h('div', { class: 'col' });
  const right = h('div', { class: 'col' });

  // ① 今日学习任务
  const taskCard = h('div', { class: 'card' },
    h('h2', null, '今日学习任务', h('span', { class: 'cnt' }, P.allTasks(S, today).length + ' 项'),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small', title: '计划改动后重排今日任务（勾选记录会保留）', onclick: () => regenPlan(today) }, icon('refresh', 12), ' 重新生成')
    ),
    taskListComponent(today)
  );
  // ④ 学习时间记录
  const logCard = h('div', { class: 'card' },
    h('h2', null, '学习时间记录', h('span', { class: 'cnt' }, '今日共 ' + fmtMin(P.dayStats(S, today).minutes))),
    logsComponent(today)
  );
  // ②/③ 学习内容目录 + 学习资料路径
  const catCard = h('div', { class: 'card' },
    h('h2', null, '学习内容目录', h('span', { class: 'cnt' }, '按阶段权重排列 · 点模块管理学习资料')),
    catalogComponent(today)
  );
  // ⑤ 日常记录
  const noteCard = h('div', { class: 'card' },
    h('h2', null, '日常记录（复盘）'),
    noteComponent(today)
  );

  left.append(taskCard, logCard);
  right.append(catCard, noteCard);
  grid.append(left, right);
  page.append(grid);
  updateFoot();
}

/* ---------------- 历史页 ---------------- */
function renderHistory() {
  const today = P.todayISO();
  if (!selDate) selDate = today;
  if (!histY) { const d = new Date(); histY = d.getFullYear(); histM = d.getMonth() + 1; }
  const page = $('#page-history');
  page.innerHTML = '';

  // 月统计（预览，不落盘）；平均达成率只统计有任务的日子，避免纯笔记日稀释
  const first = new Date(histY, histM - 1, 1);
  const daysInMonth = new Date(histY, histM, 0).getDate();
  let daysWithData = 0, rateSum = 0, rateDays = 0, minSum = 0;
  for (let i = 1; i <= daysInMonth; i++) {
    const isoD = P.iso(new Date(histY, histM - 1, i));
    const r = S.records[isoD];
    if (r && (r.plan || (r.logs && r.logs.length) || r.note || (r.extras && r.extras.length))) {
      const s = P.dayStats(S, isoD, undefined, true);
      daysWithData++; minSum += s.minutes;
      if (s.total > 0) { rateSum += s.rate; rateDays++; }
    }
  }

  page.append(h('div', { class: 'page-head' },
    h('div', null,
      h('h1', null, '历史记录'),
      h('div', { class: 'sub' }, h('span', { class: 'muted small' }, '所有打卡、时间与笔记都按日期保存 · 点日期回看或补记')),
    ),
    h('div', { class: 'head-right' },
      streakChip(P.streak(S, today)),
      h('div', { class: 'streak-chip' },
        h('div', { class: 'num' }, rateDays ? Math.round(rateSum / rateDays * 100) + '%' : '—'),
        h('div', { class: 'lbl' }, histM + '月平均', h('br'), '达成率')
      ),
      h('div', { class: 'streak-chip' },
        h('div', { class: 'num' }, fmtMin(minSum)),
        h('div', { class: 'lbl' }, histM + '月累计', h('br'), '学习时长')
      )
    )
  ));

  const card = h('div', { class: 'card' });
  card.append(h('div', { class: 'cal-head' },
    h('button', { class: 'icon-btn', onclick: () => { histM--; if (histM < 1) { histM = 12; histY--; } renderHistory(); } }, icon('left')),
    h('div', { class: 'm-title' }, histY + ' 年 ' + histM + ' 月'),
    h('button', { class: 'icon-btn', onclick: () => { histM++; if (histM > 12) { histM = 1; histY++; } renderHistory(); } }, icon('right')),
    h('span', { class: 'spacer', style: { flex: '1' } }),
    h('button', { class: 'btn small', onclick: () => { const d = new Date(); histY = d.getFullYear(); histM = d.getMonth() + 1; selDate = P.todayISO(); renderHistory(); } }, '回到今天')
  ));
  const grid = h('div', { class: 'cal-grid' });
  for (const w of ['一', '二', '三', '四', '五', '六', '日']) grid.append(h('div', { class: 'cal-dow' }, w));
  for (let i = 0; i < (first.getDay() + 6) % 7; i++) grid.append(h('div', { class: 'cal-cell empty' }));
  for (let i = 1; i <= daysInMonth; i++) {
    const isoD = P.iso(new Date(histY, histM - 1, i));
    const r = S.records[isoD];
    const hasData = r && (r.plan || (r.logs && r.logs.length) || r.note || (r.extras && r.extras.length));
    const s = hasData ? P.dayStats(S, isoD, undefined, true) : null;
    const alpha = s ? (0.12 + 0.66 * s.rate) : 0;
    const cell = h('div', {
      class: 'cal-cell' + (isoD === today ? ' today' : '') + (isoD === selDate ? ' sel' : ''),
      style: s ? { background: `rgba(217,119,87,${alpha.toFixed(2)})` } : null,
      onclick: () => { selDate = isoD; renderHistory(); }
    },
      h('div', { class: 'd' }, String(i)),
      s ? h('div', { class: 'pct' + (alpha < 0.45 ? ' dark' : '') }, Math.round(s.rate * 100) + '%') : null,
      s && s.minutes ? h('div', { class: 'pct', style: { position: 'absolute', bottom: '5px', right: '7px', left: 'auto', fontSize: '10px', color: alpha < 0.45 ? 'var(--ink-3)' : '#fff' } }, fmtMin(s.minutes)) : null
    );
    grid.append(cell);
  }
  card.append(grid);
  card.append(h('div', { class: 'cal-legend' },
    '达成率：', h('span', { class: 'sw' }), h('span', { class: 'sw', style: { background: 'rgba(217,119,87,.45)' } }),
    h('span', { class: 'sw', style: { background: 'rgba(217,119,87,.78)' } }), '颜色越深完成度越高'
  ));
  page.append(card);

  // 选中日期详情（可编辑 = 可补记历史）
  const sd = P.fromISO(selDate);
  const sStage = P.getStage(S, selDate);
  const sst = P.dayStats(S, selDate);
  const detail = h('div', { class: 'grid-2' });
  const dl = h('div', { class: 'col' }, h('div', { class: 'card' },
    h('h2', null, `${sd.getMonth() + 1}月${sd.getDate()}日 · 周${WEEK_CN[sd.getDay()]}`,
      P.sortedStages(S).length > 1 ? h('span', { class: 'badge', style: { marginLeft: '6px' } }, sStage.id + ' 阶段') : null,
      h('span', { class: 'spacer' }), h('span', { class: 'cnt' }, `完成 ${sst.done}/${sst.total} · 学习 ${fmtMin(sst.minutes)}`)),
    taskListComponent(selDate)
  ), h('div', { class: 'card' },
    h('h2', null, '该日时间记录', h('span', { class: 'cnt' }, '共 ' + fmtMin(sst.minutes))),
    logsComponent(selDate)
  ));
  const dr = h('div', { class: 'col' }, h('div', { class: 'card' },
    h('h2', null, '该日笔记'),
    noteComponent(selDate)
  ));
  detail.append(dl, dr);
  page.append(detail);
  updateFoot();
}

/* ---------------- 设置页 ---------------- */
function renderSettings() {
  const page = $('#page-settings');
  page.innerHTML = '';
  page.append(h('div', { class: 'page-head' },
    h('div', null,
      h('h1', null, '设置'),
      h('div', { class: 'sub' }, h('span', { class: 'muted small' }, '模块、任务、模板与数据管理（改动即时保存）'))
    )
  ));

  // —— 阶段与权重 ——
  const stageCard = h('div', { class: 'card' }, h('h2', null, '阶段与权重', h('span', { class: 'cnt' }, '0 = 冻结：目录置底、不生成任务')));
  const stageTbl = h('table', { class: 'tbl' });
  const headRow = h('tr', null, h('th', null, '模块 \\ 阶段'));
  for (const s of P.sortedStages(S)) {
    headRow.append(h('th', null,
      h('div', null, s.id),
      h('input', {
        type: 'date', value: s.start, style: { width: '118px', marginTop: '3px' },
        onchange: e => { s.start = e.target.value; save(true); toast('阶段 ' + s.id + ' 起始日已改为 ' + s.start); }
      }),
      h('input', {
        type: 'date', value: s.end, style: { width: '118px', marginTop: '3px' },
        onchange: e => { s.end = e.target.value; save(true); }
      })
    ));
  }
  stageTbl.append(headRow);
  for (const m of S.modules) {
    const tr = h('tr', null, h('td', null, h('span', { class: 'mod-dot', style: { background: modColor(m.id), display: 'inline-block', marginRight: '6px' } }), m.name));
    for (const s of P.sortedStages(S)) {
      tr.append(h('td', null, h('input', {
        type: 'number', min: 0, max: 100, value: m.weights[s.id] || 0, style: { width: '62px' },
        onchange: e => {
          m.weights[s.id] = Math.max(0, Math.min(100, Number(e.target.value) || 0));
          save(true); toast(m.name + ' · ' + s.id + ' 阶段权重 → ' + m.weights[s.id] + '%');
        }
      })));
    }
    stageTbl.append(tr);
  }
  stageCard.append(stageTbl);
  stageCard.append(h('div', { class: 'hint-box' }, '阶段判定：按今天日期落在哪个阶段区间自动选择；任务生成、目录排序都使用该阶段的权重列。'));

  // —— 模块管理（V2 通用模式） ——
  const single = P.sortedStages(S).length <= 1;
  let modCard = null;
  if (single) {
    modCard = h('div', { class: 'card' }, h('h2', null, '学习模块管理', h('span', { class: 'cnt' }, S.modules.length + ' 个 · 权重用于目录排序与加权达成率')));
    const mTbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, '模块'), h('th', null, '排序权重'), h('th', null, '')));
    for (const m of S.modules) {
      const nameInp = h('input', { type: 'text', value: m.name, style: { width: '160px' } });
      nameInp.addEventListener('change', () => { m.name = nameInp.value.trim() || m.name; save(true); renderView(); });
      const wInp = h('input', { type: 'number', min: 0, max: 100, value: m.weights.A || 0, style: { width: '62px' } });
      wInp.addEventListener('change', () => { m.weights.A = Math.max(0, Math.min(100, Number(wInp.value) || 0)); save(true); });
      mTbl.append(h('tr', null,
        h('td', null, h('span', { class: 'mod-dot', style: { background: modColor(m.id), display: 'inline-block', marginRight: '6px' } }), nameInp),
        h('td', null, wInp),
        h('td', null, h('button', {
          class: 'icon-btn', title: '删除模块', onclick: () => {
            if (!confirm('删除模块「' + m.name + '」？\n其下资料将变为未分类；引用它的固定任务将不再生成。')) return;
            S.modules = S.modules.filter(x => x.id !== m.id);
            S.resources.forEach(r => { if (r.moduleId === m.id) r.moduleId = null; });
            save(true); renderView();
          }
        }, icon('trash', 13)))));
    }
    const newInp = h('input', { type: 'text', placeholder: '新模块名称，回车添加', style: { flex: '1' } });
    newInp.addEventListener('keydown', e => {
      if (e.key === 'Enter' && newInp.value.trim()) {
        const m = Seed.mod(newInp.value.trim(), S.modules.length + 1);
        S.modules.push(m); save(true); renderView();
      }
    });
    modCard.append(mTbl, h('div', { class: 'inline-form' }, newInp, h('button', {
      class: 'btn small', onclick: () => {
        if (!newInp.value.trim()) { toast('请填写模块名称', true); return; }
        S.modules.push(Seed.mod(newInp.value.trim(), S.modules.length + 1));
        save(true); renderView();
      }
    }, '添加模块')));
  }

  // —— 每日固定任务（结构化编辑，V2） ——
  let fixedCard = null;
  if (single) {
    const daily = () => S.weeklyTemplate.base.daily;
    fixedCard = h('div', { class: 'card' }, h('h2', null, '每日固定任务', h('span', { class: 'cnt' }, daily().length + ' 个 · 每天自动出现在今日清单')));
    const fTbl = h('table', { class: 'tbl' }, h('tr', null, h('th', null, '任务'), h('th', null, '模块'), h('th', null, '目标时长'), h('th', null, '')));
    for (const t of daily()) {
      const tInp = h('input', { type: 'text', value: t.title, style: { width: '180px' } });
      tInp.addEventListener('change', () => { t.title = tInp.value.trim() || t.title; save(true); });
      const mSel = h('select', null, h('option', { value: '' }, '未分类'),
        S.modules.map(m => h('option', { value: m.id, selected: t.moduleId === m.id }, m.name)));
      mSel.addEventListener('change', () => { t.moduleId = mSel.value || null; save(true); });
      const minInp = h('input', { type: 'number', min: 0, max: 600, value: t.minutes || 0, style: { width: '62px' } });
      minInp.addEventListener('change', () => { t.minutes = Math.max(0, Math.min(600, Number(minInp.value) || 0)); save(true); });
      fTbl.append(h('tr', null, h('td', null, tInp), h('td', null, mSel), h('td', null, minInp),
        h('td', null, h('button', {
          class: 'icon-btn', title: '删除固定任务', onclick: () => {
            S.weeklyTemplate.base.daily = daily().filter(x => x !== t);
            save(true); renderSettings();
          }
        }, icon('trash', 13)))));
    }
    const iT = h('input', { type: 'text', placeholder: '任务名', style: { flex: '2' } });
    const iM = h('select', null, h('option', { value: '' }, '未分类'), S.modules.map(m => h('option', { value: m.id }, m.name)));
    const iMin = h('input', { type: 'number', min: 0, max: 600, placeholder: '分钟', style: { width: '70px', flex: 'none' } });
    const addFixed = () => {
      if (!iT.value.trim()) { toast('请填写任务名', true); return; }
      daily().push({ slot: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 99), title: iT.value.trim(), moduleId: iM.value || null, minutes: Math.max(0, Number(iMin.value) || 0) });
      save(true); renderSettings();
    };
    fixedCard.append(fTbl, h('div', { class: 'inline-form' }, iT, iM, iMin, h('button', { class: 'btn small', onclick: addFixed }, '添加固定任务')),
      h('div', { class: 'hint-box' }, '目标时长 = 计时达标自动勾选的阈值（0 为不自动完成）。首页快速添加时勾选「每日固定」也会加到这里。改动即时生效；当天清单点首页「重新生成」立即套用。'));
  }

  // —— 任务排程：模板改动后刷新今日计划（勾选/计时记录保留） ——
  function refreshTodayPlan() {
    const t = P.todayISO();
    if (S.records[t] && S.records[t].plan) { delete S.records[t].plan; P.planOf(S, t); }
  }

  // —— 任务轮询（快捷设置）：队列 + 出场星期，全部可视化，不再需要改 JSON ——
  function renderRotationCard() {
    const card = h('div', { class: 'card' }, h('h2', null, '任务轮询', h('span', { class: 'cnt' }, '排一个队列，勾选出场日，到点轮流出现')));
    if (!single) {
      card.append(h('div', { class: 'hint-box' }, '多阶段模式下请在下方「高级 JSON」中编辑轮询队列。'));
      return card;
    }
    if (!S.rotationQueues || !S.rotationQueues.A) S.rotationQueues.A = [];
    const q = S.rotationQueues.A;
    const bw = S.weeklyTemplate.base.byWeekday;
    const daySet = P.rotationDaysOf(S, 'A');
    const commit = re => { refreshTodayPlan(); save(true); if (re) renderSettings(); };

    // 队列列表（可排序 / 删除 / 就地编辑）
    const list = h('div', { class: 'rot-list' });
    if (!q.length) list.append(h('div', { class: 'empty' }, '队列为空——在下方添加几个任务，它们会在出场日按顺序轮流出现'));
    q.forEach((it, i) => {
      const tInp = h('input', { type: 'text', value: it.label, style: { width: '170px' } });
      tInp.addEventListener('change', () => { it.label = tInp.value.trim() || it.label; save(true); });
      const mSel = h('select', null, h('option', { value: '' }, '未分类'),
        S.modules.map(m => h('option', { value: m.id, selected: it.moduleId === m.id }, m.name)));
      mSel.addEventListener('change', () => { it.moduleId = mSel.value || null; save(true); });
      const minInp = h('input', { type: 'number', min: 0, max: 600, value: it.minutes == null ? '' : it.minutes, placeholder: '—', style: { width: '64px' } });
      minInp.addEventListener('change', () => { it.minutes = minInp.value === '' ? null : Math.max(0, Math.min(600, Number(minInp.value) || 0)); save(true); });
      list.append(h('div', { class: 'rot-row' },
        h('span', { class: 'rot-idx' }, String(i + 1)),
        h('span', { class: 'mod-dot', style: { background: it.moduleId ? modColor(it.moduleId) : '#C9C4B4' } }),
        tInp, mSel, minInp,
        h('div', { class: 'task-actions' },
          h('button', { class: 'icon-btn', title: '上移', disabled: i === 0, onclick: () => { if (i > 0) { q.splice(i - 1, 0, q.splice(i, 1)[0]); commit(true); } } }, icon('left', 12)),
          h('button', { class: 'icon-btn', title: '下移', disabled: i === q.length - 1, onclick: () => { if (i < q.length - 1) { q.splice(i + 1, 0, q.splice(i, 1)[0]); commit(true); } } }, icon('right', 12)),
          h('button', { class: 'icon-btn', title: '移出队列', onclick: () => { q.splice(i, 1); commit(true); } }, icon('trash', 12))
        )
      ));
    });
    // 添加轮询任务
    const iT = h('input', { type: 'text', placeholder: '轮询任务名，如：真题模拟卷' });
    const iM = h('select', null, h('option', { value: '' }, '未分类'), S.modules.map(m => h('option', { value: m.id }, m.name)));
    const iMin = h('input', { type: 'number', min: 0, max: 600, placeholder: '目标min', style: { width: '76px', flex: 'none' } });
    const addRot = () => {
      if (!iT.value.trim()) { toast('请填写任务名', true); return; }
      q.push({ label: iT.value.trim(), moduleId: iM.value || null, minutes: iMin.value === '' ? null : Math.max(0, Number(iMin.value) || 0) });
      iT.value = ''; iMin.value = ''; commit(true);
    };
    iT.addEventListener('keydown', e => { if (e.key === 'Enter') addRot(); });

    // 出场星期（勾选的日子每天出场一个队列项，按顺序循环）
    const setRotationDay = (day, on) => {
      // 只动目标这一天：剥离它的轮询槽，开启时再放回，其他天的设置不受影响
      const arr = Array.isArray(bw[day]) ? bw[day] : [];
      const kept = arr.filter(t => !(t && t.kind === 'rotation'));
      if (on) kept.push({ kind: 'rotation', slot: 'rot', minutes: null });
      bw[day] = kept;
    };
    const dayBtns = h('div', { class: 'rot-days' },
      WD_ORDER.map(d => {
        const on = daySet.has(d);
        return h('button', {
          class: 'day-btn' + (on ? ' on' : ''),
          title: on ? '点击取消该日轮询' : '点击设为轮询出场日',
          onclick: e => { setRotationDay(d, !on); commit(true); }
        }, '周' + WEEK_CN[d]);
      }),
      h('span', { class: 'small muted', style: { marginLeft: '6px' } }, '勾选的日子按队列顺序轮流出任务')
    );

    // 出场预览：今天（或下一个出场日）出场的任务 + 下一个任务
    const preview = h('div', { class: 'rot-preview' });
    if (q.length && daySet.size) {
      let found = null;
      let d = P.fromISO(P.todayISO());
      for (let i = 0; i < 14 && !found; i++) {
        if (daySet.has(d.getDay())) found = { isoD: P.iso(d), isToday: i === 0 };
        d = P.addDays(d, 1);
      }
      if (found) {
        const hit = P.rotationItemFor(S, 'A', found.isoD);
        preview.append(h('span', { class: 'pill' + (found.isToday ? ' hot' : '') },
          (found.isToday ? '今天' : found.isoD.slice(5)) + '出场：' + hit.item.label));
        if (q.length > 1) {
          preview.append(h('span', { class: 'pill' }, '下一个：' + q[(hit.index + 1) % q.length].label));
        }
      } else {
        preview.append(h('span', { class: 'pill' }, '14 天内没有出场日'));
      }
    } else {
      preview.append(h('span', { class: 'pill' }, q.length ? '请勾选出场星期' : '请添加轮询任务'));
    }

    card.append(
      list,
      h('div', { class: 'inline-form' }, iT, iM, iMin, h('button', { class: 'btn small', onclick: addRot }, '加入队列')),
      h('div', { class: 'rot-sec-title' }, '出场星期'),
      dayBtns,
      preview,
      h('div', { class: 'hint-box' }, '轮询顺序由「阶段开始日（默认 2026-01-01）以来第几个出场日」确定：改动队列或星期后，从下一个出场日起按新顺序轮转，历史日期已生成的计划不受影响。目标时长留空 = 不自动完成。')
    );
    return card;
  }

  // —— 每周固定任务（按星期）：只在指定星期出现的任务 ——
  function renderWeekCard() {
    const card = h('div', { class: 'card' }, h('h2', null, '每周固定任务（按星期）', h('span', { class: 'cnt' }, '只在勾选星期出现的任务，如周末复盘')));
    if (!single) {
      card.append(h('div', { class: 'hint-box' }, '多阶段模式下请在下方「高级 JSON」中编辑周模板。'));
      return card;
    }
    const bw = S.weeklyTemplate.base.byWeekday;
    const daySet = P.rotationDaysOf(S, 'A');
    const box = h('div');
    for (const d of WD_ORDER) {
      const arr = Array.isArray(bw[d]) ? bw[d].filter(t => t && t.kind !== 'rotation') : [];
      const row = h('div', { class: 'wd-row' });
      row.append(h('div', { class: 'wd-label' }, '周' + WEEK_CN[d], daySet.has(d) ? h('span', { class: 'rot-badge', title: '该日为轮询出场日（在上方「任务轮询」中管理）' }, '轮询日') : null));
      const chips = h('div', { class: 'wd-chips' });
      if (!arr.length) chips.append(h('span', { class: 'muted small' }, '—'));
      for (const t of arr) {
        chips.append(h('span', { class: 'wd-chip' },
          t.moduleId ? h('span', { class: 'mod-dot', style: { background: modColor(t.moduleId) } }) : null,
          t.title,
          t.minutes ? h('span', { class: 'muted' }, ' ' + fmtMin(t.minutes)) : null,
          h('button', {
            class: 'icon-btn', title: '删除', onclick: () => {
              bw[d] = bw[d].filter(x => x !== t);
              refreshTodayPlan(); save(true); renderSettings();
            }
          }, '×')
        ));
      }
      const iT = h('input', { type: 'text', placeholder: '+' + (d === 0 || d === 6 ? '周末任务' : '任务'), style: { width: '120px' } });
      const iM = h('select', null, h('option', { value: '' }, '未分类'), S.modules.map(m => h('option', { value: m.id }, m.name)));
      const iMin = h('input', { type: 'number', min: 0, max: 600, placeholder: 'min', style: { width: '56px' } });
      const addW = () => {
        if (!iT.value.trim()) { toast('请填写任务名', true); return; }
        if (!Array.isArray(bw[d])) bw[d] = [];
        bw[d].push({ slot: 'w' + Date.now().toString(36) + Math.floor(Math.random() * 99), title: iT.value.trim(), moduleId: iM.value || null, minutes: Math.max(0, Number(iMin.value) || 0) });
        refreshTodayPlan(); save(true); renderSettings();
      };
      iT.addEventListener('keydown', e => { if (e.key === 'Enter') addW(); });
      row.append(chips, h('div', { class: 'wd-add' }, iT, iM, iMin, h('button', { class: 'btn small', onclick: addW }, '加')));
      box.append(row);
    }
    card.append(box, h('div', { class: 'hint-box' }, '与「每日固定任务」叠加：某天出现的任务 = 每日固定 + 当天星期任务 + 轮询出场 + 当天临时添加。'));
    return card;
  }
  const rotCard = renderRotationCard();
  const weekCard = renderWeekCard();

  // —— 高级：直接编辑 JSON ——
  const tplCard = h('div', { class: 'card' }, h('h2', null, '高级编辑（JSON）'));
  // 结构校验：合法 JSON 但结构错误会导致任务被清空，必须在应用前拦截
  const isDayTask = t => t && typeof t === 'object' && typeof t.slot === 'string' && typeof t.title === 'string';
  const isValidTplShape = v => !!(v && typeof v === 'object' && !Array.isArray(v)
    && v.base && typeof v.base === 'object' && Array.isArray(v.base.daily) && v.base.daily.every(isDayTask)
    && v.base.byWeekday && typeof v.base.byWeekday === 'object'
    && Object.values(v.base.byWeekday).every(x => x == null || (Array.isArray(x) && x.every(isDayTask)))
    && (v.overrides == null || (typeof v.overrides === 'object' && !Array.isArray(v.overrides))));
  const isValidQueuesShape = v => !!(v && typeof v === 'object' && !Array.isArray(v)
    && Object.values(v).every(q => Array.isArray(q) && q.every(x => x && typeof x === 'object' && typeof x.label === 'string')));
  const mkJson = (titleText, getVal, applyVal, validate) => {
    const ta = h('textarea', { class: 'json-area' });
    ta.value = JSON.stringify(getVal(), null, 2);
    const reset = () => { ta.value = JSON.stringify(getVal(), null, 2); };
    return h('div', null,
      h('div', { class: 'small muted', style: { margin: '8px 0 6px' } }, titleText),
      ta,
      h('div', { class: 'inline-form' },
        h('button', {
          class: 'btn small primary', onclick: () => {
            let v;
            try { v = JSON.parse(ta.value); }
            catch (e) { toast('JSON 解析失败：' + e.message, true); return; }
            if (validate && !validate(v)) { toast('结构不符合要求（字段缺失或类型错误），已拒绝应用；可点「还原」恢复当前值', true); return; }
            applyVal(v); refreshTodayPlan(); save(true); renderView(); toast(titleText + ' 已应用');
          }
        }, '应用'),
        h('button', { class: 'btn small', onclick: reset }, '还原')
      )
    );
  };
  const adv = h('details', { class: 'adv-details' },
    h('summary', null, '展开直接编辑 JSON（weeklyTemplate / rotationQueues）'),
    mkJson('每周模板 weeklyTemplate（daily=每日固定；byWeekday 键 0=周日…6=周六；kind:"rotation" 为轮询槽）',
      () => S.weeklyTemplate, v => S.weeklyTemplate = v, isValidTplShape),
    mkJson('轮询队列 rotationQueues（每个阶段一个数组，依次轮转；出场日各推进一格）',
      () => S.rotationQueues, v => S.rotationQueues = v, isValidQueuesShape)
  );
  tplCard.append(adv);

  // —— 资料总览 ——
  const resCard = h('div', { class: 'card' }, h('h2', null, '学习资料总览', h('span', { class: 'cnt' }, S.resources.length + ' 条 · 也可在首页目录中按模块管理')));
  const selMod = h('select', null, h('option', { value: '' }, '全部模块'), S.modules.map(m => h('option', { value: m.id }, m.name)));
  const listBox = h('div');
  const renderResBox = () => {
    listBox.innerHTML = '';
    const mid = selMod.value;
    const list = S.resources.filter(r => !mid || r.moduleId === mid);
    if (!list.length) { listBox.append(h('div', { class: 'empty' }, '该模块暂无资料')); return; }
    const tb = h('table', { class: 'tbl' }, h('tr', null, h('th', null, '模块'), h('th', null, '资料'), h('th', null, '类型'), h('th', null, '内容'), h('th', null, '')));
    for (const r of list) {
      tb.append(h('tr', null,
        h('td', { class: 'small' }, r.starred ? h('span', { class: 'star' }, '★ ') : null, modName(r.moduleId)),
        h('td', null, r.label),
        h('td', { class: 'small muted' }, r.type === 'url' ? '链接' : r.type === 'path' ? '路径' : '检索'),
        h('td', { class: 'small muted', style: { maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          r.type === 'url' ? h('a', {
            href: r.value, target: '_blank',
            onclick: e => { if (API.mode === 'desktop') { e.preventDefault(); API.openUrl(r.value); } }
          }, r.value) : r.value),
        h('td', null, h('button', {
          class: 'icon-btn', onclick: () => {
            if (!confirm('删除资料「' + r.label + '」？')) return;
            S.resources = S.resources.filter(x => x.id !== r.id);
            save(true); renderResBox(); toast('已删除');
          }
        }, icon('trash', 13)))
      ));
    }
    listBox.append(tb);
  };
  selMod.addEventListener('change', renderResBox);
  renderResBox();
  resCard.append(h('div', { class: 'inline-form', style: { marginTop: '0', marginBottom: '8px' } }, selMod), listBox);

  // —— 自检通道（环境/数据/运行时；报告同时落盘 data/selfcheck_report.txt） ——
  let scLast = null;
  const scCard = h('div', { class: 'card' }, h('h2', null, '自检', h('span', { class: 'cnt' }, '一键体检 · 报告存于 data/selfcheck_report.txt，可发给维护者排障')));
  const scList = h('div');
  const scRender = checks => {
    scLast = checks;
    scList.innerHTML = '';
    const okN = checks.filter(c => c.ok).length;
    scList.append(h('div', { class: 'sc-sum' + (okN === checks.length ? '' : ' bad') },
      '自检结果：' + okN + '/' + checks.length + ' 项通过' + (okN === checks.length ? ' ✓' : '，请查看未通过项的建议')));
    for (const c of checks) {
      scList.append(h('div', { class: 'sc-row' + (c.ok ? '' : ' fail') },
        h('span', { class: 'sc-mark ' + (c.ok ? 'ok' : 'fail') }, c.ok ? '✓' : '✗'),
        h('div', { class: 'sc-body' },
          h('div', { class: 'sc-name' }, c.name),
          h('div', { class: 'sc-detail' }, c.detail),
          c.hint ? h('div', { class: 'sc-hint' }, '建议：' + c.hint) : null
        )
      ));
    }
  };
  if (API.runSelfcheck) {
    scCard.append(h('div', { class: 'inline-form' },
      h('button', {
        class: 'btn primary', onclick: async () => {
          toast('正在自检…');
          try { scRender(JSON.parse(await API.runSelfcheck())); toast('自检完成，报告已写入 data/selfcheck_report.txt'); }
          catch (e) { toast('自检失败：' + e, true); }
        }
      }, '运行自检'),
      h('button', {
        class: 'btn', onclick: async () => {
          if (!scLast) { toast('请先运行一次自检', true); return; }
          const text = '学习打卡自检报告\n' + scLast.map(c => (c.ok ? '[✓] ' : '[✗] ') + c.name + '：' + c.detail + (c.hint ? '\n    建议：' + c.hint : '')).join('\n');
          let ok = false;
          try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* ignore */ }
          if (!ok) {
            const ta = document.createElement('textarea');
            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
            document.body.append(ta); ta.select();
            try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
            ta.remove();
          }
          toast(ok ? '自检报告已复制' : '复制失败，可直接打开 data/selfcheck_report.txt', !ok);
        }
      }, '复制自检报告')
    ), scList,
      h('div', { class: 'hint-box' }, '命令行同样可体检（无界面也能出报告）：StudyCheckin.exe --selfcheck，弹窗显示摘要并生成 data/selfcheck_report.txt。'));
  } else {
    scCard.append(h('div', { class: 'hint-box' }, '当前为浏览器预览模式，无后端可检。桌面版：设置页「运行自检」，或命令行 StudyCheckin.exe --selfcheck。'));
  }

  // —— 数据概览 · Agent 分析 ——
  const dataCard = h('div', { class: 'card' }, h('h2', null, '数据概览 · Agent 分析'));
  const sum = P.buildSummary(S, P.todayISO());
  const ov = sum.overview;
  const ovChip = (num, lbl) => h('div', { class: 'ov-chip' }, h('div', { class: 'num' }, num), h('div', { class: 'lbl' }, lbl));
  dataCard.append(h('div', { class: 'ov-grid' },
    ovChip(String(ov.streakDays), '连续打卡（天）'),
    ovChip(fmtMin(ov.totalMinutes), '累计学习'),
    ovChip(ov.overallDoneRate == null ? '—' : pct(ov.overallDoneRate), '平均达成率'),
    ovChip(ov.activeDays + '/' + ov.daysTracked, '活跃/记录天数'),
    ovChip(fmtMin(ov.last7.minutes), '近 7 天学习'),
    ovChip(ov.last7.doneRate == null ? '—' : pct(ov.last7.doneRate), '近 7 天达成率')
  ));
  // 模块时长分布
  const mods = Object.values(sum.perModuleMinutes).filter(v => v.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  const modsBox = h('div', { class: 'ov-bars' });
  if (mods.length) {
    const tot = mods.reduce((s2, v) => s2 + v.minutes, 0);
    for (const v of mods) {
      modsBox.append(h('div', { class: 'bar-row' },
        h('span', { class: 'bar-name' }, v.name),
        h('div', { class: 'bar-track' }, h('i', { style: { width: Math.max(2, v.minutes / tot * 100).toFixed(1) + '%' } })),
        h('span', { class: 'bar-val' }, fmtMin(v.minutes))
      ));
    }
  } else modsBox.append(h('div', { class: 'empty' }, '暂无学习时长记录'));
  dataCard.append(h('div', { class: 'ov-sec' }, '模块时长分布'), modsBox);
  // 最近 7 天
  const w7 = h('div', { class: 'ov-week' });
  const t0 = P.fromISO(P.todayISO());
  let w7max = 1;
  const w7data = [];
  for (let i = 6; i >= 0; i--) {
    const isoD = P.iso(P.addDays(t0, -i));
    const dd = sum.days.find(x => x.date === isoD);
    const minutes = dd ? dd.minutes : 0;
    w7data.push({ isoD, minutes, rate: dd ? dd.rate : null });
    if (minutes > w7max) w7max = minutes;
  }
  for (const d of w7data) {
    w7.append(h('div', { class: 'wk-col', title: d.isoD + '：' + (d.minutes ? fmtMin(d.minutes) : '无记录') + (d.rate != null ? ' · 达成 ' + pct(d.rate) : '') },
      h('div', { class: 'wk-bar-wrap' }, h('div', { class: 'wk-bar' + (d.minutes ? '' : ' zero'), style: { height: Math.max(3, Math.round(d.minutes / w7max * 46)) + 'px' } })),
      h('div', { class: 'wk-lbl' }, d.isoD.slice(5).replace('-', '/'))
    ));
  }
  dataCard.append(h('div', { class: 'ov-sec' }, '最近 7 天学习时长'), w7);
  dataCard.append(h('div', { class: 'kv', style: { marginTop: '10px' } },
    h('div', null, '运行模式：', h('b', null, API.mode === 'desktop' ? '桌面应用（pywebview）' : '浏览器预览')),
    h('div', null, '数据文件：', h('b', null, 'data/learning_data.json（应用目录下，可随时备份）')),
    h('div', null, '导出目录：', h('b', null, 'exports/（文件名带时间戳，不覆盖历史导出）'))
  ));
  dataCard.append(h('div', { class: 'inline-form' },
    h('button', { class: 'btn primary', onclick: copyAnalysis }, '复制分析摘要（给 Agent）'),
    h('button', { class: 'btn', onclick: doExport }, '导出完整快照 JSON'),
    h('button', { class: 'btn', onclick: () => API.revealData() }, '打开数据文件夹'),
    h('button', {
      class: 'btn danger', onclick: async () => {
        if (!confirm('确定恢复种子数据？\n当前所有打卡/时间/笔记记录将被清空（建议先导出快照）！')) return;
        S = Seed.buildSeedState(P.todayISO());
        await API.saveState(JSON.stringify(S));
        renderView(); toast('已恢复种子数据');
      }
    }, '恢复种子数据（清空记录）')
  ));
  dataCard.append(h('div', { class: 'hint-box' },
    h('b', null, '给 Agent 的数据接口：'),
    '「复制分析摘要」生成一段人读友好的 Markdown（连续/累计/近7·30天/模块分布/最近记录），可直接粘贴对话；「导出完整快照 JSON」结构为 { exportedAt, summary, state }，summary 含 overview（总览+7/30天窗口）、days[]（逐日 rate/minutes/note + tasks[] 任务级明细：标题/模块/目标/实际分钟/是否完成）、perModuleMinutes（每模块累计分钟）；state 为完整原始数据。'
  ));

  if (single) page.append(modCard, fixedCard, rotCard, weekCard);
  else page.append(stageCard, rotCard);
  page.append(resCard, scCard, dataCard, tplCard);
  updateFoot();
}
async function doExport() {
  const payload = { exportedAt: new Date().toISOString(), summary: P.buildSummary(S, P.todayISO()), state: S };
  const p = await API.saveExport(JSON.stringify(payload, null, 2));
  toast('已导出' + (p && p.startsWith ? '：' + p : '（浏览器下载）'));
}
// 一键复制纯文本分析摘要（clipboard 失败时回退 execCommand，再失败引导用导出）
async function copyAnalysis() {
  const text = P.buildAnalysisText(S, P.todayISO());
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) { /* file:// 等环境无此 API */ }
  if (!ok) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  toast(ok ? '分析摘要已复制，可直接粘贴给 Agent' : '复制失败，请改用「导出完整快照 JSON」', !ok);
}

/* ---------------- 番茄钟悬浮面板 ---------------- */
const POMO_MIN = 25; // 标准番茄时长（分钟）
let pomoOpen = false;
let pomoEl = null;

function latestRunning() {
  let best = null, bestDate = null;
  for (const d of Object.keys(S.records)) {
    const run = ((S.records[d] || {}).logs || []).find(l => !l.end);
    if (run && (!best || (run.startedAt || '') > (best.startedAt || ''))) { best = run; bestDate = d; }
  }
  return best ? { log: best, date: bestDate } : null;
}
function fmtSec(sec) {
  sec = Math.max(0, Math.floor(sec));
  return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
}
function ensurePomoPanel() {
  if (pomoEl) return;
  pomoEl = h('div', { class: 'pomo-panel', style: { display: 'none' }, onclick: () => jumpToRunning() });
  document.body.append(pomoEl);
}
function togglePomo(open) {
  ensurePomoPanel();
  pomoOpen = (typeof open === 'boolean') ? open : !pomoOpen;
  pomoEl.style.display = pomoOpen ? 'block' : 'none';
  buildNav();
  if (pomoOpen) updatePomoPanel();
}
function jumpToRunning() {
  const run = latestRunning();
  if (!run) return;
  if (run.date === P.todayISO()) VIEW = 'today';
  else { VIEW = 'history'; selDate = run.date; }
  buildNav(); renderView();
}
function updatePomoPanel() {
  if (!pomoOpen || !pomoEl || !S) return;
  const run = latestRunning();
  pomoEl.innerHTML = '';
  const closeBtn = h('button', {
    class: 'icon-btn pomo-close', title: '关闭面板（计时不受影响）',
    onclick: (e) => { e.stopPropagation(); togglePomo(false); }
  }, '×');
  if (!run) {
    pomoEl.append(
      h('div', { class: 'pomo-head' }, '番茄钟', closeBtn),
      h('div', { class: 'pomo-empty' }, '未在计时'),
      h('div', { class: 'pomo-meta' }, '到「今日」点任务右侧 ▶ 开始计时')
    );
    return;
  }
  const L = run.log; // 注意：latestRunning 返回 {log, date} 包装，字段在 .log 上
  const task = P.allTasks(S, run.date).find(t => t.slot === L.taskId);
  const title = task ? task.title : (L.moduleId ? modName(L.moduleId) : '未指定任务');
  const startedMs = Date.parse(L.startedAt || '');
  const elapsedSec = startedMs ? Math.max(0, (Date.now() - startedMs) / 1000) : 0;
  const pomoIdx = Math.floor(elapsedSec / (POMO_MIN * 60)) + 1;
  const remainSec = pomoIdx * POMO_MIN * 60 - elapsedSec;
  const progress = Math.min(1, (elapsedSec % (POMO_MIN * 60)) / (POMO_MIN * 60));
  const totalLogged = ((S.records[run.date] || {}).logs || []).filter(l => l.taskId === L.taskId).reduce((s2, l) => s2 + P.logMinutes(l), 0);
  pomoEl.append(
    h('div', { class: 'pomo-head' }, '番茄钟 · 第 ' + pomoIdx + ' 个', closeBtn),
    h('div', { class: 'pomo-task', title }, title),
    h('div', { class: 'pomo-time' }, fmtSec(remainSec)),
    h('div', { class: 'pomo-bar' }, h('i', { style: { width: (progress * 100).toFixed(1) + '%' } })),
    h('div', { class: 'pomo-meta' },
      '本次 ' + fmtMin(elapsedSec / 60) + ' · 已记 ' + fmtMin(totalLogged) +
      (task && task.minutes ? ' / 目标 ' + fmtMin(task.minutes) : '') +
      (run.date !== P.todayISO() ? '（' + run.date + '）' : '')),    h('div', { class: 'pomo-meta muted' }, '达标将自动勾选完成 · 点击面板跳回任务')
  );
}

/* ---------------- 计时器刷新 ---------------- */
function tickTimers() {
  document.querySelectorAll('.running-elapsed').forEach(el => {
    const st = Date.parse(el.dataset.start);
    if (st) el.textContent = fmtMin((Date.now() - st) / 60000);
  });
}

/* ---------------- 启动 ---------------- */
window.addEventListener('error', e => { if (API) API.logError('[js] ' + e.message + ' @' + (e.filename || '') + ':' + e.lineno); });
window.addEventListener('unhandledrejection', e => { if (API) API.logError('[promise] ' + ((e.reason && e.reason.stack) || e.reason)); });

(async function init() {
  API = await ApiBridge.detect();
  if (!API) {
    // 桌面壳内 api 长时间未就绪（异常状态）：给出明确提示，绝不静默切换到浏览器模式
    const m = document.createElement('div');
    m.style.cssText = 'position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:200;text-align:center;line-height:2';
    m.innerHTML = '<div><div style="font-size:17px;font-weight:600;color:var(--ink)">桌面接口加载失败</div><div style="color:var(--ink-2);font-size:13px;margin-top:8px">数据没有丢失（仍在 data/learning_data.json）。<br>请关闭窗口后重新打开；若反复出现，请用源码方式 python main.py 启动。</div></div>';
    document.body.append(m);
    return;
  }
  let raw = null;
  try { raw = await API.loadState(); } catch (e) { API.logError('loadState 失败: ' + e); }
  if (raw) {
    try { S = JSON.parse(raw); } catch (e) {
      API.logError('状态解析失败，已重置种子：' + e.message);
      try { await API.backupCorrupt(); } catch (e2) { /* ignore */ }
      toast('数据文件解析失败，已重新初始化（原文件已留档为 data/learning_data.corrupt-*.json）', true);
      S = null;
    }
  }
  if (!S || !S.stages || !S.modules) {
    S = Seed.buildSeedState(P.todayISO());
    await API.saveState(JSON.stringify(S));
  }
  // 脏数据自愈：模板/轮询结构损坏时回退空白模板（记录数据保留）
  const tplOk = S.weeklyTemplate && S.weeklyTemplate.base && Array.isArray(S.weeklyTemplate.base.daily) && S.weeklyTemplate.base.byWeekday;
  if (!tplOk) { S.weeklyTemplate = Seed.emptyTemplate(); await API.saveState(JSON.stringify(S)); toast('每周模板数据异常，已重置为空模板', true); }
  if (!S.rotationQueues || typeof S.rotationQueues !== 'object' || Array.isArray(S.rotationQueues)) {
    S.rotationQueues = { A: [] }; await API.saveState(JSON.stringify(S));
  }
  if (typeof S.onboarded !== 'boolean') S.onboarded = true; // 旧数据视为已完成引导
  // 跨天计时封存：忘记停止的计时只计到当天 23:59，避免污染次日统计与自动达标
  const cappedDates = P.capStaleRunning(S, P.todayISO());
  if (cappedDates.length) {
    await API.saveState(JSON.stringify(S));
    toast('检测到 ' + cappedDates.length + ' 条跨天未停止的计时，已自动封存至当天 23:59', true);
  }
  buildNav();
  if (!S.onboarded) {
    Onboarding.start(S, save, () => { buildNav(); renderView(); }, P.todayISO());
  }
  renderView();
  setInterval(() => { tickTimers(); autoCheckDone(); }, 5000); // 计时显示刷新 + 达标自动完成检查
  setInterval(updatePomoPanel, 1000);                          // 番茄钟面板每秒走字
})();
