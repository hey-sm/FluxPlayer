import { visualBus, type VisualBus, type VisualParams } from '../bus'

/** The controller only knows this output port; it has no rendering-engine access. */
export interface DiyVisualParamsAdapter {
  apply(params: Readonly<VisualParams>): void
}

export type VisualBusParamsApi = Pick<VisualBus, 'setParams'>

/** Routes every DIY write through the public VisualBus.setParams API. */
export class VisualBusDiyParamsAdapter implements DiyVisualParamsAdapter {
  constructor(private readonly bus: VisualBusParamsApi = visualBus) {}

  apply(params: Readonly<VisualParams>): void {
    this.bus.setParams({ ...params })
  }
}

export function createVisualBusDiyParamsAdapter(
  bus: VisualBusParamsApi = visualBus,
): DiyVisualParamsAdapter {
  return new VisualBusDiyParamsAdapter(bus)
}
