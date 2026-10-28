"""tests_release.py —— 离线发布回归测试：JS 语法 / 前端资源 / 自检全项 / 便携模式。
用法：python tests_release.py  （需 pip install esprima）
"""
import json
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
PASS = FAIL = 0

def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  ✅ {name}')
    else:
        FAIL += 1
        print(f'  ❌ {name} {detail}')

print('== 1. 源码与资源 ==')
import py_compile
for p in ['src/main.py', 'build_release.py']:
    try:
        py_compile.compile(os.path.join(ROOT, p), doraise=True)
        check(f'py_compile {p}', True)
    except Exception as e:
        check(f'py_compile {p}', False, str(e))
for tree in ('src/www', 'www'):
    base = os.path.join(ROOT, tree)
    ok = all(os.path.isfile(os.path.join(base, f)) for f in ('index.html', 'css/style.css',
             'js/api.js', 'js/app.js', 'js/onboarding.js', 'js/planner.js', 'js/seed.js'))
    check(f'{tree} 前端六件套齐全', ok)
check('两份 www 一致', subprocess.run(['diff', '-r', os.path.join(ROOT, 'src/www'), base], capture_output=True).returncode == 0)
check('图标入库', os.path.isfile(os.path.join(ROOT, 'assets/StudyCheckin.ico')))

print('== 2. JS 语法 ==')
import esprima
for f in sorted(os.listdir(os.path.join(ROOT, 'www/js'))):
    if not f.endswith('.js'):
        continue
    try:
        esprima.parseScript(open(os.path.join(ROOT, 'www/js', f), encoding='utf-8').read())
        check(f'JS 语法 {f}', True)
    except Exception as e:
        check(f'JS 语法 {f}', False, str(e))

print('== 3. 引导页关键结构 ==')
ob = open(os.path.join(ROOT, 'www/js/onboarding.js'), encoding='utf-8').read()
for k, label in [("skip", '跳过出口'), ("ob-skip", '跳过按钮样式'), ("STEP_LABELS", '步骤标签'), ("finish()", '完成写盘'), ("confirm(", '跳过确认')]:
    check(f'onboarding {label}', k in ob)
css = open(os.path.join(ROOT, 'www/css/style.css'), encoding='utf-8').read()
for k in ('ob-steps2', 'ob-sdot', 'ob-sline', 'ob-skip', 'linear-gradient'):
    check(f'style.css 含 {k}', k in css)

print('== 4. 源码自检（模拟便携模式）==')
with tempfile.TemporaryDirectory() as td:
    exe = os.path.join(ROOT, 'src', 'main.py')
    env = dict(os.environ, STUDYCHECKIN_SILENT='1')
    r = subprocess.run([sys.executable, exe, '--selfcheck'], cwd=td, capture_output=True, text=True, env=env, timeout=180)
    check('selfcheck 退出码 0', r.returncode == 0, r.stdout[-200:])
    m = re.search(r'(\d+)/(\d+) 项', r.stdout)
    check('自检全项通过', bool(m) and m.group(1) == m.group(2), r.stdout[-200:])

print(f'\n===== 结果: {PASS} 通过 / {FAIL} 失败 =====')
sys.exit(1 if FAIL else 0)
