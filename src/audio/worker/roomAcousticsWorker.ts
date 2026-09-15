import { createSeededRandomSource } from '../room/seededRandom';
import { synthesizeRoomImpulseResponse } from '../room/synthesizeRoomImpulseResponse';
import { DEFAULT_RAY_TRACING_PARAMS, INTERACTIVE_RAY_TRACING_PARAMS, type RayTracingParams } from '../room/traceRays';
import type { RoomAcousticsWorkerRequest, RoomAcousticsWorkerResponse, SimulationQuality } from './roomAcousticsWorkerMessages';

/** Every simulation starts from the same seed, so simulating one room twice gives one answer rather than two
    similar ones — see `createSeededRandomSource`. The particular value is arbitrary; that it never changes is
    not. */
const SIMULATION_RANDOM_SEED = 0x5eed1e55;

function respond(response: RoomAcousticsWorkerResponse, transferables: Transferable[] = []): void {
  self.postMessage(response, { transfer: transferables });
}

function rayTracingParamsForQuality(quality: SimulationQuality): RayTracingParams {
  const params = quality === 'interactive' ? INTERACTIVE_RAY_TRACING_PARAMS : DEFAULT_RAY_TRACING_PARAMS;
  // A generator of its own per request, rather than one shared across them: a shared one would carry its
  // position forward and make each simulation depend on how many ran before it.
  return { ...params, randomSource: createSeededRandomSource(SIMULATION_RANDOM_SEED) };
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
