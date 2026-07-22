import { useCallback, useEffect, useRef, useState } from "react";
import type { MotionClipV1 } from "@ltypet/character-motion";

export function usePlayback({ activeClip }: { activeClip: MotionClipV1 | null }) {
  const animationRef = useRef<number | null>(null);
  const lastTimestampRef = useRef(0);
  const elapsedFramesRef = useRef(0);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const stopAnimation = useCallback(() => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    lastTimestampRef.current = 0;
    setIsPlaying(false);
  }, []);

  // ActiveClip null-guard effect: must be declared before rAF playback effect
  useEffect(() => {
    if (!activeClip) {
      stopAnimation();
      setCurrentFrame(0);
      return;
    }
    if (currentFrame > activeClip.durationFrames) setCurrentFrame(activeClip.durationFrames);
  }, [activeClip, currentFrame, stopAnimation]);

  // rAF playback effect
  useEffect(() => {
    if (!isPlaying || !activeClip) return;
    const frameDuration = 1000 / activeClip.fps;
    const animate = (timestamp: number) => {
      if (lastTimestampRef.current === 0) lastTimestampRef.current = timestamp;
      elapsedFramesRef.current += (timestamp - lastTimestampRef.current) / frameDuration;
      lastTimestampRef.current = timestamp;
      let frame = Math.floor(elapsedFramesRef.current);
      if (frame > activeClip.durationFrames) {
        if (activeClip.loop === "repeat") {
          elapsedFramesRef.current %= activeClip.durationFrames + 1;
          frame = Math.floor(elapsedFramesRef.current);
        } else {
          setCurrentFrame(activeClip.durationFrames);
          setIsPlaying(false);
          animationRef.current = null;
          return;
        }
      }
      setCurrentFrame(frame);
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [activeClip, isPlaying]);

  const togglePlay = useCallback(() => {
    if (!activeClip) return;
    if (isPlaying) {
      stopAnimation();
      return;
    }
    elapsedFramesRef.current = currentFrame;
    lastTimestampRef.current = 0;
    setIsPlaying(true);
  }, [activeClip, currentFrame, isPlaying, stopAnimation]);

  return { currentFrame, setCurrentFrame, isPlaying, togglePlay, stopAnimation };
}
