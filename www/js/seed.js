/* ============================================================
 * V2 通用版种子数据 —— 不预置任何个人计划内容
 * 首次打开进入新手引导，由用户创建自己的模块与任务；
 * 也提供常见场景预设（考研/语言/编程/极简）一键填充。
 * ============================================================ */
(function (root) {
  'use strict';

  // 单一通用阶段（V2 无阶段化权重概念，权重仅用于目录排序与加权达成率）
  const STAGES = [
    { id: 'A', name: '日常', short: '', start: '2026-01-01', end: '2099-12-31' }
  ];

  function emptyTemplate() {
    const byWeekday = {};
    for (let i = 0; i <= 6; i++) byWeekday[i] = [];
    return {
      base: { daily: [], byWeekday },
      overrides: {}
    };
  }

  // 模块工厂（id 自动生成，默认排序权重 10）
  function mod(name, order, weight) {
    const id = 'm' + order + '_' + Date.now().toString(36) + Math.floor(Math.random() * 99);
    return { id, name, order, weights: { A: weight == null ? 10 : weight }, stageNotes: {} };
  }

  // 预设方案：新手引导一键填充
  const PRESETS = {
    kaoyan: {
      label: '考研备考',
      modules: ['数学', '英语', '政治', '专业课'],
      tasks: [
        { title: '背单词', moduleId: 1, minutes: 30 },
        { title: '真题/刷题', moduleId: 0, minutes: 120 }
      ]
    },
    lang: {
      label: '语言学习',
      modules: ['听力', '口语', '词汇', '阅读'],
      tasks: [
        { title: '精听练习', moduleId: 0, minutes: 30 },
        { title: '背单词', moduleId: 2, minutes: 20 }
      ]
    },
    code: {
      label: '编程 / 技能',
      modules: ['教程学习', '项目实操', '算法练习'],
      tasks: [
        { title: '看教程/文档', moduleId: 0, minutes: 45 },
        { title: '刷题', moduleId: 2, minutes: 30 }
      ]
    },
    minimal: {
      label: '极简（一个模块）',
      modules: ['学习'],
      tasks: [{ title: '专注学习（一个番茄）', moduleId: 0, minutes: 25 }]
    },
    blank: { label: '完全空白（我自己添加）', modules: [], tasks: [] }
  };

  // 由预设生成完整状态（onboarding 调用；也可用于演示/测试）
  function buildPresetState(presetKey, todayISO) {
    const p = PRESETS[presetKey] || PRESETS.minimal;
    const modules = p.modules.map((name, i) => mod(name, i + 1));
    const tpl = emptyTemplate();
    for (const t of p.tasks) {
      const m = modules[t.moduleId];
      tpl.base.daily.push({ slot: 'p' + t.title, title: t.title, moduleId: m ? m.id : null, minutes: t.minutes });
    }
    return {
      version: 2,
      onboarded: true,
      preset: presetKey,
      planDoc: null,
      stages: STAGES.map(s => Object.assign({}, s)),
      modules,
      rotationQueues: { A: [] },
      weeklyTemplate: tpl,
      resources: [],
      records: {}
    };
  }

  // 首次打开的空白状态（onboarded=false → 启动新手引导）
  function buildSeedState(todayISO) {
    return {
      version: 2,
      onboarded: false,
      preset: null,
      planDoc: null,
      stages: STAGES.map(s => Object.assign({}, s)),
      modules: [],
      rotationQueues: { A: [] },
      weeklyTemplate: emptyTemplate(),
      resources: [],
      records: {}
    };
  }

  const api = { buildSeedState, buildPresetState, emptyTemplate, mod, PRESETS, STAGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Seed = api;
})(typeof self !== 'undefined' ? self : this);
