import { buildEnergyHistogram } from '../room/buildEnergyHistogram';
import { computeDirectSoundPath } from '../room/directSound';
import { HISTOGRAM_BIN_DURATION_SECONDS, MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS, SPEED_OF_SOUND_METERS_PER_SECOND } from '../room/roomAcousticsDefaults';
import { synthesizeImpulseResponseFromHistogram } from '../room/synthesizeImpulseResponseFromHistogram';
import { DEFAULT_RAY_TRACING_PARAMS, traceRays } from '../room/traceRays';
import type { RoomAcousticsWorkerRequest, RoomAcousticsWorkerResponse } from './roomAcousticsWorkerMessages';

function respond(response: RoomAcousticsWorkerResponse, transferables: Transferable[] = []): void {
  self.postMessage(response, { transfer: transferables });
}

self.onmessage = (event: MessageEvent<RoomAcousticsWorkerRequest>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'simulate': {
        const arrivals = traceRays(request.scene, DEFAULT_RAY_TRACING_PARAMS);
        const histogram = buildEnergyHistogram(
          arrivals,
          DEFAULT_RAY_TRACING_PARAMS.numberOfRays,
          HISTOGRAM_BIN_DURATION_SECONDS,
          MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS,
        );
        const directSound = computeDirectSoundPath(request.scene);
        const impulseResponseChannelData = synthesizeImpulseResponseFromHistogram(histogram, request.sampleRate, directSound, SPEED_OF_SOUND_METERS_PER_SECOND);

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
