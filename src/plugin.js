const { Plugin, Notice } = require('obsidian');
const mermaidModule = require('mermaid');
const navigation = require('./core/lifecycle');

const NAVIGATION_TARGETS = ['project', 'environment', 'domain', 'module', 'type'];
const NAVIGATION_LAYOUT_VERSION = "4";

class TreeDisplayPlugin extends Plugin {
  async onload() {
    const renderer = mermaidModule.default || mermaidModule;
    if (typeof renderer.initialize !== "function" || typeof renderer.render !== "function") {
      throw new Error(`官方 Mermaid 导出异常：${Object.keys(renderer).join(", ")}`);
    }
    this.mermaid = renderer;
    this.navigationLeaves = Object.fromEntries(NAVIGATION_TARGETS.map((target) => [target, null]));
    this.navigationLeavesReady = null;
    this.domainColorAssignments = new Map();
    this.nextDomainColor = 0;
    this.addCommand({
      id: "open-navigation-leaves",
      name: "Open Navigation Leaves",
      callback: () => void this.ensureNavigationLeaves(),
    });
    this.addCommand({
      id: "close-navigation-leaves",
      name: "Close Navigation Leaves",
      callback: () => this.closeNavigationLeaves(),
    });
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
        const isProjectDocument = /(^|\/)\_\_Project\.md$/.test(String(ctx?.sourcePath || ""));
        el.classList.toggle("controlled-mermaid-project", isProjectDocument);
        const previewView = el.closest(".markdown-preview-view");
        const previewSizer = el.closest(".markdown-preview-sizer");
        const sourceDir = String(ctx?.sourcePath || "").replace(/\/[^/]*$/, "");
        for (const description of previewView?.querySelectorAll?.(".controlled-domain-description[data-domain]") || []) {
          const domainPath = `${sourceDir}/${description.dataset.domain}.md`;
          description.style.setProperty("--domain-color", this.domainColor(domainPath, ctx?.sourcePath), "important");
        }
        const interfaceCard = el.closest?.('.callout[data-callout="usb-interface"]');
        if (interfaceCard && ctx?.sourcePath) {
          interfaceCard.style.setProperty("--domain-color", this.domainColor(ctx.sourcePath, ctx.sourcePath), "important");
        }
        if (isProjectDocument) {
          for (let parent = el.parentElement; parent && parent !== previewView; parent = parent.parentElement) {
            parent.classList.add("controlled-mermaid-fill-parent");
          }
          previewView?.classList.add("controlled-mermaid-preview");
          previewSizer?.classList.add("controlled-mermaid-sizer");
        } else {
          previewView?.classList.remove("controlled-mermaid-preview");
          previewSizer?.classList.remove("controlled-mermaid-sizer");
        }
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
            const availableHeight = isProjectDocument ? Math.max(1, el.clientHeight) : naturalHeight;
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
          this.ensureSequenceArrows(svg, dark);
        }
        if (!this.isModuleDocument(ctx?.sourcePath)) {
          this.bindControlledMermaidLinks(el, rawSource, ctx?.sourcePath);
        }
        if (svg && (rawSource.includes("@link-module") || rawSource.includes("@link-interface"))) {
          this.styleDomainInterfaces(svg, rawSource, ctx?.sourcePath);
        }
      } catch (error) {
        console.error("[tree-view] controlled-mermaid render failed", error);
        el.empty();
        const details = error?.stack || error?.message || String(error);
        el.createEl("pre", { text: `Mermaid 渲染失败\n${details}` });
      }
    });
    this.registerMarkdownPostProcessor((element, ctx) => {
      const sourcePath = String(ctx?.sourcePath || "");
      const sourceName = sourcePath.split("/").pop() || "";
      const isEnvironmentDocument = /^_[^/]+-ENV\.md$/i.test(sourceName);
      if (isEnvironmentDocument) {
        for (const link of [...element.querySelectorAll("a.internal-link")]) {
          const target = link.dataset.href || link.getAttribute("href") || "";
          const resolved = navigation.resolveFile(this.app, target, sourcePath);
          if (!resolved?.path) continue;
          const targetName = resolved.path.split("/").pop() || "";
          if (!targetName.endsWith(".md") || /^_[^/]+-ENV\.md$/i.test(targetName)) continue;
          link.classList.add("controlled-domain-link");
          link.style.setProperty("--domain-color", this.domainColor(resolved.path, sourcePath), "important");
        }
      }
      for (const table of [...element.querySelectorAll('.callout[data-callout="usb-interface"] table, .callout[data-callout="usb-method"] table')]) {
        const header = table.querySelector("thead tr");
        if (!header || header.cells[0]?.textContent?.trim() !== "测试") continue;
        const content = table.closest(".callout-content");
        const lastImplementation = content && [...content.children].filter((child) =>
          child.matches("pre, .controlled-mermaid-block, .mermaid, .block-language-mermaid"),
        ).pop();
        if (lastImplementation && lastImplementation.nextElementSibling !== table) {
          lastImplementation.after(table);
        }
        for (const row of table.querySelectorAll("tbody tr")) {
          const cell = row.cells[0];
          if (!cell || cell.querySelector("input[type=checkbox]")) continue;
          const checked = /\[x\]/i.test(cell.textContent || "");
          cell.textContent = "";
          const checkbox = element.ownerDocument.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = checked;
          checkbox.className = "controlled-test-checkbox";
          cell.appendChild(checkbox);
        }
      }
      if (!this.isModuleDocument(ctx?.sourcePath)) return;
      for (const link of [...element.querySelectorAll("a.internal-link")]) {
        link.replaceWith(element.ownerDocument.createTextNode(link.textContent || ""));
      }
    });
    this.registerDomEvent(document, "click", (event) => this.handleMermaidClick(event), true);
    this.registerDomEvent(document, "click", (event) => this.handleInternalTypeLink(event), true);
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
    const links = [];
    for (const match of source.matchAll(/^\s*%%\s*@link-(project|environment|interface|type)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))\s+(?:\[\[([^\]]+)\]\]|"([^"]+)"|'([^']+)')\s*$/gm)) {
      links.push({
        target: match[1],
        label: match[2] || match[3] || match[4],
        path: match[5] || match[6] || match[7],
      });
    }
    for (const match of source.matchAll(/^\s*%%\s*@link-(domain|module)\s+([^\s]+)\s+(?:\[\[([^\]]+)\]\]|"([^"]+)"|'([^']+)')\s*$/gm)) {
      links.push({ target: match[1], id: match[2], path: match[3] || match[4] || match[5] });
    }
    const svg = el.querySelector("svg");
    if (!svg) return;
    this.bindSequenceInterfaceLinks(svg, links, sourcePath, source);
    const groups = [...svg.querySelectorAll("g")];
    for (const link of links) {
      const group = groups.find((candidate) => {
        const id = candidate.getAttribute("id") || "";
        const text = (candidate.textContent || "").replace(/\s+/g, " ").trim();
        const matchesNode = candidate.classList.contains("node") &&
          ((link.id && (id === link.id || id.startsWith(`flowchart-${link.id}-`) || id.includes(`-${link.id}-`) || id.endsWith(`-${link.id}`) || candidate.getAttribute("data-id") === link.id)) ||
           (link.target === "interface" && link.label && text === link.label));
        if (matchesNode) return true;
        return link.target === "domain" && candidate.classList.contains("cluster") &&
          (id === link.id || id.includes(link.id));
      });
      const targets = group
        ? [group]
        : link.target === "type"
          ? this.findTypeEdgeTargets(svg, link.label)
          : link.target === "environment"
            ? this.findLabeledTextTargets(svg, link.label)
            : [];
      for (const target of targets) {
        target.dataset.obsidianLink = link.path;
        target.dataset.obsidianTarget = link.target;
        target.classList.add("obsidian-mermaid-link", `obsidian-mermaid-${link.target}`);
        target.style.setProperty("cursor", "pointer", "important");
        if (link.target === "type") {
          target.style.setProperty("fill", "var(--link-color)", "important");
          target.style.setProperty("color", "var(--link-color)", "important");
          target.style.setProperty("text-decoration", "underline", "important");
        }
        target.setAttribute("tabindex", "0");
        target.setAttribute("role", "link");
        target.setAttribute("aria-label", `打开${this.navigationTargetLabel(this.navigationTargetForLink(link.target))}：${link.path}`);
        target.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.openInNavigationLeaf(link.path, this.navigationTargetForLink(link.target), sourcePath);
        });
        target.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          void this.openInNavigationLeaf(link.path, this.navigationTargetForLink(link.target), sourcePath);
        });
      }
    }
  }
  findTypeEdgeTargets(svg, typeName) {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const matches = [...svg.querySelectorAll(".edgeLabel")].filter((edgeLabel) => {
      const value = normalize(edgeLabel.textContent);
      return value === typeName || new RegExp(`(?:^|[\\s:])${typeName}$`).test(value);
    });
    return matches.map((edgeLabel) => this.linkOnlyTypeText(edgeLabel, typeName)).filter(Boolean);
  }
  findLabeledTextTargets(svg, label) {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    return [...svg.querySelectorAll("text, .boxText, .labelText")].filter((candidate) =>
      normalize(candidate.textContent) === normalize(label),
    );
  }
  linkOnlyTypeText(edgeLabel, typeName) {
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const fullText = normalize(edgeLabel.textContent);
    const htmlLeaf = [...edgeLabel.querySelectorAll("span, p")].find((candidate) =>
      normalize(candidate.textContent) === fullText && !candidate.querySelector("span, p"));
    if (!htmlLeaf) return edgeLabel;
    const rawText = htmlLeaf.textContent || "";
    const start = rawText.lastIndexOf(typeName);
    if (start < 0 || rawText.slice(start + typeName.length).trim()) return edgeLabel;
    const document = edgeLabel.ownerDocument;
    const type = document.createElement("span");
    type.textContent = typeName;
    type.classList.add("obsidian-mermaid-type-token");
    htmlLeaf.replaceChildren(
      document.createTextNode(rawText.slice(0, start)),
      type,
      document.createTextNode(rawText.slice(start + typeName.length)),
    );
    return type;
  }
  bindSequenceInterfaceLinks(svg, links, sourcePath, source) {
    const domainLinks = links.filter((link) => link.target === "domain");
    const interfaceLinks = links.filter((link) => link.target === "interface");
    if (!domainLinks.length && !interfaceLinks.length) return;
    const labels = [...svg.querySelectorAll(".messageText")];
    const normalizeMessage = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const participantOrder = [...String(source || "").matchAll(/^\s*(?:participant|actor)\s+([A-Za-z_][\w-]*)/gm)].map((m) => m[1]);
    const pathByParticipant = new Map();
    for (const link of domainLinks) {
      pathByParticipant.set(link.id, link.path);
    }
    for (const link of interfaceLinks) {
      const line = String(source || "").split("\n").find((entry) => {
        const match = entry.match(/^\s*([A-Za-z_][\w-]*)\s*(?:->>|-->>|->|-->|-x|--x)\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        return match && normalizeMessage(match[3]) === normalizeMessage(link.label);
      });
      const match = line?.match(/^\s*([A-Za-z_][\w-]*)\s*(?:->>|-->>|->|-->|-x|--x)\s*([A-Za-z_][\w-]*)\s*:/);
      if (match) pathByParticipant.set(match[2], link.path);
    }
    const domainParticipants = participantOrder.filter((id) => id !== "USER" && pathByParticipant.has(id));
    const boxes = [...svg.querySelectorAll("rect.box")];
    domainParticipants.forEach((participant, index) => {
      const box = boxes[index];
      if (!box) return;
      box.style.setProperty("fill", this.domainColor(pathByParticipant.get(participant), sourcePath), "important");
      box.style.setProperty("fill-opacity", "0.12", "important");
    });
    this.styleSequenceParticipants(svg, pathByParticipant, sourcePath, source);
    for (const link of interfaceLinks) {
      const color = this.domainColor(link.path, sourcePath);
      const expected = normalizeMessage(link.label);
      const matches = labels.filter((label) => normalizeMessage(label.textContent) === expected);
      for (const label of matches) {
        label.style.setProperty("fill", color, "important");
        label.style.setProperty("color", color, "important");
        const messageIndex = labels.indexOf(label);
        this.styleSequenceMessageByIndex(svg, messageIndex, color);
      }
    }
    this.styleSequenceCallsByTarget(svg, source, pathByParticipant, sourcePath);
    this.styleSequenceActivations(svg, pathByParticipant, sourcePath);
  }
  styleSequenceCallsByTarget(svg, source, pathByParticipant, sourcePath) {
    const labels = [...svg.querySelectorAll(".messageText")];
    const lines = [...svg.querySelectorAll(".messageLine0, .messageLine1")];
    const messagePattern = /^\s*([A-Za-z_][\w-]*)\s*(?:->>|-->>|->|-->|-x|--x)[+-]?\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/;
    const messages = String(source || "").split("\n").map((line) => line.match(messagePattern)).filter(Boolean);
    if (messages.length !== labels.length || messages.length !== lines.length) return;
    for (const [index, match] of messages.entries()) {
      const [, , target] = match;
      const path = pathByParticipant.get(target);
      if (!path) continue;
      const color = this.domainColor(path, sourcePath);
      const label = labels[index];
      label.style.setProperty("fill", color, "important");
      label.style.setProperty("color", color, "important");
      this.styleSequenceMessageByIndex(svg, index, color);
    }
  }
  styleSequenceActivations(svg, pathByParticipant, sourcePath) {
    const actorLines = [...svg.querySelectorAll("line.actor-line")];
    const activations = [...svg.querySelectorAll("rect.activation0, rect.activation1, rect.activation2")];
    for (const activation of activations) {
      const center = Number(activation.getAttribute("x")) + Number(activation.getAttribute("width")) / 2;
      if (!Number.isFinite(center)) continue;
      const actorLine = actorLines.map((line) => ({
        line,
        distance: Math.abs(Number(line.getAttribute("x1")) - center),
      })).sort((left, right) => left.distance - right.distance)[0]?.line;
      if (!actorLine) continue;
      const actorX = Number(actorLine.getAttribute("x1"));
      const participant = [...pathByParticipant.keys()].find((id) => {
        const line = actorLines.find((candidate) => {
          const value = candidate.getAttribute("name") || candidate.getAttribute("data-name") || "";
          return value === id || value.includes(id);
        });
        return line && Math.abs(Number(line.getAttribute("x1")) - actorX) < 2;
      });
      const path = participant ? pathByParticipant.get(participant) : null;
      if (!path) continue;
      const color = this.domainColor(path, sourcePath);
      activation.style.setProperty("fill", color, "important");
      activation.style.setProperty("fill-opacity", "0.18", "important");
      activation.style.setProperty("stroke", color, "important");
      activation.style.setProperty("stroke-width", "2px", "important");
    }
  }
  renderSequenceInterfaceMarkers(svg, source, pathByParticipant, sourcePath) {
    const bindings = [];
    for (const match of String(source || "").matchAll(/^\s*%%\s*@domain-interface\s+([A-Za-z_][\w-]*)\s+(?:"([^"]+)"|'([^']+)')\s+(?:"([^"]+)"|'([^']+)')\s*$/gm)) {
      bindings.push({ participant: match[1], name: match[2] || match[3], reason: match[4] || match[5] });
    }
    if (!bindings.length) return;
    const labels = [...svg.querySelectorAll(".messageText")];
    const lines = [...svg.querySelectorAll(".messageLine0, .messageLine1")];
    const actorLines = [...svg.querySelectorAll("line.actor-line")];
    const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const participantNames = new Map();
    for (const match of String(source || "").matchAll(/^\s*(?:participant|actor)\s+([A-Za-z_][\w-]*)\s+as\s+(.+)$/gm)) {
      participantNames.set(match[1], match[2].trim());
    }
    const usedLabels = new Set();
    const interfaces = new Map();
    for (const binding of bindings) {
      const path = pathByParticipant.get(binding.participant);
      if (!path) continue;
      const name = participantNames.get(binding.participant) || binding.participant;
      const actorLine = actorLines.find((line) => {
        const value = line.getAttribute("name") || line.getAttribute("data-name") || "";
        return value === binding.participant || value === name || value.includes(binding.participant) || value.includes(name);
      });
      if (!actorLine) continue;
      const label = labels.find((candidate) => !usedLabels.has(candidate) && normalize(candidate.textContent) === normalize(binding.reason));
      if (!label) continue;
      usedLabels.add(label);
      let y = Number(label.getAttribute("y"));
      if (!Number.isFinite(y)) {
        try { const box = label.getBBox(); y = box.y + box.height / 2; } catch (_) { continue; }
      }
      const x = Number(actorLine.getAttribute("x1"));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const key = `${binding.participant}\u0000${binding.name}`;
      const current = interfaces.get(key) || {
        participant: binding.participant, name: binding.name, path, x, ys: [], messageIndexes: [],
      };
      current.ys.push(y);
      current.messageIndexes.push(labels.indexOf(label));
      interfaces.set(key, current);
    }
    for (const entry of interfaces.values()) {
      const name = participantNames.get(entry.participant) || entry.participant;
      const color = this.domainColor(entry.path, sourcePath);
      const width = Math.max(56, Math.min(132, 20 + entry.name.length * 14));
      const top = Math.min(...entry.ys) - 13;
      const bottom = Math.max(...entry.ys) + 13;
      const height = Math.max(26, bottom - top);
      const group = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.add("controlled-mermaid-sequence-interface");
      group.setAttribute("aria-label", `${name} 接口：${entry.name}`);
      const rect = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("x", String(entry.x - width / 2));
      rect.setAttribute("y", String(top));
      rect.setAttribute("width", String(width));
      rect.setAttribute("height", String(height));
      rect.setAttribute("rx", "2");
      rect.style.setProperty("fill", "var(--background-primary)", "important");
      rect.style.setProperty("stroke", color, "important");
      rect.style.setProperty("stroke-width", "2px", "important");
      const text = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", String(entry.x));
      text.setAttribute("y", String(top + 18));
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("font-size", "13");
      text.style.setProperty("fill", color, "important");
      text.style.setProperty("font-weight", "700", "important");
      text.textContent = entry.name;
      group.append(rect, text);
      svg.appendChild(group);
      for (const messageIndex of entry.messageIndexes) {
        if (messageIndex >= 0 && lines[messageIndex]) this.styleSequenceMessageByIndex(svg, messageIndex, color);
      }
    }
  }
  styleSequenceParticipants(svg, pathByParticipant, sourcePath, source) {
    const participantNames = new Map();
    for (const match of String(source || "").matchAll(/^\s*(?:participant|actor)\s+([A-Za-z_][\w-]*)\s+as\s+(.+)$/gm)) {
      participantNames.set(match[1], match[2].trim());
    }
    const actorLines = [...svg.querySelectorAll("line.actor-line")];
    const actorShapes = [...svg.querySelectorAll("rect.actor, rect.actor-top, rect.actor-bottom")];
    const userLine = actorLines.find((candidate) => {
      const value = candidate.getAttribute("name") || candidate.getAttribute("data-name") || "";
      return value === "USER" || value.includes("USER") || value.includes("用户");
    });
    if (userLine) {
      const userX = Number(userLine.getAttribute("x1"));
      const userColor = "#ffffff";
      userLine.style.setProperty("stroke", userColor, "important");
      userLine.style.setProperty("stroke-width", "2px", "important");
      for (const shape of actorShapes) {
        const center = Number(shape.getAttribute("x")) + Number(shape.getAttribute("width")) / 2;
        if (Math.abs(center - userX) > 2) continue;
        shape.style.setProperty("fill", "transparent", "important");
        shape.style.setProperty("stroke", userColor, "important");
        shape.querySelectorAll("text, tspan").forEach((text) => text.style.setProperty("fill", userColor, "important"));
      }
      svg.querySelectorAll("text, tspan").forEach((text) => {
        const textX = Number(text.getAttribute("x"));
        if (Number.isFinite(textX) && Math.abs(textX - userX) <= 2) text.style.setProperty("fill", userColor, "important");
      });
    }
    for (const [participant, path] of pathByParticipant) {
      if (participant === "USER") continue;
      const name = participantNames.get(participant);
      const line = actorLines.find((candidate) => {
        const lineName = candidate.getAttribute("name") || candidate.getAttribute("data-name") || "";
        return lineName === name || lineName === participant || lineName.includes(participant) || lineName.includes(name);
      });
      if (!line) continue;
      const x = Number(line.getAttribute("x1"));
      const color = this.domainColor(path, sourcePath);
      line.style.setProperty("stroke", color, "important");
      line.style.setProperty("stroke-width", "2px", "important");
      for (const shape of actorShapes) {
        const center = Number(shape.getAttribute("x")) + Number(shape.getAttribute("width")) / 2;
        if (Math.abs(center - x) > 2) continue;
        shape.style.setProperty("fill", "transparent", "important");
        shape.style.setProperty("stroke", color, "important");
        shape.classList.add("obsidian-mermaid-link", "obsidian-mermaid-domain-header");
        shape.dataset.obsidianLink = path;
        shape.dataset.obsidianTarget = "domain";
        shape.setAttribute("tabindex", "0");
        shape.setAttribute("role", "link");
        shape.setAttribute("aria-label", `打开领域：${path}`);
        const openDomain = (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.openInNavigationLeaf(path, "domain", sourcePath);
        };
        shape.addEventListener("click", openDomain);
        shape.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") openDomain(event);
        });
        const parent = shape.parentElement;
        parent?.querySelectorAll("text, tspan, .text").forEach((text) => {
          text.style.setProperty("fill", color, "important");
          text.style.setProperty("color", color, "important");
        });
      }
      for (const text of svg.querySelectorAll("text, tspan")) {
        const textX = Number(text.getAttribute("x"));
        if (Number.isFinite(textX) && Math.abs(textX - x) <= 2) {
          text.style.setProperty("fill", color, "important");
          text.style.setProperty("color", color, "important");
          text.classList.add("obsidian-mermaid-link", "obsidian-mermaid-domain-header");
          text.dataset.obsidianLink = path;
          text.dataset.obsidianTarget = "domain";
          text.style.setProperty("cursor", "pointer", "important");
          text.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            void this.openInNavigationLeaf(path, "domain", sourcePath);
          });
        }
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
            const coloredId = `${markerId}-${color.replace("#", "")}`;
            let coloredMarker = label.ownerDocument.querySelector(`marker[id="${CSS.escape(coloredId)}"]`);
            if (!coloredMarker) {
              coloredMarker = marker.cloneNode(true);
              coloredMarker.setAttribute("id", coloredId);
              marker.parentNode.appendChild(coloredMarker);
            }
            coloredMarker.querySelectorAll("path, polygon, polyline").forEach((shape) => {
              shape.style.setProperty("fill", color, "important");
              shape.style.setProperty("stroke", color, "important");
            });
            line.setAttribute(attribute, `url(#${coloredId})`);
          }
        }
        return;
      }
      group = group.parentElement;
    }
  }
  styleSequenceMessagePrecisely(svg, label, color) {
    const lines = [...svg.querySelectorAll(".messageLine0, .messageLine1")];
    if (!lines.length) return;
    let labelY = Number(label.getAttribute("y"));
    if (!Number.isFinite(labelY)) {
      try { const box = label.getBBox(); labelY = box.y + box.height / 2; } catch (_) { return; }
    }
    const line = lines.map((candidate) => {
      const y1 = Number(candidate.getAttribute("y1"));
      const y2 = Number(candidate.getAttribute("y2"));
      return { candidate, distance: Math.abs((y1 + y2) / 2 - labelY) };
    }).sort((a, b) => a.distance - b.distance)[0]?.candidate;
    if (!line) return;
    line.style.setProperty("stroke", color, "important");
    line.style.setProperty("stroke-width", "2px", "important");
    for (const attribute of ["marker-start", "marker-end"]) {
      const markerId = (line.getAttribute(attribute) || "").match(/#([^)'\"]+)/)?.[1];
      if (!markerId) continue;
      const marker = svg.querySelector(`marker[id="${CSS.escape(markerId)}"]`);
      if (!marker) continue;
      const coloredId = `${markerId}-${lines.indexOf(line)}-${color.replace("#", "")}`;
      let coloredMarker = svg.querySelector(`marker[id="${CSS.escape(coloredId)}"]`);
      if (!coloredMarker) {
        coloredMarker = marker.cloneNode(true);
        coloredMarker.setAttribute("id", coloredId);
        marker.parentNode.appendChild(coloredMarker);
      }
      coloredMarker.querySelectorAll("path, polygon, polyline").forEach((shape) => {
        shape.style.setProperty("fill", color, "important");
        shape.style.setProperty("stroke", color, "important");
      });
      line.setAttribute(attribute, `url(#${coloredId})`);
    }
  }
  styleSequenceMessageByIndex(svg, messageIndex, color) {
    const lines = [...svg.querySelectorAll(".messageLine0, .messageLine1")];
    const line = lines[messageIndex];
    if (!line) return;
    line.style.setProperty("stroke", color, "important");
    line.style.setProperty("stroke-width", "2px", "important");
    for (const attribute of ["marker-start", "marker-end"]) {
      const markerId = (line.getAttribute(attribute) || "").match(/#([^)'\"]+)/)?.[1];
      if (!markerId) continue;
      const marker = svg.querySelector(`marker[id="${CSS.escape(markerId)}"]`);
      if (!marker) continue;
      const coloredId = `${markerId}-message-${messageIndex}-${color.replace("#", "")}`;
      let coloredMarker = svg.querySelector(`marker[id="${CSS.escape(coloredId)}"]`);
      if (!coloredMarker) {
        coloredMarker = marker.cloneNode(true);
        coloredMarker.setAttribute("id", coloredId);
        marker.parentNode.appendChild(coloredMarker);
      }
      coloredMarker.querySelectorAll("path, polygon, polyline").forEach((shape) => {
        shape.style.setProperty("fill", color, "important");
        shape.style.setProperty("stroke", color, "important");
      });
      line.setAttribute(attribute, `url(#${coloredId})`);
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
    const interfaceOwners = new Map();
    for (const match of source.matchAll(/^\s*%%\s*@link-interface\s+(?:([^\s]+)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s]+))\s+(?:\[\[([^\]]+)\]\]|"([^"]+)"|'([^']+)')\s*$/gm)) {
      const id = match[1] || match[2] || match[3] || match[4];
      const path = match[5] || match[6] || match[7];
      if (id) interfaceOwners.set(id, path);
    }
    const interfaceIds = new Set([
      ...[...graphSource.matchAll(/\b([A-Za-z_][\w-]*)\s*\[\[[^\]]/g)].map((match) => match[1]),
      ...interfaceOwners.keys(),
    ]);
    const moduleIds = new Set(
      [...source.matchAll(/^\s*%%\s*@link-module\s+([A-Za-z_][\w-]*)\s+/gm)].map((match) => match[1]),
    );
    if (!interfaceIds.size && !moduleIds.size) return;
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
        const text = (candidate.textContent || "").replace(/\s+/g, " ").trim();
        return id === interfaceId || id.startsWith(`flowchart-${interfaceId}-`) ||
          candidate.getAttribute("data-id") === interfaceId || text === interfaceId;
      });
      if (!node) continue;
        const color = this.domainColor(interfaceOwners.get(interfaceId) || sourcePath, sourcePath);
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
  navigationTargetForLink(target) {
    return target === "interface" ? "domain" : NAVIGATION_TARGETS.includes(target) ? target : "domain";
  }
  navigationTargetLabel(target) {
    return {
      project: "项目",
      environment: "环境",
      domain: "领域",
      module: "模块",
      type: "类型",
    }[target] || "文档";
  }
  isModuleDocument(sourcePath) {
    const parts = String(sourcePath || "").split("/").filter(Boolean);
    return parts.length >= 3 && /-ENV$/i.test(parts[parts.length - 3]);
  }
  findNavigationLeaf(target) {
    const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
    const remembered = this.navigationLeaves[target];
    if (remembered?.containerEl?.isConnected) return remembered;
    return markdownLeaves.find((candidate) =>
      candidate.containerEl?.dataset.treeViewNavigationTarget === target ||
      candidate.tabHeaderEl?.dataset.treeViewNavigationTarget === target,
    ) || null;
  }
  assignNavigationLeaf(leaf, target) {
    if (!leaf) return null;
    this.navigationLeaves[target] = leaf;
    if (leaf.containerEl) {
      leaf.containerEl.dataset.treeViewNavigationTarget = target;
      leaf.containerEl.dataset.treeViewNavigationVersion = NAVIGATION_LAYOUT_VERSION;
    }
    if (leaf.tabHeaderEl) {
      leaf.tabHeaderEl.dataset.treeViewNavigationTarget = target;
      leaf.tabHeaderEl.dataset.treeViewNavigationVersion = NAVIGATION_LAYOUT_VERSION;
      const tabContainer = leaf.tabHeaderEl.closest(".workspace-tab-header-container");
      if (tabContainer) {
        tabContainer.classList.add("tree-view-fixed-navigation-tabs");
        for (const button of tabContainer.querySelectorAll(
          ".workspace-tab-header-new-tab, .workspace-tab-header-new-tab-button, [class*='new-tab'], [aria-label*='New tab'], [aria-label*='新建标签']",
        )) {
          button.style.setProperty("display", "none", "important");
        }
      }
      let marker = leaf.tabHeaderEl.querySelector(".tree-view-navigation-marker");
      if (!marker) {
        marker = leaf.tabHeaderEl.ownerDocument.createElement("span");
        marker.className = "tree-view-navigation-marker";
        leaf.tabHeaderEl.appendChild(marker);
      }
      marker.textContent = `[${this.navigationTargetLabel(target)}]`;
      marker.setAttribute("aria-label", `${this.navigationTargetLabel(target)} 固定窗口`);
    }
    return leaf;
  }
  migrateNavigationLeafOrder() {
    const leaves = this.app.workspace.getLeavesOfType("markdown");
    const ownedLeaves = leaves.filter((leaf) =>
      leaf.containerEl?.dataset.treeViewNavigationTarget,
    );
    const needsMigration = ownedLeaves.some((leaf) =>
      leaf.containerEl?.dataset.treeViewNavigationVersion !== NAVIGATION_LAYOUT_VERSION,
    );
    if (!needsMigration) return;
    for (const leaf of new Set(ownedLeaves)) {
      if (typeof leaf.detach === "function") leaf.detach();
    }
    this.navigationLeaves = Object.fromEntries(NAVIGATION_TARGETS.map((target) => [target, null]));
    this.navigationLeavesReady = null;
  }
  environmentDescriptorForDomain(file) {
    if (!file?.path || !file.path.endsWith(".md")) return null;
    const domain = file.path.split("/").pop().replace(/\.md$/, "");
    const root = file.path.split("/").slice(0, -1).join("/");
    const environmentDescriptors = this.app.vault.getMarkdownFiles().filter((candidate) =>
      candidate.path.startsWith(`${root}/_`) && /-ENV\.md$/i.test(candidate.path),
    );
    for (const descriptor of environmentDescriptors) {
      const environment = descriptor.path.split("/").pop().replace(/\.md$/, "").slice(1);
      const implementation = this.app.vault.getAbstractFileByPath(`${root}/${environment}/${domain}`);
      if (implementation?.children) return descriptor;
    }
    return null;
  }
  async ensureNavigationLeaves() {
    if (this.navigationLeavesReady) return this.navigationLeavesReady;
    this.navigationLeavesReady = (async () => {
      this.migrateNavigationLeafOrder();
      const reservedLeaves = new Set();
      // Obsidian inserts a new vertical split on the opposite side of the
      // current split. Create in reverse so the visible order is stable.
      for (const target of [...NAVIGATION_TARGETS].reverse()) {
        const existing = this.findNavigationLeaf(target);
        if (existing && !reservedLeaves.has(existing)) {
          this.assignNavigationLeaf(existing, target);
          reservedLeaves.add(existing);
          continue;
        }
        const projectLeaf = target === "project"
          ? this.app.workspace.getLeavesOfType("markdown").find((candidate) =>
            !reservedLeaves.has(candidate) &&
            /(^|\/)__Project\.md$/.test(String(candidate.view?.file?.path || "")),
          ) || (() => {
            const active = this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView)?.leaf;
            return reservedLeaves.has(active) ? null : active;
          })()
          : null;
        let leaf = projectLeaf || this.app.workspace.getLeaf("split", "vertical");
        while (reservedLeaves.has(leaf)) {
          leaf = this.app.workspace.getLeaf("split", "vertical");
        }
        this.assignNavigationLeaf(leaf, target);
        reservedLeaves.add(leaf);
      }
    })();
    try {
      await this.navigationLeavesReady;
    } catch (error) {
      this.navigationLeavesReady = null;
      throw error;
    }
    return this.navigationLeavesReady;
  }
  async openInNavigationLeaf(path, target, sourcePath) {
    const normalizedTarget = this.navigationTargetForLink(target);
    const leaf = this.findNavigationLeaf(normalizedTarget);
    if (!leaf) {
      new Notice("请先执行 Open Navigation Leaves 打开五个固定窗口");
      return null;
    }
    const file = navigation.resolveFile(this.app, path, sourcePath);
    if (!file) return navigation.openFileInLeaf(this.app, path, leaf, sourcePath);
    if (normalizedTarget === "domain") {
      const environmentFile = this.environmentDescriptorForDomain(file);
      if (environmentFile) {
        await this.openResolvedFileInNavigationLeaf(environmentFile, "environment");
      }
    }
    return this.openResolvedFileInNavigationLeaf(file, normalizedTarget);
  }
  async openResolvedFileInNavigationLeaf(file, target) {
    const leaf = this.findNavigationLeaf(target);
    if (!leaf) {
      new Notice("请先执行 Open Navigation Leaves 打开五个固定窗口");
      return null;
    }
    await leaf.openFile(file);
    this.assignNavigationLeaf(leaf, target);
    this.app.workspace.revealLeaf(leaf);
    if (leaf.view?.file?.path !== file.path) {
      await leaf.openFile(file);
      this.app.workspace.revealLeaf(leaf);
    }
    return leaf;
  }
  closeNavigationLeaves() {
    const ownedLeaves = new Set([
      ...Object.values(this.navigationLeaves || {}).filter(Boolean),
      ...this.app.workspace.getLeavesOfType("markdown").filter((leaf) =>
        leaf.containerEl?.dataset.treeViewNavigationTarget,
      ),
    ]);
    for (const leaf of ownedLeaves) {
      if (typeof leaf.detach === "function") leaf.detach();
    }
    this.navigationLeaves = Object.fromEntries(NAVIGATION_TARGETS.map((target) => [target, null]));
    this.navigationLeavesReady = null;
  }
  async handleInternalTypeLink(event) {
    const link = event.target?.closest?.("a.internal-link, a[data-href]");
    if (!link || (!link.classList.contains("internal-link") && !link.dataset.href)) return;
    const leaf = this.app.workspace.getLeavesOfType("markdown").find((candidate) =>
      candidate.containerEl?.contains(event.target),
    );
    const sourcePath = leaf?.view?.file?.path || this.app.workspace.getActiveViewOfType(require("obsidian").MarkdownView)?.file?.path;
    if (!sourcePath) return;
    const targetPath = link.dataset.href || link.getAttribute("href");
    const file = navigation.resolveFile(this.app, targetPath, sourcePath);
    if (!file) return;
    const sourceName = sourcePath.split("/").pop() || "";
    const sourceDirectory = sourcePath.slice(0, sourcePath.lastIndexOf("/"));
    const isEnvironmentDomainLink = /^_[^/]+-ENV\.md$/i.test(sourceName) &&
      file.path.startsWith(`${sourceDirectory}/`) &&
      file.path.split("/").length === sourceDirectory.split("/").length + 1 &&
      !file.path.split("/").pop().startsWith("_");
    if (!isEnvironmentDomainLink && file.parent?.name !== "Types") return;
    event.preventDefault();
    event.stopPropagation();
    await this.openResolvedFileInNavigationLeaf(file, isEnvironmentDomainLink ? "domain" : "type");
  }
  onunload() {
    this.navigationLeaves = Object.fromEntries(NAVIGATION_TARGETS.map((target) => [target, null]));
    this.navigationLeavesReady = null;
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
