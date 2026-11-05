import { useState } from 'react';
import type { WorldCommands } from '../network/commands';
import type { WorldStore } from '../state/worldStore';

type Props = Pick<WorldStore, 'connection' | 'pending' | 'notice' | 'error'> & { commands: WorldCommands };

export function SaveControls({ connection, pending, notice, error, commands }: Props) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const disabled = connection !== 'connected' || !!pending;
  return <>
      <div className="save-controls">
        <button disabled={connection !== 'connected' || !!pending} onClick={() => commands.save()}>Save</button>
        <button disabled={connection !== 'connected' || !!pending} onClick={() => commands.load()}>Load</button>
        <button disabled={disabled} onClick={() => setConfirmRestart(true)}>Restart</button>
      </div>
      {confirmRestart && <section aria-label="Confirm restart">
        <p className="hint">Restart the shared game for every connected tab? Current progress will be lost. Your save slot will be kept.</p>
        <div className="save-controls">
          <button disabled={disabled} onClick={() => { commands.restart(); setConfirmRestart(false); }}>Restart game</button>
          <button onClick={() => setConfirmRestart(false)}>Cancel</button>
        </div>
      </section>}
      <p className="hint">One server save slot. Load replaces the shared world in every connected tab.</p>
      <p role="status">{pending ? ({ save_game: 'Saving…', load_game: 'Loading…', restart_game: 'Restarting…' }[pending.action] ?? 'Working…') : notice}</p>
      {error && <p role="alert" className="error">{error}</p>}
  </>;
}
