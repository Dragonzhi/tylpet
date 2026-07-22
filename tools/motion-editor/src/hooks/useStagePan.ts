import { useEffect, useRef, useState } from "react";

export function useStagePan() {
  const spacePressedRef = useRef(false);
  const panGestureRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);
  const [stagePan, setStagePan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement) && !(event.target instanceof HTMLSelectElement)) {
        spacePressedRef.current = true;
      }
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.code === "Space") spacePressedRef.current = false;
    };
    const blur = () => { spacePressedRef.current = false; panGestureRef.current = null; };
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const onPointerDownCapture = (event: React.PointerEvent<HTMLElement>) => {
    if (!spacePressedRef.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    panGestureRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: stagePan.x,
      y: stagePan.y,
    };
  };

  const onPointerMoveCapture = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setStagePan({
      x: gesture.x + event.clientX - gesture.clientX,
      y: gesture.y + event.clientY - gesture.clientY,
    });
  };

  const onPointerUpCapture = (event: React.PointerEvent<HTMLElement>) => {
    if (panGestureRef.current?.pointerId === event.pointerId) panGestureRef.current = null;
  };

  const onPointerCancelCapture = () => { panGestureRef.current = null; };

  return {
    stagePan,
    setStagePan,
    panHandlers: {
      onPointerDownCapture,
      onPointerMoveCapture,
      onPointerUpCapture,
      onPointerCancelCapture,
    },
  };
}
