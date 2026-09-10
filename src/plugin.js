const { Plugin, Notice } = require('obsidian');
const TreeView = require('./view/canvas');
const { loadConfig } = require('./core/configuration');
const parser = require('./markdown/parsing');
const documents = require('./data/model');
const { RefreshManager } = require('./core/lifecycle');
const Scanner = require('./data/scanning');
const navigation = require('./core/lifecycle');
const tableEditor = require('./markdown/editing');
const VIEW = 'tree-view';
class TreeDisplayPlugin extends Plugin {
  async loadConfig() {
    /* configuration is owned by core/config.js */
    this.config = await loadConfig(this.app.vault);
  }
  async onload() {
    await this.loadConfig();
    this.refreshing = false;
    this.refreshAgain = false;
    this.refreshNotice = false;
    this.refreshManager = new RefreshManager(this, VIEW);
    this.scanner = new Scanner({
      vault: this.app.vault,
      metadataCache: this.app.metadataCache,
      config: this.config,
      title: this.title.bind(this),
      fileState: this.fileState.bind(this),
      methods: this.methods.bind(this),
      tasks: this.tasks.bind(this),
    });
    this.registerView(VIEW, (leaf) => new TreeView(leaf, this));
    this.registerMarkdownPostProcessor((el, ctx) =>
      this.enhanceTaskTables(el, ctx),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => this.syncFocus(file)),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) =>
        this.syncFocus(leaf?.view?.file),
      ),
    );
    this.registerEvent(
      this.app.vault.on("modify", (f) => {
        if (f.path.endsWith(".md")) this.requestRefresh();
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", () => this.requestRefresh()),
    );
    this.registerEvent(
      this.app.vault.on("delete", () => this.requestRefresh()),
    );
    this.registerEvent(
      this.app.vault.on("rename", () => this.requestRefresh()),
    );
    this.addCommand({
      id: "open-usbip-tree",
      name: "打开树状显示",
      callback: () => this.openTree(),
    });
    this.addCommand({
      id: "refresh-usbip-status",
      name: "刷新树状显示",
      callback: () => this.requestRefresh({ immediate: true, notice: true }),
    });
  }
  onunload() {
    window.clearTimeout(this.refreshTimer);
  }
  requestRefresh({ immediate = false, notice = false } = {}) {
    return this.refreshManager.request({ immediate, notice });
    this.refreshNotice = this.refreshNotice || notice;
    window.clearTimeout(this.refreshTimer);
    if (immediate) return this.flushRefresh();
    this.refreshTimer = window.setTimeout(() => this.flushRefresh(), 180);
  }
  async flushRefresh() {
    return this.refreshManager.flush();
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.refreshAgain = false;
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW))
          await leaf.view.render();
      } while (this.refreshAgain);
      if (this.refreshNotice) new Notice("USB透传层级图已刷新");
    } finally {
      this.refreshNotice = false;
      this.refreshing = false;
    }
  }
  async syncFocus(file) {
    if (!file?.path) return;
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW))
      await leaf.view.focusPath(file.path);
  }
  tasks(text) {
    return parser.tasks(text);
  }
  methods(text) {
    return parser.methods(text);
  }
  async title(file, fallback) {
    return documents.title(this.app.vault, file, fallback);
  }
  async fileState(file) {
    return documents.state(this.app.vault, this.app.metadataCache, file, this.tasks.bind(this));
  }
  async rootSpecs() { return this.scanner.rootSpecs(); }
  async nodes() { return this.scanner.nodes(); }
  async enhanceTaskTables(el, ctx) { return tableEditor.enhanceTaskTables(this, el, ctx); }
  async writeTask(file, task, box) {
    const checked = box.checked;
    box.disabled = true;
    try {
      await updateChecklist(this.app.vault, file, task, checked);
      feedback.success(task, checked);
      await this.requestRefresh({ immediate: true });
    } catch (error) {
      feedback.failure(box, checked, error);
    } finally {
      box.disabled = false;
    }
  }
  async openTree() {
    return navigation.openTree(this.app, VIEW);
  }
  async open(path, sourceLeaf) {
    return navigation.openFile(this.app, path, sourceLeaf);
  }
}
module.exports = TreeDisplayPlugin;
