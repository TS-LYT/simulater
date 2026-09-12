function asEvents(list) {
  return (list || [])
    .map((ev) => ({
      ...ev,
      t: Number(ev.t) || 0,
      kind: String(ev.kind || '').toLowerCase(),
    }))
    .sort((a, b) => a.t - b.t || Number(a.src) - Number(b.src));
}

export function createReplayPlayer({ getSpeed, onEvent, onTime, onResetVisuals }) {
  const player = {
    events: [],
    time: 0,
    cursor: 0,
    duration: 0,
    playing: false,
    loaded: false,

    load(events) {
      this.events = asEvents(events);
      this.loaded = true;
      const lastT = this.events.length ? this.events[this.events.length - 1].t : 0;
      this.duration = lastT + (this.events.length ? 15 : 0);
      this.reset();
    },

    play() {
      if (!this.events.length) return;
      if (this.time >= this.duration) this.reset();
      this.playing = true;
    },

    pause() {
      this.playing = false;
    },

    reset() {
      this.playing = false;
      this.time = 0;
      this.cursor = 0;
      if (onResetVisuals) onResetVisuals();
      if (onTime) onTime(this.time, this.duration, this.loaded);
    },

    step() {
      this.playing = false;
      if (this.cursor >= this.events.length) return;
      const ev = this.events[this.cursor++];
      this.time = ev.t;
      if (onEvent) onEvent(ev);
      if (onTime) onTime(this.time, this.duration, this.loaded);
    },

    seek(t) {
      const next = Math.min(Math.max(Number(t) || 0, 0), this.duration || 0);
      this.playing = false;
      if (next < this.time - 1e-9) {
        this.cursor = 0;
        if (onResetVisuals) onResetVisuals();
      }
      this.time = next;
      while (this.cursor < this.events.length && this.events[this.cursor].t <= next + 1e-9) {
        this.cursor += 1;
      }
      if (onTime) onTime(this.time, this.duration, this.loaded);
    },

    tick(dt) {
      if (!this.playing || !this.events.length) return this.time;
      const speed = Math.max(0.05, Number(getSpeed?.()) || 1);
      const target = Math.min(this.time + dt * speed, this.duration);
      while (this.cursor < this.events.length && this.events[this.cursor].t <= target + 1e-9) {
        const ev = this.events[this.cursor++];
        if (onEvent) onEvent(ev);
      }
      this.time = target;
      if (this.time >= this.duration && this.cursor >= this.events.length) this.playing = false;
      if (onTime) onTime(this.time, this.duration, this.loaded);
      return this.time;
    },
  };

  return player;
}
