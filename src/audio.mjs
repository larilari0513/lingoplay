export class AudioCapture {
  async start(deviceId, onAudio, monitor = false) {
    if (!deviceId) throw new Error('먼저 오디오 입력 장치를 선택해 주세요.');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId }, channelCount: { ideal: 1 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      this.context = new AudioContext({ sampleRate: 24000, latencyHint: 'interactive' });
      if (this.context.sampleRate !== 24000) throw new Error('이 기기에서 24kHz 음성 처리를 시작하지 못했어요.');
      await this.context.audioWorklet.addModule('./pcm-worklet.js');
      this.node = new AudioWorkletNode(this.context, 'pcm-capture');
      this.node.port.onmessage = event => { if (event.data.flushed) this.flushResolve?.(); else if (this.active) onAudio(new Uint8Array(event.data)); };
      this.source = this.context.createMediaStreamSource(this.stream);
      this.source.connect(this.node); this.node.connect(this.context.destination);
      this.active = true; await this.context.resume();
      if (monitor) { this.monitor = new Audio(); this.monitor.srcObject = this.stream; await this.monitor.setSinkId('default'); await this.monitor.play(); }
    } catch (e) { await this.stop(); if (e.name === 'NotAllowedError') throw new Error('마이크 권한을 허용해 주세요. Mac에서는 시스템 설정에서 LingoPlay의 마이크 권한을 확인하세요.'); if (e.name === 'OverconstrainedError' || e.name === 'NotFoundError') throw new Error('선택한 오디오 장치를 찾지 못했어요. 장치 목록을 새로 연결해 주세요.'); throw e; }
  }
  async stop(flush = false) {
    if (flush && this.node && this.context?.state === 'running') { this.source?.disconnect(); await new Promise(resolve => { const timer = setTimeout(resolve, 250); this.flushResolve = () => { clearTimeout(timer); resolve(); }; this.node.port.postMessage('flush'); }); }
    this.active = false; this.stream?.getTracks().forEach(t => t.stop());
    if (this.monitor) { this.monitor.pause(); this.monitor.srcObject = null; }
    this.node?.disconnect(); this.source?.disconnect();
    if (this.context && this.context.state !== 'closed') await this.context.close();
  }
}
export class PCMPlayer {
  async start(deviceId) {
    if (!deviceId) throw new Error('번역 음성을 보낼 출력 장치를 선택해 주세요.');
    try {
      this.context = new AudioContext({ sampleRate: 24000 }); this.destination = this.context.createMediaStreamDestination();
      this.audio = new Audio(); this.audio.srcObject = this.destination.stream;
      if (!this.audio.setSinkId) throw new Error('오디오 출력 장치 선택을 지원하지 않는 환경이에요.');
      await this.audio.setSinkId(deviceId); await this.context.resume(); await this.audio.play(); this.next = 0; this.sources = new Set();
    } catch (e) { this.stop(); throw new Error(`음성 출력 연결 실패: ${e.message}`); }
  }
  append(base64) {
    if (!this.context || this.context.state === 'closed') return;
    const binary = atob(base64); if (binary.length % 2) return;
    const samples = new Float32Array(binary.length / 2);
    for (let i = 0; i < samples.length; i++) { let v = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8; if (v >= 32768) v -= 65536; samples[i] = v / 32768; }
    const now = this.context.currentTime;
    if (this.next - now > 8) throw new Error('번역 음성이 너무 많이 밀렸어요. 다시 시작해 주세요.');
    const buffer = this.context.createBuffer(1, samples.length, 24000); buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.destination);
    this.next = Math.max(now + .04, this.next); source.start(this.next); this.next += buffer.duration;
    this.sources.add(source); source.onended = () => { this.sources.delete(source); source.disconnect(); };
  }
  remaining() { return this.context ? Math.max(0, this.next - this.context.currentTime) * 1000 : 0; }
  stop() { for (const source of this.sources || []) { try { source.stop(); } catch {} } this.sources?.clear(); if (this.audio) { this.audio.pause(); this.audio.srcObject = null; } if (this.context?.state !== 'closed') this.context?.close().catch(() => {}); }
}
