# SoundCue 用户手册

SoundCue 是一个 Codex 音频审阅插件。它适合播客、访谈、会议录音、配音草稿这类长音频工作流：你在转写文本里像批注文档一样标记问题，复制 edit brief 给 Codex 讨论修改方案，确认后生成新的音频版本。

SoundCue 的核心原则：**永远不覆盖原始音频**。每次确认编辑都会生成新的 `v2`、`v3`、`v4` 文件，原始 `v1` 保持不变。

## 适用场景

- 播客创作者：删掉冗长开头，缩短某段表达，重写口播片段，检查修改前后效果。
- 访谈或会议整理者：快速定位一段发言，添加处理意见，把上下文交给 Codex 继续推理。
- 音频内容运营：把修改请求变成结构化批注和本地版本，避免口头描述丢失。
- 需要本地处理的团队：音频、转写、批注和版本都保存在本机项目目录里。

SoundCue 不是完整 DAW，也不是一键自动发布工具。它的重点是：**选区、批注、brief、审阅、生成派生版本**。

## 安装插件

在 SoundCue 项目目录里先生成本地 marketplace：

```bash
npm install
npm run package:marketplace
```

用 Codex 插件安装流程安装：

```bash
codex plugin marketplace add ./build/soundcue-marketplace
codex plugin add soundcue@soundcue
```

安装后，Codex 会获得 SoundCue 的 skill 和 MCP 工具。你可以在 Codex 对话里说：

```text
打开 SoundCue UI
```

或让 Codex 调用 MCP 工具：

```text
open_soundcue_ui
```

如果你只是本地开发或调试，也可以直接运行：

```bash
npm run dev:local-stt
```

然后打开：

```text
http://127.0.0.1:43231/
```

## 第一次使用：检查 Settings

打开 SoundCue 后，先进入顶部的 `Settings` 标签页。

你会看到四层依赖：

- `Core`：SoundCue UI、项目文件、批注、版本管理。随插件提供。
- `Audio tools`：`ffmpeg` / `ffprobe`，用于音频切片、拼接、导出。真实编辑需要它。
- `Transcript`：本地 Whisper / whisper.cpp，用于转写音频。
- `Voice provider`：OpenVoice，可选，用于生成替换语音。它比较大，不影响基础审阅。

如果某一项显示 `Missing`，点击对应卡片的安装按钮。安装时页面会显示当前阶段、步骤、耗时、日志入口和可取消状态。

常用检查命令：

```bash
npm run stt:check
npm run voice:check
```

OpenVoice 是可选项。只做剪切、删除、整理批注时可以不安装；需要生成新语音时再安装。

## 语言设置

SoundCue 支持 English 和中文。点击右上角语言图标可以快速切换；也可以进入顶部 `Settings`，在 `Language` 区域选择语言。

语言会影响：

- 界面文案
- 默认批注语气
- 复制到 Codex 输入框的编辑说明

中文文案按中文播客创作者的使用习惯表达；英文文案按英文 native speaker 的产品表达编写，不做逐字翻译。

## 项目和数据保存在哪里

每个 Codex 对话对应一个 SoundCue project。默认目录：

```text
audio-patch-projects/<thread-id>/
```

里面包含：

```text
project.json
assets/
transcripts/
annotations/
patches/
versions/
export/
```

用户音频默认不会上传。除非你主动配置外部云端 provider，否则内置流程都在本地运行。

## 完整用户旅程

### 1. 打开 SoundCue

在 Codex 里让插件打开 UI：

```text
打开 SoundCue UI
```

如果 UI 没有自动出现，确认 MCP 工具 `open_soundcue_ui` 是否可用，或者手动运行：

```bash
node scripts/start-ui.mjs
```

### 2. 导入音频

点击左上角 `Import audio`，选择本地音频文件。

支持常见浏览器可读音频格式，例如：

- `mp3`
- `wav`
- `m4a`

导入后，SoundCue 会创建当前项目的一个新版本，例如 `v1`。

### 3. 转写音频

如果已配置本地 STT，导入后会自动转写。

如果没有自动转写，点击顶部 `Transcribe`。

转写成功后，左侧 `Transcript Review` 区域会显示竖向文本段落。文本像文档一样垂直滚动，点击任意段落会联动底部播放器和波形。

如果转写失败，进入 `Settings` 查看 `Transcript` 状态和日志。常见原因：

- 没有安装 `whisper-cli`
- Whisper 模型缺失
- `AUDIO_PATCH_STT_COMMAND` 配置不正确

### 4. 选择一段文本或音频

在 `转写审阅` 里点击一个片段。右侧 `编辑批注` 抽屉会显示选中范围和文本。

底部播放器会显示当前时间、总时长、选区范围和波形。播放时，时间戳和 transcript 会跟随音频更新。

### 5. 添加批注

在右侧选择意图：

- `缩短`：缩短表达
- `删除`：删除片段
- `改写`：重写文本
- `重配音`：重新配音
- `保留`：保留但做标记
- `问题`：指出问题，不直接修改

在 `批注说明` 写清楚你的要求，例如：

```text
把这一段缩短一些，语气更平稳。
```

点击 `保存批注` 保存批注。

### 6. 准备 edit brief

点击 `生成编辑说明` 或 `更新编辑说明`。

SoundCue 会把当前音频路径、转写路径、选中时间范围、意图、备注和选中文本组织成结构化 brief。

然后点击 `复制说明`，把它复制到 Codex composer。

重要：brief 只是上下文，不是授权 Codex 自动改文件。默认 brief 会明确写：

```text
Use this as context only. Do not modify audio files or project files unless I explicitly ask in the composer.
```

### 7. 和 Codex 讨论修改方案

把 brief 粘贴到 Codex composer 后，先让 Codex 分析修改方案。例如：

```text
先帮我推理这个修改。不要直接改音频，先给出精确 edit plan。
```

你确认方案后，再明确授权：

```text
认可，生成一个新文件。
```

这样可以避免插件或 Codex 在你没确认时直接生成新版本。

### 8. 审阅建议修改

当有 suggested edit 后，切换到顶部 `建议修改`。

这里会显示类似 merge request 的审阅视图：

- 修改摘要
- 原版本播放器
- 候选版本播放器
- 候选文本

你可以分别播放原片段和候选片段，确认听感、语义和节奏。

### 9. 创建新版本

如果你接受候选修改，点击 `生成新版本`。

SoundCue 会创建新的派生音频版本，例如：

```text
v1 -> v2
```

原始 `v1` 不会被覆盖。项目当前版本会移动到 `v2`。

### 10. 打开本地文件夹

点击右上角文件夹按钮，或让 Codex 调用：

```text
open_audio_patch_folder
```

你可以查看：

- 原始音频版本
- 新生成版本
- transcript JSON
- annotations
- patches
- export 文件

## 多版本工作流

SoundCue 使用线性版本：

```text
v1 -> v2 -> v3 -> v4
```

它不做 Git 风格分支，也不覆盖历史版本。

建议做法：

- 每次只处理一个明确选区。
- 每次确认后生成一个新版本。
- 如果听感不满意，基于当前版本继续批注并生成下一个版本。
- 用 `建议修改` 的对比播放器检查版本差异。

## OpenVoice 使用说明

OpenVoice 是内置的可选本地 voice provider。它用于生成替换语音，适合 `Rewrite`、`Revoice` 或需要新口播的 `Shorten`。

安装：

```bash
npm run voice:setup -- --install
```

检查：

```bash
npm run voice:check
```

启用：

```bash
npm run dev:openvoice
```

或设置：

```bash
AUDIO_PATCH_VOICE_PROVIDER=openvoice
```

注意：

- OpenVoice 安装较大，可能需要几分钟。
- 当前开源 voice cloning 效果不一定能完全匹配专业商业 TTS。
- 对音质要求高的场景，优先使用保留源音频、剪切、删除、缩短这类质量保持型编辑。

## 常见问题

### Import audio 后没有 transcript

点击 `Transcribe`。如果仍失败，进入 `Settings` 查看 `Transcript`。

可运行：

```bash
npm run stt:check
```

### Transcribe 失败

检查：

- `whisper-cli` 是否安装
- Whisper 模型是否存在
- `AUDIO_PATCH_STT_COMMAND` 是否指向可执行脚本

macOS 推荐：

```bash
brew install whisper-cpp
npm run stt:setup
```

### 生成的新语音不像原声音色

这是 OpenVoice 或自定义 voice provider 的质量限制。可以改用：

- 删除或缩短源音频片段
- 保留原声，只做剪切拼接
- 使用外部高质量 voice provider，并通过 `AUDIO_PATCH_VOICE_COMMAND` 接入

### 点击生成新版本后会不会修改原音频

不会。SoundCue 的产品原则是原始版本 immutable。`生成新版本` 只会创建新的派生音频文件。

### 怎么确认插件是否可交付

日常迭代先跑快速冒烟测试：

```bash
npm run test:smoke
```

它会验证 MCP 的 edit plan schema、UI server、approved plan 生成 suggested edit、新版本创建，以及原音频 hash 不变。

正式交付前运行完整校验：

```bash
npm run verify:deliverable
```

它会验证：

- plugin manifest
- MCP tools
- Settings 里的 Runtime 状态
- Codex marketplace 安装
- 打包后的 MCP tools
- 打包后的 UI server
- 完整音频旅程
- `v1` hash 不变，`v2` hash 变化

## 建议工作方式

- 用短选区做小步修改，不要一次批注整段长音频。
- brief 粘贴给 Codex 后，先要求 edit plan，再授权生成文件。
- 生成后一定用 `建议修改` 播放对比。
- 如果 OpenVoice 听感不理想，把它当 optional provider，不要阻塞基础工作流。
- 定期打开 project folder，确认本地文件和版本符合预期。
