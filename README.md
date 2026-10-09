<div align="center">

# YouTube 中文同传

看 YouTube，听中文。把视频字幕翻译成中文，再用 Edge 中文声音读出来。

[下载插件](https://github.com/lhl1/youtube-progress-dub/releases/latest) · [使用指南](docs/usage.md) · [反馈问题](https://github.com/lhl1/youtube-progress-dub/issues)

[![CI](https://github.com/lhl1/youtube-progress-dub/actions/workflows/ci.yml/badge.svg)](https://github.com/lhl1/youtube-progress-dub/actions/workflows/ci.yml)
[![MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

适用于电脑端 Microsoft Edge。视频需要有字幕，自动生成的字幕也可以用。

## 三步开始

1. [下载安装包](https://github.com/lhl1/youtube-progress-dub/releases/latest)，选择 ZIP，解压到一个长期保留的文件夹。
2. 在 Edge 地址栏输入 `edge://extensions`，打开“开发人员模式”，点击“加载解压缩的扩展”，选择解压后的文件夹。
3. 刷新 YouTube 页面，点击播放器齿轮旁的白色“中文同传”图标，试听声音即可开始。

选择的文件夹里应直接有 `manifest.json`。第一次没有声音时，点击一下视频中的按钮。

## 用起来是什么样？

| 功能 | 你能得到什么 |
| --- | --- |
| 中文朗读 | 一句读完再读下一句，视频照常播放。来不及读时，中文会稍微落后。 |
| 跟随倍速 | 视频加速，中文朗读也跟着加速。 |
| 原声更轻 | 开启后持续降低原声音量，句子之间不会忽大忽小。 |
| 双语字幕 | 中文和原文一起看，字体、大小、颜色、位置都能调。 |
| 自动开启 | 设置一次，以后打开视频就自动开启同传。 |
| 长视频支持 | 随播放进度继续准备翻译，拖动进度后从新位置开始。 |

默认已设好：完整朗读、晓晓声音、基础语速 1.30 倍、原声上限 25%，同时显示中文和原文。

## 界面预览

常用设置都在播放器里完成。点击图片可查看原图。

| 朗读与音量 | 字幕外观 | 双语与同步 |
| --- | --- | --- |
| [<img src="docs/images/player-settings.png" alt="朗读与音量设置" width="260">](docs/images/player-settings.png) | [<img src="docs/images/subtitle-style.png" alt="字幕外观与实时预览" width="260">](docs/images/subtitle-style.png) | [<img src="docs/images/subtitle-sync.png" alt="双语与字幕同步设置" width="260">](docs/images/subtitle-sync.png) |

## 常见问题

<details>
<summary>中文没声音，怎么办？</summary>

点击播放器里的“中文同传”图标，先“试听声音”，再试“恢复 / 重试”。也可以换一种中文声音，并检查 Edge 和系统是否静音。刚更新插件后，需要刷新视频页面。

</details>

<details>
<summary>会不会把字幕拆得很碎？</summary>

只对 YouTube 自动生成的字幕尝试按意思分段，让长字幕更容易读。人工制作的原生字幕保留原来的每条文字和时间，不合并、不拆分。自动生成字幕可能缺词或缺少标点，分段和翻译仍可能有误差。

</details>

<details>
<summary>字幕和设置会发到哪里？</summary>

设置与翻译缓存保存在本机。需要翻译的字幕会发给 Google，或你自己配置的翻译服务；Edge 在线声音由浏览器提供。详见[隐私说明](docs/privacy.md)。

</details>

---

[更多使用说明](docs/usage.md) · [开发与打包](docs/development.md) · [MIT 许可证](LICENSE) · [第三方组件](THIRD_PARTY_NOTICES.md)
