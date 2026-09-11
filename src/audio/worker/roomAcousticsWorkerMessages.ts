import type { RoomScene } from '../room/roomTypes';

/** 'interactive' uses `INTERACTIVE_RAY_TRACING_PARAMS`'s much smaller ray/bounce budget for a fast, rougher
    preview while the room is actively being edited; 'full' uses `DEFAULT_RAY_TRACING_PARAMS` for the accurate
    result once editing settles. See `roomAcousticsDefaults.ts`. */
export type SimulationQuality = 'interactive' | 'full';

export type RoomAcousticsWorkerRequest = {
  type: 'simulate';
  requestId: number;
  scene: RoomScene;
  sampleRate: number;
  stereoSimulationEnabled: boolean;
  quality: SimulationQuality;
};

export type RoomAcousticsWorkerResponse =
  | { type: 'simulate'; requestId: number; impulseResponseChannelData: Float32Array<ArrayBuffer>[]; sampleRate: number }
  | { type: 'error'; requestId: number; message: string };
