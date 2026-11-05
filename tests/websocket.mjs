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
    const errors = [];
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'error') errors.push(message.message);
      queue.push(message);
    });
    t.after(() => socket.close());
    return {
      socket, errors,
      async next() {
        for (let i = 0; i < 200; i++) { if (queue.length) return queue.shift(); await delay(20); }
        throw new Error('Timed out waiting for server message');
      },
      command(id, active, version = 10) {
        socket.send(JSON.stringify({ type: 'set_lighthouse_active', protocol_version: version, lighthouse_id: id, active }));
      },
    };
  }
  const a = client(), b = client();
  await a.next(); await b.next();
  a.socket.send(JSON.stringify({ type: 'set_simulation_paused', protocol_version: 10, paused: true }));
  const initial = await a.next();
  assert.equal(initial.type, 'world_snapshot');
  assert.equal(initial.protocol_version, 10);
  assert.ok(initial.world.islands.length >= 6 && initial.world.islands.length <= 12);
  assert.equal(initial.world.lighthouses.length, initial.world.islands.length);
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
    a.socket.send(JSON.stringify({ type, protocol_version: 10, request_id }));
    let result;
    do { result = await a.next(); } while (result.type !== 'command_result');
    assert.equal(result.request_id, request_id);
    return result;
  }
  assert.equal((await command('load_game', 'missing')).success, false);
  a.socket.send(JSON.stringify({ type: 'expand_lighthouse_radius', protocol_version: 10, lighthouse_id: id }));
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
  assert.equal(JSON.parse(saved).save_version, 8);
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
  unsupported.save_version = 109;
  await writeFile(savePath, JSON.stringify(unsupported));
  assert.equal((await command('load_game', 'version')).success, false);
  await writeFile(savePath, saved);
  // Concurrent clients mutate under the same server gate without losing an upgrade.
  for (const c of [a, b]) c.socket.send(JSON.stringify({ type: 'expand_lighthouse_radius', protocol_version: 10, lighthouse_id: id }));
  async function untilRadius(c, radius) {
    for (;;) {
      const message = await c.next();
      if (message.type === 'world_snapshot' && message.world.lighthouses[0].radius === radius) return message;
    }
  }
  assert.deepEqual(await untilRadius(a, 470), await untilRadius(b, 470));

  // Explicit geometry fixture keeps the restoration-boundary checks deterministic.
  const fixedWorld = JSON.parse(await readFile(new URL('./fixtures/fixed-world.json', import.meta.url), 'utf8'));
  fixedWorld.economy.paused = true;
  fixedWorld.lighthouses[0].radius = 470;
  fixedWorld.lighthouses[0].explored_radius = 470;
  await writeFile(savePath, JSON.stringify({ save_version: 7, world: fixedWorld }));
  assert.equal((await command('load_game', 'fixed-layout')).success, true);
  await untilRadius(a, 470); await untilRadius(b, 470);

  // Discover Amber Shoal and restore concurrently: one charge and one mutation.
  a.socket.send(JSON.stringify({ type: 'restore_fuel_facility', protocol_version: 10, island_id: 'island-2' }));
  assert.equal((await a.next()).type, 'error'); // 470 radius does not illuminate its center.
  a.socket.send(JSON.stringify({ type: 'expand_lighthouse_radius', protocol_version: 10, lighthouse_id: id }));
  const eligible = await untilRadius(a, 530);
  await untilRadius(b, 530);
  a.command('beacon-2', true);
  await a.next(); await b.next();
  for (const c of [a, b]) c.socket.send(JSON.stringify({ type: 'restore_fuel_facility', protocol_version: 10, island_id: 'island-2' }));
  async function untilProduction(c, production) {
    for (;;) {
      const message = await c.next();
      if (message.type === 'world_snapshot' && message.world.economy.production === production) return message;
    }
  }
  const facility = await untilProduction(a, 5);
  assert.deepEqual(await untilProduction(b, 5), facility);
  assert.equal(facility.world.economy.fuel, eligible.world.economy.fuel - 120);
  assert.equal(facility.world.revision, eligible.world.revision + 2);
  assert.equal(facility.world.lighthouses[1].connected, true);
  assert.deepEqual(facility.world.shipping_links, [{ from: id, to: 'beacon-2' }]);
  a.command(id, false);
  const isolated = await untilProduction(a, 2);
  assert.deepEqual(await untilProduction(b, 2), isolated);
  assert.equal(isolated.world.islands[1].fuel_production, 0);
  assert.deepEqual(isolated.world.shipping_links, []);
  a.command(id, true);
  const networkRestored = await untilProduction(a, 5);
  assert.deepEqual(await untilProduction(b, 5), networkRestored);
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
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 10, request_id: 'restart' }));
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
  restarted.socket.send(JSON.stringify({ type: 'set_simulation_paused', protocol_version: 10, paused: false }));
  await until(restarted, w => !w.economy.paused);
  const tick = await until(restarted, w => w.economy.elapsed_seconds > baseline);
  const otherTick = await until(observer, w => w.economy.elapsed_seconds === tick.economy.elapsed_seconds);
  assert.deepEqual(otherTick, tick);
  assert.equal(tick.lighthouses[0].fuel_upkeep, 2);
  const savedFuel = JSON.parse(facilitySaved).world.economy.fuel;
  assert.equal(tick.economy.fuel, savedFuel + (tick.economy.elapsed_seconds - baseline) * 2);
  observer.socket.send(JSON.stringify({ type: 'set_simulation_paused', protocol_version: 10, paused: true }));
  const paused = await until(restarted, w => w.economy.paused);
  await delay(1200);
  const verification = client();
  assert.deepEqual((await verification.next()).world, paused);

  // A simultaneous yard restoration charges once and broadcasts the new fleet.
  const cargoFixture = JSON.parse(facilitySaved);
  cargoFixture.world.salvage.reserve = 100;
  cargoFixture.world.economy.fuel = 300;
  await writeFile(savePath, JSON.stringify(cargoFixture));
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 10, request_id: 'cargo-fixture' }));
  await until(restarted, w => w.salvage.reserve === 100);
  await until(observer, w => w.salvage.reserve === 100);
  for (const c of [restarted, observer]) c.socket.send(JSON.stringify({ type: 'restore_salvage_yard', protocol_version: 10, island_id: 'island-5' }));
  const yardRestored = await until(restarted, w => w.salvage.ships.length === 1);
  const broadcast = await until(observer, w => w.salvage.ships.length === 1);
  assert.deepEqual(yardRestored, broadcast);
  assert.equal(yardRestored.salvage.reserve, 60);
  assert.equal(yardRestored.economy.fuel, 180);
  assert.equal(yardRestored.salvage.yards[0].restored, true);
  assert.equal(yardRestored.salvage.rules.expand_cost, 20);

  for (const c of [restarted, observer]) c.socket.send(JSON.stringify({
    type: 'set_lighthouse_specialization', protocol_version: 10,
    lighthouse_id: 'beacon-1', specialization: 'efficient_lamp',
  }));
  const specialized = await until(restarted, w => w.lighthouses[0].specialization === 'efficient_lamp');
  assert.deepEqual(await until(observer, w => w.lighthouses[0].specialization === 'efficient_lamp'), specialized);
  assert.equal(specialized.salvage.reserve, 20);
  assert.equal(specialized.lighthouses[0].fuel_upkeep, yardRestored.lighthouses[0].fuel_upkeep - 0.5);
  restarted.socket.send(JSON.stringify({
    type: 'set_lighthouse_specialization', protocol_version: 10,
    lighthouse_id: 'beacon-1', specialization: 'navigation_beacon',
  }));
  const refitted = await until(restarted, w => w.lighthouses[0].specialization === 'navigation_beacon');
  assert.equal(refitted.salvage.reserve, 0);
  assert.equal(refitted.lighthouses[0].fuel_upkeep, yardRestored.lighthouses[0].fuel_upkeep);

  // Research uses remembered exploration, and concurrent duplicate purchases charge once.
  const researchFixture = JSON.parse(facilitySaved);
  researchFixture.world.salvage.reserve = 40;
  researchFixture.world.economy.paused = true;
  researchFixture.world.economy.blackout = false;
  for (const light of researchFixture.world.lighthouses) {
    light.active = false;
    light.explored_radius = light.radius;
  }
  await writeFile(savePath, JSON.stringify(researchFixture));
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 10, request_id: 'research-fixture' }));
  const researchBaseline = await until(restarted, w => w.salvage.reserve === 40 && w.lighthouses.every(l => !l.active));
  await until(observer, w => w.revision === researchBaseline.revision);
  assert.equal(researchBaseline.research.catalog.filter(t => t.discovered).length, 6);
  for (const c of [restarted, observer]) c.socket.send(JSON.stringify({
    type: 'research_technology', protocol_version: 10, technology_id: 'reinforced_foundations',
  }));
  const researched = await until(restarted, w => w.research.completed.length === 1);
  assert.deepEqual(await until(observer, w => w.research.completed.length === 1), researched);
  assert.equal(researched.salvage.reserve, 0);
  assert.equal(researched.salvage.rules.expand_cost, 15);
  assert.equal(researched.revision, researchBaseline.revision + 1);
  const duplicateObserver = client();
  const duplicateState = (await duplicateObserver.next()).world;
  assert.deepEqual(duplicateState, researched);
  duplicateObserver.socket.close();

  // Independent purchases compete for a single shared reserve.
  await writeFile(savePath, JSON.stringify(researchFixture));
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 10, request_id: 'research-race' }));
  const raceBaseline = await until(restarted, w => w.research.completed.length === 0 && w.salvage.reserve === 40);
  await until(observer, w => w.revision === raceBaseline.revision);
  restarted.socket.send(JSON.stringify({ type: 'research_technology', protocol_version: 10, technology_id: 'streamlined_hulls' }));
  observer.socket.send(JSON.stringify({ type: 'research_technology', protocol_version: 10, technology_id: 'precision_lenses' }));
  const winner = await until(restarted, w => w.research.completed.length === 1);
  assert.deepEqual(await until(observer, w => w.research.completed.length === 1), winner);
  assert.equal(winner.salvage.reserve, 0);
  assert.equal(winner.revision, raceBaseline.revision + 1);
  const failedClient = winner.research.completed[0] === 'streamlined_hulls' ? observer : restarted;
  for (let i = 0; i < 100 && !failedClient.errors.includes('Not enough Salvage for research'); i++) await delay(20);
  assert.ok(failedClient.errors.includes('Not enough Salvage for research'));

  // Malformed IDs and protocol mismatches cannot mutate research.
  restarted.socket.send(JSON.stringify({ type: 'research_technology', protocol_version: 10, technology_id: 'unknown' }));
  for (;;) { const msg = await restarted.next(); if (msg.type === 'error' && msg.message === 'Invalid command') break; }
  restarted.socket.send(JSON.stringify({ type: 'research_technology', protocol_version: 8, technology_id: 'reinforced_foundations' }));
  assert.equal((await restarted.next()).message, 'Unsupported protocol version');
  restarted.socket.send(JSON.stringify({ type: 'save_game', protocol_version: 10, request_id: 'research-save' }));
  for (;;) { const msg = await restarted.next(); if (msg.type === 'command_result') { assert.equal(msg.success, true); break; } }
  const researchSaved = JSON.parse(await readFile(savePath, 'utf8'));
  assert.equal(researchSaved.save_version, 8);
  assert.deepEqual(researchSaved.world.research.completed, winner.research.completed);
  assert.equal(researchSaved.world.research.catalog, undefined);
  const invalidResearch = structuredClone(researchSaved);
  invalidResearch.world.research.completed = ['expanded_holds'];
  await writeFile(savePath, JSON.stringify(invalidResearch));
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 10, request_id: 'invalid-research' }));
  for (;;) { const msg = await restarted.next(); if (msg.type === 'command_result') { assert.equal(msg.success, false); break; } }
  const unchangedClient = client();
  assert.deepEqual((await unchangedClient.next()).world, winner);
  unchangedClient.socket.close();
  await writeFile(savePath, JSON.stringify(researchSaved));
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 10, request_id: 'research-load' }));
  const researchLoaded = await until(restarted, w => w.revision > winner.revision);
  assert.deepEqual(researchLoaded.research, winner.research);

  // A single shared vessel is constructed once even with concurrent requests.
  const vesselFixture = structuredClone(researchSaved);
  vesselFixture.world.economy.fuel = 600;
  vesselFixture.world.salvage.reserve = 200;
  await writeFile(savePath, JSON.stringify(vesselFixture));
  restarted.socket.send(JSON.stringify({ type: 'load_game', protocol_version: 10, request_id: 'vessel-fixture' }));
  const vesselBaseline = await until(restarted, w => w.revision > researchLoaded.revision);
  await until(observer, w => w.revision === vesselBaseline.revision);
  for (const c of [restarted, observer]) c.socket.send(JSON.stringify({ type: 'build_salvage_vessel', protocol_version: 10 }));
  const vesselBuilt = await until(restarted, w => w.salvage.vessel !== null);
  assert.deepEqual(await until(observer, w => w.salvage.vessel !== null), vesselBuilt);
  assert.equal(vesselBuilt.economy.fuel, 400);
  assert.equal(vesselBuilt.salvage.reserve, 200);
  assert.equal(vesselBuilt.revision, vesselBaseline.revision + 1);
  assert.equal(vesselBuilt.salvage.vessel.enabled, true);
  assert.equal(vesselBuilt.salvage.vessel_route.length, 2);
  restarted.socket.send(JSON.stringify({ type: 'set_salvage_vessel_enabled', protocol_version: 10, enabled: false }));
  const vesselStopped = await until(restarted, w => w.salvage.vessel?.enabled === false);
  assert.deepEqual(await until(observer, w => w.salvage.vessel?.enabled === false), vesselStopped);
  assert.equal(vesselStopped.economy.fuel, 400);

  // Restart broadcasts a fresh running game and preserves the save slot.
  const beforeRestartSave = await readFile(savePath, 'utf8');
  restarted.socket.send(JSON.stringify({ type: 'restart_game', protocol_version: 10, request_id: 'new-game' }));
  for (;;) {
    const msg = await restarted.next();
    if (msg.type === 'command_result') {
      assert.equal(msg.request_id, 'new-game');
      assert.equal(msg.success, true);
      break;
    }
  }
  const fresh = await until(restarted, w => w.revision > vesselStopped.revision);
  assert.equal(fresh.revision, vesselStopped.revision + 1);
  assert.equal(fresh.economy.elapsed_seconds, 0);
  assert.equal(fresh.economy.paused, false);
  assert.equal(fresh.economy.fuel, 300);
  assert.equal(fresh.objective_complete, false);
  assert.ok(fresh.islands.length >= 6 && fresh.islands.length <= 12);
  assert.notDeepEqual(fresh.islands.map(i => i.position), researchLoaded.islands.map(i => i.position));
  assert.deepEqual(fresh.research.completed, []);
  assert.deepEqual(await until(observer, w => w.revision >= fresh.revision), fresh);
  assert.equal(await readFile(savePath, 'utf8'), beforeRestartSave);

});
