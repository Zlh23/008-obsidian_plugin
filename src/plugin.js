const { Plugin } = require('obsidian');
const mermaidModule = require('mermaid');
const navigation = require('./core/lifecycle');
class TreeDisplayPlugin extends Plugin {
  async onload() {
    const renderer = mermaidModule.default || mermaidModule;
    if (typeof renderer.initialize !== "function" || typeof renderer.render !== "function") {
      throw new Error(`官方 Mermaid 导出异常：${Object.keys(renderer).join(", ")}`);
    }
    this.mermaid = renderer;
    this.navigationLeaves = { domain: null, module: null };
    this.domainColorAssignments = new Map();
    this.nextDomainColor = 0;
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
          this.ensureSequenceArrows(svg, dark);
        }
        this.bindControlledMermaidLinks(el, rawSource, ctx?.sourcePath);
        if (svg && rawSource.includes("@link-module")) {
          this.styleDomainInterfaces(svg, rawSource, ctx?.sourcePath);
        }
      } catch (error) {
        console.error("[tree-view] controlled-mermaid render failed", error);
        el.empty();
        const details = error?.stack || error?.message || String(error);
        el.createEl("pre", { text: `Mermaid 渲染失败\n${details}` });
      }
    });
    this.registerDomEvent(document, "click", (event) => this.handleMermaidClick(event), true);
    this.registerDomEvent(document, "mouseover", (event) => this.handleMermaidHover(event), true);
    this.lastPointer = null;
    this.registerDomEvent(document, "mousemove", (event) => { this.lastPointer = { x: event.clientX, y: event.clientY }; }, true);
    this.registerInterval(window.setInterval(() => this.clearStaleMermaidHover(), 100));
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, popoutWindow) => this.bindMermaidWindow(popoutWindow)));
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
    const interfaceLinks = [];
    for (const match of source.matchAll(/^\s*%%\s*@link-interface\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))\s+(?:\[\[([^\]]+)\]\]|"([^"]+)"|'([^']+)')\s*$/gm)) {
      interfaceLinks.push({
        label: match[1] || match[2] || match[3],
        path: match[4] || match[5] || match[6],
      });
    }
    const links = [];
    for (const match of source.matchAll(/^\s*%%\s*@link-(domain|module)\s+([^\s]+)\s+(?:\[\[([^\]]+)\]\]|"([^"]+)"|'([^']+)')\s*$/gm)) {
      links.push({ target: match[1], id: match[2], path: match[3] || match[4] || match[5] });
    }
    const svg = el.querySelector("svg");
    if (!svg) return;
    this.bindSequenceInterfaceLinks(svg, interfaceLinks, sourcePath);
    const groups = [...svg.querySelectorAll("g")];
    for (const link of links) {
      const group = groups.find((candidate) => {
        const id = candidate.getAttribute("id") || "";
        const matchesNode = candidate.classList.contains("node") &&
          (id === link.id || id.startsWith(`flowchart-${link.id}-`) || candidate.getAttribute("data-id") === link.id);
        if (matchesNode) return true;
        return link.target === "domain" && candidate.classList.contains("cluster") &&
          (id === link.id || id.includes(link.id));
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
        void this.openInNavigationLeaf(link.path, link.target, sourcePath);
      });
      group.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void this.openInNavigationLeaf(link.path, link.target, sourcePath);
      });
    }
  }
  bindSequenceInterfaceLinks(svg, links, sourcePath) {
    if (!links.length) return;
    const labels = [...svg.querySelectorAll(".messageText")];
    for (const link of links) {
      const color = "#ffd43b";
      const matches = labels.filter((label) => label.textContent.trim() === link.label);
      for (const label of matches) {
        label.dataset.obsidianLink = link.path;
        label.dataset.obsidianTarget = "domain";
        label.classList.add("obsidian-mermaid-link", "obsidian-mermaid-interface");
        label.style.setProperty("fill", color, "important");
        label.style.setProperty("color", color, "important");
        this.styleSequenceMessage(label, color);
        label.setAttribute("tabindex", "0");
        label.setAttribute("role", "link");
        label.setAttribute("aria-label", `打开领域：${link.path}`);
        label.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.openInNavigationLeaf(link.path, "domain", sourcePath);
        });
        label.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          void this.openInNavigationLeaf(link.path, "domain", sourcePath);
        });
      }
    }
  }
  styleSequenceMessage(label, color) {
    // Mermaid places the message label and its line in the same message group.
    // Find that group instead of guessing a generated element id.
    let group = label.parentElement;
    while (group && group !== label.ownerDocument.documentElement) {
      const lines = group.querySelectorAll?.(".messageLine0, .messageLine1, line.messageLine0, line.messageLine1") || [];
      if (lines.length) {
        for (const line of lines) {
          line.style.setProperty("stroke", color, "important");
          line.style.setProperty("stroke-width", "2px", "important");
          for (const attribute of ["marker-start", "marker-end"]) {
            const value = line.getAttribute(attribute) || "";
            const markerId = value.match(/#([^)\'"]+)/)?.[1];
            if (!markerId) continue;
            const marker = label.ownerDocument.querySelector(`marker[id="${CSS.escape(markerId)}"]`);
            if (!marker) continue;
            marker.querySelectorAll("path, polygon, polyline").forEach((shape) => {
              shape.style.setProperty("fill", color, "important");
              shape.style.setProperty("stroke", color, "important");
            });
          }
        }
        return;
      }
      group = group.parentElement;
    }
  }
  domainColor(path, sourcePath) {
    const resolved = navigation.resolveFile(this.app, path, sourcePath);
    const key = resolved?.path || `${sourcePath || ""}:${path || ""}`;
    return this.domainColorForKey(key);
  }
  domainColorForKey(key) {
    const palette = [
      "#4da3ff", "#ffd43b", "#b780ff", "#39d98a",
      "#ff7a90", "#ff9f43", "#4dd9d0", "#f472d0",
      "#8bd450", "#70a5ff", "#e6a6ff", "#ff6b4a",
    ];
    if (!this.domainColorAssignments.has(key)) {
      const color = palette[this.nextDomainColor % palette.length];
      this.domainColorAssignments.set(key, color);
      this.nextDomainColor += 1;
    }
    return this.domainColorAssignments.get(key);
  }
  styleDomainInterfaces(svg, source, sourcePath) {
    if (!sourcePath) return;
    const graphSource = source.replace(/^\s*%%.*$/gm, "");
    const interfaceIds = new Set(
      [...graphSource.matchAll(/\b([A-Za-z_][\w-]*)\s*\[\[[^\]]/g)].map((match) => match[1]),
    );
    if (!interfaceIds.size) return;
    const color = this.domainColorForKey(sourcePath);
    // Module clusters use Mermaid's current theme. Domain color belongs only
    // to the boundary interfaces, never to the module container or methods.
    for (const cluster of svg.querySelectorAll("g.cluster")) {
      cluster.classList.remove("obsidian-mermaid-module-frame");
      cluster.style.removeProperty("--domain-color");
      for (const shape of cluster.querySelectorAll(":scope > rect, :scope > polygon, :scope > path")) {
        shape.style.removeProperty("fill");
        shape.style.removeProperty("stroke");
        shape.style.removeProperty("stroke-width");
      }
      for (const label of cluster.querySelectorAll(".cluster-label text, .cluster-label span")) {
        label.style.removeProperty("color");
        label.style.removeProperty("fill");
        label.style.removeProperty("font-weight");
      }
    }
    const nodes = [...svg.querySelectorAll("g.node")];
    for (const interfaceId of interfaceIds) {
      const node = nodes.find((candidate) => {
        const id = candidate.getAttribute("id") || "";
        return id === interfaceId || id.startsWith(`flowchart-${interfaceId}-`) ||
          candidate.getAttribute("data-id") === interfaceId;
      });
      if (!node) continue;
      node.classList.add("obsidian-mermaid-domain-interface");
      node.style.setProperty("--domain-color", color);
      const shapes = node.querySelectorAll("rect, polygon, path, circle, ellipse, .label-container");
      for (const shape of shapes) {
        shape.style.setProperty("fill", "transparent", "important");
        shape.style.setProperty("stroke", color, "important");
        shape.style.setProperty("stroke-width", "2.5px", "important");
      }
      for (const label of node.querySelectorAll(".nodeLabel, text, span, p")) {
        label.style.setProperty("color", color, "important");
        label.style.setProperty("fill", color, "important");
        label.style.setProperty("font-weight", "700", "important");
      }
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
  ensureSequenceArrows(svg, dark) {
    const namespace = "http://www.w3.org/2000/svg";
    let defs = svg.querySelector("defs");
    if (!defs) {
      defs = svg.ownerDocument.createElementNS(namespace, "defs");
      svg.prepend(defs);
    }
    const visibleColor = dark ? "#d7dee8" : "#30343b";
    const markerBySource = new Map();
    const markerSelector = '[marker-end], [marker-start]';
    for (const line of svg.querySelectorAll(markerSelector)) {
      for (const attribute of ["marker-start", "marker-end"]) {
        const markerValue = line.getAttribute(attribute) || "";
        const markerId = markerValue.match(/#([^)\'"]+)/)?.[1];
        if (!markerId) continue;
        const marker = svg.querySelector(`marker[id="${CSS.escape(markerId)}"]`);
        if (!marker) continue;
        let replacementId = markerBySource.get(markerId);
        if (!replacementId) {
          replacementId = `${svg.id || "controlled-mermaid"}-visible-arrow-${markerBySource.size}`;
          const replacement = marker.cloneNode(true);
          replacement.setAttribute("id", replacementId);
          replacement.querySelectorAll("path, polygon, polyline").forEach((shape) => {
            shape.setAttribute("fill", visibleColor);
            shape.setAttribute("stroke", visibleColor);
            shape.style.setProperty("fill", visibleColor, "important");
            shape.style.setProperty("stroke", visibleColor, "important");
            shape.style.setProperty("stroke-width", "1.2px", "important");
          });
          defs.appendChild(replacement);
          markerBySource.set(markerId, replacementId);
        }
        line.setAttribute(attribute, `url(#${replacementId})`);
      }
    }
  }
  async openInNavigationLeaf(path, target, sourcePath) {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    let leaf = this.navigationLeaves[target];
    if (!leaf || !markdownLeaves.includes(leaf)) {
      leaf = markdownLeaves.find((candidate) =>
        candidate.containerEl?.dataset.treeViewNavigationTarget === target,
      );
    }
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("split", "vertical");
      this.navigationLeaves[target] = leaf;
    }
    this.navigationLeaves[target] = leaf;
    if (leaf.containerEl) leaf.containerEl.dataset.treeViewNavigationTarget = target;
    return navigation.openFileInLeaf(this.app, path, leaf, sourcePath);
  }
  onunload() {
    this.navigationLeaves = { domain: null, module: null };
  }
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
          this.open(path, this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView)?.leaf, sourcePath);
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
      await this.open(path, active?.leaf, sourcePath);
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
  async open(path, sourceLeaf, sourcePath) {
    return navigation.openFile(this.app, path, sourceLeaf, sourcePath);
  }
}
module.exports = TreeDisplayPlugin;
