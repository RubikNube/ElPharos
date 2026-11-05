import type { WorldCommands } from '../network/commands';
import type { WorldStore } from '../state/worldStore';

type Props = Pick<WorldStore, 'connection' | 'pending' | 'notice' | 'error'> & { commands: WorldCommands };

export function SaveControls({ connection, pending, notice, error, commands }: Props) {
  return <>
      <div className="save-controls">
        <button disabled={connection !== 'connected' || !!pending} onClick={() => commands.save()}>Save</button>
        <button disabled={connection !== 'connected' || !!pending} onClick={() => commands.load()}>Load</button>
      </div>
      <p className="hint">One server save slot. Load replaces the shared world in every connected tab.</p>
      <p role="status">{pending ? (pending.action === 'save_game' ? 'Saving…' : 'Loading…') : notice}</p>
      {error && <p role="alert" className="error">{error}</p>}
  </>;
}
