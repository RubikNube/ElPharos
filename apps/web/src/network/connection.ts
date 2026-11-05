import { isDiscovered } from '../rendering/visibility';
import { serverMessageSchema, type ClientMessage } from '../protocol';
import { useWorldStore } from '../state/worldStore';

export function connectWorld() {
  let socket: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const url = new URL('/ws', window.location.href);
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  function connect() {
    if (stopped) return;
    useWorldStore.setState({ world: null, connection: attempt ? 'reconnecting' : 'connecting' });
    const current = new WebSocket(url);
    socket = current;
    // An open socket is usable only after receiving a valid world snapshot.
    deadline = setTimeout(() => current.close(), 10000);
    current.onmessage = (event: MessageEvent<unknown>) => {
      if (stopped || current !== socket) return;
      try {
        if (typeof event.data !== 'string') throw new Error('Expected text');
        const message = serverMessageSchema.parse(JSON.parse(event.data));
        if (message.type === 'command_result') {
          const pending = useWorldStore.getState().pending;
          if (pending?.id === message.request_id) useWorldStore.setState({
            pending: null, notice: message.success ? (pending.action === 'save_game' ? 'World saved.' : 'World loaded.') : null,
            error: message.success ? null : message.message,
          });
          return;
        }
        if (message.type === 'error') {
          useWorldStore.setState({ error: message.message });
          return;
        }
        clearTimeout(deadline);
        attempt = 0;
        const selected = message.world.lighthouses.find(light => light.id === useWorldStore.getState().selectedId && isDiscovered(message.world, light.position));
        useWorldStore.setState({ selectedId: selected?.id ?? null, world: message.world, connection: 'connected' });
      } catch {
        useWorldStore.setState({ error: 'Received an incompatible world. Check that client and server versions match.' });
        current.close(4002, 'Invalid server message');
      }
    };
    current.onerror = () => {
      if (!stopped && current === socket) useWorldStore.setState({ error: 'Cannot reach the world server. Retrying…' });
    };
    current.onclose = () => {
      if (stopped || current !== socket) return;
      clearTimeout(deadline);
      const interrupted = useWorldStore.getState().pending;
      useWorldStore.setState({ world: null, connection: 'reconnecting', pending: null, notice: interrupted ? 'Connection lost. Save/load outcome is unknown; reconnect before retrying.' : null });
      retry = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempt++, 4), 10000));
    };
  }
  connect();

  return {
    send(message: ClientMessage) {
      if (socket?.readyState !== WebSocket.OPEN || useWorldStore.getState().connection !== 'connected') return;
      if ('request_id' in message) useWorldStore.setState({ pending: { id: message.request_id, action: message.type }, notice: null, error: null });
      useWorldStore.setState({ error: null });
      socket.send(JSON.stringify(message));
    },
    dispose() {
      stopped = true;
      clearTimeout(retry);
      clearTimeout(deadline);
      if (socket) {
        socket.onmessage = socket.onerror = socket.onclose = null;
        socket.close();
      }
      useWorldStore.setState({ world: null, connection: 'offline', error: null, pending: null, notice: null });
    },
  };
}
