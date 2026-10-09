/**
 * Calm, static Voice Core backdrop for inner pages: the hero's mint/amber/ice
 * glow and a fading 64px grid at the top of the page. Pure CSS, no canvas.
 */
export function PageBackdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="bd-glow" />
      <div className="bd-grid" />
    </div>
  );
}
