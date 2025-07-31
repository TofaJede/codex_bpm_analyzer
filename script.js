const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const waveCanvas = document.getElementById('waveCanvas');
const keyCanvas = document.getElementById('keyCanvas');
const eqCanvas = document.getElementById('eqCanvas');
const loudnessCanvas = document.getElementById('loudnessCanvas');
const noteCloud = document.getElementById('noteCloud');
const bpmMeter = document.getElementById('bpmMeter');
const dynamicRangeDiv = document.getElementById('dynamicRange');
const durationLabel = document.getElementById('durationLabel');
const resetBtn = document.getElementById('resetBtn');
const loadingOverlay = document.getElementById('loading');
const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
let waveAnimation;

// Drag & Drop
['dragenter','dragover'].forEach(event => {
  dropZone.addEventListener(event, e => {
    e.preventDefault();
    dropZone.classList.add('hover');
  });
});
['dragleave','drop'].forEach(event => {
  dropZone.addEventListener(event, e => {
    e.preventDefault();
    dropZone.classList.remove('hover');
  });
});
dropZone.addEventListener('drop', e => {
  const file = e.dataTransfer.files[0];
  handleFile(file);
});
dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
resetBtn.addEventListener('click', resetAll);

function handleFile(file) {
  if (!file) return;
  loadingOverlay.classList.remove('hidden');
  const reader = new FileReader();
  reader.onload = async e => {
    const arrayBuffer = e.target.result;
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    analyzeBuffer(audioBuffer);
    loadingOverlay.classList.add('hidden');
  };
  reader.readAsArrayBuffer(file);
}

function analyzeBuffer(buffer) {
  const envelope = computeLoudness(buffer); // also used for BPM
  const bpm = estimateBPM(envelope, buffer.sampleRate, 1024);
  const dynamic = computeDynamicRange(buffer);
  const freqData = analyzeFrequency(buffer);
  drawWaveform(envelope);
  drawKeyChart(freqData.keyDist);
  showBPM(bpm);
  showNotes(freqData.dominantNotes);
  drawEQ(freqData.bandEnergy);
  showDynamicRange(dynamic);
  drawLoudness(envelope);
  durationLabel.textContent = `Analyzed: ${formatTime(buffer.duration)}`;
}

function computeLoudness(buffer) {
  const data = buffer.getChannelData(0);
  const size = 1024;
  const loud = [];
  for (let i = 0; i < data.length; i += size) {
    let sum = 0;
    for (let j = 0; j < size && i + j < data.length; j++) {
      const s = data[i + j];
      sum += s * s;
    }
    loud.push(Math.sqrt(sum / size));
  }
  return loud;
}

function estimateBPM(envelope, sampleRate, step) {
  const rate = sampleRate / step;
  const n = envelope.length;
  const ac = new Array(n).fill(0);
  for (let lag = 1; lag < n; lag++) {
    let sum = 0;
    for (let i = 0; i < n - lag; i++) {
      sum += envelope[i] * envelope[i + lag];
    }
    ac[lag] = sum;
  }
  let bestLag = 0, bestVal = 0;
  const minBPM = 60, maxBPM = 180;
  const minLag = Math.round(rate * 60 / maxBPM);
  const maxLag = Math.round(rate * 60 / minBPM);
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (ac[lag] > bestVal) {
      bestVal = ac[lag];
      bestLag = lag;
    }
  }
  return Math.round(60 * rate / bestLag);
}

function computeDynamicRange(buffer) {
  const data = buffer.getChannelData(0);
  let min = 1, max = -1;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max, range: max - min };
}

function analyzeFrequency(buffer) {
  const data = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const size = 2048;
  const bins = new Array(12).fill(0);
  const noteStrength = {};
  const band = { low: 0, mid: 0, high: 0 };
  for (let i = 0; i < data.length - size; i += size) {
    const slice = data.slice(i, i + size);
    const spectrum = dft(slice);
    for (let k = 0; k < spectrum.length; k++) {
      const freq = k * sampleRate / size;
      const mag = spectrum[k];
      if (freq < 250) band.low += mag;
      else if (freq < 4000) band.mid += mag;
      else band.high += mag;
      if (freq > 27 && freq < 4200) {
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        const pc = ((midi % 12) + 12) % 12;
        bins[pc] += mag;
        const name = noteFromMidi(midi);
        noteStrength[name] = (noteStrength[name] || 0) + mag;
      }
    }
  }
  const total = bins.reduce((a, b) => a + b, 0) || 1;
  const keyDist = bins.map(v => v / total * 100);
  const dominantNotes = Object.entries(noteStrength)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const bandTotal = band.low + band.mid + band.high || 1;
  band.low /= bandTotal;
  band.mid /= bandTotal;
  band.high /= bandTotal;
  return { keyDist, dominantNotes, bandEnergy: band };
}

function dft(samples) {
  const N = samples.length;
  const result = new Array(N / 2).fill(0);
  for (let k = 0; k < N / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const angle = (2 * Math.PI * k * n) / N;
      re += samples[n] * Math.cos(angle);
      im -= samples[n] * Math.sin(angle);
    }
    result[k] = Math.sqrt(re * re + im * im);
  }
  return result;
}

function noteFromMidi(midi) {
  const name = noteNames[(midi % 12 + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function drawWaveform(loud) {
  const ctx = waveCanvas.getContext('2d');
  const w = waveCanvas.width = waveCanvas.offsetWidth;
  const h = waveCanvas.height = waveCanvas.offsetHeight;
  let idx = 0;
  if (waveAnimation) cancelAnimationFrame(waveAnimation);
  function animate() {
    ctx.clearRect(0, 0, w, h);
    const radius = Math.min(w, h) / 4 + loud[idx % loud.length] * h / 4;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgb(100,51,162)';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 20;
    ctx.shadowColor = 'rgb(100,51,162)';
    ctx.stroke();
    idx++;
    waveAnimation = requestAnimationFrame(animate);
  }
  animate();
}

function drawKeyChart(dist) {
  const ctx = keyCanvas.getContext('2d');
  const w = keyCanvas.width = keyCanvas.offsetWidth;
  const h = keyCanvas.height = keyCanvas.offsetHeight;
  const barH = h / 12;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 12; i++) {
    const val = dist[i];
    ctx.fillStyle = 'rgba(100,51,162,0.7)';
    ctx.fillRect(0, i * barH, w * val / 100, barH - 2);
    ctx.fillStyle = '#eee';
    ctx.fillText(`${noteNames[i]} ${val.toFixed(1)}%`, 5, i * barH + barH / 2 + 4);
  }
}

function showBPM(bpm) {
  bpmMeter.textContent = bpm + ' BPM';
  bpmMeter.style.animation = 'pulse 1s infinite';
}

function showNotes(notes) {
  noteCloud.innerHTML = '';
  if (!notes.length) return;
  const max = notes[0][1];
  notes.forEach(([name, val]) => {
    const span = document.createElement('span');
    span.textContent = name;
    const size = 16 + (val / max) * 40;
    span.style.fontSize = size + 'px';
    noteCloud.appendChild(span);
  });
}

function drawEQ(band) {
  const ctx = eqCanvas.getContext('2d');
  const w = eqCanvas.width = eqCanvas.offsetWidth;
  const h = eqCanvas.height = eqCanvas.offsetHeight;
  const vals = [band.low, band.mid, band.high];
  const labels = ['Low', 'Mid', 'High'];
  const barW = w / 3 - 20;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < 3; i++) {
    const val = vals[i];
    const x = i * (barW + 20) + 20;
    const barH = val * h;
    ctx.fillStyle = 'rgba(100,51,162,0.7)';
    ctx.fillRect(x, h - barH, barW, barH);
    ctx.fillStyle = '#eee';
    ctx.fillText(labels[i], x, h - 5);
  }
}

function showDynamicRange(dynamic) {
  const bar = dynamicRangeDiv.querySelector('.bar');
  const minMarker = dynamicRangeDiv.querySelector('.marker.min');
  const maxMarker = dynamicRangeDiv.querySelector('.marker.max');
  const label = dynamicRangeDiv.querySelector('.label');
  const minPos = ((dynamic.min + 1) / 2) * 100;
  const maxPos = ((dynamic.max + 1) / 2) * 100;
  bar.style.left = minPos + '%';
  bar.style.width = (maxPos - minPos) + '%';
  minMarker.style.left = minPos + '%';
  maxMarker.style.left = maxPos + '%';
  label.textContent = `${dynamic.min.toFixed(2)} / ${dynamic.max.toFixed(2)}`;
}

function drawLoudness(loud) {
  const ctx = loudnessCanvas.getContext('2d');
  const w = loudnessCanvas.width = loudnessCanvas.offsetWidth;
  const h = loudnessCanvas.height = loudnessCanvas.offsetHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  for (let i = 0; i < loud.length; i++) {
    const x = i / (loud.length - 1) * w;
    const y = h - loud[i] * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = 'rgb(100,51,162)';
  ctx.shadowBlur = 10;
  ctx.shadowColor = 'rgb(100,51,162)';
  ctx.stroke();
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function resetAll() {
  if (waveAnimation) cancelAnimationFrame(waveAnimation);
  [waveCanvas, keyCanvas, eqCanvas, loudnessCanvas].forEach(c => {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
  });
  bpmMeter.textContent = '';
  bpmMeter.style.animation = 'none';
  noteCloud.innerHTML = '';
  dynamicRangeDiv.querySelector('.bar').style.width = '0';
  dynamicRangeDiv.querySelector('.label').textContent = '';
  durationLabel.textContent = '';
  fileInput.value = '';
  loadingOverlay.classList.add('hidden');
}
