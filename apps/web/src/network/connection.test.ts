import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectWorld } from './connection';
import { worldCommands } from './commands';
import { PROTOCOL_VERSION } from '../protocol';
import { researchWorldFixture } from '../research.fixture';
import { useWorldStore } from '../state/worldStore';

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn<(message: string) => void>();
  close = vi.fn(() => { this.readyState = 3; this.onclose?.(); });
  constructor(readonly url: URL) { FakeSocket.instances.push(this); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  snapshot(objective_complete = false) { this.message({ type: 'world_snapshot', protocol_version: PROTOCOL_VERSION, world: { ...researchWorldFixture(), objective_complete } }); }
}

let client: ReturnType<typeof connectWorld>;
beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
  vi.stubGlobal('window', { location: { href: 'https://example.test/game', protocol: 'https:' } });
  useWorldStore.setState({ world: null, selectedId: null, pending: null, notice: null, error: null, connection: 'offline' });
  client = connectWorld();
});
afterEach(() => { client.dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('waits for a validated snapshot before accepting commands and uses the current origin', () => {
  const socket = FakeSocket.instances[0];
  const commands = worldCommands(client.send);
  expect(socket.url.href).toBe('wss://example.test/ws');
  commands.setPaused(true);
  expect(socket.send).not.toHaveBeenCalled();
  socket.snapshot();
  expect(useWorldStore.getState().connection).toBe('connected');
  commands.setPaused(true);
  expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'set_simulation_paused', protocol_version: PROTOCOL_VERSION, paused: true });
});

it('closes an incompatible snapshot and reconnects with capped backoff', () => {
  const socket = FakeSocket.instances[0];
  socket.message({ type: 'world_snapshot', protocol_version: 0 });
  expect(socket.close).toHaveBeenCalledWith(4002, 'Invalid server message');
  expect(useWorldStore.getState().error).toContain('incompatible');
  for (const delay of [1000, 2000, 4000, 8000, 10000, 10000]) {
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(delay - 1);
    expect(FakeSocket.instances).toHaveLength(count);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(count + 1);
    FakeSocket.instances.at(-1)!.close();
  }
});

it('expires connections without snapshots and resets backoff after a valid one', () => {
  vi.advanceTimersByTime(10000);
  expect(FakeSocket.instances[0].close).toHaveBeenCalled();
  vi.advanceTimersByTime(1000);
  FakeSocket.instances[1].snapshot();
  vi.advanceTimersByTime(10000);
  expect(FakeSocket.instances[1].close).not.toHaveBeenCalled();
  FakeSocket.instances[1].close();
  vi.advanceTimersByTime(1000);
  expect(FakeSocket.instances).toHaveLength(3);
});

it('correlates save results and reports an interrupted load without retrying it', () => {
  const socket = FakeSocket.instances[0];
  socket.snapshot();
  client.send({ type: 'save_game', protocol_version: PROTOCOL_VERSION, request_id: 'save' });
  socket.message({ type: 'command_result', protocol_version: PROTOCOL_VERSION, request_id: 'other', success: true, message: 'Done' });
  expect(useWorldStore.getState().pending?.id).toBe('save');
  socket.message({ type: 'command_result', protocol_version: PROTOCOL_VERSION, request_id: 'save', success: true, message: 'Done' });
  expect(useWorldStore.getState().notice).toBe('World saved.');
  client.send({ type: 'load_game', protocol_version: PROTOCOL_VERSION, request_id: 'load' });
  socket.close();
  expect(useWorldStore.getState().pending).toBeNull();
  expect(useWorldStore.getState().notice).toContain('outcome is unknown');
  vi.advanceTimersByTime(1000);
  FakeSocket.instances[1].snapshot();
  expect(FakeSocket.instances[1].send).not.toHaveBeenCalled();
});

it('ignores stale socket events and clears timers and pending state on disposal', () => {
  const old = FakeSocket.instances[0];
  old.close();
  vi.advanceTimersByTime(1000);
  const current = FakeSocket.instances[1];
  current.snapshot();
  old.onclose?.();
  old.onerror?.();
  old.message({ type: 'error', protocol_version: PROTOCOL_VERSION, message: 'stale' });
  expect(useWorldStore.getState().connection).toBe('connected');
  expect(useWorldStore.getState().error).toBeNull();
  worldCommands(client.send).save();
  client.dispose();
  expect(useWorldStore.getState().pending).toBeNull();
  expect(useWorldStore.getState().connection).toBe('offline');
  expect(vi.getTimerCount()).toBe(0);
  expect(current.onmessage).toBeNull();
});

it('announces victory once, allows continued play, and announces a later victory after restart', () => {
  const socket = FakeSocket.instances[0];
  socket.snapshot();
  expect(useWorldStore.getState().victoryNotice).toBe(false);
  socket.snapshot(true);
  expect(useWorldStore.getState().victoryNotice).toBe(true);
  useWorldStore.setState({ victoryNotice: false });
  socket.snapshot(true);
  expect(useWorldStore.getState().victoryNotice).toBe(false);
  worldCommands(client.send).setLighthouseActive('beacon-1', false);
  expect(JSON.parse(socket.send.mock.calls.at(-1)![0]).type).toBe('set_lighthouse_active');
  socket.close();
  vi.advanceTimersByTime(1000);
  const reconnected = FakeSocket.instances[1];
  reconnected.snapshot(true);
  expect(useWorldStore.getState().victoryNotice).toBe(false);
  worldCommands(client.send).restart();
  const request = JSON.parse(reconnected.send.mock.calls.at(-1)![0]);
  expect(request.type).toBe('restart_game');
  expect(useWorldStore.getState().pending?.id).toBe(request.request_id);
  reconnected.message({ type: 'command_result', protocol_version: PROTOCOL_VERSION, request_id: request.request_id, success: true, message: 'Done' });
  reconnected.snapshot();
  expect(useWorldStore.getState().notice).toBe('New game started.');
  expect(useWorldStore.getState().victoryNotice).toBe(false);
  reconnected.snapshot(true);
  expect(useWorldStore.getState().victoryNotice).toBe(true);
});
