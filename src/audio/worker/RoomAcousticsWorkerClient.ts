import type { RoomScene } from '../room/roomTypes';
import type { RoomAcousticsWorkerRequest, RoomAcousticsWorkerResponse } from './roomAcousticsWorkerMessages';

export interface SimulateRoomResult {
  impulseResponseChannelData: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

/** Thin promise-based wrapper around the room-acoustics ray-tracing Web Worker, mirroring
    `AudioAnalysisWorkerClient`'s request/response shape — one instance per simulation run. */
export class RoomAcousticsWorkerClient {
  private readonly worker: Worker;
  private nextRequestId = 0;
  private readonly pendingRequests = new Map<number, { resolve: (response: RoomAcousticsWorkerResponse) => void; reject: (error: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./roomAcousticsWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<RoomAcousticsWorkerResponse>) => this.handleResponse(event.data);
  }

  private handleResponse(response: RoomAcousticsWorkerResponse): void {
    const pendingRequest = this.pendingRequests.get(response.requestId);
    if (!pendingRequest) return;
    this.pendingRequests.delete(response.requestId);

    if (response.type === 'error') {
      pendingRequest.reject(new Error(response.message));
    } else {
      pendingRequest.resolve(response);
    }
  }

  private sendRequest(request: RoomAcousticsWorkerRequest): Promise<RoomAcousticsWorkerResponse> {
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.requestId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  async simulate(scene: RoomScene, sampleRate: number, stereoSimulationEnabled: boolean): Promise<SimulateRoomResult> {
    const requestId = this.nextRequestId++;
    const response = await this.sendRequest({ type: 'simulate', requestId, scene, sampleRate, stereoSimulationEnabled });
    if (response.type !== 'simulate') throw new Error('Unexpected response to simulate.');
    return { impulseResponseChannelData: response.impulseResponseChannelData, sampleRate: response.sampleRate };
  }

  terminate(): void {
    this.worker.terminate();
    this.pendingRequests.clear();
  }
}
