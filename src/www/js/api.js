/* ============================================================
 * ApiBridge —— 前后端桥接
 *  · 桌面模式：window.pywebview.api（Python 端持久化到 data/learning_data.json）
 *  · 浏览器模式（调试/预览）：localStorage 兜底，导出走浏览器下载
 * ============================================================ */
(function () {
  'use strict';
  const LS_KEY = 'studycheckin_state_v1';

  async function detect() {
    // pywebview 会在页面脚本运行前注入 window.pywebview（桌面壳内必然存在）。
    // · 存在但 api 未就绪 → 等待 pywebviewloaded / 轮询，最长 15s，绝不静默降级；
    // · 不存在 → 只留 1.5s 观察窗（防注入时序），之后按浏览器预览模式运行。
    const t0 = Date.now();
    const hasBridge = () => !!(window.pywebview && window.pywebview.api);
    const grace = 1500, hardMax = 15000;
    while (!hasBridge()) {
      const elapsed = Date.now() - t0;
      if (!window.pywebview && elapsed > grace) break;          // 普通浏览器：快速降级
      if (window.pywebview && elapsed > hardMax) break;         // 桌面壳：api 迟迟未就绪
      await new Promise(r => setTimeout(r, 80));
    }
    if (hasBridge()) {
      const p = window.pywebview.api;
      return {
        mode: 'desktop',
        loadState: () => p.load_state(),
        saveState: json => p.save_state(json),
        saveExport: json => p.save_export(json),
        backupCorrupt: () => p.backup_corrupt(),
        revealData: () => p.reveal_data_folder(),
        openUrl: url => p.open_url(url),
        runSelfcheck: typeof p.run_selfcheck === 'function' ? () => p.run_selfcheck() : null,
        logError: msg => { try { return p.log_error(String(msg)); } catch (e) { /* ignore */ } }
      };
    }
    if (window.pywebview && !hasBridge()) {
      // 明确在桌面壳里但 api 迟迟未就绪：返回 null 让上层给出明确提示，绝不静默降级
      console.error('pywebview 环境但 api 未就绪（等待 15s 超时）');
      return null;
    }
    return {
      mode: 'browser',
      loadState: async () => localStorage.getItem(LS_KEY),
      saveState: async json => { localStorage.setItem(LS_KEY, json); return 'ok'; },
      backupCorrupt: async () => { localStorage.removeItem(LS_KEY); return 'ok'; },
      saveExport: async json => {
        const blob = new Blob([json], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'learning_data_export.json';
        a.click();
        return 'downloaded';
      },
      revealData: async () => toast('浏览器预览模式：数据保存在 localStorage', true),
      openUrl: async url => window.open(url, '_blank'),
      logError: async m => console.error(m)
    };
  }

  function toast(msg, isErr) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = ''; }, 2600);
  }

  window.ApiBridge = { detect, toast };
})();
