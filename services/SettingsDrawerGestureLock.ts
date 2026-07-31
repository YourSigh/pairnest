export class SettingsDrawerGestureLock {
  private static lockCount = 0;

  static lock() {
    this.lockCount += 1;
    let released = false;

    return () => {
      if (released) return;
      released = true;
      this.lockCount = Math.max(0, this.lockCount - 1);
    };
  }

  static isLocked() {
    return this.lockCount > 0;
  }
}
