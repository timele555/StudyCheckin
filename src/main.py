"""学习进度打卡 V2 · 桌面端入口（pywebview + WebView2）\n数据：data/learning_data.json（原子写入，保留上一版 .bak）\n导出：exports/learning_data_YYYYMMDD_HHMMSS.json（供 agent 分析）\n自检：data/selfcheck_report.txt（GUI 设置页或 `StudyCheckin.exe --selfcheck` 生成）\n便携：exe 同目录存在 PORTABLE 标记文件时，数据随程序目录走（整目录拷贝即移植）。\n"""
import json
import os
import shutil
import socket
import sys
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path
import webview
APP_VERSION = '2.2.0'
SINGLE_INSTANCE_PORT = 57311
FROZEN = getattr(sys, 'frozen', False)
BASE = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
ASSETS = Path(getattr(sys, '_MEIPASS', BASE)) / 'www' if FROZEN else BASE / 'www'
PORTABLE = (BASE / 'PORTABLE').exists()
if not FROZEN or PORTABLE:
    APP_DIR = BASE
else:
    APP_DIR = Path(os.environ.get('APPDATA', BASE)) / 'StudyCheckinV2'
DATA_DIR = APP_DIR / 'data'
EXPORT_DIR = APP_DIR / 'exports'
DATA_FILE = DATA_DIR / 'learning_data.json'
LOG_FILE = DATA_DIR / 'ui_errors.log'
SELFCHECK_REPORT = DATA_DIR / 'selfcheck_report.txt'
class Api:
    def __init__(self) -> None:
        self._save_lock = threading.Lock()
        self._export_lock = threading.Lock()
    def _ensure_dirs(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    def load_state(self):
        self._ensure_dirs()
        if not DATA_FILE.exists():
            return
        else:
            try:
                return DATA_FILE.read_text(encoding='utf-8')
            except Exception as e:
                self.log_error(f'load_state: {e}')
                return None
    def save_state(self, state_json: str) -> str:
        self._ensure_dirs()
        tmp = DATA_FILE.with_suffix(f'.json.{os.getpid()}.{threading.get_ident()}.tmp')
        with self._save_lock:
            tmp.write_text(state_json, encoding='utf-8')
            try:
                if DATA_FILE.exists():
                    bak = DATA_FILE.with_suffix('.json.bak')
                    bak.write_text(DATA_FILE.read_text(encoding='utf-8'), encoding='utf-8')
                os.replace(tmp, DATA_FILE)
            finally:
                if tmp.exists():
                    tmp.unlink(missing_ok=True)
        return 'ok'
    def backup_corrupt(self) -> str:
        """状态 JSON 解析失败时，把原文件改名留档，避免被覆盖。"""
        self._ensure_dirs()
        if DATA_FILE.exists():
            ts = time.strftime('%Y%m%d_%H%M%S')
            DATA_FILE.rename(DATA_DIR / f'learning_data.corrupt-{ts}.json')
            return 'ok'
        return 'no-file'
    def save_export(self, export_json: str) -> str:
        self._ensure_dirs()
        with self._export_lock:
            base = time.strftime('learning_data_%Y%m%d_%H%M%S')
            out = EXPORT_DIR / f'{base}.json'
            n = 1
            while out.exists():
                n += 1
                out = EXPORT_DIR / f'{base}-{n}.json'
            out.write_text(export_json, encoding='utf-8')
        return str(out)
    def reveal_data_folder(self) -> str:
        self._ensure_dirs()
        os.startfile(DATA_DIR)
        return 'ok'
    def open_url(self, url: str) -> str:
        webbrowser.open(url)
        return 'ok'
    def log_error(self, message: str) -> str:
        try:
            self._ensure_dirs()
            with open(LOG_FILE, 'a', encoding='utf-8') as f:
                f.write(f"[{datetime.now().isoformat(timespec='seconds')}] {message}\n")
        except Exception:
            pass
        return 'ok'
    def run_selfcheck(self) -> str:
        """前端设置页调用：跑一遍环境自检，返回 JSON 字符串并落盘报告。"""
        return json.dumps(run_checks(), ensure_ascii=False)
def _webview2_version() -> str | None:
    try:
        import winreg
        guids = ['SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}']
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            for path in guids:
                try:
                    with winreg.OpenKey(hive, path) as k:
                        return str(winreg.QueryValueEx(k, 'pv')[0])
                except OSError:
                    continue
    except Exception:
        return None
    return None
def run_checks():
    checks = []
    def add(cid: str, name: str, ok: bool, detail: str, hint: str = '') -> None:
        checks.append({'id': cid, 'name': name, 'ok': bool(ok), 'detail': detail, 'hint': hint})
    mode = '便携模式（数据随程序目录，整目录拷贝即可移植）' if PORTABLE else '源码运行（数据在项目目录）' if not FROZEN else '安装模式（数据在 %APPDATA%\\StudyCheckinV2）'
    add('mode', '运行模式与版本', True, f'v{APP_VERSION} · {mode} · 程序目录 {BASE}')
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        probe = DATA_DIR / '.write_probe'
        probe.write_text('ok', encoding='utf-8')
        probe.unlink(missing_ok=True)
        add('data_dir', '数据目录可写', True, str(DATA_DIR))
        if DATA_FILE.exists():
            try:
                st = json.loads(DATA_FILE.read_text(encoding='utf-8'))
                missing = [k for k in ('version', 'modules', 'stages', 'records') if k not in st]
                if missing:
                    add('state', '状态数据完整', False, str(DATA_FILE) + f"缺少字段：{', '.join(missing)}。可导出备份后在设置页「恢复种子数据」重建。")
                else:
                    add('state', '状态数据完整', True, f"{str(DATA_FILE)}（模块 {len(st.get('modules', []))}，记录 {len(st.get('records', {}))} 天）")
            except Exception as e:
                add('state', '状态数据完整', False, str(DATA_FILE) + f'JSON 解析失败：{e}。原文件会被自动留档为 learning_data.corrupt-*.json。')
        else:
            add('state', '状态数据完整', True, '首次使用，尚无数据文件（首次保存时自动创建）')
        bak = DATA_FILE.with_suffix('.json.bak')
        add('backup', '自动备份', True, f"{bak.name} 存在，最近修改 {datetime.fromtimestamp(bak.stat().st_mtime):%Y-%m-%d %H:%M}" if bak.exists() else '暂无备份（首次保存后每次写入前自动生成 .bak）')
        add('assets', '前端资源', (ASSETS / 'index.html').exists(), str(ASSETS), '' if (ASSETS / 'index.html').exists() else '打包资源缺失，请重新安装或重新解压便携版。')
        wv = _webview2_version()
        add('webview2', 'WebView2 运行时', wv is not None, f'已安装 {wv}' if wv else '未在注册表中检测到', '' if wv else '请安装 Microsoft Edge WebView2 Runtime（https://developer.microsoft.com/microsoft-edge/webview2/）。')
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.bind(('127.0.0.1', SINGLE_INSTANCE_PORT))
            s.close()
            add('port', '单实例端口', True, f'127.0.0.1:{SINGLE_INSTANCE_PORT} 可绑定')
        except OSError:
            add('port', '单实例端口', False, f'127.0.0.1:{SINGLE_INSTANCE_PORT} 被占用', '程序可能已在运行；若确认未运行请重启系统后重试。')
        free_mb = shutil.disk_usage(str(DATA_DIR)).free // 1048576
        add('disk', '磁盘剩余空间', free_mb >= 50, f'{free_mb} MB 可用（数据盘）', '' if free_mb >= 50 else '空间不足 50MB，请清理磁盘。')
        EXPORT_DIR.mkdir(parents=True, exist_ok=True)
        add('exports', '导出目录', True, str(EXPORT_DIR))
    except Exception as e:
        add('data_dir', '数据目录可写', False, str(DATA_DIR) + f'无法创建/写入：{e}。请更换目录权限或以管理员身份运行。')
    write_selfcheck_report(checks)
    return checks
def write_selfcheck_report(checks):
    ok_n = sum((1 for c in checks if c['ok']))
    lines = [f'学习打卡 V2 自检报告 · v{APP_VERSION}', f'生成时间：{datetime.now().isoformat(timespec="seconds")}', f'程序目录：{BASE}', f'数据目录：{DATA_DIR}', f'结果：{ok_n}/{len(checks)} 项通过', '']
    for c in checks:
        mark = '✓' if c['ok'] else '✗'
        lines.append(f"[{mark}] {c['name']}：{c['detail']}")
        if c['hint']:
            lines.append(f"    └ 建议：{c['hint']}")
    try:
        SELFCHECK_REPORT.parent.mkdir(parents=True, exist_ok=True)
        SELFCHECK_REPORT.write_text('\n'.join(lines), encoding='utf-8')
    except Exception:
        pass
    return SELFCHECK_REPORT
def _acquire_single_instance() -> socket.socket | None:
    """单实例锁：绑定本地固定端口，第二个实例启动时立即退出，避免双窗口互踩数据文件。"""
    lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        lock.bind(('127.0.0.1', SINGLE_INSTANCE_PORT))
        lock.listen(0)
        return lock
    except OSError:
        return None
def _selfcheck_cli() -> None:
    """无 GUI 自检：跑检查、弹窗摘要，报告落盘 data/selfcheck_report.txt（支持远程排障）。"""
    checks = run_checks()
    ok_n = sum((1 for c in checks if c['ok']))
    bad = [c for c in checks if not c['ok']]
    lines = [f'自检完成：{ok_n}/{len(checks)} 项通过', '']
    for c in bad:
        lines.append(f"✗ {c['name']}：{c['detail']}")
        if c['hint']:
            lines.append(f"  建议：{c['hint']}")
    lines += ['', f'完整报告：{SELFCHECK_REPORT}']
    msg = '\n'.join(lines) if bad else f'自检完成：{ok_n}/{len(checks)} 项全部通过。\n\n完整报告：{SELFCHECK_REPORT}'
    print(msg)
    if os.environ.get('STUDYCHECKIN_SILENT'):
        return
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, msg, f'学习打卡 v{APP_VERSION} 自检', 64 if not bad else 48)
    except Exception:
        return
def main() -> None:
    if '--selfcheck' in sys.argv:
        _selfcheck_cli()
        return
    debug = '--debug' in sys.argv
    lock = _acquire_single_instance()
    if lock is None:
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, '学习打卡已在运行中，请使用已打开的窗口。', '学习打卡', 64)
        except Exception:
            print('学习进度打卡已在运行中', file=sys.stderr)
        sys.exit(0)
    window = webview.create_window('学习打卡', str(ASSETS / 'index.html'), js_api=Api(), width=1280, height=840, min_size=(1024, 680))
    def _on_closed() -> None:
        time.sleep(1.0)
        os._exit(0)
    window.events.closed += _on_closed
    webview.start(debug=debug)
    os._exit(0)
if __name__ == '__main__':
    main()
