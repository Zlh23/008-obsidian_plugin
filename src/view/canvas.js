const { ItemView } = require('obsidian');
const VIEW = 'tree-view';
class TreeView extends ItemView { constructor(leaf, plugin) { super(leaf); this.plugin = plugin; this.orientation = 'horizontal'; this.rootFilter = 'all'; this.selected = null; this.expanded = new Set(); this.renderToken = 0; } getViewType() { return VIEW; } getDisplayText() { return '树状显示'; } getIcon() { return 'git-fork'; } async onOpen() { await this.render(); } async render(motion = null) { return renderCycle(this, motion); } }
const LAYOUT_DEFAULTS = Object.freeze({ nodeWidth: 190, nodeHeight: 58, padding: 58, rankGap: 96 });

function mergeLayout(overrides = {}) {
  return { ...LAYOUT_DEFAULTS, ...overrides };
}


function layoutTree(nodes, { vertical = false, wrap = (label) => [label], padding = 58, rankGap = 96 } = {}) {
  const map = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => !node.parent || !map.has(node.parent));
  const children = (node) => node.children.map((id) => map.get(id)).filter(Boolean);
  const span = (node) => {
    const lines = wrap(node.label, node.level === 4 ? 9 : 8);
    const own = vertical ? Math.max(54, Math.min(128, Math.max(...lines.map((line) => [...line].length)) * 10 + 20)) : lines.length > 1 ? 58 : 50;
    const kids = children(node);
    if (!kids.length) return (node.span = own);
    return (node.span = Math.max(own, kids.reduce((sum, child) => sum + span(child), 0) + 10 * (kids.length - 1)));
  };
  const assign = (node, start) => {
    const kids = children(node), center = start + node.span / 2;
    if (vertical) node.x = center; else node.y = center;
    let cursor = center - (kids.reduce((sum, child) => sum + child.span, 0) + 10 * Math.max(0, kids.length - 1)) / 2;
    kids.forEach((child) => { assign(child, cursor); cursor += child.span + 10; });
  };
  let offset = padding;
  roots.forEach((root) => { span(root); assign(root, offset); offset += root.span + 42; });
  nodes.forEach((node) => { const main = padding + (node.level - 1) * rankGap; if (vertical) node.y = main; else node.x = main; });
  return { width: Math.max(360, ...nodes.map((node) => node.x + 90)), height: Math.max(300, ...nodes.map((node) => node.y + 70)) };
}


async function renderCycle(view, motion = null) {
    const host = view.contentEl,
      renderToken = ++view.renderToken,
      previous = view.lastPositions || new Map();
    host.empty();
    host.addClass("usbip-tree-view");
    try {
      const all = await view.plugin.nodes();
      if (renderToken !== view.renderToken) return;
      view.progress(all);
      const roots = all.filter(
          (n) =>
            !n.parent &&
            (view.rootFilter === "all" || n.id === view.rootFilter),
        ),
        visible = new Set(),
        byId = new Map(all.map((n) => [n.id, n]));
      view.nodeById = byId;
      view.focusFamily = view.relatedIds(view.selected, byId);
      const include = (n) => {
        visible.add(n.id);
        if (!view.expanded.has(n.id)) return;
        for (const id of n.children) {
          const child = byId.get(id);
          if (child && child.level < 4) include(child);
        }
      };
      roots.forEach(include);
      const nodes = all.filter((n) => visible.has(n.id));
      if (!nodes.length) {
        host.createDiv({
          cls: "usbip-empty",
          text: "没有找到符合目录规范的节点。请检查根目录及同名入口文件。",
        });
        return;
      }
      const viewport = host.createDiv({ cls: "usbip-tree-viewport" });
      viewport.oncontextmenu = (event) => {
        if (event.target === viewport || event.target.tagName === "svg") {
          event.preventDefault();
          const keep = new Set();
          for (const id of view.focusFamily || [])
            if (view.expanded.has(id)) keep.add(id);
          view.expanded = keep;
          view.render("collapse");
        }
      };
      const svg = viewport.createSvg("svg"),
        size = view.layout(nodes);
      svg.setAttr("viewBox", `0 0 ${size.width} ${size.height}`);
      svg.setAttr("width", "100%");
      svg.setAttr("height", "100%");
      svg.setAttr("preserveAspectRatio", "xMidYMid meet");
      svg.addClass("usbip-tree-canvas");
      const by = new Map(nodes.map((n) => [n.id, n]));
      for (const n of nodes)
        if (n.parent && by.has(n.parent)) view.line(svg, by.get(n.parent), n);
      for (const n of nodes) view.node(svg, n);
      view.lastPositions = new Map(
        nodes.map((n) => [n.id, { x: n.x, y: n.y }]),
      );
      for (const g of svg.querySelectorAll(".usbip-node")) {
        const old = previous.get(g.getAttribute("data-node-id")),
          cur = view.lastPositions.get(g.getAttribute("data-node-id"));
        if (old && cur && !view.reducedMotion()) {
          const dx = old.x - cur.x,
            dy = old.y - cur.y;
          g.animate(
            [
              { transform: `translate(${dx}px,${dy}px)` },
              { transform: "translate(0, 0)" },
            ],
            { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" },
          );
        }
      }
      if (view.selected) view.setFocus(view.selected);
    } catch (error) {
      console.error("USB透传层级图渲染失败", error);
      {
        const box = host.createEl("pre", { cls: "usbip-error" });
        box.setText(
          `层级图渲染失败\n${error?.stack || error?.message || String(error)}`,
        );
        box.style.setProperty("display", "block");
        box.style.setProperty("color", "#ff3333");
        box.style.setProperty("background", "#fff0f0");
        box.style.setProperty("white-space", "pre-wrap");
      }
    }
  }


// TreeView 的实现文件由构建脚本从旧实现迁移而来。
// 该模块只负责 Obsidian ItemView；数据扫描和 Markdown 编辑不应放在这里。
Object.assign(TreeView.prototype, require('./graphics'));
Object.assign(TreeView.prototype, require('./interaction'));
module.exports = TreeView;
