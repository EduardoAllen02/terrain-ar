export class ExperienceRegistry {
  private names: string[] = []
  idx = 0   // internal — accessed by Viewer360 for dot sync

  register(hotspotNames: string[]): void {
    this.names = [...hotspotNames].sort()
    this.idx   = 0
  }

  setCurrent(name: string): void {
    const i = this.names.indexOf(name)
    if (i !== -1) this.idx = i
  }

  getCurrentName(): string | null {
    return this.names[this.idx] ?? null
  }

  getCount(): number {
    return this.names.length
  }

  navigatePrev(): string | null {
    if (!this.names.length) return null
    this.idx = (this.idx - 1 + this.names.length) % this.names.length
    return this.names[this.idx]
  }

  navigateNext(): string | null {
    if (!this.names.length) return null
    this.idx = (this.idx + 1) % this.names.length
    return this.names[this.idx]
  }
}