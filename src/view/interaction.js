const FocusController = {
  setFocus(id) {
    this.selected = id;
    this.focusFamily = this.relatedIds(id, this.nodeById);
    const ancestors = this.ancestorIds(id, this.nodeById);
    for (const node of this.contentEl.querySelectorAll(".usbip-node")) {
      const nodeId = node.getAttribute("data-node-id");
      node.classList.toggle("is-selected", nodeId === id);
      node.classList.toggle(
        "is-focus-ancestor",
        nodeId !== id && ancestors.has(nodeId),
      );
      node.classList.toggle("is-unrelated", !this.focusFamily.has(nodeId));
    }
    for (const edge of this.contentEl.querySelectorAll(".usbip-edge"))
      edge.classList.toggle(
        "is-unrelated",
        !this.focusFamily.has(edge.getAttribute("data-child-id")),
      );
  },
  async focusPath(path) {
    let node =
      this.nodeById?.get(path) ||
      [...(this.nodeById?.values?.() || [])].find((x) => x.path === path);
    if (!node) {
      await this.render();
      node =
        this.nodeById?.get(path) ||
        [...(this.nodeById?.values?.() || [])].find((x) => x.path === path);
    }
    if (!node) return;
    this.rootFilter = "all";
    let parent = node.parent;
    while (parent) {
      this.expanded.add(parent);
      parent = this.nodeById.get(parent)?.parent;
    }
    this.selected = node.id;
    await this.render();
    this.setFocus(node.id);
  }
};

const InteractionController = {
  async activate(n) {
    if (!this.hasVisibleChildren(n) || this.expanded.has(n.id)) {
      this.setFocus(n.id);
      await this.plugin.open(n.path, this.leaf);
      return;
    }
    this.selected = n.id;
    this.expanded.add(n.id);
    await this.render("expand");
  },
  async collapseBranch(n) {
    const ids = new Set(),
      walk = (id) => {
        ids.add(id);
        const node = this.nodeById?.get(id);
        if (node) node.children.forEach(walk);
      };
    walk(n.id);
    if (
      !this.expanded.has(n.id) &&
      ![...ids].some((id) => this.expanded.has(id))
    )
      return;
    await this.animateBranch(ids);
    for (const id of ids) this.expanded.delete(id);
    if (this.selected && ids.has(this.selected)) this.selected = null;
    await this.render("collapse");
  }
};

const TreeState = {
  progress(all) {
    const by = new Map(all.map((n) => [n.id, n]));
    for (const n of all) {
      if (n.level === 2 && (n.ownMethods?.length || n.ownTasks?.length)) {
        const items = n.ownMethods?.length ? n.ownMethods : n.ownTasks;
        n.passed = items.filter((m) => m.done).length;
        n.total = items.length;
      } else {
        n.passed = n.level === 4 && n.state === "已完成" ? 1 : 0;
        n.total = n.level === 4 ? 1 : 0;
      }
    }
    for (const level of [3, 2, 1])
      for (const n of all.filter((x) => x.level === level))
        for (const id of n.children) {
          const child = by.get(id);
          if (child) {
            n.passed += child.passed;
            n.total += child.total;
          }
        }
    for (const n of all)
      if (n.level === 2 && (n.ownMethods?.length || n.ownTasks?.length)) {
        const items = n.ownMethods?.length ? n.ownMethods : n.ownTasks;
        n.passed = items.filter((m) => m.done).length;
        n.total = items.length;
      }
  },
  hasVisibleChildren(n) {
    return n.children.some((id) => (this.nodeById?.get(id)?.level || 4) < 4);
  },
  relatedIds(id, by) {
    const out = new Set();
    if (!id || !by?.has(id)) return out;
    let cur = by.get(id);
    while (cur) {
      out.add(cur.id);
      cur = cur.parent ? by.get(cur.parent) : null;
    }
    const walk = (n) => {
      for (const child of n.children || []) {
        const c = by.get(child);
        if (c && !out.has(c.id)) {
          out.add(c.id);
          walk(c);
        }
      }
    };
    walk(by.get(id));
    return out;
  },
  ancestorIds(id, by) {
    const out = new Set(),
      start = by?.get(id);
    let cur = start?.parent ? by.get(start.parent) : null;
    while (cur) {
      out.add(cur.id);
      cur = cur.parent ? by.get(cur.parent) : null;
    }
    return out;
  }
};
module.exports = { FocusController, InteractionController, TreeState };
