// Observe only for an explicit UI action, then detach. Two stable animation
// frames after ResizeObserver give Maps time to apply its container resize.
// There is deliberately no timer or persistent recenter-on-resize listener.
export function waitForMapLayout(
  element: HTMLElement,
  signal: AbortSignal,
  changeLayout: () => void = () => {},
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    let frame = 0;
    const finish = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = element.clientWidth;
        const height = element.clientHeight;
        frame = requestAnimationFrame(() => {
          if (element.clientWidth === width && element.clientHeight === height)
            finish();
          // A changed size will produce another observer notification.
        });
      });
    });
    signal.addEventListener("abort", finish, { once: true });
    observer.observe(element);
    changeLayout();
  });
}
