/**
 * ExperienceRegistry
 *
 * Se construye en runtime a partir de los nombres de hotspots
 * descubiertos en el GLB. Orden alfabético por defecto.
 *
 * Para añadir una nueva experiencia:
 *   1. Añadir Empty "hotspot_NOMBRE" en Blender
 *   2. Añadir assets/pois/hotspot/NOMBRE.png
 *   3. Añadir assets/360/NOMBRE.jpg
 *   — Sin tocar código.
 */
export class ExperienceRegistry {
  private names: string[] = []
  private idx   = 0

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