class RealtimeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs) {
    const input = inputs?.[0]?.[0];
    if (input && input.length) {
      this.port.postMessage(input.slice());
    }
    return true;
  }
}

registerProcessor("realtime-processor", RealtimeProcessor);