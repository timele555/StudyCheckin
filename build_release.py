"""build_release.py —— 一键构建发布物（克隆仓库后先 pip install -r requirements.txt pyinstaller）。

产出：
  dist/StudyCheckin.exe    免安装单文件版（带 ICO 图标，双击即用）
  StudyCheckin.exe         仓库根目录同步一份（README 下载点同款）

用法：python build_release.py
"""
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
ICO = os.path.join(ROOT, 'assets', 'StudyCheckin.ico')


def main():
    if not os.path.isfile(ICO):
        sys.exit(f'缺少图标文件: {ICO}')
    shutil.rmtree(os.path.join(ROOT, 'dist'), ignore_errors=True)
    args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--windowed',
            '--icon', ICO, '--name', 'StudyCheckin', '--add-data', os.path.join('src', 'www') + os.pathsep + 'www',
            os.path.join('src', 'main.py')]
    print('>>', ' '.join(args))
    r = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, shell=False)
    if r.returncode != 0:
        print(r.stdout[-2000:])
        print(r.stderr[-2000:])
        sys.exit('构建失败')
    out = os.path.join(ROOT, 'dist', 'StudyCheckin.exe')
    shutil.copy2(out, os.path.join(ROOT, 'StudyCheckin.exe'))
    print(f'\n构建完成：dist/StudyCheckin.exe ({os.path.getsize(out) / 1048576:.1f} MB)，仓库根目录已同步')


if __name__ == '__main__':
    main()
