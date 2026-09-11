import { synthesizeRoomImpulseResponse } from '../room/synthesizeRoomImpulseResponse';
import { DEFAULT_RAY_TRACING_PARAMS, INTERACTIVE_RAY_TRACING_PARAMS, type RayTracingParams } from '../room/traceRays';
import type { RoomAcousticsWorkerRequest, RoomAcousticsWorkerResponse, SimulationQuality } from './roomAcousticsWorkerMessages';

function respond(response: RoomAcousticsWorkerResponse, transferables: Transferable[] = []): void {
  self.postMessage(response, { transfer: transferables });
}

function rayTracingParamsForQuality(quality: SimulationQuality): RayTracingParams {
  return quality === 'interactive' ? INTERACTIVE_RAY_TRACING_PARAMS : DEFAULT_RAY_TRACING_PARAMS;
}

self.onmessage = (event: MessageEvent<RoomAcousticsWorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'simulate': {
        const impulseResponseChannelData = synthesizeRoomImpulseResponse(
          request.scene,
          request.sampleRate,
          rayTracingParamsForQuality(request.quality),
          request.stereoSimulationEnabled,
        );

        respond(
          { type: 'simulate', requestId: request.requestId, impulseResponseChannelData, sampleRate: request.sampleRate },
          impulseResponseChannelData.map(channel => channel.buffer),
        );
        break;
      }
    }
  } catch (error) {
    respond({ type: 'error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};
