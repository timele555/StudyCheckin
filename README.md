# 学习打卡（StudyCheckin V2）

桌面端学习进度打卡工具：pywebview + WebView2 壳，前端纯 HTML/CSS/JS。

- 数据落盘 `data/learning_data.json`：原子写入，每次保存前自动生成 `.bak` 备份，文件损坏自动留档
- 一键导出 JSON 到 `exports/`
- 内置环境自检：GUI 设置页或 `python src/main.py --selfcheck`
- 单实例锁：重复启动只保留一个窗口
- 便携模式：exe（或项目）同目录放置 `PORTABLE` 空标记文件，数据随程序目录走，整目录拷贝即迁移

## 快速开始

```bash
pip install -r requirements.txt
python src/main.py             # 运行（数据在项目目录 data/）
python src/main.py --selfcheck # 无 GUI 自检
```

前端资源位于 `www/`（index.html + css + js）。

## License

MIT
