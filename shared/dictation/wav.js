function writeString(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

export function encodeWav(samples, sampleRate) {
  const source = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const buffer = new ArrayBuffer(44 + source.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + source.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, source.length * 2, true);
  let offset = 44;
  for (let index = 0; index < source.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, source[index] || 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

export function downsample(input, inputRate, outputRate) {
  if (!input?.length || !inputRate || !outputRate || inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const result = new Float32Array(length);
  let offset = 0;
  for (let index = 0; index < length; index += 1) {
    const next = Math.min(input.length, Math.round((index + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let cursor = offset; cursor < next; cursor += 1) {
      sum += input[cursor];
      count += 1;
    }
    result[index] = count ? sum / count : 0;
    offset = next;
  }
  return result;
}

export function rms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / samples.length);
}
