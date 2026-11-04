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
        for (let i = 0; i < 200; i++) { if (queue.length) return queue.shift(); await delay(20); }
        throw new Error('Timed out waiting for server message');
      },
      command(id, active, version = 5) {
        socket.send(JSON.stringify({ type: 'set_lighthouse_active', protocol_version: version, lighthouse_id: id, active }));
      },
    };
  }
  const a = client(), b = client();
  await a.next(); await b.next();
  a.socket.send(JSON.stringify({ type: 'set_simulation_paused', protocol_version: 5, paused: true }));
  const initial = await a.next();
  assert.equal(initial.type, 'world_snapshot');
  assert.equal(initial.protocol_version, 5);
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
    a.socket.send(JSON.stringify({ type, protocol_version: 5, request_id }));
    let result;
    do { result = await a.next(); } while (result.type !== 'command_result');
    assert.equal(result.request_id, request_id);
    return result;
  }
  assert.equal((await command('load_game', 'missing')).success, false);
  a.socket.send(JSON.stringify({ type: 'expand_lighthouse_radius', protocol_version: 5, lighthouse_id: id }));
  const expanded = await a.next();
  assert.equal(expanded.world.lighthouses[0].radius, 350);
  assert.equal(expanded.world.lighthouses[0].fuel_upkeep, 1.25);
  assert.equal(expanded.world.lighthouses[0].next_fuel_upkeep, 1.5);
  assert.equal(expanded.world.economy.fuel, initial.world.economy.fuel);
  assert.equal(expanded.world.lighthouses[0].explored_radius, 350);
  assert.deepEqual(await b.next(), expanded);
  assert.equal((await command('save_game', 'save')).success, true);
  assert.deepEqual(await a.next(), expanded);
  const saved = await readFile(savePath, 'utf8');
  assert.equal(JSON.parse(saved).save_version, 4);
  assert.equal(JSON.parse(saved).world.lighthouses[0].fuel_upkeep, undefined);
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
  for (const c of [a, b]) c.socket.send(JSON.stringify({ type: 'expand_lighthouse_radius', protocol_version: 5, lighthouse_id: id }));
  async function untilRadius(c, radius) {
    for (;;) {
      const message = await c.next();
      if (message.type === 'world_snapshot' && message.world.lighthouses[0].radius === radius) return message;
    }
  }
  assert.deepEqual(await untilRadius(a, 470), await untilRadius(b, 470));

  // Discover Amber Shoal and restore concurrently: one charge and one mutation.
  a.socket.send(JSON.stringify({ type: 'restore_fuel_facility', protocol_version: 5, island_id: 'island-2' }));
  assert.equal((await a.next()).type, 'error'); // 470 radius does not illuminate its center.
  a.socket.send(JSON.stringify({ type: 'expand_lighthouse_radius', protocol_version: 5, lighthouse_id: id }));
  const eligible = await untilRadius(a, 530);
  await untilRadius(b, 530);
  for (const c of [a, b]) c.socket.send(JSON.stringify({ type: 'restore_fuel_facility', protocol_version: 5, island_id: 'island-2' }));
  async function untilProduction(c, production) {
    for (;;) {
      const message = await c.next();
      if (message.type === 'world_snapshot' && message.world.economy.production === production) return message;
    }
  }
  const facility = await untilProduction(a, 5);
  assert.deepEqual(await untilProduction(b, 5), facility);
  assert.equal(facility.world.economy.fuel, eligible.world.economy.fuel - 120);
  assert.equal(facility.world.revision, eligible.world.revision + 1);
  assert.equal((await command('save_game', 'facility-save')).success, true);
  const facilitySaved = await readFile(savePath, 'utf8');
  assert.equal(JSON.parse(facilitySaved).world.economy.production, undefined);
  assert.equal(JSON.parse(facilitySaved).world.islands[1].fuel_facility, 'restored');

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
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 5, request_id: 'restart' }));
  assert.equal((await restarted.next()).success, true);
  const afterRestart = (await restarted.next()).world;
  assert.equal(afterRestart.lighthouses[0].radius, 530);
  assert.equal(afterRestart.economy.production, 5);

  // Exercise unsolicited ticks and shared pause using predicates, not message order.
  async function until(c, predicate) {
    for (let i = 0; i < 30; i++) {
      const message = await c.next();
      if (message.type === 'world_snapshot' && predicate(message.world)) return message.world;
    }
    throw new Error('No matching snapshot');
  }
  const observer = client();
  const baseline = (await observer.next()).world.economy.elapsed_seconds;
  restarted.socket.send(JSON.stringify({ type: 'set_simulation_paused', protocol_version: 5, paused: false }));
  await until(restarted, w => !w.economy.paused);
  const tick = await until(restarted, w => w.economy.elapsed_seconds > baseline);
  const otherTick = await until(observer, w => w.economy.elapsed_seconds === tick.economy.elapsed_seconds);
  assert.deepEqual(otherTick, tick);
  assert.equal(tick.lighthouses[0].fuel_upkeep, 2);
  const savedFuel = JSON.parse(facilitySaved).world.economy.fuel;
  assert.equal(tick.economy.fuel, savedFuel + (tick.economy.elapsed_seconds - baseline) * 3);
  observer.socket.send(JSON.stringify({ type: 'set_simulation_paused', protocol_version: 5, paused: true }));
  const paused = await until(restarted, w => w.economy.paused);
  await delay(1200);
  const verification = client();
  assert.deepEqual((await verification.next()).world, paused);
});
