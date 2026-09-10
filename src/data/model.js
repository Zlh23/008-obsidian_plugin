const { TFolder } = require('obsidian');

async function title(vault, file, fallback) {
  const match = (await vault.read(file)).match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
}

async function state(vault, metadataCache, file, tasks) {
  const items = tasks(await vault.read(file));
  if (items.length) return items.every((item) => item.done) ? '已完成' : items.some((item) => item.done) ? '进行中' : '未开始';
  return metadataCache.getFileCache(file)?.frontmatter?.status || '未开始';
}

function orderedFolders(folder, text) {
  return ordered(folder.children.filter((item) => item instanceof TFolder), text, (item) => `${item.name}/`);
}

function ordered(items, text, key) {
  return items.sort((a, b) => { const ai = text.indexOf(key(a)), bi = text.indexOf(key(b)); if (ai >= 0 && bi >= 0) return ai - bi; if (ai >= 0) return -1; if (bi >= 0) return 1; return a.name.localeCompare(b.name); });
}


function createNode({ id, label, level, parent = null, path, state = '未开始' }) {
  return { id, label, level, parent, path, state, children: [] };
}

function attach(parent, child) {
  if (!parent.children.includes(child.id)) parent.children.push(child.id);
  child.parent = parent.id;
}


module.exports = { title, state, orderedFolders, ordered, createNode, attach };
