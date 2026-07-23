# 小洛宝角色素材工作流

## 文件职责

- `artwork.source.svg`：使用 Inkscape 编辑的权威源文件，保存格式必须是 **Inkscape SVG**。
- `artwork.svg`：由脚本生成的生产素材，供桌宠和 Animation Studio 读取；不要直接编辑。
- `rig.v1.json`：角色绑定及生产素材指纹。
- `motions.v1.json`：命名动作库。

## 修改素材

1. 在 Inkscape 中打开并编辑 `artwork.source.svg`。
2. 保留既有 `inkscape:label`、pivot、图层层级和 `viewBox`；新增可动画部件时使用稳定的英文小写下划线标签。
3. 保存为 Inkscape SVG，不要导出 Plain SVG、Optimized SVG 或 SVGZ。
4. 在仓库根目录运行：

```powershell
npm run artwork:build
npm test
npm run build
```

`artwork:build` 会执行以下操作：

- 校验 rig 所引用的全部标签存在且唯一。
- 校验 `viewBox`、重复 ID、外部资源和危险 SVG 元素。
- 保留 `inkscape:label`、`inkscape:groupmode`、transform、pivot 和隐藏图层。
- 移除 namedview、编辑器专用属性和无意义空白。
- 为语义图层生成稳定 ID 与 `data-part`。
- 原子写入 `artwork.svg` 并同步 `rig.v1.json` 的 SHA-256 指纹。

`npm run build` 只运行 `artwork:check`。如果源文件、生产文件和 rig 指纹不同步，构建会提示先执行 `npm run artwork:build`，不会自行覆盖素材。

## M14 嘴型

当前 `mouth` 内包含：

- `mouth_closed`：默认显示。
- `mouth_open`：默认 `display:none`。

规范化脚本会检查二者都位于 `mouth` 内部，避免丢失口型或错误替换正式素材。
