import { create } from 'zustand';
import type { WorldState } from '../protocol';

export type WorldStore = {
  world: WorldState | null;
  selectedId: string | null;
  boatSelected: boolean;
  pending: { id: string; action: string } | null;
  notice: string | null;
  victoryNotice: boolean;
  connection: 'connecting' | 'connected' | 'reconnecting' | 'offline';
  error: string | null;
};

export const useWorldStore = create<WorldStore>(() => ({
  pending: null, notice: null, victoryNotice: false, selectedId: "beacon-1", boatSelected: false, world: null, connection: 'connecting', error: null,
}));
