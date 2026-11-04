import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

test('real server: snapshots, validation, mutations, broadcast, reconnect', { timeout: 60000 }, async (t) => {
  const server = spawn('cargo', ['run', '--quiet', '-p', 'el-pharos-server'], {
    env: { ...process.env, EL_PHAROS_BIND: '127.0.0.1:0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
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
      command(id, active, version = 1) {
        socket.send(JSON.stringify({ type: 'set_lighthouse_active', protocol_version: version, lighthouse_id: id, active }));
      },
    };
  }
  const a = client(), b = client();
  const initial = await a.next();
  assert.equal(initial.type, 'world_snapshot');
  assert.equal(initial.protocol_version, 1);
  assert.equal(initial.world.islands.length, 1);
  assert.equal(initial.world.lighthouses.length, 1);
  assert.deepEqual(await b.next(), initial);
  const id = initial.world.lighthouses[0].id;
  a.socket.send('not json');
  assert.equal((await a.next()).type, 'error');
  a.command('missing', false);
  assert.equal((await a.next()).message, 'Unknown lighthouse');
  a.command(id, false, 2);
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
  b.command(id, true);
  assert.equal((await a.next()).world.lighthouses[0].active, true);
  assert.equal((await b.next()).world.revision, changed.world.revision + 1);
});
