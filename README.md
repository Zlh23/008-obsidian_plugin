# 树状显示（Tree View）

本插件把一组 Markdown 文件显示成可展开的树状图。它不规定项目的层级名称、层数或业务含义；只需准备目录结构，并在 `config.json` 中指定整棵树的 Project Root（Vault 相对路径）。

## 从零开始

### 1. 创建根目录和入口文件

每棵树从一个目录开始，目录中放一个与目录同名的 Markdown 入口文件：

```text
my-project/
└── my-project.md
```

子目录也可以使用同名入口文件，Markdown 文件可以直接作为子节点。插件按真实目录和文件父子关系建立连接，层数不限。

### 2. 配置扫描范围

编辑插件目录下的 `config.json`：

```json
{
  "roots": ["my-project"],
  "scan": { "entryFile": "same-name", "children": "directories-and-files" },
  "interaction": { "openOnClick": true, "expandOnFirstClick": true, "contextMenuCollapse": true, "focusSync": true },
  "layout": { "defaultOrientation": "horizontal", "fitToViewport": true }
}
```

`roots` 中的每一项就是一棵树的 Project Root，使用 Vault 相对路径；例如 `projects/usbip`。`roots` 为空时，插件自动发现 Vault 根目录下所有带同名入口文件的目录。

## 接入已有文档

1. 找到要显示的最高层目录。
2. 为该目录补充同名入口 Markdown（如 `hardware/hardware.md`）。
3. 为需要显示的子目录补充同名入口文件。
4. 将 Project Root 的 Vault 相对路径加入 `roots`。
5. 执行“刷新树状显示”。

不要复制业务内容；只需补充入口文件和目录关系。

## 给 Agent 的接入步骤

1. 读取现有目录，不改动业务 Markdown 内容。
2. 识别树的根目录和需要展示的子目录。
3. 创建缺失的同名入口文件。
4. 保持原有文件路径稳定。
5. 更新 `config.json` 的 `roots`（填写完整的 Project Root 路径）。
6. 验证每个入口都满足“目录名/目录名.md”。
7. 刷新并验证展开、打开、右键收起和 Focus 同步。

## 可选的状态显示

需要方法进度时，可使用方法 Callout 和 Checklist；前期测试也可以只使用 Checklist 表格。勾选会写回原 Markdown 并刷新状态。

## 交互和命令

- 有下级：第一次点击展开，再次点击打开文件。
- 末级节点：点击直接打开文件。
- 右键节点：收起该分支；右键背景：收起全部但保留 Focus 分支。
- 打开 Markdown 文件时，树状图同步 Focus。

命令：`打开树状显示`、`刷新树状显示`、`切换树状显示方向`。

## 安装

使用 BRAT 添加本仓库，或将 `main.js`、`manifest.json`、`styles.css`、`config.json` 和 `src/` 放入：

```text
<Vault>/.obsidian/plugins/tree-view/
```

### 使用 Git clone（开发模式）

如果需要直接跟踪仓库源码，可以把仓库克隆到 Vault 的插件目录：

```bash
git clone https://github.com/Zlh23/008-obsidian_plugin.git \
  "<Vault>/.obsidian/plugins/tree-view"
```

更新代码时进入该目录执行 `git pull`，然后在 Obsidian 中重新加载插件。Git clone 适合开发和调试；它不会自动构建，也不会自动发布 Release。若入口代码发生变化，请先运行项目的构建检查，再重新加载插件。

BRAT 则使用 GitHub Release 中的 `main.js`、`manifest.json` 和 `styles.css`，适合普通安装和自动更新。两种方式不要同时安装同一个插件目录。

## 自动发布

仓库已包含 GitHub Actions 工作流。推送到 `main` 后，工作流读取 `manifest.json` 的版本号，发现对应 Tag 不存在时直接创建 GitHub Release，并上传 `main.js`、`manifest.json` 和 `styles.css`。不需要手动合并 PR。

首次启用时：

1. 将工作流文件提交并推送到 `main`。
2. 在 GitHub 的 Actions 页面确认工作流成功运行。

之后只需修改 `manifest.json` 的 `version`，提交并推送到 `main`。发布版本必须与该版本号保持一致。
