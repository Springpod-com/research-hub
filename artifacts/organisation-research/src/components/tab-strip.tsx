import { useEffect, useRef, useState, type ReactNode } from "react";
import * as U from "../ui";

/**
 * A horizontally scrolling row (the organisation tab strip) that shows a
 * fade and a chevron at its right edge while more of it lies off screen. On
 * a phone the strip is wider than the viewport, and without the hint the
 * last tabs are easy to miss.
 */
export function TabStrip({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () =>
      setMore(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
    check();
    el.addEventListener("scroll", check, { passive: true });
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", check);
      observer.disconnect();
    };
  }, []);
  return (
    <div className={U.cn("relative", className)}>
      <div ref={ref} className="overflow-x-auto">
        {children}
      </div>
      <div
        aria-hidden
        className={U.cn(
          "pointer-events-none absolute inset-y-0 right-0 flex w-14 items-center justify-end bg-gradient-to-l from-background via-background/80 to-transparent pr-1 text-muted-foreground transition-opacity",
          more ? "opacity-100" : "opacity-0",
        )}
      >
        <U.IconArrowRight size={16} />
      </div>
    </div>
  );
}

/**
 * Reports whether an element has scrolled out of view, so a compact copy of
 * it (an organisation's name beside the tabs) can take over on a phone.
 */
export function useScrolledPast<T extends HTMLElement>(key?: string) {
  const ref = useRef<T>(null);
  const [past, setPast] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The element sits at the top of its page, so the only way for it to
    // leave the view is to be scrolled above it.
    const observer = new IntersectionObserver(([entry]) =>
      setPast(!entry.isIntersecting),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [key]);
  return { ref, past };
}
