import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { filterByResolution, limitStreamsPerResolution, normalizeStreamLimit } from '../lib/stream-provider/utils/filtering.js';
import landingTemplate from '../lib/util/landingTemplate.js';

const streams = [
  { name: 'Sootio RD\n4K', title: 'first', url: 'https://example.invalid/first' },
  { resolution: '1080p', name: 'Sootio Debrider', title: 'second' },
  { name: 'Sootio TorBox\nUHD', title: 'third' },
  { title: 'fourth.2160p.Remux' },
  { title: 'fifth.1080p.WEB-DL' },
  { title: 'sixth.720p' },
  { name: 'Sootio', title: 'unknown first' },
  { name: 'Sootio', title: 'unknown second' },
];

test('caps each normalized resolution across sources and preserves order and objects', () => {
  assert.deepEqual(limitStreamsPerResolution(streams, 1), [streams[0], streams[1], streams[5], streams[6]]);
  assert.deepEqual(limitStreamsPerResolution(streams, '2'), [streams[0], streams[1], streams[2], streams[4], streams[5], streams[6], streams[7]]);
  assert.equal(streams.length, 8);
});

test('unlimited and malformed limits preserve old results', () => {
  for (const value of [undefined, null, '', 0, '0', -1, 1.5, Infinity, NaN, 'five', '5junk', true, [1], {}, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeStreamLimit(value), 0);
    assert.equal(limitStreamsPerResolution(streams, value), streams);
  }
  assert.equal(normalizeStreamLimit(' 5 '), 5);
  assert.deepEqual(limitStreamsPerResolution([], 5), []);
});

test('explicit resolution takes precedence and unknown labels share one bucket', () => {
  const unknowns = [{ resolution: 'N/A' }, { resolution: 'unknown' }, { title: 'no resolution' }];
  const known = { resolution: '720p', name: 'Misleading 4K label' };
  assert.deepEqual(limitStreamsPerResolution([...unknowns, known, { title: 'movie.720p' }], 1), [unknowns[0], known]);
});

test('resolution selection still normalizes aliases and retains unknowns', () => {
  assert.deepEqual(filterByResolution(streams, ['2160p']), [streams[0], streams[2], streams[3], streams[6], streams[7]]);
});

test('configuration page restores a numeric limit without interpolating raw input', () => {
  const manifest = { name: 'Sootio', version: 'test', description: '' };
  assert.match(landingTemplate(manifest, { MaxStreamsPerResolution: 5 }), /id="MaxStreamsPerResolution"[^>]*value="5"/);
  assert.match(landingTemplate(manifest), /id="MaxStreamsPerResolution"[^>]*value="0"/);
  const malicious = '" autofocus onfocus="alert(1)';
  const html = landingTemplate(manifest, { MaxStreamsPerResolution: malicious });
  assert.match(html, /id="MaxStreamsPerResolution"[^>]*value="0"/);
  assert.ok(!html.includes(malicious));
});

test('movie and episode responses enforce the limit after provider results', () => {
  // App imports start background timers; isolate them from the test runner.
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    console.log = () => {};
    console.error = () => {};
    process.env.SQLITE_CACHE_ENABLED = 'false';
    const streams = ${JSON.stringify(streams)};
    const { default: provider } = await import(${JSON.stringify(new URL('../lib/stream-provider.js', import.meta.url).href)});
    const { default: addon } = await import(${JSON.stringify(new URL('../addon.js', import.meta.url).href)});
    provider.getMovieStreams = async () => streams;
    provider.getSeriesStreams = async () => streams;
    for (const [type, id] of [['movie', 'tt0133093'], ['series', 'tt0903747:1:1']]) {
      const capped = await addon.get('stream', type, id, {}, { MaxStreamsPerResolution: 1 });
      assert.deepEqual(capped.streams, [streams[0], streams[1], streams[5], streams[6]]);
      const unlimited = await addon.get('stream', type, id, {}, {});
      assert.deepEqual(unlimited.streams, streams);
    }
    process.exit(0);
  `], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
