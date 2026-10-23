#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.resolve(projectRoot, '../ideas/01-bae-frimley/content');
const outputRoot = path.join(projectRoot, 'content');

const workspaces = {
  signageSites: 'site', signageLocations: 'location', signagePlaces: 'place',
  signageDisplays: 'display', signageDecks: 'deck', signageEvents: 'event',
  signageMenus: 'menu', signageBoards: 'board', signageVideos: 'video', signageMessages: 'message',
  signageSyncSettings: 'syncSettings'
};

const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nodeName = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, '-');
const property = (name, value) => {
  const type = typeof value === 'boolean' ? 'Boolean' : typeof value === 'number' ? 'Decimal' : 'String';
  return `  <sv:property sv:name="${esc(name)}" sv:type="${type}"><sv:value>${esc(value)}</sv:value></sv:property>`;
};
const node = (name, value, type, depth = 0) => {
  const indent = '  '.repeat(depth);
  const lines = [`${indent}<sv:node sv:name="${esc(nodeName(name))}">`,
    `${indent}  <sv:property sv:name="jcr:primaryType" sv:type="Name"><sv:value>${depth === 0 ? `sgn:${type}` : 'mgnl:contentNode'}</sv:value></sv:property>`];
  for (const [key, child] of Object.entries(value)) {
    if (key === '$schema' || child === null || child === undefined) continue;
    if (Array.isArray(child)) {
      const scalar = child.every((item) => typeof item !== 'object' || item === null);
      if (scalar) {
        lines.push(`${indent}  <sv:property sv:name="${esc(key)}" sv:type="String" sv:multiple="true">${child.map((item) => `<sv:value>${esc(item)}</sv:value>`).join('')}</sv:property>`);
      } else {
        lines.push(`${indent}  <sv:node sv:name="${esc(key)}"><sv:property sv:name="jcr:primaryType" sv:type="Name"><sv:value>mgnl:contentNode</sv:value></sv:property>`);
        child.forEach((item, index) => lines.push(node(String(index), item, type, depth + 2)));
        lines.push(`${indent}  </sv:node>`);
      }
    } else if (typeof child === 'object') {
      lines.push(node(key, child, type, depth + 1));
    } else {
      lines.push(`${indent}${property(key, child)}`);
    }
  }
  lines.push(`${indent}</sv:node>`);
  return lines.join('\n');
};
const writeRecord = (workspace, type, id, data) => {
  const dir = path.join(outputRoot, workspace);
  fs.mkdirSync(dir, { recursive: true });
  const root = node(id, data, type).replace(
    '<sv:node ',
    '<sv:node xmlns:sv="http://www.jcp.org/jcr/sv/1.0" '
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n`;
  fs.writeFileSync(path.join(dir, `${nodeName(id)}.xml`), xml);
};
const read = (file) => JSON.parse(fs.readFileSync(path.join(sourceRoot, file), 'utf8'));
const rename = (record, mapping) => Object.fromEntries(Object.entries(record).map(([key, value]) => [mapping[key] || key, value]));

fs.rmSync(outputRoot, { recursive: true, force: true });
for (const [workspace, type] of Object.entries(workspaces)) fs.mkdirSync(path.join(outputRoot, workspace), { recursive: true });

const site = read('site.json');
writeRecord('signageSites', 'site', site.id, { ...rename(site, { id: 'slug', siteName: 'name' }), home: true, playback: read('displays.json').defaults, syncOrder: 0 });
for (const [syncOrder, item] of read('locations.json').locations.entries()) writeRecord('signageLocations', 'location', item.id, { ...rename(item, { id: 'slug', siteName: 'name' }), syncOrder });
for (const [syncOrder, item] of read('displays.json').folders.entries()) writeRecord('signagePlaces', 'place', item.id, { ...rename(item, { id: 'slug', settings: 'playback' }), syncOrder });
for (const [syncOrder, item] of read('displays.json').displays.entries()) writeRecord('signageDisplays', 'display', item.id, { ...rename(item, { id: 'slug', folder: 'place', settings: 'playback' }), syncOrder });
for (const [syncOrder, file] of fs.readdirSync(path.join(sourceRoot, 'decks')).filter((name) => name.endsWith('.json')).entries()) {
  const item = read(path.join('decks', file));
  const cards = item.cards.map((card) => rename(card, { id: 'cardId', type: 'cardType' }));
  writeRecord('signageDecks', 'deck', item.id, { ...rename(item, { id: 'slug' }), cards, syncOrder });
}
for (const [file, collection, workspace, type] of [
  ['events.json', 'events', 'signageEvents', 'event'], ['menus.json', 'menus', 'signageMenus', 'menu'],
  ['boards.json', 'boards', 'signageBoards', 'board'], ['videos.json', 'videos', 'signageVideos', 'video'],
  ['messages.json', 'messages', 'signageMessages', 'message']
]) for (const [syncOrder, item] of read(file)[collection].entries()) {
  const names = { id: 'slug', title: 'name', cuesFrom: 'cues' };
  const normalized = rename(item, names);
  writeRecord(workspace, type, item.id, { ...normalized, syncOrder });
}
writeRecord('signageSyncSettings', 'syncSettings', 'player-content', {
  name: 'Digital signage player',
  destinationPath: path.resolve(projectRoot, '../ideas/01-bae-frimley/content'),
  magnoliaBaseUrl: 'http://localhost:8080/author',
  enabled: true,
  pruneDecks: true
});

const config = {
  output: { type: 'FileSystem', destinationPath: outputRoot, settings: {} },
  settings: { collisionMode: 'overwrite', wipeBeforeImport: false },
  workspaces: Object.keys(workspaces).map((workspace) => ({ workspace, paths: ['.*'], mode: 'node' }))
};
fs.writeFileSync(path.join(outputRoot, 'content-transfer-import.json'), `${JSON.stringify(config, null, 2)}\n`);
fs.cpSync(path.join(sourceRoot, 'media'), path.join(outputRoot, 'source-media'), { recursive: true });
console.log(`Generated ${Object.values(workspaces).length} workspace import sets in ${outputRoot}`);
