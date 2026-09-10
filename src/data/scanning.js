const { TFolder, TFile } = require('obsidian');

class Scanner {
  constructor({ vault, metadataCache, config, title, fileState, methods, tasks }) { this.vault = vault; this.metadataCache = metadataCache; this.config = config; this.title = title; this.fileState = fileState; this.methods = methods; this.tasks = tasks; }
  ordered(folder, text) { return folder.children.filter((item) => item instanceof TFolder).sort((a, b) => a.name.localeCompare(b.name)); }
  orderedModules(folder, text) { return folder.children.filter((item) => item instanceof TFile && item.extension === 'md' && item.basename !== folder.name && this.metadataCache.getFileCache(item)?.frontmatter?.type === 'module').sort((a, b) => a.name.localeCompare(b.name)); }
  async rootSpecs() {
    const root = this.vault.getRoot(),
      specs = [],
      configured = this.config?.roots || [];
    const folders = configured.length
      ? configured.map((path) => this.vault.getAbstractFileByPath(path)).filter((x) => x instanceof TFolder)
      : root.children.filter((x) => x instanceof TFolder && !x.name.startsWith("."));
    for (const folder of folders) {
      const index = `${folder.path}/${folder.name}.md`,
        file = this.vault.getAbstractFileByPath(index);
      if (file instanceof TFile)
        specs.push({
          dir: folder.path,
          index,
          label: await this.title(file, folder.name),
        });
    }
    return specs;
  }
  async nodes() {
    const nodes = [];
    for (const spec of await this.rootSpecs()) {
      const rf = this.vault.getAbstractFileByPath(spec.index);
      if (!(rf instanceof TFile)) continue;
      const root = {
        id: spec.index,
        label: spec.label,
        level: 1,
        parent: null,
        path: spec.index,
        state: await this.fileState(rf),
        children: [],
      };
      nodes.push(root);
      const folder = this.vault.getAbstractFileByPath(spec.dir);
      if (!(folder instanceof TFolder)) continue;
      const rootText = await this.vault.read(rf);
      for (const lf of this.ordered(folder, rootText)) {
        const lp = `${lf.path}/${lf.name}.md`,
          lfile = this.vault.getAbstractFileByPath(lp);
        if (!(lfile instanceof TFile)) continue;
        const layer = {
          id: lp,
          label: await this.title(lfile, lf.name),
          level: 2,
          parent: root.id,
          path: lp,
          state: await this.fileState(lfile),
          children: [],
          ownMethods: this.methods(await this.vault.read(lfile)),
          ownTasks: this.tasks(await this.vault.read(lfile)),
        };
        nodes.push(layer);
        root.children.push(layer.id);
        const layerText = await this.vault.read(lfile);
        for (const mfile of this.orderedModules(lf, layerText)) {
          const mp = mfile.path,
            module = {
              id: mp,
              label: await this.title(mfile, mfile.basename),
              level: 3,
              parent: layer.id,
              path: mp,
              state: await this.fileState(mfile),
              children: [],
            };
          nodes.push(module);
          layer.children.push(module.id);
          for (const method of this.methods(await this.vault.read(mfile))) {
            const item = {
              id: `${mp}#method-${method.line}`,
              label: method.label,
              level: 4,
              parent: module.id,
              path: mp,
              state: method.done ? "已完成" : "未开始",
              children: [],
            };
            nodes.push(item);
            module.children.push(item.id);
          }
        }
      }
    }
    const by = new Map(nodes.map((n) => [n.id, n]));
    for (const level of [3, 2, 1])
      for (const n of nodes.filter(
        (x) => x.level === level && x.children.length,
      )) {
        const kids = n.children.map((id) => by.get(id)).filter(Boolean);
        n.state = kids.every((x) => x.state === "已完成")
          ? "已完成"
          : kids.some((x) => x.state !== "未开始")
            ? "进行中"
            : "未开始";
      }
    return nodes;
  }
}
module.exports = Scanner;
