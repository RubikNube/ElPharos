import { create } from 'zustand';
import type { WorldState } from '../protocol';

export type WorldStore = {
  world: WorldState | null;
  selectedId: string | null;
  pending: { id: string; action: string } | null;
  notice: string | null;
  connection: 'connecting' | 'connected' | 'reconnecting' | 'offline';
  error: string | null;
};

export const useWorldStore = create<WorldStore>(() => ({
  pending: null, notice: null, selectedId: "beacon-1", world: null, connection: 'connecting', error: null,
}));
