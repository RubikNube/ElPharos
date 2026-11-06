import { PROTOCOL_VERSION, type ClientMessage, type TechnologyId } from '../protocol';

export function worldCommands(send: (message: ClientMessage) => void) {
  return {
    wardVeilTarget: (lighthouse_id: string) => send({ type: 'ward_veil_target', protocol_version: PROTOCOL_VERSION, lighthouse_id }),
    sendDoctor: (lighthouse_id: string) => send({ type: 'send_doctor', protocol_version: PROTOCOL_VERSION, lighthouse_id }),
    buildSalvageVessel: () => send({ type: 'build_salvage_vessel', protocol_version: PROTOCOL_VERSION }),
    setSalvageVesselEnabled: (enabled: boolean) => send({ type: 'set_salvage_vessel_enabled', protocol_version: PROTOCOL_VERSION, enabled }),
    research: (technology_id: TechnologyId) => send({ type: 'research_technology', protocol_version: PROTOCOL_VERSION, technology_id }),
    setPaused: (paused: boolean) => send({ type: 'set_simulation_paused', protocol_version: PROTOCOL_VERSION, paused }),
    setLighthouseActive: (lighthouse_id: string, active: boolean) => send({ type: 'set_lighthouse_active', protocol_version: PROTOCOL_VERSION, lighthouse_id, active }),
    expandLighthouse: (lighthouse_id: string) => send({ type: 'expand_lighthouse_radius', protocol_version: PROTOCOL_VERSION, lighthouse_id }),
    specialize: (lighthouse_id: string, specialization: 'efficient_lamp' | 'navigation_beacon') => send({ type: 'set_lighthouse_specialization', protocol_version: PROTOCOL_VERSION, lighthouse_id, specialization }),
    restoreSalvageYard: (island_id: string) => send({ type: 'restore_salvage_yard', protocol_version: PROTOCOL_VERSION, island_id }),
    restoreFuelFacility: (island_id: string) => send({ type: 'restore_fuel_facility', protocol_version: PROTOCOL_VERSION, island_id }),
    save: () => send({ type: 'save_game', protocol_version: PROTOCOL_VERSION, request_id: crypto.randomUUID() }),
    load: () => send({ type: 'load_game', protocol_version: PROTOCOL_VERSION, request_id: crypto.randomUUID() }),
    restart: () => send({ type: 'restart_game', protocol_version: PROTOCOL_VERSION, request_id: crypto.randomUUID() }),
  };
}

export type WorldCommands = ReturnType<typeof worldCommands>;
