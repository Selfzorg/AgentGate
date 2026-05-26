export type SseHub = {
  publish(channel: string, payload: unknown): void;
};

export function createSseHubPlaceholder(): SseHub {
  return {
    publish(_channel, _payload) {
      return undefined;
    }
  };
}
