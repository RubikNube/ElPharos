import { useLayoutEffect, useRef } from 'react';
import type { WorldState } from '../protocol';
import type { WorldCommands } from '../network/commands';
import { doctorBlockedReason } from './DoctorPanel';
import { facilityBlockedReason, isNetworkIlluminated, lighthouseSelection, networkUpkeep } from '../state/worldQueries';

type Action = { label: string; reason?: string | null; run: () => void };

export function lighthouseActions(world: WorldState, id: string, connected: boolean, commands: WorldCommands): Action[] {
  const { lighthouse: light, island, yard } = lighthouseSelection(world, id);
  if (!light) return [];
  const offline = connected ? null : 'Reconnect to use this action.';
  const actions: Action[] = [
    {
      label: light.active ? 'Extinguish beacon' : 'Light the beacon',
      reason: offline ?? (!light.active && !light.visited ? 'Send the expedition boat here first.' : !light.active && world.economy.fuel < networkUpkeep(world) + light.fuel_upkeep ? 'Not enough fuel for one second of network upkeep.' : null),
      run: () => commands.setLighthouseActive(id, !light.active),
    },
    {
      label: `Expand radius (+${world.radius_step})${world.salvage ? ` — ${world.salvage.rules.expand_cost} Salvage` : ''}`,
      reason: offline ?? (light.radius >= world.radius_max ? 'Maximum radius reached.' : world.salvage && world.salvage.reserve < world.salvage.rules.expand_cost ? 'Not enough Salvage.' : null),
      run: () => commands.expandLighthouse(id),
    },
  ];
  if (world.expedition.pending_choice === id) {
    actions.unshift(
      {
        label: `Explore — collect up to 20 ${world.salvage ? 'Salvage' : 'fuel'}`,
        reason: offline,
        run: () => commands.chooseExpedition(id, 'explore'),
      },
      {
        label: 'Secure — 30s, then −0.25 fuel/s upkeep',
        reason: offline,
        run: () => commands.chooseExpedition(id, 'secure'),
      },
    );
  }
  if (world.salvage) {
    for (const [role, name] of [['efficient_lamp', 'Efficient lamp'], ['navigation_beacon', 'Navigation beacon']] as const) {
      const cost = light.specialization ? world.salvage.rules.refit_cost : world.salvage.rules.specialization_cost;
      actions.push({
        label: light.specialization === role ? `Installed: ${name}` : `${light.specialization ? 'Refit' : 'Install'}: ${name} — ${cost} Salvage`,
        reason: offline ?? (light.specialization === role ? 'Already installed.' : !isNetworkIlluminated(world, light.position) ? 'Requires connected illumination.' : world.salvage.reserve < cost ? 'Not enough Salvage.' : null),
        run: () => commands.specialize(id, role),
      });
    }
  }
  if (light.sick) actions.push({
    label: `Send doctor — ${world.doctor_rules.trip_fuel} fuel`,
    reason: doctorBlockedReason(world, light, connected),
    run: () => commands.sendDoctor(id),
  });
  const facilityBlock = facilityBlockedReason(world, island, connected);
  if (yard && !yard.restored && world.salvage) actions.push({
    label: `Restore salvage yard — ${world.salvage.rules.restore_fuel} fuel + ${world.salvage.rules.restore_cost} Salvage`,
    reason: facilityBlock ?? (world.salvage.reserve < world.salvage.rules.restore_cost ? 'Not enough Salvage.' : null),
    run: () => commands.restoreSalvageYard(yard.island_id),
  });
  if (island?.fuel_facility === 'ruined') actions.push({
    label: `Restore fuel facility — ${world.economy.facility_restore_cost} fuel`,
    reason: facilityBlock,
    run: () => commands.restoreFuelFacility(island.id),
  });
  if (island?.fuel_facility === 'haven' && world.salvage) {
    const vessel = world.salvage.vessel;
    const rules = world.salvage.rules.vessel;
    actions.push(vessel ? {
      label: vessel.enabled ? 'Stop automatic expeditions' : 'Enable automatic expeditions',
      reason: offline,
      run: () => commands.setSalvageVesselEnabled(!vessel.enabled),
    } : {
      label: `Build salvage vessel — ${rules.build_fuel} fuel`,
      reason: offline ?? (!world.salvage.vessel_route ? 'No nearby water route available.' : world.economy.fuel < rules.build_fuel ? 'Not enough fuel to build.' : null),
      run: () => commands.buildSalvageVessel(),
    });
  }
  const boat = world.expedition;
  actions.push({
    label: 'Send expedition here',
    reason: offline ?? (boat.pending_choice || boat.securing ? 'Resolve the current expedition visit first.' : !isNetworkIlluminated(world, boat.position) || !isNetworkIlluminated(world, light.position) ? 'Requires a route through connected light.' : null),
    run: () => commands.orderExpedition(light.position, light.id),
  });
  return actions;
}

export function LighthouseContextMenu({ world, id, x, y, connected, commands, onClose }: {
  world: WorldState; id: string; x: number; y: number; connected: boolean; commands: WorldCommands; onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const light = lighthouseSelection(world, id).lighthouse;
  const actions = lighthouseActions(world, id, connected, commands);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const position = () => {
      const parent = element.parentElement!;
      element.style.left = `${Math.max(8, Math.min(x + 8, parent.clientWidth - element.offsetWidth - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(y + 8, parent.clientHeight - element.offsetHeight - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(element);
    return () => observer.disconnect();
  }, [x, y, actions.length]);
  useLayoutEffect(() => { (menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? menu.current)?.focus(); }, [id]);
  if (!light) return null;
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };
  return <div ref={menu} className="lighthouse-context-menu" role="menu" tabIndex={-1} aria-label={`${light.name} actions`} onKeyDown={onKeyDown}>
    <strong>{light.name}</strong>
    {actions.map(action => <button key={action.label.split(' — ')[0]} role="menuitem" disabled={!!action.reason} title={action.reason ?? undefined} onClick={() => { action.run(); onClose(); }}>
      {action.label}{action.reason && <small>{action.reason}</small>}
    </button>)}
  </div>;
}
