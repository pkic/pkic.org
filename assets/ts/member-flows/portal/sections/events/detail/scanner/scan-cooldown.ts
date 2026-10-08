/** Collection pauses while saving, then holds feedback briefly for the next attendee. */
export class ScanCooldownGate {
  private deadline = 0;
  private saving = false;
  constructor(private durationMs = 600) {}
  accept(now = Date.now()): boolean {
    if (this.saving || now < this.deadline) return false;
    this.saving = true;
    return true;
  }
  feedback(now = Date.now()) {
    this.saving = false;
    this.deadline = now + this.durationMs;
  }
  ready(now = Date.now()) {
    return !this.saving && now >= this.deadline;
  }
  remaining(now = Date.now()) {
    return Math.max(0, this.deadline - now);
  }
  skip() {
    if (!this.saving) this.deadline = 0;
  }
  reset() {
    this.saving = false;
    this.deadline = 0;
  }
}
