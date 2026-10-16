/* ============================================================
 * Planner —— 纯逻辑层（不碰 DOM / 不碰存储）
 *  · 阶段判定（按日期自动）
 *  · 「今日任务」生成：每日固定 + 星期模板 + 轮询槽（确定性轮转）
 *  · 达成率（简单/加权）、连续打卡、导出用汇总
 * 设计原则：任何落下的进度不补——任务按日期生成，不跨日顺延。
 * ============================================================ */
(function (root) {
  'use strict';

  // ---------- 日期工具（全部用本地时区，避免 UTC 偏移问题） ----------
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function iso(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function fromISO(s) { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function todayISO() { return iso(new Date()); }
  function addDays(d, n) { const x = new Date(d.getTime()); x.setDate(x.getDate() + n); return x; }
  function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function diffMinutes(h1, h2) { // 'HH:MM' -> 分钟差（h2<=h1 视为跨午夜）
    const a = h1.split(':').map(Number), b = h2.split(':').map(Number);
    let m = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
    if (m < 0) m += 24 * 60;
    return m;
  }

  // ---------- 阶段 ----------
  function sortedStages(state) {
    return [...state.stages].sort((a, b) => (a.start < b.start ? -1 : 1));
  }
  function getStage(state, dateISO) {
    const stages = sortedStages(state);
    let cur = stages[0], upcoming = false, ended = false;
    if (dateISO < stages[0].start) { upcoming = true; }
    else {
      for (const s of stages) if (s.start <= dateISO) cur = s;
      const last = stages[stages.length - 1];
      if (dateISO > last.end) { cur = last; ended = true; }
    }
    return Object.assign({}, cur, { upcoming, ended });
  }
  function weightOf(state, moduleId, stageId) {
    const m = state.modules.find(x => x.id === moduleId);
    if (!m) return 0;
    const w = Number(m.weights[stageId]) || 0;
    return Math.max(0, Math.min(100, w)); // 越界权重（负数/超 100）钳制
  }

  // ---------- 目录（按权重排序） ----------
  function modulesForStage(state, stageId) {
    return state.modules
      .map(m => Object.assign({}, m, { weight: m.weights[stageId] || 0 }))
      .sort((a, b) => (b.weight - a.weight) || (a.order - b.order));
  }

  // ---------- 轮询槽（确定性：不依赖可变状态，轮转序号 = 阶段开始日以来第几个「出场日」） ----------
  // 出场日 = 模板 byWeekday 中放置了 kind:"rotation" 槽的星期（设置页「任务轮询」卡片勾选的星期）。
  // 兼容旧数据：旧版硬编码周二/四，其模板里轮询槽恰好就在 2/4 上，推导结果一致。
  function rotationDaysOf(state, stageId) {
    const bw = (templateFor(state, stageId).byWeekday) || {};
    const days = new Set();
    for (const k of Object.keys(bw)) {
      const arr = bw[k];
      if (Array.isArray(arr) && arr.some(t => t && t.kind === 'rotation')) days.add(Number(k));
    }
    return days;
  }
  function rotationSessionNo(state, stageId, dateISO) {
    const st = state.stages.find(s => s.id === stageId);
    if (!st) return 1;
    const rdays = rotationDaysOf(state, stageId);
    if (!rdays.size) return 1;
    let n = 0;
    let d = fromISO(st.start);
    const end = fromISO(dateISO);
    while (d <= end && n < 3000) { if (rdays.has(d.getDay())) n++; d = addDays(d, 1); }
    return Math.max(1, n);
  }
  // 某天轮询出场的是队列里哪一项（供设置页预览与测试；不出场返回 null）
  function rotationItemFor(state, stageId, dateISO) {
    const q = (state.rotationQueues || {})[stageId] || [];
    if (!q.length || !rotationDaysOf(state, stageId).has(fromISO(dateISO).getDay())) return null;
    const n = rotationSessionNo(state, stageId, dateISO);
    const idx = (n - 1) % q.length;
    return { index: idx, item: q[idx] };
  }

  // ---------- 今日任务生成 ----------
  function isValidTpl(t) {
    return !!(t && typeof t === 'object' && !Array.isArray(t) &&
      Array.isArray(t.daily) && t.byWeekday && typeof t.byWeekday === 'object' && !Array.isArray(t.byWeekday));
  }
  function templateFor(state, stageId) {
    const t = state.weeklyTemplate || {};
    const o = t.overrides && t.overrides[stageId];
    if (isValidTpl(o)) return o;
    if (isValidTpl(t.base)) return t.base; // 覆盖模板畸形时回退基础模板
    return { daily: [], byWeekday: {} };   // 彻底畸形时返回空模板，绝不抛错
  }
  function slotOf(t) {
    return { slot: t.slot, title: t.title, moduleId: t.moduleId || null, minutes: t.minutes || 0, kind: t.kind || 'template' };
  }
  // 生成某天计划（纯函数）。moduleId 在当前阶段权重为 0（冻结）的任务不生成。
  function generateDayPlan(state, dateISO) {
    const d = fromISO(dateISO);
    const stage = getStage(state, dateISO);
    const tpl = templateFor(state, stage.id);
    const tasks = [];
    const push = t => { if (!tasks.some(x => x.slot === t.slot)) tasks.push(t); };
    for (const t of (tpl.daily || [])) {
      if (t.moduleId && weightOf(state, t.moduleId, stage.id) === 0) continue;
      push(slotOf(t));
    }
    for (const t of ((tpl.byWeekday || {})[d.getDay()] || [])) {
      if (t.kind === 'rotation') {
        const q = (state.rotationQueues || {})[stage.id] || [];
        if (!q.length) continue;
        const n = rotationSessionNo(state, stage.id, dateISO);
        const item = q[(n - 1) % q.length];
        if (item.moduleId && weightOf(state, item.moduleId, stage.id) === 0) continue;
        // 目标时长：优先队列项自带 minutes，其次槽上的 minutes，最后 60
        const minutes = item.minutes != null ? Number(item.minutes) || 0 : (t.minutes != null ? Number(t.minutes) || 0 : 60);
        push({ slot: 'rot-' + n, title: item.label || t.title || '轮询任务', moduleId: item.moduleId || null, minutes, kind: 'rotation' });
      } else {
        if (t.moduleId && weightOf(state, t.moduleId, stage.id) === 0) continue;
        push(slotOf(t));
      }
    }
    return { date: dateISO, stageId: stage.id, upcoming: stage.upcoming, ended: stage.ended, tasks };
  }

  // ---------- 记录读写 ----------
  function ensureRecord(state, dateISO) {
    if (!state.records[dateISO]) state.records[dateISO] = { done: {}, extras: [], logs: [], note: '' };
    const r = state.records[dateISO];
    if (!r.done) r.done = {};
    if (!r.extras) r.extras = [];
    if (!r.logs) r.logs = [];
    if (typeof r.note !== 'string') r.note = '';
    return r;
  }
  function planOf(state, dateISO) { // 计划快照：首次访问该日期时生成并持久化（此后改计划不影响历史）
    const r = ensureRecord(state, dateISO);
    if (!r.plan) {
      r.plan = generateDayPlan(state, dateISO);
      r.planGeneratedAt = new Date().toISOString();
    }
    return r.plan;
  }
  function allTasks(state, dateISO, preview) { // 计划任务 + 当天手动添加的临时任务；preview=true 时不落盘
    const r = state.records[dateISO];
    let planTasks;
    if (preview) {
      planTasks = (r && r.plan && r.plan.tasks) ? r.plan.tasks : generateDayPlan(state, dateISO).tasks;
    } else {
      planTasks = planOf(state, dateISO).tasks;
    }
    const list = planTasks.map(t => Object.assign({ type: 'plan' }, t));
    for (const x of ((r && r.extras) || [])) list.push(Object.assign({ type: 'extra', slot: x.id }, x));
    return list;
  }

  // ---------- 统计 ----------
  function logMinutes(l, nowMs) {
    if (l.end) return diffMinutes(l.start, l.end);
    if (l.startedAt) return Math.max(0, Math.round(((nowMs || Date.now()) - new Date(l.startedAt).getTime()) / 60000));
    return 0;
  }
  function dayStats(state, dateISO, nowMs, preview) {
    const stage = getStage(state, dateISO);
    const r = state.records[dateISO] || {};
    const done = r.done || {};
    let total = 0, doneN = 0, wAll = 0, wDone = 0;
    for (const t of allTasks(state, dateISO, preview)) {
      total++;
      const w = t.moduleId ? weightOf(state, t.moduleId, stage.id) : 0;
      wAll += w;
      if (done[t.slot] || done[t.id]) { doneN++; wDone += w; }
    }
    let minutes = 0;
    for (const l of (r.logs || [])) minutes += logMinutes(l, nowMs);
    return { total, done: doneN, rate: total ? doneN / total : 0, weightedRate: wAll ? wDone / wAll : 0, minutes };
  }
  function streak(state, todayISO) {
    let d = fromISO(todayISO), count = 0;
    for (let i = 0; i < 730; i++) {
      const s = dayStats(state, iso(d), undefined, true);
      if (s.done > 0) count++;
      else if (i !== 0) break; // 今天还没打卡不扣连击，从昨天继续数
      d = addDays(d, -1);
    }
    return count;
  }

  // ---------- 跨天计时封存（忘记停止的计时只计到当天 23:59，避免污染次日统计） ----------
  function capStaleRunning(state, todayISO) {
    const capped = [];
    for (const dateISO of Object.keys(state.records)) {
      if (dateISO >= todayISO) continue;
      const r = state.records[dateISO] || {};
      for (const l of (r.logs || [])) {
        if (!l.end) { l.end = '23:59'; capped.push(dateISO); }
      }
    }
    return capped;
  }

  // ---------- 导出汇总（给 agent 分析用） ----------
  function _loggedBySlot(r) {
    const m = {};
    for (const l of (r.logs || [])) {
      const k = l.taskId || '_';
      m[k] = (m[k] || 0) + logMinutes(l);
    }
    return m;
  }
  function buildSummary(state, todayISO) {
    const perModule = {};
    for (const m of state.modules) perModule[m.id] = { name: m.name, minutes: 0 };
    const days = [];
    const from = fromISO(todayISO);
    const win = n => { const d0 = addDays(from, -(n - 1)); return [iso(d0), todayISO]; };
    for (const dateISO of Object.keys(state.records).sort()) {
      const r = state.records[dateISO] || {};
      const st = dayStats(state, dateISO, undefined, true);
      for (const l of (r.logs || [])) {
        const key = l.moduleId && perModule[l.moduleId] ? l.moduleId : '_other';
        if (!perModule[key]) perModule[key] = { name: '未分类', minutes: 0 };
        perModule[key].minutes += logMinutes(l);
      }
      if (r.plan || r.logs || r.note) {
        const loggedBy = _loggedBySlot(r);
        const done = r.done || {};
        // 任务级明细：标题/模块/目标/实际分钟/是否完成（临时任务标 type:"extra"）
        const tasks = allTasks(state, dateISO, true).map(t => ({
          title: t.title,
          module: t.moduleId ? (state.modules.find(m => m.id === t.moduleId) || { name: '未分类' }).name : '未分类',
          goal: t.minutes || 0,
          logged: loggedBy[t.slot] || 0,
          done: !!(done[t.slot] || done[t.id]),
          type: t.kind === 'rotation' ? 'rotation' : (t.type || 'plan')
        }));
        days.push({
          date: dateISO, stage: (r.plan && r.plan.stageId) || getStage(state, dateISO).id,
          rate: +st.rate.toFixed(4), weightedRate: +st.weightedRate.toFixed(4),
          done: st.done, total: st.total, minutes: st.minutes,
          note: r.note || '', tasks
        });
      }
    }
    // 整体概览 + 7/30 天窗口（rate 只统计有任务的日子，避免笔记日稀释）
    const withTasks = days.filter(d => d.total > 0);
    const sum = (arr, f) => arr.reduce((s, d) => s + f(d), 0);
    const winStat = n => {
      const [a, b] = win(n);
      const ds = days.filter(d => d.date >= a && d.date <= b);
      const dsT = ds.filter(d => d.total > 0);
      return {
        days: ds.length, activeDays: ds.filter(d => d.minutes > 0 || d.done > 0).length,
        minutes: sum(ds, d => d.minutes),
        doneRate: dsT.length ? +(sum(dsT, d => d.rate) / dsT.length).toFixed(4) : null
      };
    };
    let topModule = null;
    for (const v of Object.values(perModule)) {
      if (v.minutes > 0 && (!topModule || v.minutes > topModule.minutes)) topModule = { name: v.name, minutes: v.minutes };
    }
    const overview = {
      today: todayISO,
      streakDays: streak(state, todayISO),
      daysTracked: days.length,
      activeDays: days.filter(d => d.done > 0 || d.minutes > 0).length,
      firstDate: days.length ? days[0].date : null,
      lastActiveDate: days.length ? days[days.length - 1].date : null,
      totalMinutes: sum(days, d => d.minutes),
      avgMinutesPerActiveDay: 0,
      overallDoneRate: withTasks.length ? +(sum(withTasks, d => d.rate) / withTasks.length).toFixed(4) : null,
      last7: winStat(7), last30: winStat(30),
      topModule
    };
    const activeMin = days.filter(d => d.minutes > 0);
    overview.avgMinutesPerActiveDay = activeMin.length ? Math.round(sum(activeMin, d => d.minutes) / activeMin.length) : 0;
    return {
      about: {
        app: '学习打卡 V2', schemaVersion: 2,
        note: 'rate=完成数/计划任务数；minutes 为实际学习分钟（日志累计）；tasks[].logged 为该任务当日实际分钟；perModuleMinutes 按日志归属模块累计。'
      },
      generatedAt: new Date().toISOString(), today: todayISO,
      streakDays: overview.streakDays, // 顶层冗余一份（兼容旧导出结构）
      overview, days, perModuleMinutes: perModule
    };
  }
  // 纯文本分析摘要（剪贴板一键复制，直接可读/可粘贴给 agent）
  function buildAnalysisText(state, todayISO) {
    const s = buildSummary(state, todayISO);
    const o = s.overview;
    const L = [];
    L.push('# 学习数据分析摘要（' + todayISO + ' 生成）');
    L.push('');
    L.push('- 连续打卡：' + o.streakDays + ' 天；记录范围：' + (o.firstDate || '无') + ' ~ ' + (o.lastActiveDate || '无') + '（' + o.daysTracked + ' 天有记录）');
    L.push('- 累计学习 ' + o.totalMinutes + ' 分钟；有学习行为的日均 ' + o.avgMinutesPerActiveDay + ' 分钟');
    L.push('- 总体平均达成率：' + (o.overallDoneRate == null ? '暂无' : Math.round(o.overallDoneRate * 100) + '%'));
    L.push('- 近 7 天：学习 ' + o.last7.minutes + ' 分钟 / 活跃 ' + o.last7.activeDays + ' 天 / 达成率 ' + (o.last7.doneRate == null ? '—' : Math.round(o.last7.doneRate * 100) + '%'));
    L.push('- 近 30 天：学习 ' + o.last30.minutes + ' 分钟 / 活跃 ' + o.last30.activeDays + ' 天 / 达成率 ' + (o.last30.doneRate == null ? '—' : Math.round(o.last30.doneRate * 100) + '%'));
    const mods = Object.values(s.perModuleMinutes).filter(v => v.minutes > 0).sort((a, b) => b.minutes - a.minutes);
    if (mods.length) {
      const tot = mods.reduce((x, v) => x + v.minutes, 0);
      L.push('- 模块分布：' + mods.map(v => v.name + ' ' + v.minutes + 'min(' + Math.round(v.minutes / tot * 100) + '%)').join('、'));
    }
    const recent = s.days.slice(-5).reverse();
    if (recent.length) {
      L.push('');
      L.push('## 最近记录');
      for (const d of recent) {
        L.push('- ' + d.date + '：完成 ' + d.done + '/' + d.total + ' · ' + d.minutes + 'min' + (d.note ? ' · 笔记：' + d.note.slice(0, 60) : ''));
      }
    }
    return L.join('\n');
  }

  const api = {
    pad2, iso, fromISO, todayISO, addDays, hm, diffMinutes,
    sortedStages, getStage, weightOf, modulesForStage,
    rotationDaysOf, rotationSessionNo, rotationItemFor,
    templateFor, generateDayPlan, ensureRecord, planOf, allTasks,
    logMinutes, dayStats, streak, capStaleRunning, buildSummary, buildAnalysisText
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Planner = api;
})(typeof self !== 'undefined' ? self : this);
