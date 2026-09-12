const { Notice, normalizePath } = require('obsidian');

async function openFile(app, path, sourceLeaf, sourcePath) {
  const file = resolveFile(app, path, sourcePath);
  if (!file) return new Notice(`文件不存在：${String(path).trim()}`);
  let target = app.workspace.getLeavesOfType('markdown').find((leaf) => leaf !== sourceLeaf);
  if (!target) target = app.workspace.getLeaf('split', 'vertical');
  await target.openFile(file);
  app.workspace.revealLeaf(target);
}

function resolveFile(app, path, sourcePath) {
  const clean = String(path).trim().replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0];
  const sourceDirectory = String(sourcePath || '').replace(/\/[^/]*$/, '');
  const relative = sourceDirectory ? normalizePath(`${sourceDirectory}/${clean}`) : normalizePath(clean);
  const rootRelative = normalizePath(clean.replace(/^\//, ''));
  const candidates = [relative, relative.endsWith('.md') ? relative : `${relative}.md`];
  if (rootRelative !== relative) {
    candidates.push(rootRelative, rootRelative.endsWith('.md') ? rootRelative : `${rootRelative}.md`);
  }
  return candidates.map((candidate) => app.vault.getAbstractFileByPath(candidate)).find(Boolean);
}

async function openFileInLeaf(app, path, target, sourcePath) {
  const file = resolveFile(app, path, sourcePath);
  if (!file) return new Notice(`文件不存在：${String(path).trim()}`);
  await target.openFile(file);
  app.workspace.revealLeaf(target);
}
module.exports = { openFile, openFileInLeaf, resolveFile };
