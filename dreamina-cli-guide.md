# 即梦 (Dreamina) CLI 完整使用指南

> **版本**: `46b5b0e-dirty` (build: 2026-06-03T19:39:25Z)
> **CLI 路径**: `~/.local/bin/dreamina`

---

## 目录

1. [快速入门](#快速入门)
2. [账户命令](#账户命令)
3. [图片生成](#图片生成)
4. [视频生成](#视频生成)
5. [图片放大](#图片放大)
6. [任务管理](#任务管理)
7. [会话管理](#会话管理)
8. [参数速查表](#参数速查表)
9. [常见问题](#常见问题)

---

## 快速入门

### 安装与登录

```bash
# 1. 登录即梦账户（OAuth Device Flow）
dreamina login

# 无头模式登录（适用于 CI/CD 或远程环境）
dreamina login --headless
dreamina login checklogin --device_code=<device_code> --poll=30

# 清除登录状态
dreamina logout

# 强制重新登录
dreamina relogin

# 查看版本
dreamina version
```

登录命令会输出 `verification_uri`、`user_code` 和 `device_code`。在浏览器中打开 `verification_uri`，输入 `user_code` 即可完成授权。

### 查看积分

```bash
dreamina user_credit
```

---

## 账户命令

### `dreamina login` — 登录

通过 OAuth Device Flow 完成本地登录。

| 参数 | 说明 |
|------|------|
| `--headless` | 打印 OAuth 授权信息后退出，不等待完成 |

```bash
dreamina login
dreamina login --headless
dreamina login checklogin --device_code=<device_code> --poll=30
```

### `dreamina logout` — 登出

清除本地 OAuth 登录状态。

```bash
dreamina logout
```

### `dreamina relogin` — 重新登录

清除当前登录态并强制重新进行 OAuth 登录。

```bash
dreamina relogin
```

### `dreamina user_credit` — 查询积分

显示当前账户的剩余积分。

```bash
dreamina user_credit
```

### `dreamina version` — 查看版本

打印构建版本和 commit 信息。

```bash
dreamina version
```

---

## 图片生成

### `dreamina text2image` — 文生图

根据文本描述生成图片。任务为异步执行，可使用 `--poll` 等待结果。

#### 支持的模型与分辨率

| 模型版本 | 支持分辨率 |
|----------|------------|
| 3.0, 3.1 | 1k, 2k |
| 4.0, 4.1, 4.5, 4.6, 4.7, 5.0 | 2k, 4k |

#### 支持的比例

`21:9`, `16:9`, `3:2`, `4:3`, `1:1`, `3:4`, `2:3`, `9:16`

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--prompt` | string | 生图提示词（必填） |
| `--ratio` | string | 图片比例，默认 `1:1` |
| `--resolution_type` | string | 分辨率：`1k`, `2k`, `4k`（依模型而定） |
| `--model_version` | string | 模型版本：`3.0`, `3.1`, `4.0`, `4.1`, `4.5`, `4.6`, `4.7`, `5.0` |
| `--session` | int | 会话 ID（默认 0） |
| `--poll` | int | 提交后轮询等待秒数（0 表示不轮询） |

#### 示例

```bash
# 基础用法
dreamina text2image --prompt="一只可爱的橘猫肖像" --ratio=1:1 --resolution_type=2k

# 使用指定模型
dreamina text2image --prompt="赛博朋克风格的城市天际线" --model_version=5.0 --ratio=16:9 --resolution_type=4k

# 轮询等待结果
dreamina text2image --prompt="水彩风景画" --ratio=3:2 --resolution_type=2k --poll=60
```

---

### `dreamina image2image` — 图生图

上传 1-10 张本地图片，基于参考图生成新图片。

#### 支持的模型

`4.0`, `4.1`, `4.5`, `4.6`, `4.7`, `5.0`

> **注意**: image2image 不支持 1k 分辨率，仅支持 2k 和 4k。

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--images` | strings | 本地输入图片路径（1-10 张） |
| `--prompt` | string | 编辑提示词 |
| `--ratio` | string | 图片比例 |
| `--resolution_type` | string | 分辨率：`2k`, `4k` |
| `--model_version` | string | 模型版本 |
| `--session` | int | 会话 ID |
| `--poll` | int | 轮询等待秒数 |

#### 示例

```bash
# 基础图生图
dreamina image2image --images ./input.png --prompt="转换为水彩画风格"

# 多图参考
dreamina image2image --images ./ref1.png,./ref2.png --prompt="融合两种风格" --ratio=1:1

# 指定模型和分辨率
dreamina image2image --images ./photo.jpg --prompt="变成动漫风格" --model_version=5.0 --resolution_type=4k
```

---

## 视频生成

### `dreamina text2video` — 文生视频

根据文本描述生成视频。使用 Seedance 2.0 系列模型。

#### 支持的模型

| 模型 | 分辨率 | 时长 |
|------|--------|------|
| `seedance2.0` | 720p | 4-15s |
| `seedance2.0fast` | 720p | 4-15s |
| `seedance2.0_vip` | 720p, 1080p | 4-15s |
| `seedance2.0fast_vip` | 720p, 1080p | 4-15s |

默认模型：`seedance2.0fast`

#### 支持的比例

`1:1`, `3:4`, `16:9`, `4:3`, `9:16`, `21:9`

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--prompt` | string | 视频提示词（必填） |
| `--duration` | int | 视频时长（4-15 秒，默认 5） |
| `--ratio` | string | 视频比例 |
| `--video_resolution` | string | 分辨率：`720p`, `1080p` |
| `--model_version` | string | 模型版本 |
| `--session` | int | 会话 ID |
| `--poll` | int | 轮询等待秒数 |

#### 示例

```bash
# 基础文生视频
dreamina text2video --prompt="一只猫在草地上奔跑" --duration=5

# 高清视频
dreamina text2video --prompt="日落时分的海滩航拍" --model_version=seedance2.0_vip --video_resolution=1080p --duration=8 --ratio=16:9
```

---

### `dreamina image2video` — 图生视频

上传一张图片作为首帧，生成动态视频。

#### 支持的模型

| 模型 | 分辨率 | 时长范围 |
|------|--------|----------|
| `3.0`, `3.0fast`, `3.0pro` | 720p | 3-10s |
| `3.5pro` | 720p | 4-12s |
| `seedance2.0`, `seedance2.0fast` | 720p | 4-15s |
| `seedance2.0_vip`, `seedance2.0fast_vip` | 720p, 1080p | 4-15s |

> 比例由输入图片自动推断，无需手动设置。

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--image` | string | 本地首帧图片路径（必填） |
| `--prompt` | string | 生成提示词 |
| `--duration` | int | 视频时长 |
| `--video_resolution` | string | 分辨率 |
| `--model_version` | string | 模型版本 |
| `--session` | int | 会话 ID |
| `--poll` | int | 轮询等待秒数 |

#### 示例

```bash
# 基础图生视频
dreamina image2video --image=./first.png --prompt="镜头推进"

# 使用 Seedance 2.0 VIP
dreamina image2video --image=./portrait.jpg --prompt="人物微笑并眨眼" --model_version=seedance2.0_vip --video_resolution=1080p --duration=6
```

---

### `dreamina frames2video` — 首尾帧生视频

上传首帧和尾帧两张图片，生成过渡视频。

#### 支持的模型

| 模型 | 分辨率 | 时长范围 |
|------|--------|----------|
| `3.0` | 720p | 3-10s |
| `3.5pro` | 720p | 4-12s |
| `seedance2.0`, `seedance2.0fast` | 720p | 4-15s |
| `seedance2.0_vip`, `seedance2.0fast_vip` | 720p, 1080p | 4-15s |

默认模型：`seedance2.0fast`

> 比例由首帧图片尺寸自动推断。

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--first` | string | 首帧图片路径（必填） |
| `--last` | string | 尾帧图片路径（必填） |
| `--prompt` | string | 生成提示词 |
| `--duration` | int | 视频时长 |
| `--video_resolution` | string | 分辨率 |
| `--model_version` | string | 模型版本 |
| `--session` | int | 会话 ID |
| `--poll` | int | 轮询等待秒数 |

#### 示例

```bash
# 基础首尾帧
dreamina frames2video --first=./start.png --last=./end.png --prompt="季节变换"

# 高清首尾帧
dreamina frames2video --first=./spring.png --last=./winter.png --prompt="春夏秋冬流转" --model_version=seedance2.0_vip --duration=10
```

---

### `dreamina multiframe2video` — 多图故事视频

上传 2-20 张图片，生成连贯的视觉故事视频。

#### 核心概念

- 对于 N 张图片，过渡段数为 N-1
- 每个过渡段的时长限制为 [0.5, 8] 秒
- 总时长必须 ≥ 2 秒
- 2 张图片可用简写模式；3+ 张需逐段设置

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--images` | strings | 本地参考图片路径（2-20 张） |
| `--prompt` | string | 简写提示词（仅 2 张图片时可用） |
| `--duration` | float | 简写过渡时长（仅 2 张图片时可用，默认 3s） |
| `--transition-prompt` | stringArray | 逐段过渡提示词（N-1 个） |
| `--transition-duration` | stringArray | 逐段过渡时长（N-1 个，默认每段 3s） |
| `--session` | int | 会话 ID |
| `--poll` | int | 轮询等待秒数 |

#### 示例

```bash
# 2 张图片简写模式
dreamina multiframe2video --images ./a.png,./b.png --prompt="角色转身"

# 3 张图片逐段模式
dreamina multiframe2video --images ./a.png,./b.png,./c.png \
  --transition-prompt="从 A 过渡到 B" \
  --transition-prompt="从 B 过渡到 C"
```

---

### `dreamina multimodal2video` — 全能参考视频（旗舰模式）⭐

即梦最强视频生成模式，对应 Web 端「全能参考」功能。支持图片、视频、音频混合输入。

#### 支持的模型

`seedance2.0`, `seedance2.0fast`, `seedance2.0_vip`, `seedance2.0fast_vip`

#### 输入限制

| 类型 | 最大数量 | 说明 |
|------|----------|------|
| 图片 (`--image`) | ≤9 | 至少需要 1 张图片或 1 个视频 |
| 视频 (`--video`) | ≤3 | - |
| 音频 (`--audio`) | ≤3 | 音频时长需 2-15 秒 |

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--image` | stringArray | 本地图片路径（可重复） |
| `--video` | stringArray | 本地视频路径（可重复） |
| `--audio` | stringArray | 本地音频路径（可重复） |
| `--prompt` | string | 可选编辑提示词 |
| `--duration` | int | 视频时长（4-15s，默认 5） |
| `--ratio` | string | 视频比例 |
| `--video_resolution` | string | 分辨率：`720p`, `1080p` |
| `--model_version` | string | 模型版本 |
| `--session` | int | 会话 ID |
| `--poll` | int | 轮询等待秒数 |

#### 示例

```bash
# 图片转电影镜头
dreamina multimodal2video --image ./input.png --prompt="转换为电影感镜头"

# 图片 + 音频
dreamina multimodal2video --image ./input.png --audio ./music.mp3 --model_version=seedance2.0fast --duration=5

# 图片 + 视频 + 音频（全混合输入）
dreamina multimodal2video \
  --image ./ref1.png \
  --video ./ref.mp4 \
  --audio ./music.mp3 \
  --model_version=seedance2.0fast \
  --duration=8 \
  --ratio=16:9
```

---

## 图片放大

### `dreamina image_upscale` — 图片超分放大

上传一张本地图片，进行超分辨率放大。

#### 支持分辨率

| 分辨率 | 要求 |
|--------|------|
| `2k` | 所有用户可用 |
| `4k` | 需 VIP |
| `8k` | 需 VIP |

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--image` | string | 本地图片路径（必填） |
| `--resolution_type` | string | 目标分辨率：`2k`, `4k`, `8k` |
| `--session` | int | 会话 ID |
| `--poll` | int | 轮询等待秒数 |

#### 示例

```bash
# 基础放大到 4K
dreamina image_upscale --image=./input.png --resolution_type=4k

# 8K 超分（需 VIP）
dreamina image_upscale --image=./photo.jpg --resolution_type=8k
```

---

## 任务管理

### `dreamina query_result` — 查询任务结果

根据 `submit_id` 查询异步任务状态和结果。

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--submit_id` | string | 任务 ID（必填） |
| `--download_dir` | string | 下载结果媒体到指定目录 |

#### 示例

```bash
# 查询任务
dreamina query_result --submit_id=3f6eb41f425d23a3

# 查询并下载
dreamina query_result --submit_id=3f6eb41f425d23a3 --download_dir=./output
```

---

### `dreamina list_task` — 任务列表

列出当前登录用户保存的任务历史。

#### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `--gen_status` | string | 按状态筛选 |
| `--gen_task_type` | string | 按任务类型筛选 |
| `--submit_id` | string | 按任务 ID 筛选 |
| `--limit` | int | 最大返回数（默认 20） |
| `--offset` | int | 分页偏移量 |

#### 示例

```bash
# 列出所有任务
dreamina list_task

# 筛选成功任务
dreamina list_task --gen_status=success

# 分页
dreamina list_task --limit=10 --offset=20
```

---

## 会话管理

### `dreamina session` — 会话管理

会话 (Session) 是用于组织创作历史的容器。所有生成器命令都支持 `--session=<id>` 参数。

#### 子命令

| 命令 | 别名 | 说明 |
|------|------|------|
| `create` | - | 创建新会话（自动命名或自定义名称） |
| `list` | `ls` | 列出最近的会话 |
| `search` | `find` | 按名称搜索会话 ID |
| `rename` | `update` | 重命名会话 |
| `delete` | `rm` | 删除会话 |

> 会话 0 是默认会话，不可重命名或删除。删除会话会将其历史安全移回默认会话。

#### 示例

```bash
# 创建会话
dreamina session create
dreamina session create "我的视频项目"

# 列出会话
dreamina session list
dreamina session ls -n 100

# 搜索会话
dreamina session search "视频"

# 重命名会话
dreamina session rename 10086 "新项目名称"

# 删除会话
dreamina session rm 10086

# 在指定会话中生成内容
dreamina text2image --prompt="日落" --session=10086
```

---

## 参数速查表

### 图片模型版本速查

| 模型 | text2image | image2image | 可用分辨率 |
|------|:---:|:---:|------|
| 3.0 | ✅ | ❌ | 1k, 2k |
| 3.1 | ✅ | ❌ | 1k, 2k |
| 4.0 | ✅ | ✅ | 2k, 4k |
| 4.1 | ✅ | ✅ | 2k, 4k |
| 4.5 | ✅ | ✅ | 2k, 4k |
| 4.6 | ✅ | ✅ | 2k, 4k |
| 4.7 | ✅ | ✅ | 2k, 4k |
| 5.0 | ✅ | ✅ | 2k, 4k |

### 视频模型版本速查

| 模型 | text2video | image2video | frames2video | multimodal2video |
|------|:---:|:---:|:---:|:---:|
| 3.0 / 3.0fast / 3.0pro | ❌ | ✅ | ✅ | ❌ |
| 3.5pro | ❌ | ✅ | ✅ | ❌ |
| seedance2.0 / seedance2.0fast | ✅ | ✅ | ✅ | ✅ |
| seedance2.0_vip / seedance2.0fast_vip | ✅ | ✅ | ✅ | ✅ |

### 通用比例

所有支持比例的生成器均使用以下值：

`21:9`, `16:9`, `3:2`, `4:3`, `1:1`, `3:4`, `2:3`, `9:16`

### 分辨率速查

| 分辨率 | 图片生成 | 图片放大 | 视频生成 |
|--------|:---:|:---:|:---:|
| 1k | ✅ (3.0/3.1) | ❌ | ❌ |
| 2k | ✅ | ✅ (所有用户) | ❌ |
| 4k | ✅ (4.0+) | ✅ (VIP) | ❌ |
| 8k | ❌ | ✅ (VIP) | ❌ |
| 720p | ❌ | ❌ | ✅ |
| 1080p | ❌ | ❌ | ✅ (VIP) |

---

## 常见问题

### Q: 登录时提示 "请先登录后再进行授权操作"

A: 需要在即梦 Web 端 (`jimeng.jianying.com`) 先登录账户，然后再进行 CLI OAuth 授权。

### Q: 任务返回 `AigcComplianceConfirmationRequired` 错误

A: 部分高内容安全风险模型（如 Seedance 2.0 系列）首次使用前需要先在即梦 Web 端完成授权确认。请登录网页端完成授权后重试。

### Q: 如何查看任务结果？

A: 生成命令会返回 `submit_id`，使用 `dreamina query_result --submit_id=<id>` 查看结果。也可以用 `dreamina list_task` 查看历史任务。

### Q: 支持哪些图片格式？

A: 常见格式如 PNG、JPG/JPEG、WEBP 等均可。

### Q: 一次最多上传多少张图片？

A: image2image 最多 10 张，multiframe2video 最多 20 张，multimodal2video 图片最多 9 张。

### Q: 如何节省积分？

A: 使用默认模型和默认分辨率即可满足大部分需求。高分辨率（4k、1080p）和 VIP 模型消耗更多积分。

---

> 本文档基于 `dreamina` CLI version `46b5b0e-dirty` (build: 2026-06-03) 生成。更多帮助请运行 `dreamina --help` 及各子命令的 `-h` 查看。
