import type { WorldState } from '../protocol';
import { keeperMood, keeperName, useKeeperRemark, type Lighthouse } from '../state/keeper';

export function KeeperStatus({ world, light }: { world: WorldState; light: Lighthouse }) {
  const mood = keeperMood(world, light);
  const remark = useKeeperRemark(light, mood);
  return <section className="keeper-status" aria-label="Lighthouse keeper">
    <p><strong>{keeperName(light)}</strong> · <span>{mood}</span></p>
    {remark && <blockquote>“{remark}”</blockquote>}
  </section>;
}

export function LighthouseStatus({ world, light }: { world: WorldState; light: Lighthouse }) {
  return <>
    <strong>{light.name}</strong>
    <p>{light.active ? 'Beacon illuminated' : 'Beacon extinguished'} · {light.connected ? 'Connected to First Haven' : 'Isolated from First Haven'}</p>
    <p>Light radius: {light.radius} units<br />Beacon upkeep: {light.fuel_upkeep} fuel/s{!light.active && ' when lit'}</p>
    <KeeperStatus world={world} light={light} />
  </>;
}
