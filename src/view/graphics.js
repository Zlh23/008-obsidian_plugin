function reducedMotion() { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; }
function animateCanvas(svg) { if (!reducedMotion()) svg.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 180, easing: 'ease-out', fill: 'both' }); }
async function animateBranch(ids) {
  if (reducedMotion()) return;
  const elements = [...this.contentEl.querySelectorAll('.usbip-node,.usbip-edge')].filter((el) => ids.has(el.getAttribute('data-node-id')) || ids.has(el.getAttribute('data-child-id')));
  await Promise.all(elements.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {})));
}

function wrapLabel(label, limit) {
  const chars = [...label];
  if (chars.length <= limit) return [label];
  const split = Math.ceil(chars.length / 2);
  return [chars.slice(0, split).join(''), chars.slice(split).join('')];
}

function starPoints(cx, cy, outer, inner) {
  const points = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 ? inner : outer;
    const angle = -Math.PI / 2 + index * Math.PI / 5;
    points.push(`${cx + Math.cos(angle) * radius},${cy + Math.sin(angle) * radius}`);
  }
  return points.join(' ');
}


function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function toggleExpanded(expanded, nodeId) {
  if (expanded.has(nodeId)) expanded.delete(nodeId); else expanded.add(nodeId);
  return expanded;
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}


const COLORS = { 已完成: '#35b759', 进行中: '#e5b92f', 未开始: '#8b8b8b' };
const NodeRenderer = {
  line(svg, a, b) {
    const p = svg.createSvg("path"),
      vertical = this.orientation === "vertical";
    p.setAttr("data-child-id", b.id);
    p.setAttr(
      "d",
      vertical
        ? `M ${a.x} ${a.y} C ${a.x} ${(a.y + b.y) / 2}, ${b.x} ${(a.y + b.y) / 2}, ${b.x} ${b.y}`
        : `M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`,
    );
    p.addClass("usbip-edge");
  },
  node(svg, n) {
    const g = svg.createSvg("g");
    g.addClass("usbip-node");
    g.setAttr("data-node-id", n.id);
    if (this.selected === n.id) g.addClass("is-selected");
    if (this.expanded.has(n.id)) g.addClass("is-expanded");
    const color = COLORS[n.state] || COLORS["未开始"];
    let shape;
    if (n.level === 1) {
      shape = g.createSvg("polygon");
      shape.setAttr("points", this.star(n.x, n.y, 25, 12));
    } else if (n.level === 2) {
      shape = g.createSvg("rect");
      shape.setAttr("x", n.x - 21);
      shape.setAttr("y", n.y - 21);
      shape.setAttr("width", "42");
      shape.setAttr("height", "42");
      shape.setAttr("rx", "10");
    } else {
      shape = g.createSvg("polygon");
      shape.setAttr(
        "points",
        `${n.x},${n.y - 24} ${n.x - 24},${n.y + 19} ${n.x + 24},${n.y + 19}`,
      );
    }
    shape.setAttr("fill", color);
    shape.addClass("usbip-shape");
    const text = g.createSvg("text"),
      lines = this.wrap(n.label, 8),
      vertical = this.orientation === "vertical";
    text.setAttr("text-anchor", vertical ? "middle" : "start");
    text.addClass("usbip-node-label");
    lines.forEach((line, index) => {
      const span = text.createSvg("tspan");
      span.textContent = line;
      span.setAttr("x", vertical ? n.x : n.x + 30);
      span.setAttr(
        "y",
        vertical
          ? n.y + 36 + index * 13
          : n.y - (lines.length - 1) * 7 + index * 14,
      );
    });
    const progress = text.createSvg("tspan");
    progress.textContent = `（${n.passed}/${n.total}）`;
    progress.addClass("usbip-node-progress");
    progress.setAttr("x", vertical ? n.x : n.x + 30);
    progress.setAttr(
      "y",
      vertical ? n.y + 36 + lines.length * 13 : n.y + (lines.length + 1) * 7,
    );
    const expandable = this.hasVisibleChildren(n),
      title = g.createSvg("title");
    title.textContent = expandable
      ? `${n.label} · ${n.state} · ${n.passed}/${n.total} · 首次展开，再次打开；右键收起整棵分支`
      : `${n.label} · ${n.state} · ${n.passed}/${n.total} · 点击打开`;
    g.onclick = () => this.activate(n);
    g.oncontextmenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.collapseBranch(n);
    };
  }
};
module.exports = { reducedMotion, animateCanvas, animateBranch, wrap: wrapLabel, star: starPoints, createSvgElement, ...NodeRenderer };
