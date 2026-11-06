import { useState } from 'react';
import type { WorldState } from '../protocol';
import { keeperName } from '../state/keeper';
import { cargoStatus } from '../shipping';

const familyMessages = [
  'We packed enough biscuits for everyone at the tower.',
  'The children are counting every beacon along the way.',
  'A warm supper and familiar faces are waiting ahead.',
  'We promised to bring the old family photographs.',
  'The sea is calm enough for a proper visit today.',
  'There is a spare bunk and a kettle on at the far light.',
];
const mailMessages = [
  'Dear neighbor, the lantern is steady tonight. I hope yours is too.',
  'I found your old chart. I am sending it back with a note in the margin.',
  'The gulls arrived before your last letter. This time I hope my reply is first.',
  'When the weather clears, come share a pot of tea at my tower.',
  'Your story about the storm made me smile. Our light held through it as well.',
  'I have saved you a fresh page from the logbook and a little good news.',
];
const remarks: Record<string, string[]> = {
  cargo: ['The hold is secure. We will keep to the lit passage.', 'Another load for the network; steady as she goes.', 'The crew is watching for the next beacon.'],
  doctor: ['Medicine and clean bandages are ready below deck.', 'We are making all the speed we can for the keeper.', 'The patient will have help soon.'],
  vessel: ['The crew is charting the water beyond the lights.', 'Every scrap we find can help rebuild a haven.', 'The lookout has spotted another promising patch of sea.'],
  legacy: ['A safe passage is a welcome sight at sea.', 'We can see the next lantern from here.', 'The crew sends a wave to the tower.'],
};

export function ShipStatus({ world, id }: { world: WorldState; id: string }) {
  const [remark] = useState(() => {
    const lines = remarks[id.split(':')[0]] ?? remarks.legacy;
    return lines[Math.floor(Math.random() * lines.length)];
  });
  const name = (lightId: string) => world.lighthouses.find(l => l.id === lightId)?.name ?? lightId;
  if (id === 'expedition') {
    const boat = world.expedition;
    const status = boat.pending_choice ? `Awaiting a choice at ${name(boat.pending_choice)}` : boat.securing ? `Securing ${name(boat.securing)} · ${boat.secure_remaining}s` : boat.blocked ? 'Waiting for a safe route' : boat.destination ? 'Sailing to destination' : 'Waiting for orders';
    return <><strong>Expedition boat</strong><p>{world.economy.paused ? 'Paused' : status}</p><small>Select the boat to give it orders.</small></>;
  }
  if (id.startsWith('voyage:')) {
    const ship = world.voyages.ships.find(s => `voyage:${s.id}` === id);
    if (!ship) return null;
    const origin = world.lighthouses.find(l => l.id === ship.origin);
    const destination = world.lighthouses.find(l => l.id === ship.destination);
    const blocked = ship.from === ship.to && ship.phase !== 'visiting' || ship.from !== ship.to && !world.shipping_links.some(l => (l.from === ship.from && l.to === ship.to) || (l.to === ship.to && l.from === ship.to));
    const status = world.economy.paused ? 'Paused' : blocked ? 'Waiting for a safe route' : ship.phase === 'visiting' ? 'Visiting the keeper' : ship.phase === 'returning' ? 'Sailing home' : ship.kind === 'mail' ? 'Delivering mail' : 'Sailing to visit';
    const text = (ship.kind === 'mail' ? mailMessages : familyMessages)[ship.message_id];
    return <><strong>{ship.kind === 'mail' ? 'Mail ship' : 'Family boat'}</strong>
      <p>{status} · {name(ship.origin)} → {name(ship.destination)}</p>
      <blockquote>“{text}”</blockquote>
      {origin && destination && <small>{ship.kind === 'mail' ? `From ${keeperName(origin)} to ${keeperName(destination)}` : `${keeperName(origin)}’s family visiting ${keeperName(destination)}`}</small>}
    </>;
  }
  if (id.startsWith('cargo:')) {
    const ship = world.salvage?.ships.find(s => `cargo:${s.yard_id}` === id);
    if (!ship) return null;
    return <><strong>Cargo ship</strong><p>{cargoStatus(world, ship)}</p><blockquote>“{remark}”</blockquote></>;
  }
  if (id === 'doctor') {
    if (!world.doctor) return null;
    return <><strong>Doctor ship</strong><p>{world.economy.paused ? 'Paused' : world.doctor.returning ? 'Returning to First Haven' : `Sailing to ${name(world.doctor.destination)}`}</p><blockquote>“{remark}”</blockquote></>;
  }
  if (id === 'vessel') {
    const ship = world.salvage?.vessel;
    if (!ship) return null;
    const status = ship.phase === 'docked' ? 'Docked at First Haven' : ship.phase === 'searching' ? 'Searching for Salvage' : ship.phase === 'returning' ? 'Returning with Salvage' : 'Sailing to the search area';
    return <><strong>Salvage vessel</strong><p>{world.economy.paused ? 'Paused' : status}</p><blockquote>“{remark}”</blockquote></>;
  }
  if (id.startsWith('legacy:')) {
    const link = world.shipping_links.find(l => `legacy:${l.from}:${l.to}` === id);
    if (!link) return null;
    return <><strong>Passing ship</strong><p>{world.economy.paused ? 'Paused' : `Sailing between ${name(link.from)} and ${name(link.to)}`}</p><blockquote>“{remark}”</blockquote></>;
  }
  return null;
}
