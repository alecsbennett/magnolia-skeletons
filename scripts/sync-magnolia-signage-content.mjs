#!/usr/bin/env node
/**
 * Export Magnolia's signage delivery content to the JSON contract consumed by
 * ideas/01-bae-frimley/server/src/content/jsonSource.js.
 *
 * The saved Signage sync settings record is read first. Environment variables
 * are deliberate fallbacks for the first run before an editor saves settings:
 *   MAGNOLIA_AUTHOR_URL, SIGNAGE_CONTENT_DIR, SIGNAGE_SYNC_TOKEN
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const fallbackTarget = path.resolve(projectRoot, '../ideas/01-bae-frimley/content');
const fallbackBaseUrl = 'http://localhost:8080/author';
const endpoints = ['sites', 'locations', 'places', 'displays', 'decks', 'events', 'menus', 'boards', 'videos', 'messages'];

const decodeHtml = (value) => String(value)
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? decodeHtml(value) : value;
  const entries = Object.entries(value).filter(([key]) => !key.startsWith('@'));
  const numeric = entries.length > 0 && entries.every(([key]) => /^\d+$/.test(key));
  if (numeric) return entries.sort(([a], [b]) => Number(a) - Number(b)).map(([, child]) => clean(child));
  return Object.fromEntries(entries.map(([key, child]) => [key, clean(child)]));
};
const renameKeys = (record, changes) => Object.fromEntries(Object.entries(record)
  .map(([key, value]) => [changes[key] ?? key, value]));
const ordered = (items) => [...items].sort((a, b) => (a.syncOrder ?? Number.MAX_SAFE_INTEGER) - (b.syncOrder ?? Number.MAX_SAFE_INTEGER));
const withoutSyncOrder = (record) => {
  const { syncOrder, ...result } = record;
  return result;
};
const file = (target, name, value) => ({ target: path.join(target, name), value: `${JSON.stringify(value, null, 2)}\n` });

async function getJson(baseUrl, endpoint) {
  const url = new URL(`.rest/delivery/signage-${endpoint}?limit=1000`, `${baseUrl.replace(/\/$/, '')}/`);
  const response = await fetch(url, { headers: process.env.SIGNAGE_SYNC_TOKEN ? { 'X-Private-Key': process.env.SIGNAGE_SYNC_TOKEN } : {} });
  if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${response.statusText}`);
  const payload = await response.json();
  return (payload.results || []).map(clean);
}

async function writeAtomically(target, output, pruneDecks) {
  const written = new Set(output.map(({ target: filename }) => filename));
  await mkdir(path.join(target, 'decks'), { recursive: true });
  for (const { target: filename, value } of output) {
    await mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.sync-tmp`;
    await writeFile(temporary, value, 'utf8');
    await rename(temporary, filename);
  }
  if (pruneDecks) {
    for (const name of await readdir(path.join(target, 'decks'))) {
      const existing = path.join(target, 'decks', name);
      if (name.endsWith('.json') && !written.has(existing)) await rm(existing);
    }
  }
}

const baseForSettings = process.env.MAGNOLIA_AUTHOR_URL || fallbackBaseUrl;
let settings = null;
try { settings = (await getJson(baseForSettings, 'sync-settings'))[0] || null; } catch (error) {
  console.warn(`[sync] Settings endpoint unavailable; using environment defaults (${error.message}).`);
}
if (settings && settings.enabled === false) throw new Error('Sync is disabled in Signage sync settings.');
const baseUrl = settings?.magnoliaBaseUrl || baseForSettings;
const target = path.resolve(settings?.destinationPath || process.env.SIGNAGE_CONTENT_DIR || fallbackTarget);

const data = Object.fromEntries(await Promise.all(endpoints.map(async (endpoint) => [endpoint, await getJson(baseUrl, endpoint)])));
const site = data.sites[0];
if (!site) throw new Error('No signage site exists in Magnolia; refusing to replace player content.');

const playerSite = renameKeys(withoutSyncOrder(site), { slug: 'id', name: 'siteName' });
delete playerSite.home;
delete playerSite.playback;
const folders = ordered(data.places).map((item) => {
  const folder = renameKeys(withoutSyncOrder(item), { slug: 'id', playback: 'settings' });
  // The player schema deliberately represents root places with parent: null;
  // Magnolia stores an empty optional reference by omitting the property.
  if (!Object.hasOwn(folder, 'parent')) folder.parent = null;
  return folder;
});
const displays = ordered(data.displays).map((item) => renameKeys(withoutSyncOrder(item), { slug: 'id', place: 'folder' }));
const decks = ordered(data.decks).map((item) => {
  const deck = renameKeys(withoutSyncOrder(item), { slug: 'id' });
  deck.cards = clean(deck.cards || []).map((card) => renameKeys(card, { cardId: 'id', cardType: 'type' }));
  return deck;
});
const locations = ordered(data.locations).map((item) => renameKeys(withoutSyncOrder(item), { slug: 'id', name: 'siteName' }));
const events = ordered(data.events).map((item) => renameKeys(withoutSyncOrder(item), { slug: 'id', name: 'title' }));
const menus = ordered(data.menus).map((item) => renameKeys(withoutSyncOrder(item), { slug: 'id' }));
const boards = ordered(data.boards).map((item) => renameKeys(withoutSyncOrder(item), { slug: 'id', name: 'title' }));
const videos = ordered(data.videos).map((item) => renameKeys(withoutSyncOrder(item), { slug: 'id', name: 'title', cues: 'cuesFrom' }));
const messages = ordered(data.messages).map((item) => renameKeys(withoutSyncOrder(item), { slug: 'id' }));

await writeAtomically(target, [
  file(target, 'site.json', { $schema: '../schemas/site.schema.json', ...playerSite }),
  file(target, 'displays.json', { $schema: '../schemas/displays.schema.json', defaults: site.playback || {}, folders, displays }),
  file(target, 'locations.json', { $schema: '../schemas/locations.schema.json', locations }), file(target, 'events.json', { $schema: '../schemas/events.schema.json', events }),
  file(target, 'menus.json', { $schema: '../schemas/menus.schema.json', menus }), file(target, 'boards.json', { $schema: '../schemas/boards.schema.json', boards }),
  file(target, 'videos.json', { $schema: '../schemas/videos.schema.json', videos }), file(target, 'messages.json', { $schema: '../schemas/messages.schema.json', messages }),
  ...decks.map((deck) => file(target, path.join('decks', `${deck.id}.json`), { $schema: '../../schemas/deck.schema.json', ...deck })),
], settings?.pruneDecks !== false);
console.log(`[sync] Wrote ${decks.length} decks and ${endpoints.length} signage datasets to ${target}.`);
