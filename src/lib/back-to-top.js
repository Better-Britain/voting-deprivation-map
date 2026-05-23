export function initBackToTopButton(button) {
  if (!button) return;

  const root = document.documentElement;
  const threshold = () => Math.max(window.innerHeight * 2, 1200);

  function updateVisibility() {
    const show = window.scrollY > threshold() && root.scrollHeight > window.innerHeight * 1.5;
    button.classList.toggle("is-visible", show);
    button.setAttribute("aria-hidden", show ? "false" : "true");
  }

  button.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  window.addEventListener("scroll", updateVisibility, { passive: true });
  window.addEventListener("resize", updateVisibility);
  updateVisibility();
}
