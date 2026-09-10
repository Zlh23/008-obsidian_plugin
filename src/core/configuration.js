const CONFIG_PATH = '.obsidian/plugins/tree-view/config.json';

const DEFAULT_CONFIG = {
  displayName: '树状显示',
  roots: [],
  scan: { entryFile: 'same-name', children: 'directories-and-files', parentLinks: 'wikilinks-or-relative-paths' },
  interaction: { openOnClick: true, expandOnFirstClick: true, contextMenuCollapse: true, focusSync: true },
  layout: { defaultOrientation: 'horizontal', fitToViewport: true },
};

async function loadConfig(vault) {
  try {
    const user = JSON.parse(await vault.adapter.read(CONFIG_PATH));
    return {
      ...DEFAULT_CONFIG, ...user,
      scan: { ...DEFAULT_CONFIG.scan, ...(user.scan || {}) },
      interaction: { ...DEFAULT_CONFIG.interaction, ...(user.interaction || {}) },
      layout: { ...DEFAULT_CONFIG.layout, ...(user.layout || {}) },
    };
  } catch (_) {
    return DEFAULT_CONFIG;
  }
}


module.exports = { CONFIG_PATH, DEFAULT_CONFIG, loadConfig };
