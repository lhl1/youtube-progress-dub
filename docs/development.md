# 开发与打包

[返回首页](../README.md)

使用 Node.js 24 和 Python 3。从仓库根目录执行：

```sh
npm ci
npm run build:syntax
npm test
```

单元测试覆盖字幕分类、原生条目边界、ASR 分句、字幕分页、朗读队列、暂停恢复、倍速与音量等行为。`npm test` 不访问 YouTube。

浏览器集成检查使用 Playwright 和 Windows 桌面版 Edge，具体入口在 `package.json`，例如 `npm run test:native-boundaries`。部分检查使用本地模拟视频页面、静音朗读或真实 Edge 声音，需要已安装 Edge 和相应中文声音；并非所有平台都可直接运行。

```sh
npm run backup
npm run pack
```

修改或打包前先运行备份，确认 SHA-256 校验成功。安装包输出到 `dist/`，不要覆盖需要保留的旧版本。

首次自行签名会在 `tools/local-signing-key.pem` 生成私钥，并将公钥写入扩展清单；私钥已被 `.gitignore` 排除。自行生成新密钥会得到不同的扩展 ID，不具备原发布者的更新身份。发布者可通过环境变量 `DUB_SIGNING_KEY` 指定仓库外的现有私钥路径；请妥善离线备份私钥，绝不上传。

## 项目结构

- `YouTube中文同传/`：可直接加载的扩展，包含离线英语词性模型与第三方许可证。
- `tests/`：单元测试、浏览器集成测试与本地测试页面。
- `tools/`：备份、模型构建、签名、打包和验证工具。
- `.github/workflows/ci.yml`：构建与单元测试持续集成。

欢迎通过 [Issues](https://github.com/lhl1/youtube-progress-dub/issues) 报告问题。请提供浏览器版本、扩展版本、字幕类型、播放倍速与复现步骤；日志中先移除密钥与个人信息。

## 字幕处理规则

只有明确标记为自动生成（ASR）的字幕才进行语义分段与显示分页。人工／原生字幕保留原条目的文字和时间边界，不跨条合并、不拆分；翻译不改变字幕类型，未知类型同样保留原条目。

英语 ASR 结合本地 wink-nlp 词性分析和规则寻找语义边界。字幕显示分页不生成新的翻译请求，不截断朗读或清空队列。中文分页结合标点、`Intl.Segmenter` 词语边界和软长度预算；双语只使用可信句段对应，缺少对应时显示完整源文。原文缺词、口误或无标点时，规则仍有识别限制。

完整朗读不主动调用视频暂停／播放，基础倍率乘以视频倍速；调整速度保留队列。从长视频调度到朗读恢复的检查入口见 `package.json`。

## 文档

- [使用指南](usage.md)
- [隐私说明](privacy.md)
- [第三方组件与许可证](../THIRD_PARTY_NOTICES.md)

## 自动字幕改进的复现

[1.7.0 研究与改进说明](asr-segmentation-v1.7.0.md)记录设计依据、旧版失败样例、中文页面示例与验证边界。

```sh
node tools/evaluate-asr.cjs
```

默认仅检查公开样例的分段和完整性，不访问翻译服务。加 `--live` 可观察真实 Google 翻译；Windows 上加 `--edge` 使用已安装 Edge 的网络环境。`--baseline <旧版core.js>` 可做前后边界对比。工具输出到 `dist/asr-redesign-report.json`；结果是观察记录，不是自动质量分数。
