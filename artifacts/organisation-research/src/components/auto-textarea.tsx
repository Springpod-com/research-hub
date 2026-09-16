import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from "react";
import * as U from "../ui";

export const AutoTextarea = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<typeof U.Textarea>
>(function AutoTextarea(
  { className, onChange, value, ...props },
  forwardedRef,
) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resize(localRef.current);
  }, [resize, value]);

  return (
    <U.Textarea
      {...props}
      ref={(element) => {
        localRef.current = element;
        if (typeof forwardedRef === "function") forwardedRef(element);
        else if (forwardedRef) forwardedRef.current = element;
      }}
      className={U.cn("max-h-[40vh] resize-none overflow-y-auto", className)}
      value={value}
      onChange={(event) => {
        resize(event.currentTarget);
        onChange?.(event);
      }}
    />
  );
});
