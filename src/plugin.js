const { Plugin, Notice } = require('obsidian');
const mermaidModule = require('mermaid');
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
    const renderer = mermaidModule.default || mermaidModule;
    if (typeof renderer.initialize !== "function" || typeof renderer.render !== "function") {
      throw new Error(`官方 Mermaid 导出异常：${Object.keys(renderer).join(", ")}`);
    }
    this.mermaid = renderer;
    this.navigationLeaves = { domain: null, module: null };
    this.registerMarkdownCodeBlockProcessor("controlled-mermaid", async (source, el, ctx) => {
      const id = `controlled-mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        const rawSource = String(source ?? "");
        const widthMatch = rawSource.match(/^\s*%%\s*@width\s+(auto|\d+(?:\.\d+)?)\s*$/m);
        const width = widthMatch?.[1] || "auto";
        const graphSource = (widthMatch ? rawSource.replace(widthMatch[0], "") : rawSource)
          .replace(/^\s*%%\s*@link\s+.*$/gm, "")
          .replace(/^\s*%%\{init:.*\}%%\s*$/gm, "")
          .trim();
        if (!graphSource) throw new Error("controlled-mermaid 代码块为空");
        const dark = el.ownerDocument.body?.classList.contains("theme-dark");
        const markdownWidth = Math.max(320, el.parentElement?.clientWidth || el.clientWidth || 900);
        this.configureControlledMermaid(dark, markdownWidth);
        const rendered = await this.mermaid.render(id, graphSource);
        if (typeof rendered?.svg !== "string") throw new Error("官方 Mermaid.render 未返回 SVG");
        el.empty();
        el.style.width = width === "auto" ? "100%" : `${width}px`;
        el.style.maxWidth = "100%";
        el.style.overflow = "hidden";
        el.classList.add("controlled-mermaid-block");
        const previewView = el.closest(".markdown-preview-view");
        const previewSizer = el.closest(".markdown-preview-sizer");
        for (let parent = el.parentElement; parent && parent !== previewView; parent = parent.parentElement) {
          parent.classList.add("controlled-mermaid-fill-parent");
        }
        previewView?.classList.add("controlled-mermaid-preview");
        previewSizer?.classList.add("controlled-mermaid-sizer");
        el.innerHTML = rendered.svg;
        rendered.bindFunctions?.(el);
        const svg = el.querySelector("svg");
        if (svg) {
          svg.classList.add("controlled-mermaid-svg");
          svg.removeAttribute("width");
          svg.removeAttribute("height");
          svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
          const viewBox = svg.viewBox?.baseVal;
          const naturalWidth = Math.max(1, viewBox?.width || 1);
          const naturalHeight = Math.max(1, viewBox?.height || 1);
          const fitSvg = () => {
            const availableWidth = Math.max(1, el.clientWidth);
            const availableHeight = Math.max(1, el.clientHeight);
            const scale = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
            svg.style.width = `${Math.floor(naturalWidth * scale)}px`;
            svg.style.height = `${Math.floor(naturalHeight * scale)}px`;
          };
          fitSvg();
          el.ownerDocument.defaultView.requestAnimationFrame(fitSvg);
          const ResizeObserverClass = el.ownerDocument.defaultView.ResizeObserver;
          if (ResizeObserverClass) {
            const observer = new ResizeObserverClass(fitSvg);
            observer.observe(el);
            this.register(() => observer.disconnect());
          }
          if (rawSource.includes("@link-domain") || rawSource.includes("@link-module")) {
            this.styleDomainDataFlows(svg, id);
          }
        }
        this.bindControlledMermaidLinks(el, rawSource, ctx?.sourcePath);
      } catch (error) {
        console.error("[tree-view] controlled-mermaid render failed", error);
        el.empty();
        const details = error?.stack || error?.message || String(error);
        el.createEl("pre", { text: `Mermaid 渲染失败\n${details}` });
      }
    });
    await this.loadConfig();
    this.registerDomEvent(document, "click", (event) => this.handleMermaidClick(event), true);
    this.registerDomEvent(document, "mouseover", (event) => this.handleMermaidHover(event), true);
    this.lastPointer = null;
    this.registerDomEvent(document, "mousemove", (event) => { this.lastPointer = { x: event.clientX, y: event.clientY }; }, true);
    this.registerInterval(window.setInterval(() => this.clearStaleMermaidHover(), 100));
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, popoutWindow) => this.bindMermaidWindow(popoutWindow)));
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
    this.registerMarkdownPostProcessor((el, ctx) =>
      this.enhanceMermaidLinks(el, ctx),
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
  configureControlledMermaid(dark, targetWidth) {
    // Keep Mermaid's TD direction as the primary layout constraint. Dagre
    // produces the predictable top-to-bottom arrangement needed by the
    // documentation maps; the SVG is still fitted without changing geometry.
    const nodeSpacing = targetWidth < 600 ? 10 : targetWidth < 800 ? 16 : 24;
    const wrappingWidth = Math.max(88, Math.min(160, Math.floor((targetWidth - 120) / 4 - nodeSpacing)));
    this.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: dark ? "dark" : "base",
      layout: "dagre",
      flowchart: {
        useMaxWidth: false,
        htmlLabels: true,
        wrappingWidth,
        nodeSpacing,
        rankSpacing: 48,
        curve: "basis",
      },
      themeVariables: dark ? {
        fontFamily: "var(--font-text)", background: "#1e1e1e",
        primaryColor: "#2b2d31", primaryTextColor: "#e6e6e6",
        primaryBorderColor: "#707784", lineColor: "#9aa0aa",
        clusterBkg: "#24262b", clusterBorder: "#5d6470",
        edgeLabelBackground: "#1e1e1e",
      } : {
        fontFamily: "var(--font-text)", primaryColor: "#f6f7f9",
        primaryTextColor: "#202124", primaryBorderColor: "#8b95a5",
        lineColor: "#7a8493", clusterBkg: "#fbfbfc",
        clusterBorder: "#c5cad3", edgeLabelBackground: "#ffffff",
      },
    });
  }
  bindControlledMermaidLinks(el, source, sourcePath) {
    if (sourcePath) el.setAttribute("data-obsidian-source-path", sourcePath);
    const links = [];
    for (const match of source.matchAll(/^\s*%%\s*@link-(domain|module)\s+([^\s]+)\s+(?:\[\[([^\]]+)\]\]|"([^"]+)"|'([^']+)')\s*$/gm)) {
      links.push({ target: match[1], id: match[2], path: match[3] || match[4] || match[5] });
    }
    const svg = el.querySelector("svg");
    if (!svg) return;
    const groups = [...svg.querySelectorAll("g")];
    for (const link of links) {
      const group = groups.find((candidate) => {
        const id = candidate.getAttribute("id") || "";
        if (link.target === "domain") return candidate.classList.contains("cluster") && (id === link.id || id.includes(link.id));
        return candidate.classList.contains("node") && (id === link.id || id.startsWith(`flowchart-${link.id}-`) || candidate.getAttribute("data-id") === link.id);
      });
      if (!group) continue;
      group.dataset.obsidianLink = link.path;
      group.dataset.obsidianTarget = link.target;
      group.classList.add("obsidian-mermaid-link", `obsidian-mermaid-${link.target}`);
      group.setAttribute("tabindex", "0");
      group.setAttribute("role", "link");
      group.setAttribute("aria-label", `打开${link.target === "domain" ? "领域" : "模块"}：${link.path}`);
      group.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.openInNavigationLeaf(link.path, link.target);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void this.openInNavigationLeaf(link.path, link.target);
      });
    }
  }
  styleDomainDataFlows(svg, renderId) {
    const namespace = "http://www.w3.org/2000/svg";
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = svg.ownerDocument.createElementNS(namespace, "defs");
      svg.prepend(defs);
    }
    const paths = [...svg.querySelectorAll("g.edgePaths path, path.flowchart-link")]
      .filter((path) => !path.closest("defs"));
    paths.forEach((path, index) => {
      let length;
      try { length = path.getTotalLength(); } catch (_) { return; }
      if (!length) return;
      const start = path.getPointAtLength(0);
      const end = path.getPointAtLength(length);
      const gradientId = `${renderId}-flow-${index}`;
      const gradient = svg.ownerDocument.createElementNS(namespace, "linearGradient");
      gradient.setAttribute("id", gradientId);
      gradient.setAttribute("gradientUnits", "userSpaceOnUse");
      gradient.setAttribute("x1", String(start.x));
      gradient.setAttribute("y1", String(start.y));
      gradient.setAttribute("x2", String(end.x));
      gradient.setAttribute("y2", String(end.y));
      for (const [offset, color] of [["0%", "#d6a500"], ["48%", "#b8a44d"], ["100%", "#4da3ff"]]) {
        const stop = svg.ownerDocument.createElementNS(namespace, "stop");
        stop.setAttribute("offset", offset);
        stop.setAttribute("stop-color", color);
        gradient.appendChild(stop);
      }
      defs.appendChild(gradient);
      path.style.setProperty("stroke", `url(#${gradientId})`, "important");
      const markerEnd = path.getAttribute("marker-end") || path.style.markerEnd || "";
      const markerId = markerEnd.match(/#([^)'\"]+)/)?.[1];
      const marker = markerId ? svg.querySelector(`marker[id="${markerId}"]`) : null;
      if (marker) {
        const clonedMarker = marker.cloneNode(true);
        const clonedId = `${renderId}-arrow-${index}`;
        clonedMarker.setAttribute("id", clonedId);
        clonedMarker.querySelectorAll("path, polygon").forEach((shape) => {
          shape.setAttribute("fill", "#4da3ff");
          shape.setAttribute("stroke", "#4da3ff");
        });
        defs.appendChild(clonedMarker);
        path.setAttribute("marker-end", `url(#${clonedId})`);
      }
    });
  }
  async openInNavigationLeaf(path, target) {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    let leaf = this.navigationLeaves[target];
    if (!leaf || !markdownLeaves.includes(leaf)) {
      leaf = markdownLeaves.find((candidate) => this.isNavigationLeaf(candidate, target));
    }
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("split", "vertical");
      this.navigationLeaves[target] = leaf;
    }
    this.navigationLeaves[target] = leaf;
    if (leaf.containerEl) leaf.containerEl.dataset.treeViewNavigationTarget = target;
    return navigation.openFileInLeaf(this.app, path, leaf);
  }
  isNavigationLeaf(leaf, target) {
    if (leaf.containerEl?.dataset.treeViewNavigationTarget === target) return true;
    const filePath = leaf.view?.file?.path || "";
    const match = filePath.match(/^my-skills\/项目开发流程\/([^/]+)\/([^/]+)\.md$/);
    if (!match) return false;
    const isDomainEntry = match[1] === match[2];
    return target === "domain" ? isDomainEntry : !isDomainEntry;
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
  async enhanceMermaidLinks(el, ctx) {
    const sourcePath = ctx?.sourcePath;
    if (!sourcePath) return;
    el.setAttribute("data-obsidian-source-path", sourcePath);
    el.closest?.(".mermaid, .block-language-mermaid")?.setAttribute("data-obsidian-source-path", sourcePath);
    const source = await this.app.vault.adapter.read(sourcePath).catch(() => "");
    const links = new Map();
    for (const match of source.matchAll(/^\s*%%\s*@link\s+([^\s]+)\s+(?:\[\[([^\]]+)\]\]|"([^"]+)"|'([^']+)')\s*$/gm)) {
      links.set(match[1], match[2] || match[3] || match[4]);
    }
    if (!links.size) return;
    const findSvgs = () => el.matches?.("svg") ? [el] : [...el.querySelectorAll("svg")];
    for (let attempt = 0; attempt < 30 && !findSvgs().length; attempt++)
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    for (const svg of findSvgs()) {
      const candidates = [...svg.querySelectorAll("g.node, g[id^='flowchart-'], g")];
      for (const [nodeId, path] of links) {
        const node = candidates.find((candidate) => {
          const id = candidate.getAttribute("id") || "";
          return id === nodeId || id.startsWith(`flowchart-${nodeId}-`) || id.includes(`-${nodeId}-`) || id.includes(`flowchart-${nodeId}`) || candidate.getAttribute("data-id") === nodeId;
        });
        if (!node || node.dataset.obsidianLink) continue;
        node.dataset.obsidianLink = path;
        node.classList.add("obsidian-mermaid-link");
        node.setAttribute("title", `打开：${path}`);
        node.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.open(path, this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView)?.leaf);
        });
      }
    }
  }
  async handleMermaidClick(event, preview = false) {
    const element = event.target?.closest?.(".mermaid svg g, .block-language-mermaid svg g");
    if (!element) return;
    const container = event.target?.closest?.(".mermaid, .block-language-mermaid");
    const sourcePath = container?.getAttribute("data-obsidian-source-path") || this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView)?.file?.path;
    if (!sourcePath) return;
    const active = this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView);
    let node = element.closest("g.node, g[id^='flowchart-'], g[data-id]") || element;
    if (!preview) node = node.ownerDocument.querySelector(".obsidian-mermaid-hover") || node;
    const rawId = node.getAttribute("data-id") || node.getAttribute("id") || "";
    const nodeId = rawId.match(/^flowchart-(.+?)-[0-9]+$/)?.[1] || rawId;
    const source = await this.app.vault.adapter.read(sourcePath).catch(() => "");
    const match = [...source.matchAll(new RegExp(`^\\s*%%\\s*@link\\s+${nodeId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s+(?:\\[\\[([^\\]]+)\\]\\]|"([^"]+)"|'([^']+)')\\s*$`, "gm"))][0];
    const path = match?.[1] || match?.[2] || match?.[3];
    if (!path) return;
    const svg = node.closest("svg");
    svg?.querySelectorAll(".obsidian-mermaid-hover").forEach((item) => { item.classList.remove("obsidian-mermaid-hover"); this.setMermaidHoverStyle(item, false); });
    node.ownerDocument.querySelectorAll(".obsidian-mermaid-focus").forEach((item) => { this.clearMermaidInlineStyle(item); item.classList.remove("obsidian-mermaid-focus"); this.restoreMermaidShape(item); });
    node.classList.toggle("obsidian-mermaid-hover", preview);
    if (preview) this.setMermaidHoverStyle(node, true);
    if (!preview) this.setMermaidFocusStyle(node, true);
    if (!preview) {
      event.preventDefault();
      event.stopPropagation();
      await this.open(path, active?.leaf);
    }
  }
  handleMermaidHover(event) {
    if (event.target?.closest?.(".mermaid svg g, .block-language-mermaid svg g"))
      void this.handleMermaidClick(event, true);
  }
  clearStaleMermaidHover() {
    if (!this.lastPointer) return;
    const under = document.elementFromPoint(this.lastPointer.x, this.lastPointer.y);
    document.querySelectorAll(".obsidian-mermaid-hover").forEach((node) => {
      if (!under || !node.contains(under)) { node.classList.remove("obsidian-mermaid-hover"); this.setMermaidHoverStyle(node, false); }
    });
  }
  bindMermaidWindow(workspaceWindow) {
    const doc = workspaceWindow?.document;
    if (!doc || doc === document || doc.body?.dataset.treeViewMermaidBound) return;
    doc.body.dataset.treeViewMermaidBound = "true";
    doc.addEventListener("click", (event) => this.handleMermaidClick(event), true);
    doc.addEventListener("mouseover", (event) => this.handleMermaidHover(event), true);
    this.registerEvent(this.app.workspace.on("layout-change", () => {}));
  }
  setMermaidHoverStyle(node, active) {
    node.style.cursor = active ? "pointer" : "";
    node.querySelectorAll("rect, polygon, circle, ellipse").forEach((shape) => {
      shape.style.setProperty("stroke", active ? "#4da3ff" : "");
      shape.style.setProperty("stroke-width", active ? "3px" : "");
      shape.style.setProperty("filter", active ? "drop-shadow(0 0 6px rgba(77,163,255,.95))" : "");
    });
    node.querySelectorAll(".label, .nodeLabel").forEach((label) => label.style.setProperty("fill", active ? "#4da3ff" : ""));
  }
  setMermaidFocusStyle(node, active) {
    node.querySelectorAll("rect, polygon, circle, ellipse").forEach((shape) => {
      shape.style.setProperty("stroke", active ? "#ffd43b" : "");
      shape.style.setProperty("stroke-width", active ? "3px" : "");
      shape.style.setProperty("filter", active ? "drop-shadow(0 0 6px rgba(255,212,59,.95))" : "");
    });
    node.querySelectorAll(".label, .nodeLabel").forEach((label) => { label.style.setProperty("fill", active ? "#ffd43b" : ""); label.style.setProperty("font-weight", active ? "800" : ""); });
  }
  clearMermaidInlineStyle(node) {
    node.querySelectorAll("rect, polygon, circle, ellipse, path").forEach((shape) => { shape.style.removeProperty("stroke"); shape.style.removeProperty("stroke-width"); shape.style.removeProperty("filter"); shape.style.removeProperty("cursor"); });
    node.querySelectorAll(".label, .nodeLabel").forEach((label) => { label.style.removeProperty("fill"); label.style.removeProperty("font-weight"); });
  }
  makeMermaidHexagon(node) {
    const shape = node.querySelector("rect, polygon, circle, ellipse, path") || [...node.children].find((child) => child instanceof node.ownerDocument.defaultView.SVGElement);
    if (!shape || node.dataset.originalMermaidShape) return;
    node.dataset.originalMermaidShape = shape.outerHTML;
    let box;
    try { box = shape.getBBox(); } catch (_) { box = null; }
    if (!box || !box.width || !box.height) {
      const x = Number(shape.getAttribute("x") || 0), y = Number(shape.getAttribute("y") || 0);
      const width = Number(shape.getAttribute("width") || 100), height = Number(shape.getAttribute("height") || 50);
      box = { x, y, width, height };
    }
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const rx = Math.max(box.width / 2, 28), ry = Math.max(box.height / 2, 26), points = [];
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 6 + i * Math.PI / 3; points.push(`${cx + rx * Math.cos(a)},${cy + ry * Math.sin(a)}`); }
    const hex = node.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "polygon");
    hex.setAttribute("points", points.join(" ")); hex.setAttribute("fill", shape.getAttribute("fill") || "currentColor");
    hex.setAttribute("stroke", shape.getAttribute("stroke") || "#ffd43b"); hex.setAttribute("stroke-width", "5");
    shape.replaceWith(hex);
  }
  restoreMermaidShape(node) {
    const original = node.dataset.originalMermaidShape, current = node.querySelector("rect, polygon, circle, ellipse");
    if (!original || !current) return;
    current.insertAdjacentHTML("afterend", original); current.remove(); delete node.dataset.originalMermaidShape;
  }
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
