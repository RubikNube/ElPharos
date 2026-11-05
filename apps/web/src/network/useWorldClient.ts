import { useEffect, useMemo, useRef } from 'react';
import { connectWorld } from './connection';
import { worldCommands } from './commands';

export function useWorldClient() {
  const client = useRef<ReturnType<typeof connectWorld> | null>(null);
  useEffect(() => {
    const connection = connectWorld();
    client.current = connection;
    return () => { connection.dispose(); client.current = null; };
  }, []);
  return useMemo(() => worldCommands(message => client.current?.send(message)), []);
}
