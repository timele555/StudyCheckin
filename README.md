# 学习打卡（StudyCheckin V2）

桌面端学习进度打卡工具：pywebview + WebView2 壳，前端纯 HTML/CSS/JS。

- 数据落盘 `data/learning_data.json`：原子写入，每次保存前自动生成 `.bak` 备份，文件损坏自动留档
- 一键导出 JSON 到 `exports/`
- 内置环境自检：GUI 设置页或 `python src/main.py --selfcheck`
- 单实例锁：重复启动只保留一个窗口
- 便携模式：exe（或项目）同目录放置 `PORTABLE` 空标记文件，数据随程序目录走，整目录拷贝即迁移

## 下载使用（免安装）

仓库根目录附带免安装单文件程序：

- **`StudyCheckin.exe`**（约 12 MB）：双击即用，无需安装 Python。默认数据存于 `%APPDATA%\StudyCheckinV2`
- 在 exe 旁新建名为 `PORTABLE` 的空文件 → 切换便携模式，数据随程序目录走（整文件夹拷贝即迁移）
- 自检：`StudyCheckin.exe --selfcheck`（报告落盘，弹窗摘要）

不想下载整包？源码运行见下节。

## 源码运行

```bash
pip install -r requirements.txt
python src/main.py             # 运行（数据在项目目录 data/）
python src/main.py --selfcheck # 无 GUI 自检
```

前端资源位于 `src/www/`（index.html + css + js），打包时随程序内置。仓库根目录 `www/` 为同步副本，两份一致。

## 从源码构建

```bash
pip install -r requirements.txt pyinstaller
python build_release.py     # 产出 dist/StudyCheckin.exe（带 ICO 图标），并同步到仓库根目录
python tests_release.py     # 发布回归测试（JS 语法 / 资源 / 自检全项），应全部通过
```

新手引导（v2.2.0）：渐变背景 + 步骤条卡片式向导，右上角可随时「跳过引导直接进入」（默认创建「学习」模块）。

## License

MIT
