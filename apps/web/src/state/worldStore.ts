import { create } from 'zustand';
import type { WorldState } from '../protocol';

type WorldStore = {
  world: WorldState | null;
  connection: 'connecting' | 'connected' | 'reconnecting' | 'offline';
  error: string | null;
};

export const useWorldStore = create<WorldStore>(() => ({
  world: null, connection: 'connecting', error: null,
}));
