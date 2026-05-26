export type SseClientOptions = {
  url: string;
  onMessage(event: MessageEvent): void;
  onError?(event: Event): void;
};

export function createSseClient(options: SseClientOptions): EventSource {
  const source = new EventSource(options.url);
  source.onmessage = options.onMessage;
  source.onerror = options.onError ?? null;
  return source;
}
