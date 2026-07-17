# 小洛宝 SVG 动画编辑器方案

> 文档状态：已确认技术方向，编辑器尚未实现
>
> 决策日期：2026-07-16
>
> 上位计划：[`计划.md`](../计划.md) M8
>
> P0 可执行步骤：[`M8-P0实施手册.md`](./M8-P0实施手册.md)

## 1. 决策摘要

项目继续使用分层 SVG 作为角色生产渲染方案，并开发一套面向桌宠的轻量动画编辑器。编辑器以 [SVG-edit](https://github.com/SVG-Edit/svgedit) 的 `@svgedit/svgcanvas` 为画布和基础编辑能力来源，自行实现接近 Flash/Animate 的图层、轴心、时间轴、关键帧、补间、动作片段和导出流程。

SVG-edit 只承担选择、变换、缩放、画布导航、基础图形编辑和撤销等通用能力。角色 rig、动作数据、时间轴和运行时格式由本项目定义，不把生产数据绑定到 SVG-edit 的私有状态、完整 UI 或扩展内部结构。

编辑器必须作为独立开发工具存在，不能进入 `400×500` 桌宠生产窗口，也不能让 LLM、业务调度器或 Tauri 窗口逻辑依赖编辑器。

## 2. 背景与目标

现有 SVG 运行时已经证明以下能力可行：

- 分层部件、pivot 和纸片关节动画。
- 鼠标视线、头部探出、身体视差和程序化待机动作。
- 马尾、刘海、鬓发和发饰的物理回摆。
- 动作期间的绘制层级切换。
- 透明窗口轮廓命中和点击穿透。

当前瓶颈不是渲染，而是创作方式：继续在 TS/CSS 中手写动作关键帧，难以直观调整节奏、轴心、层级和多部件配合，也不利于后续增加服装和动作。

编辑器的目标是让不依赖代码的动作制作成为主路径：

1. 导入分层 SVG 并识别角色部件与 pivot。
2. 像 Flash 一样在帧时间轴上制作纸片关节动画。
3. 导出稳定、可校验、可版本化的动作数据。
4. 由桌宠 `CharacterRenderer` 播放命名动作。
5. 让不同服装在遵守同一 rig 契约时复用动作。

## 3. 非目标

第一阶段明确不做：

- 完整矢量绘图软件或 Inkscape 替代品。
- Live2D 式网格变形、蒙皮和参数化形变。
- Spine 式骨骼权重、IK、约束求解和网格附件。
- 路径节点逐帧变形、复杂遮罩动画和滤镜动画。
- 音频剪辑、视频导出和逐帧位图动画。
- 多人协作、素材市场、云存储和插件市场。
- 在编辑器中直接调用桌宠的 Tauri、LLM 或系统感知能力。

当简单纸片动画无法表达明确需求时，再用真实动作样例决定是否扩展；不能预先把编辑器做成通用动画平台。

## 4. 总体架构

```text
Inkscape / 其他 SVG 绘图工具
            │
            ▼
      分层 artwork.svg
            │
            ▼
┌─────────────────────────────────────┐
│ 小洛宝 Animation Studio            │
│                                     │
│ SVG-edit svgcanvas                  │
│ 选择 / 变换 / 缩放 / 撤销 / 导航   │
│             │                       │
│             ▼                       │
│ Rig 模型 / 时间轴 / 属性面板        │
│ 关键帧 / 补间 / 事件 / 预览         │
└─────────────┬───────────────────────┘
              │
              ▼
     rig.json + motions.json
              │
              ▼
       SvgCharacterRenderer
              │
              ▼
 BehaviorScheduler / Mock Agent / LLM
       只提交 motion.play("wave")
```

编辑器、文件格式和运行时必须分层：

- 编辑器 UI 可以替换，`rig.json` 和 `motions.json` 语义不随之变化。
- 运行时不能导入 SVG-edit，也不能读取编辑器内部对象。
- 动作协议只引用语义部件 ID 和命名动作，不引用 DOM selector。
- 源 SVG 是美术事实；rig 是结构事实；motion 是动作事实。

## 5. 仓库与依赖策略

推荐将编辑器维护为独立仓库，例如 `ltypet-motion-editor`。如果原型阶段必须放在当前仓库，应使用拥有独立 `package.json`、构建输出和测试配置的 `tools/motion-editor/`，不得把 SVG-edit 的 Vite、Vitest 和 UI 依赖并入桌宠根依赖。

原因：

- 当前 SVG-edit master 与桌宠使用不同的构建版本和依赖生命周期。
- 编辑器是开发工具，桌宠是面向用户的生产应用，发布边界不同。
- 独立依赖可以固定 SVG-edit 的精确版本或 commit，避免上游更新破坏创作环境。
- 编辑器可能采用完整浏览器窗口，桌宠则必须保持小型透明 Tauri 窗口。

上游管理规则：

1. 记录采用的 SVG-edit tag、commit 和许可证文件。
2. 优先依赖 `@svgedit/svgcanvas` 的公开 API。
3. 必须修改上游时，以少量、可列举的 patch 维护，并保留 upstream remote。
4. 不直接跟随 `master` 自动升级；升级前运行导入回归和交互回归。
5. 分发前保留许可证与第三方 notices，并审计实际打包内容。

## 6. 编辑器核心概念

### 6.1 Project

一次编辑会话对应一个角色项目，包含 SVG、rig、动作片段和编辑器元数据。项目不保存桌宠业务状态。

### 6.2 Part

Part 是可独立变换的语义部件，例如：

- `body`
- `head`
- `arm_left`
- `arm_right`
- `hair_tail_left`
- `hair_tail_right`
- `fringe`
- `accessory_blue_left`

Part 必须有稳定 ID。名称可以本地化，ID 不因改名、服装或编辑器显示顺序变化。

### 6.3 Pivot

Pivot 是 Part 局部坐标系中的旋转/缩放中心。导入时可读取现有 `pivot_<partId>` 标记，编辑器中也可以拖动修改。

Pivot 标记只在编辑器可见；生产渲染和轮廓命中必须排除它。保存时以数值写入 rig，不能要求运行时重新通过 DOM 包围盒猜测轴心。

### 6.4 Motion Clip

Motion Clip 是可命名、可单独播放的动作，例如 `idle`、`wave`、`sleep`、`stretch`。Clip 具有 FPS、总帧数、循环策略、轨道和事件。

### 6.5 Track 与 Keyframe

一个 Part 对应一条或多条属性轨道。第一版支持：

- `x`、`y`
- `rotation`
- `scaleX`、`scaleY`
- `opacity`
- 离散 `renderSlot`

关键帧保存明确数值和补间方式。没有关键帧的属性使用 bind pose，不隐式继承编辑器上一次选择产生的临时值。

### 6.6 Event Marker

事件标记位于指定帧，用于向运行时发出受控事件，例如动作完成提示、脚步落点或口型片段切换。第一版事件必须来自白名单，不允许嵌入 JavaScript、CSS 或 Tauri command。

## 7. Rig 与绘制层级模型

### 7.1 逻辑父级和绘制顺序分离

`logicalParentId` 决定变换继承，`renderSlot` 决定绘制顺序，两者不能再由同一 SVG DOM 嵌套关系隐式表达。

例如：

- 左右马尾的逻辑父级是 `head`，因此头部探出时连接点跟随头部。
- 马尾的默认绘制槽位可以是 `behind-body`，因此不必放进头部 DOM 图层。
- 右手的逻辑父级可以是 `body`，挥到水平位置时把 `renderSlot` 从 `behind-body` 离散切换为 `front-head`。

推荐初始槽位：

```text
behind-body
body-back
body
between-body-head
head
front-head
effects-front
```

槽位名称属于 rig 契约。动作只能选择声明过的槽位，不能写任意 z-index 或 DOM 路径。

### 7.2 Bind Pose

导入时记录每个 Part 的初始局部矩阵、pivot、逻辑父级和绘制槽位，组成 bind pose。现有素材包含镜像、斜切、非统一缩放和多层父级 matrix，因此 bind pose 必须保存完整的 SVG 2D 仿射矩阵 `[a, b, c, d, e, f]`，不能强行分解后只保存 `x/y/rotation/scale`。

如果 rig 的逻辑父级与源 SVG 的 DOM 父级不同，导入器先计算 Part 和逻辑父级的世界矩阵，再换算：

```text
bindMatrix(part) = inverse(worldBind(logicalParent))
                 × sourceWorldMatrix(part)
```

这样可以改变绘制容器和逻辑父级而不改变初始视觉位置。所有动作关键帧保存相对 bind pose 的可编辑增量，既保留复杂原始矩阵，又让时间轴只暴露平移、旋转、缩放和透明度。

运行时的基础矩阵组合为：

```text
world(part) = world(parent)
            × bindMatrix
            × authoredMotion
            × proceduralMotion
            × interactionOffset
```

围绕 pivot 的 authored 变换按固定顺序组合，第一版不提供 skew 关键帧：

```text
authoredMotion = translate(x, y)
               × translate(pivot.x, pivot.y)
               × rotate(rotation)
               × scale(scaleX, scaleY)
               × translate(-pivot.x, -pivot.y)
```

运行时应先计算最终世界矩阵，再把 Part 放入对应 render slot；DOM 中为了绘制层级发生的重排不能参与逻辑继承计算。实际实现可以使用嵌套 wrapper 或矩阵计算，但每个通道必须可独立归零、取消和调试。

### 7.3 动作与程序动画叠加

角色最终表现至少分为三类通道：

| 通道 | 来源 | 示例 |
|---|---|---|
| authored | 编辑器动作 | 招手、睡觉、伸懒腰 |
| procedural | 本地连续动画 | 呼吸、马尾物理、随机耳朵微动 |
| interaction | 用户或 Agent 参数 | 视线、头部探出、鼠标跟随 |

Clip 可以通过声明暂时接管某个通道，例如 `wave` 接管右手 authored 轨道，但不能默认关闭眨眼和头发物理。需要禁止的程序动画必须在 clip 元数据中显式声明，并在结束或中断后恢复。

## 8. 文件格式

第一版使用可读 JSON，便于 diff、测试和手工诊断。建议项目目录：

```text
character-project/
  artwork.svg
  rig.json
  motions.json
  editor.json
```

- `artwork.svg`：原始分层美术；不得嵌入脚本和外部网络资源。
- `rig.json`：部件、轴心、逻辑父级、bind pose、槽位和兼容版本。
- `motions.json`：命名 clip、关键帧、缓动和事件。
- `editor.json`：面板布局、时间轴缩放、折叠状态等非生产数据。

### 8.1 Rig 草案

```ts
interface CharacterRig {
  schemaVersion: 1;
  rigId: string;
  artwork: string;
  viewport: { width: number; height: number };
  renderSlots: string[];
  parts: RigPart[];
}

interface RigPart {
  id: string;
  // 当前 artwork 内的绑定，不是跨服装共享的语义身份。
  sourceElementId: string;
  logicalParentId: string | null;
  defaultRenderSlot: string;
  pivot: { x: number; y: number };
  bindMatrix: AffineMatrix;
  tags?: string[];
}

type AffineMatrix = [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
];

interface TransformValue {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
}
```

`RigPart.id` 是动作、编辑器和不同服装共享的语义 Part ID，例如
`arm_right`；`sourceElementId` 只是某一份 artwork 内定位源节点的绑定，例如
当前素材中的 `layer21`，不同服装可以不同。导入器可优先从唯一的
`inkscape:label` 得到语义 ID，再解析并记录当前 DOM ID。P0 不要求修改源 SVG
加入 `data-part`；是否在派生的运行时 artwork 中生成 `data-part`，由 P1 的绑定
格式验证后再决定。

### 8.2 Motion 草案

```ts
interface MotionLibrary {
  schemaVersion: 1;
  rigId: string;
  clips: MotionClip[];
}

interface MotionClip {
  id: string;
  fps: number;
  durationFrames: number;
  loop: boolean;
  tracks: PartTrack[];
  events: MotionEvent[];
  suppressProceduralChannels?: string[];
}

interface PartTrack {
  partId: string;
  keyframes: MotionKeyframe[];
}

interface MotionKeyframe {
  frame: number;
  values: Partial<TransformValue> & { renderSlot?: string };
  easing?: EasingValue;
}

type EasingValue =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | { cubicBezier: [number, number, number, number] };

interface MotionEvent {
  frame: number;
  type: string;
  payload?: Record<string, string | number | boolean>;
}
```

### 8.3 格式约束

- `schemaVersion`、`rigId`、Part ID 和 Clip ID 必须校验。
- 拒绝重复 ID、未知 Part、未知槽位、非有限数值、负帧和越界帧。
- FPS 第一版默认 24，可选范围暂定 `1..60`。
- `scaleX/scaleY`、opacity、坐标和角度必须设置安全范围。
- 未知字段可以按版本策略忽略或拒绝，但行为必须有测试并保持一致。
- 导出顺序稳定，避免仅因对象遍历顺序产生巨大 diff。
- 编辑器预览与运行时必须共享同一个纯函数插值核心，防止“编辑器里正确、桌宠里不同”。

## 9. Flash 风格交互

### 9.1 布局

```text
┌──────────────┬──────────────────────────┬──────────────┐
│ 图层 / Rig   │                          │ 属性         │
│ Part 树      │          舞台            │ Transform    │
│ 显隐/锁定    │                          │ Pivot/Easing │
├──────────────┴──────────────────────────┴──────────────┤
│ 动作选择 │ 播放控制 │ 帧标尺 │ 轨道与关键帧          │
└───────────────────────────────────────────────────────┘
```

### 9.2 第一版操作

- 单击选择 Part；双击可进入组内编辑，但默认以语义 Part 为选择单位。
- 舞台直接拖动移动，旋转手柄旋转，缩放手柄缩放。
- Pivot 使用独立工具拖动，不能与普通几何选择混淆。
- 时间轴播放头可拖动并实时更新舞台。
- 修改属性时，如果当前帧已有关键帧则更新；没有关键帧时必须明确提示插入，第一版不默认静默自动打帧。
- 支持复制、粘贴、移动和删除关键帧。
- 支持多选关键帧整体平移，但第一版不要求多部件同时自由变换。
- `renderSlot` 使用阶梯/离散轨道，不做数值补间。

### 9.3 建议快捷键

| 快捷键 | 行为 |
|---|---|
| `F6` | 插入或更新关键帧 |
| `Shift+F6` | 删除当前关键帧 |
| `Enter` | 播放/暂停 |
| `,` / `.` | 前一帧/后一帧 |
| `Home` / `End` | 首帧/末帧 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | 撤销/重做 |
| `Space + 拖动` | 平移舞台 |
| `Delete` | 删除选中的关键帧或允许删除的编辑对象 |

快捷键必须在文本输入框聚焦时正确让路，并提供菜单或按钮替代路径。

## 10. SVG 导入与安全边界

导入是首个决策门。P0 默认使用已烘焙复杂 transform 的
`src/assets/小洛宝.glax.svg` 作为编辑器输入，同时保留
`src/assets/小洛宝.svg` 作为 Inkscape 美术源和视觉/结构对照。不能因为派生版本
更容易导入，就跳过两者差异和派生过程可复现性的验证。

导入流程：

1. 解析并安全清理 SVG，拒绝脚本、事件属性、`foreignObject` 和外部网络引用。
2. 读取 `viewBox`、稳定 ID、分组、Inkscape label 和 pivot 标记。
3. 显示导入诊断：重复 ID、缺失 ID、不可逆变换、未知引用、pivot 缺失。
4. 建立 rig 草案，但不改写原始 SVG。
5. 在隔离副本中交给 svgcanvas 编辑和预览。
6. 保存前验证 Part 与源元素映射仍然存在。

首个原型必须验证：

- 视觉与 Inkscape 渲染一致。
- 部件 ID、分组层级和 pivot 坐标没有漂移。
- 选择一个 Part 不会意外拆散其内部路径。
- 导入后不修改并保存时，不产生不可解释的大范围结构重写。
- 带父级 matrix、镜像和斜切的部件行为可预测。

如果完整 SVG-edit editor 会重写结构，改为只使用 svgcanvas 的舞台能力，并由项目自己的导入器和序列化器持有源文档；不能通过把全部图形转路径来掩盖生产格式问题。

## 11. 撤销、保存与恢复

- Rig 修改、关键帧修改、动作长度、补间和层级切换必须进入统一命令历史。
- SVG 几何编辑与动作编辑的撤销顺序必须一致，不能出现两个互不知情的撤销栈。
- 原型阶段允许只读 SVG 几何，以降低整合撤销栈的风险。
- 自动保存写入恢复文件，不覆盖用户明确保存的项目。
- 保存使用临时文件加原子替换；失败时保留上一版本。
- 崩溃恢复必须提示恢复来源和时间，不能静默覆盖正式文件。
- `editor.json` 损坏不能阻止打开 artwork、rig 和 motion。

## 12. 运行时接入

编辑器产物通过 `SvgCharacterRenderer` 接入已有语义动作协议：

```ts
await renderer.playMotion("wave", {
  signal,
  blendInMs: 80,
  blendOutMs: 120,
});
```

运行时职责：

- 载入并校验 rig/motion 版本。
- 把归一化播放时间换算到帧并插值。
- 执行离散层级切换和白名单事件。
- 支持完成、中断、超时、恢复和 cleanup。
- 通过 `AbortSignal` 或等价机制响应调度器中断。
- clip 结束后恢复合法的 idle/程序动画状态。
- `prefers-reduced-motion` 下按策略缩短、替代或跳过动作，但必须正确完成 Promise。
- 缺失动作返回稳定的 `unsupported_action` 或 `renderer_unavailable`，不能静默伪装成功。

开发环境应提供热重载动作 JSON 的能力，但热更新不能重建 SVG rig、漂移 pivot 或遗留上一动作的 RAF。

## 13. 多服装兼容

动作复用依赖 rig 契约，而不是图形完全相同。

每套服装必须声明：

- `rigVersion`
- 支持的 Part ID
- 支持的 render slot
- 支持的命名动作或降级映射
- 可选的动作修正参数

同一动作在不同服装上的策略：

1. Part 和能力完全匹配：直接播放。
2. 可选装饰 Part 缺失：忽略该轨道并记录诊断。
3. 必需 Part 缺失：使用声明过的 fallback clip。
4. 无 fallback：明确拒绝，不留下半切换角色。

第一版不做任意骨骼重定向。需要复用动作的服装必须遵守统一 Part ID、逻辑父级和轴心约定。

## 14. 分阶段实施

### P0：SVG-edit 可行性尖峰

目标：证明现有素材能被可靠导入、选中、变换和保存动画数据。

- [ ] 建立独立编辑器 workspace，固定 SVG-edit/svgcanvas 精确版本。
- [ ] 打开 `小洛宝.glax.svg` 并生成导入诊断，同时对原始 `小洛宝.svg` 运行对照诊断。
- [ ] 验证 ID、分组、pivot 和视觉往返。
- [ ] 选中 `arm_right`，在两个时间点旋转并插值预览。
- [ ] 输出最小 motion JSON，不修改生产 SVG。
- [ ] 记录 SVG-edit 公开 API、不得依赖的 private API 和必要 patch。

通过门槛：可以制作并预览一次右手挥动，重新打开项目后结果一致。若导入、选择模型或序列化无法稳定满足要求，停止扩展 UI，重新评估画布内核。

### P1：格式与纯动画核心

- [ ] 确定 rig/motion JSON Schema 和版本策略。
- [ ] 实现校验器、稳定序列化和错误诊断。
- [ ] 实现帧时间、关键帧查询、补间和 cubic bezier。
- [ ] 实现 logical parent、bind pose 和 render slot 数学。
- [ ] 为插值、边界、无效输入和矩阵组合增加单元测试。

通过门槛：不依赖 React 和 SVG-edit即可用纯测试复现任意帧姿态。

### P2：Flash 风格时间轴 MVP

- [ ] Part 图层树、锁定、显隐和选择同步。
- [ ] 动作列表、时间标尺、播放头和轨道。
- [ ] F6 关键帧、删除、复制、粘贴和拖动。
- [ ] 属性面板、pivot 工具和基础缓动。
- [ ] 播放、暂停、逐帧和循环预览。
- [ ] 统一撤销/重做和未保存提示。

通过门槛：用户不修改源码即可制作 `idle`、`wave` 和一个自选动作。

### P3：桌宠运行时接入

前置条件：`计划.md` M1-M4 的动作协议、调度器和渲染器适配层具备可用纵向链路。

- [ ] `SvgCharacterRenderer.playMotion()` 播放导出 clip。
- [ ] authored/procedural/interaction 变换互不覆盖。
- [ ] 支持动作中断、结束恢复和 reduced motion。
- [ ] 支持离散 render slot 切换且视觉无跳变。
- [ ] Mock Agent 可调用命名动作并观察结构化结果。

通过门槛：编辑器制作的 `wave` 在真实 Tauri 窗口播放，拖动、穿透、眨眼、视线和头发物理不退化。

### P4：可用性与服装验证

- [ ] 自动保存、恢复、最近项目和明确错误提示。
- [ ] 两套服装共享至少 `idle`、`wave`、`sleep`。
- [ ] 导入检查、兼容报告和 fallback 动作。
- [ ] 编辑器快捷键、焦点、键盘操作和高 DPI 验证。
- [ ] 编写创作教程和示例项目。

通过门槛：从一套新服装 SVG 到可在桌宠切换和播放已有动作，不需要修改 Agent、调度器或业务代码。

### P5：开发工具发布

- [ ] 固定上游版本并记录 patch。
- [ ] 审计许可证、第三方 notices 和素材边界。
- [ ] 构建可重复，项目格式有迁移与备份策略。
- [ ] Windows 安装/便携运行、崩溃恢复和大素材性能验证。
- [ ] 发布版本与桌宠支持的 rig/motion schema 对应。

## 15. 测试与验收

### 自动化测试

- Schema：合法项目、未知版本、重复 ID、未知 Part、越界帧和非有限值。
- 时间：首尾帧、同帧覆盖、空轨道、循环边界和不同 FPS。
- 插值：线性、预设缓动、cubic bezier、角度和离散属性。
- 矩阵：父子继承、pivot、镜像、非统一缩放和负坐标。
- 层级：render slot 切换不改变逻辑父级和世界连接点。
- 序列化：稳定顺序、往返一致和版本迁移。
- 运行时：完成、中断、超时、缺失动作、reduced motion 和 cleanup。

### 真实编辑器验收

- 100%、150% 和 200% DPI 下选择框与鼠标位置一致。
- 导入 `小洛宝.glax.svg` 后无部件错位，并记录它与原始 `小洛宝.svg` 的视觉差异。
- Pivot 拖动后旋转中心稳定，撤销和重开项目后不漂移。
- 拖动播放头时舞台无明显停顿或历史状态泄漏。
- 关键帧密集时仍能选择、移动和撤销。
- 快捷键在舞台、时间轴和文本输入框中行为正确。

### 真实桌宠验收

- `wave` 可由单击、Mock Agent 和调度器触发。
- 动作中拖动窗口可立即打断或按策略并行，不冻结动画。
- 轮廓命中和点击穿透仍与可见 SVG 对齐。
- 头部动作时马尾逻辑连接点跟随，但仍绘制在指定后层。
- 手臂跨越水平位置时切换槽位，不在身体连接处明显跳变。
- 动作结束、异常和 HMR 后没有残留 transform、RAF 或事件监听。

## 16. 风险与应对

| 风险 | 应对 |
|---|---|
| SVG-edit 导入会改写复杂 SVG | P0 做视觉、ID、pivot 和结构往返；项目自己持有源文档 |
| 扩展 API 依赖内部实现 | 只用公开 svgcanvas API；隔离 adapter；固定 commit |
| 编辑器预览与桌宠表现不同 | 共享纯插值/矩阵核心和同一 schema 测试向量 |
| authored 与程序动画争抢 transform | 独立 wrapper/矩阵通道，显式接管与恢复 |
| 逻辑父级和绘制层级冲突 | rig 分离 `logicalParentId` 与 `renderSlot` |
| 编辑器范围膨胀 | 严守非目标；新能力必须由真实动作阻塞证明必要性 |
| 多服装无法直接复用动作 | 统一 rig ID；兼容报告；fallback；不承诺任意重定向 |
| 上游更新破坏工具 | 精确锁定版本、维护少量 patch、升级回归 |
| 许可证或素材无法公开分发 | 独立审计代码依赖与角色 IP，不把二者混为一项结论 |

## 17. 当前动画迁移策略

现有动画在 Animation Studio 可用前继续作为生产基线，不立即删除：

- 呼吸、眨眼、耳朵、鼠标跟随和头发物理保留为程序动画。
- 现有招手作为第一个 authored clip 对照样例。
- 编辑器导出的 `wave` 达到真实窗口回归门槛后，再替换 CSS/组件内招手关键帧。
- 每次只迁移一个动作，保留可切回旧实现的 feature flag，直到视觉和交互回归完成。
- 不把待机物理全部烘焙成关键帧；编辑器负责有明确导演节奏的动作，程序动画负责持续生命感。

## 18. Agent 交接规则

后续 Agent 实施本方案时：

1. 先查看 `计划.md` M8 状态与 M1-M4 前置条件。
2. P0 可以作为隔离工具原型提前进行；P3 生产接入不得绕过动作协议和调度器。
3. 不因编辑器开发修改桌宠窗口、穿透、拖动和原生菜单模型。
4. 不把“能打开 SVG”写成 P0 通过；必须完成右手关键帧、保存、重开和一致预览。
5. 不把未验证的 SVG-edit 私有方法写入长期文件格式或运行时接口。
6. 每完成一个阶段，在 `计划.md` M8 下记录实际结果、验证、风险和下一步；本文件只在技术方案本身变化时更新。
