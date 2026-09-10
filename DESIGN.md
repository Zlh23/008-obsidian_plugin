# 树状显示设计说明

源码按 Domain 聚合，Module 使用文件表示：

```text
src/
├── core/       configuration.js, lifecycle.js
├── data/       scanning.js, model.js
├── markdown/   parsing.js, editing.js
└── view/       canvas.js, interaction.js, graphics.js
```

`plugin.js` 只负责 Obsidian 生命周期和模块组装；每个 Domain 内的 Module 聚合同一概念范围的实现。
