# 我的论文库

个人论文 PDF 收藏，从本地文件夹 `C:\Users\Administrator\Desktop\论文库` 自动同步到这里。

在线地址：https://github.com/Bin9chn/paper-library

## 存放方式

- PDF 直接放在仓库根目录，按论文标题命名
- 有子主题时可以用文件夹分类，同步脚本会原样带上目录结构

## 同步

自动：每天 22:00 检查一次文件夹，有新文件或改动就自动提交并推送。

手动：

- 双击桌面的 `sync-papers.cmd`，或在文件夹里执行 `bash sync.sh`
- 运行结果会追加到同目录的 `sync.log`

## 说明

本机 `github.com:443` 直连不通，所以 `sync.sh` 不用 `git push`，而是调用同目录的
`push-api.mjs`，通过 `api.github.com` 的 Git Data API 上传变化过的文件。
