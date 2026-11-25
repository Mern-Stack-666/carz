/**
 * Procedural Web Audio API sound engine for Raftaar Nitro.
 * Generates zero-copyright dynamic engine notes per car, nitro whoosh, pickups,
 * drift tire hiss, collisions, countdown beeps, UI clicks, and looping synth music.
 *
 * Custom audio drop-in note: if you add MP3/OGG files under public/sounds/ later,
 * you can load them via AudioContext.decodeAudioData inside playCustomBuffer().
 */
export class AudioSystem {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.masterGain = null;
    this.sfxGain = null;
    this.musicGain = null;

    this.engineRunning = false;
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineFilter = null;
    this.engineGain = null;
    this.engineProfile = { baseFreq: 68, maxFreq: 195, waveform: 'sawtooth', grit: 0.3 };

    this.nitroGain = null;
    this.driftGain = null;
    this.noiseBuffer = null;

    this.musicTimer = null;
    this.musicStep = 0;
    this.musicMode = 'none'; // 'menu' | 'race' | 'none'
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;

    this.ctx = new AC();
    this.masterGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();

    this.sfxGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this.noiseBuffer = this._createNoiseBuffer();
    this.applySettings(this.settings);
  }

  applySettings(settings) {
    this.settings = settings;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.masterGain.gain.setTargetAtTime(settings.masterVolume, t, 0.03);
    this.sfxGain.gain.setTargetAtTime(settings.sfxVolume, t, 0.03);
    this.musicGain.gain.setTargetAtTime(settings.musicVolume, t, 0.03);
  }

  _createNoiseBuffer() {
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  startEngine(profile) {
    this.unlock();
    if (!this.ctx || this.engineRunning) return;
    this.engineProfile = profile || this.engineProfile;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineGain = this.ctx.createGain();

    this.engineOsc1.type = this.engineProfile.waveform || 'sawtooth';
    this.engineOsc2.type = 'triangle';
    this.engineOsc1.frequency.value = this.engineProfile.baseFreq;
    this.engineOsc2.frequency.value = this.engineProfile.baseFreq * 0.5;

    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineGain.gain.value = 0.001;

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxGain);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // Nitro continuous whoosh node
    const nitroSrc = this.ctx.createBufferSource();
    nitroSrc.buffer = this.noiseBuffer;
    nitroSrc.loop = true;
    const nitroFilter = this.ctx.createBiquadFilter();
    nitroFilter.type = 'bandpass';
    nitroFilter.frequency.value = 950;
    nitroFilter.Q.value = 1.6;
    this.nitroGain = this.ctx.createGain();
    this.nitroGain.gain.value = 0;
    nitroSrc.connect(nitroFilter);
    nitroFilter.connect(this.nitroGain);
    this.nitroGain.connect(this.sfxGain);
    nitroSrc.start();
    this._nitroSrc = nitroSrc;

    // Drift tire hiss node
    const driftSrc = this.ctx.createBufferSource();
    driftSrc.buffer = this.noiseBuffer;
    driftSrc.loop = true;
    const driftFilter = this.ctx.createBiquadFilter();
    driftFilter.type = 'bandpass';
    driftFilter.frequency.value = 2100;
    driftFilter.Q.value = 3.0;
    this.driftGain = this.ctx.createGain();
    this.driftGain.gain.value = 0;
    driftSrc.connect(driftFilter);
    driftFilter.connect(this.driftGain);
    this.driftGain.connect(this.sfxGain);
    driftSrc.start();
    this._driftSrc = driftSrc;

    this.engineRunning = true;
  }

  updateEngine(speedRatio, isBoosting, isDrifting) {
    if (!this.ctx || !this.engineRunning) return;
    const t = this.ctx.currentTime;
    const clamped = Math.max(0, Math.min(1.35, speedRatio));
    const freq =
      this.engineProfile.baseFreq +
      (this.engineProfile.maxFreq - this.engineProfile.baseFreq) * clamped +
      (isBoosting ? 35 : 0);

    this.engineOsc1.frequency.setTargetAtTime(freq, t, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(freq * 0.502, t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(260 + clamped * 1100 + (isBoosting ? 600 : 0), t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.06 + clamped * 0.08, t, 0.05);

    this.nitroGain.gain.setTargetAtTime(isBoosting ? 0.16 : 0, t, 0.06);
    this.driftGain.gain.setTargetAtTime(isDrifting && clamped > 0.2 ? 0.09 : 0, t, 0.06);
  }

  stopEngine() {
    if (!this.engineRunning) return;
    try {
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      this._nitroSrc?.stop();
      this._driftSrc?.stop();
    } catch {
      // already stopped
    }
    this.engineRunning = false;
  }

  playClick() {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.exponentialRampToValueAtTime(920, t + 0.05);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  playPickup(risky = false) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = risky ? [523.25, 659.25, 987.77] : [440, 659.25];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t + idx * 0.055);
      g.gain.setValueAtTime(0.16, t + idx * 0.055);
      g.gain.exponentialRampToValueAtTime(0.001, t + idx * 0.055 + 0.18);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t + idx * 0.055);
      osc.stop(t + idx * 0.055 + 0.2);
    });
  }

  playCollision(intensity = 0.6) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    g.gain.setValueAtTime(Math.min(0.28, 0.1 + intensity * 0.18), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.19);
  }

  playCountdown(isGo = false) {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = isGo ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(isGo ? 880 : 440, t);
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (isGo ? 0.36 : 0.18));
    osc.connect(g);
    g.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + (isGo ? 0.38 : 0.2));
  }

  playWinFanfare() {
    this.unlock();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t + i * 0.09);
      g.gain.setValueAtTime(0.16, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.32);
      osc.connect(g);
      g.connect(this.sfxGain);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.34);
    });
  }

  startMusic(mode = 'menu') {
    this.unlock();
    if (this.musicMode === mode && this.musicTimer) return;
    this.stopMusic();
    this.musicMode = mode;
    if (!this.ctx) return;

    const tempoMs = mode === 'race' ? 165 : 240;
    const bassSeq =
      mode === 'race'
        ? [110, 110, 130.81, 146.83, 110, 110, 164.81, 146.83]
        : [98, 123.47, 146.83, 123.47, 87.31, 110, 130.81, 110];
    const leadSeq =
      mode === 'race'
        ? [440, 0, 523.25, 587.33, 659.25, 0, 587.33, 523.25]
        : [392, 0, 493.88, 0, 587.33, 0, 493.88, 440];

    this.musicTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      if (this.settings.musicVolume <= 0.01 || this.settings.masterVolume <= 0.01) return;

      const t = this.ctx.currentTime;
      const step = this.musicStep % bassSeq.length;
      this.musicStep++;

      // Bass pulse
      const bass = this.ctx.createOscillator();
      const bg = this.ctx.createGain();
      bass.type = 'triangle';
      bass.frequency.setValueAtTime(bassSeq[step], t);
      bg.gain.setValueAtTime(0.09, t);
      bg.gain.exponentialRampToValueAtTime(0.001, t + tempoMs / 1000 * 0.9);
      bass.connect(bg);
      bg.connect(this.musicGain);
      bass.start(t);
      bass.stop(t + tempoMs / 1000);

      // Lead synth arpeggio
      const leadNote = leadSeq[step];
      if (leadNote > 0) {
        const lead = this.ctx.createOscillator();
        const lg = this.ctx.createGain();
        lead.type = 'sine';
        lead.frequency.setValueAtTime(leadNote, t);
        lg.gain.setValueAtTime(0.045, t);
        lg.gain.exponentialRampToValueAtTime(0.001, t + tempoMs / 1000 * 0.85);
        lead.connect(lg);
        lg.connect(this.musicGain);
        lead.start(t);
        lead.stop(t + tempoMs / 1000);
      }
    }, tempoMs);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    this.musicMode = 'none';
  }
}
