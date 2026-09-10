const { Notice } = require('obsidian');

async function openTree(app, viewType) {
  let leaf = app.workspace.getLeavesOfType(viewType)[0];
  if (!leaf) { leaf = app.workspace.getLeaf(true); await leaf.setViewState({ type: viewType, active: true }); }
  app.workspace.revealLeaf(leaf);
}

async function openFile(app, path, sourceLeaf) {
  const file = app.vault.getAbstractFileByPath(path);
  if (!file) return new Notice(`文件不存在：${path}`);
  let target = app.workspace.getLeavesOfType('markdown').find((leaf) => leaf !== sourceLeaf);
  if (!target) target = app.workspace.getLeaf('split', 'vertical');
  await target.openFile(file);
  app.workspace.revealLeaf(target);
}


class RefreshManager {
  constructor(plugin, viewType) { this.plugin = plugin; this.viewType = viewType; this.timer = null; this.running = false; this.again = false; this.notice = false; }
  request({ immediate = false, notice = false } = {}) { this.notice ||= notice; clearTimeout(this.timer); if (immediate) return this.flush(); this.timer = setTimeout(() => this.flush(), 180); }
  async flush() { if (this.running) { this.again = true; return; } this.running = true; try { do { this.again = false; for (const leaf of this.plugin.app.workspace.getLeavesOfType(this.viewType)) await leaf.view.render(); } while (this.again); } finally { this.notice = false; this.running = false; } }
}

module.exports = { openTree, openFile, RefreshManager };
