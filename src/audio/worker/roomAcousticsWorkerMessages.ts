import type { RoomScene } from '../room/roomTypes';

export type RoomAcousticsWorkerRequest = {
  type: 'simulate';
  requestId: number;
  scene: RoomScene;
  sampleRate: number;
  stereoSimulationEnabled: boolean;
};

export type RoomAcousticsWorkerResponse =
  | { type: 'simulate'; requestId: number; impulseResponseChannelData: Float32Array<ArrayBuffer>[]; sampleRate: number }
  | { type: 'error'; requestId: number; message: string };
