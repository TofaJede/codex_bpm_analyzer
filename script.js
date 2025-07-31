const fileInput = document.getElementById('audioFile');
const audio = document.getElementById('audio');
const resultsDiv = document.getElementById('results');
const resetButton = document.getElementById('resetButton');
const canvas = document.getElementById('visualizer');
const ctx = canvas.getContext('2d');

let audioCtx; let source; let analyser; let animationId;
let pitchHistogram = new Array(12).fill(0);

const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

fileInput.addEventListener('change', handleFiles);
audio.addEventListener('play', startVisualizer);
audio.addEventListener('pause', stopVisualizer);
resetButton.addEventListener('click', resetAll);

function handleFiles() {
  const file = fileInput.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  audio.src = url;
  analyzeKey(file);
}

function analyzeKey(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const arrayBuffer = e.target.result;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    pitchHistogram = computePitchHistogram(audioBuffer);
    const keyScores = detectKeys(pitchHistogram);
    displayResults(keyScores);
  };
  reader.readAsArrayBuffer(file);
}

function computePitchHistogram(audioBuffer) {
  const data = audioBuffer.getChannelData(0);
  const sampleRate = audioBuffer.sampleRate;
  const step = 2048;
  const hist = new Array(12).fill(0);
  for (let i = 0; i < data.length - step; i += step) {
    const slice = data.slice(i, i + step);
    const freq = autoCorrelate(slice, sampleRate);
    if (freq) {
      const midi = 69 + 12 * Math.log2(freq / 440);
      const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
      hist[pitchClass]++;
    }
  }
  return hist;
}

function autoCorrelate(buf, sampleRate) {
  const SIZE = buf.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let bestOffset = -1;
  let bestCorrelation = 0;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    const val = buf[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return null;

  let lastCorrelation = 1;
  for (let offset = 0; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;
    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += Math.abs((buf[i]) - (buf[i + offset]));
    }
    correlation = 1 - (correlation / MAX_SAMPLES);
    if (correlation > 0.9 && correlation > lastCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    } else if (correlation < lastCorrelation) {
      if (bestCorrelation > 0.01) {
        const freq = sampleRate / bestOffset;
        return freq;
      }
    }
    lastCorrelation = correlation;
  }
  if (bestCorrelation > 0.01) {
    return sampleRate / bestOffset;
  }
  return null;
}

function detectKeys(hist) {
  const scores = {};
  const sum = hist.reduce((a, b) => a + b, 0) || 1;
  const norm = hist.map(v => v / sum);
  for (let i = 0; i < 12; i++) {
    let majorScore = 0;
    let minorScore = 0;
    for (let j = 0; j < 12; j++) {
      majorScore += norm[j] * majorProfile[(12 + j - i) % 12];
      minorScore += norm[j] * minorProfile[(12 + j - i) % 12];
    }
    scores[`${noteNames[i]} Major`] = majorScore;
    scores[`${noteNames[i]} Minor`] = minorScore;
  }
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  for (const key in scores) {
    scores[key] = (scores[key] / total) * 100;
  }
  return scores;
}

function displayResults(scores) {
  resultsDiv.innerHTML = '';
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const topKey = entries[0][0];
  entries.forEach(([key, val]) => {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.width = val.toFixed(2) + '%';
    const label = document.createElement('span');
    label.textContent = `${key}: ${val.toFixed(2)}%`;
    if (key === topKey) {
      label.classList.add('top-key');
      bar.style.background = 'rgba(100,51,162,0.8)';
    }
    bar.appendChild(label);
    resultsDiv.appendChild(bar);
  });
}

function startVisualizer() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (source) source.disconnect();
  source = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  analyser.connect(audioCtx.destination);
  draw();
}

function draw() {
  const width = canvas.width = canvas.offsetWidth;
  const height = canvas.height = canvas.offsetHeight;
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  animationId = requestAnimationFrame(draw);
  analyser.getByteFrequencyData(dataArray);
  ctx.clearRect(0, 0, width, height);
  let x = 0;
  const barWidth = (width / bufferLength) * 2.5;
  for (let i = 0; i < bufferLength; i++) {
    const barHeight = dataArray[i] / 255 * height;
    ctx.fillStyle = `rgba(100,51,162,${barHeight / height})`;
    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
}

function stopVisualizer() {
  cancelAnimationFrame(animationId);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (source) source.disconnect();
}

function resetAll() {
  stopVisualizer();
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio.removeAttribute('src');
    audio.load();
  }
  fileInput.value = '';
  resultsDiv.innerHTML = '';
  pitchHistogram = new Array(12).fill(0);
}
