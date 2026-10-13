/** The page backdrop: slow gradient light and a faint grid. Pure CSS, so it costs no JavaScript per frame. */
export function Background() {
  return (
    <div className="backdrop" aria-hidden="true">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
      <div className="grid-lines" />
      <div className="grain" />
    </div>
  );
}
