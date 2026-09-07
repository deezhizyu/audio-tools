import { synthesizeRoomImpulseResponse } from '../room/synthesizeRoomImpulseResponse';
import { DEFAULT_RAY_TRACING_PARAMS } from '../room/traceRays';
import type { RoomAcousticsWorkerRequest, RoomAcousticsWorkerResponse } from './roomAcousticsWorkerMessages';

function respond(response: RoomAcousticsWorkerResponse, transferables: Transferable[] = []): void {
  self.postMessage(response, { transfer: transferables });
}

self.onmessage = (event: MessageEvent<RoomAcousticsWorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'simulate': {
        const impulseResponseChannelData = synthesizeRoomImpulseResponse(request.scene, request.sampleRate, DEFAULT_RAY_TRACING_PARAMS);

        respond(
          { type: 'simulate', requestId: request.requestId, impulseResponseChannelData, sampleRate: request.sampleRate },
          [impulseResponseChannelData.buffer],
        );
        break;
      }
    }
  } catch (error) {
    respond({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
