function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function updateChecklist(vault, file, task, checked) {
  await vault.process(file, (data) => {
    const lines = data.split(/\r?\n/);
    const pattern = new RegExp(`^\\s*(?:>\\s*)?\\|\\s*- \\[([ xX])\\]\\s*\\|\\s*${escapeRegExp(task.label)}\\s*\\|`);
    const index = lines.findIndex((line) => pattern.test(line));
    if (index < 0) throw new Error(`找不到验证任务：${task.label}`);
    lines[index] = lines[index].replace(/- \[[ xX]\]/, checked ? '- [x]' : '- [ ]');
    return lines.join('\n');
  });
}


const { Notice } = require('obsidian');

function success(task, checked) { new Notice(`${checked ? '已完成' : '已取消'}：${task.label}`); }
function failure(box, checked, error) { box.checked = !checked; new Notice(error?.message || '无法更新验证任务'); }


async function enhanceTaskTables(plugin, el, ctx) {

    const file = plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!file) return;
    const source = await plugin.app.vault.read(file),
      lines = source.split(/\r?\n/),
      section = ctx.getSectionInfo(el),
      start = section?.lineStart ?? 0,
      end = section?.lineEnd ?? lines.length - 1,
      tasks = [];
    for (let line = start; line <= end; line++) {
      const m = lines[line]?.match(
        /^\s*(?:>\s*)?\|\s*- \[([ xX])\]\s*\|\s*([^|]+)\|/,
      );
      if (m)
        tasks.push({
          line,
          label: m[2].trim(),
          done: m[1].toLowerCase() === "x",
        });
    }
    const cells = [
      ...el.querySelectorAll("table tbody tr td:first-child"),
    ].filter(
      (c) =>
        c.querySelector('input[type="checkbox"]') ||
        /-\s*\[[ xX]\]/.test(c.textContent || ""),
    );
    for (let i = 0; i < Math.min(cells.length, tasks.length); i++) {
      const cell = cells[i],
        task = tasks[i];
      if (cell.dataset.usbipTask === "ready") continue;
      cell.dataset.usbipTask = "ready";
      cell.addClass("usbip-task-cell");
      const old = cell.querySelector('input[type="checkbox"]'),
        box = document.createElement("input");
      box.type = "checkbox";
      box.checked = task.done;
      box.className = "usbip-task-checkbox";
      box.setAttribute(
        "aria-label",
        `${task.done ? "取消完成" : "标记完成"}：${task.label}`,
      );
      if (old) old.replaceWith(box);
      else {
        cell.textContent = (cell.textContent || "").replace(
          /^\s*-\s*\[[ xX]\]\s*/,
          "",
        );
        cell.prepend(document.createTextNode(" "));
        cell.prepend(box);
      }
      box.onclick = (e) => e.stopPropagation();
      box.onchange = () => plugin.writeTask(file, task, box);
    }
  }


module.exports = { updateChecklist, escapeRegExp, success, failure, enhanceTaskTables };
