import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

test('real server: snapshots, validation, mutations, broadcast, reconnect', { timeout: 60000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'el-pharos-ws-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const savePath = join(dir, 'save.json');
  const startServer = () => spawn('cargo', ['run', '--quiet', '-p', 'el-pharos-server'], {
    env: { ...process.env, EL_PHAROS_BIND: '127.0.0.1:0', EL_PHAROS_SAVE_PATH: savePath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let server = startServer();
  let logs = '';
  server.stdout.on('data', (chunk) => { logs += chunk.toString(); });
  server.stderr.on('data', (chunk) => { logs += chunk.toString(); });
  t.after(async () => {
    if (server.exitCode === null) {
      const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited;
    }
  });
  let port;
  for (let i = 0; i < 500; i++) {
    port = logs.replace(/\x1b\[[0-9;]*m/g, '').match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (port) break;
    if (server.exitCode !== null) throw new Error(logs);
    await delay(100);
  }
  assert.ok(port, `Server did not start: ${logs}`);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/health`)).text(), 'ok');

  function client() {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const queue = [];
    socket.addEventListener('message', (event) => queue.push(JSON.parse(event.data)));
    t.after(() => socket.close());
    return {
      socket,
      async next() {
        for (let i = 0; i < 100; i++) { if (queue.length) return queue.shift(); await delay(20); }
        throw new Error('Timed out waiting for server message');
      },
      command(id, active, version = 2) {
        socket.send(JSON.stringify({ type: 'set_lighthouse_active', protocol_version: version, lighthouse_id: id, active }));
      },
    };
  }
  const a = client(), b = client();
  const initial = await a.next();
  assert.equal(initial.type, 'world_snapshot');
  assert.equal(initial.protocol_version, 2);
  assert.equal(initial.world.islands.length, 4);
  assert.equal(initial.world.lighthouses.length, 4);
  assert.deepEqual(await b.next(), initial);
  const id = initial.world.lighthouses[0].id;
  a.socket.send('not json');
  assert.equal((await a.next()).type, 'error');
  a.command('missing', false);
  assert.equal((await a.next()).message, 'Unknown lighthouse');
  a.command(id, false, 99);
  assert.equal((await a.next()).message, 'Unsupported protocol version');
  a.command(id, false);
  const changed = await a.next();
  assert.equal(changed.world.revision, initial.world.revision + 1);
  assert.equal(changed.world.lighthouses[0].active, false);
  assert.deepEqual(await b.next(), changed);
  a.command(id, false);
  assert.deepEqual(await a.next(), changed);
  const reconnected = client();
  assert.deepEqual(await reconnected.next(), changed);
  reconnected.socket.close();
  b.command(id, true);
  assert.equal((await a.next()).world.lighthouses[0].active, true);
  assert.equal((await b.next()).world.revision, changed.world.revision + 1);
  async function command(type, request_id) {
    a.socket.send(JSON.stringify({ type, protocol_version: 2, request_id }));
    let result;
    do { result = await a.next(); } while (result.type !== 'command_result');
    assert.equal(result.request_id, request_id);
    return result;
  }
  assert.equal((await command('load_game', 'missing')).success, false);
  a.socket.send(JSON.stringify({ type: 'expand_lighthouse_radius', protocol_version: 2, lighthouse_id: id }));
  const expanded = await a.next();
  assert.equal(expanded.world.lighthouses[0].radius, 350);
  assert.equal(expanded.world.lighthouses[0].explored_radius, 350);
  assert.deepEqual(await b.next(), expanded);
  assert.equal((await command('save_game', 'save')).success, true);
  assert.deepEqual(await a.next(), expanded);
  const saved = await readFile(savePath, 'utf8');
  a.command(id, false);
  const dark = await a.next();
  assert.equal(dark.world.lighthouses[0].explored_radius, 350);
  assert.deepEqual(await b.next(), dark);
  assert.equal((await command('load_game', 'load')).success, true);
  const restored = await a.next();
  assert.equal(restored.world.revision, dark.world.revision + 1);
  assert.equal(restored.world.lighthouses[0].active, true);
  assert.equal(restored.world.lighthouses[0].radius, 350);
  assert.deepEqual(await b.next(), restored);
  await writeFile(savePath, 'corrupt');
  assert.equal((await command('load_game', 'bad')).success, false);
  const afterFailure = client();
  assert.deepEqual(await afterFailure.next(), restored);
  afterFailure.socket.close();
  const unsupported = JSON.parse(saved);
  unsupported.save_version = 99;
  await writeFile(savePath, JSON.stringify(unsupported));
  assert.equal((await command('load_game', 'version')).success, false);
  await writeFile(savePath, saved);
  // Concurrent clients mutate under the same server gate without losing an upgrade.
  for (const c of [a, b]) c.socket.send(JSON.stringify({ type: 'expand_lighthouse_radius', protocol_version: 2, lighthouse_id: id }));
  async function untilRadius(c, radius) {
    for (;;) {
      const message = await c.next();
      if (message.type === 'world_snapshot' && message.world.lighthouses[0].radius === radius) return message;
    }
  }
  assert.deepEqual(await untilRadius(a, 470), await untilRadius(b, 470));

  a.socket.close(); b.socket.close();
  const exited = once(server, 'exit');
  server.kill('SIGTERM');
  await exited;
  logs = '';
  port = undefined;
  server = startServer();
  server.stdout.on('data', chunk => { logs += chunk.toString(); });
  server.stderr.on('data', chunk => { logs += chunk.toString(); });
  for (let i = 0; i < 100; i++) {
    port = logs.replace(/\x1b\[[0-9;]*m/g, '').match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (port) break;
    await delay(100);
  }
  assert.ok(port, logs);
  const restarted = client();
  assert.equal((await restarted.next()).world.lighthouses[0].radius, 290);
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 2, request_id: 'restart' }));
  assert.equal((await restarted.next()).success, true);
  assert.equal((await restarted.next()).world.lighthouses[0].radius, 350);

});
