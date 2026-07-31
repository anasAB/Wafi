import type { DomainEvent } from './domainEvent.types'

// No-op until WAFI-140 wires a real event bus underneath. Called only from
// executeBusinessOperation, fire-and-forget — never import this directly from a service.
export async function publishEvent<T>(_event: DomainEvent<T>): Promise<void> {
  // intentionally empty
}
