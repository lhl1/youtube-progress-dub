/* One volume policy for the entire dubbing session, independent of utterances. */
(function (root) {
  'use strict';
  class SessionVolume {
    constructor() { this.element = null; this.target = 1; this.cap = 1; this.applied = null; this.writing = false; this.listener = () => this.changed(); }
    start(element, cap) {
      if (!element) return;
      if (this.element !== element) {
        this.stop(); this.element = element; this.target = element.volume; this.applied = null;
        element.addEventListener('volumechange', this.listener);
      }
      this.cap = Math.min(1, Math.max(0, Number(cap) || 0)); this.enforce();
    }
    write(value) {
      if (!this.element || Math.abs(this.element.volume - value) < 0.0001) { this.applied = value; return; }
      this.applied = value; this.writing = true;
      try { this.element.volume = value; } finally { this.writing = false; }
    }
    changed() {
      if (!this.element || this.writing || Math.abs(this.element.volume - this.applied) < 0.0001) return;
      // Remember explicit slider changes for restoration, but keep the session cap.
      this.target = this.element.volume; this.enforce();
    }
    enforce() { if (this.element) this.write(Math.min(this.target, this.cap)); }
    stop() {
      const element = this.element, restore = this.target;
      if (!element) return;
      element.removeEventListener('volumechange', this.listener); this.element = null; this.applied = null;
      element.volume = restore;
    }
  }
  root.DubVolume = SessionVolume;
  if (typeof module !== 'undefined') module.exports = SessionVolume;
})(globalThis);
