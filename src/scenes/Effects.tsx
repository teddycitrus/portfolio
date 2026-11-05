import { PerformanceMonitor } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { useAppStore } from '@/state/useAppStore';

/** Drops to 1x pixel ratio when frame rate declines, restores the canvas default when it recovers. */
const AdaptiveDpr = () => {
  const setDpr = useThree((s) => s.setDpr);
  const initialDpr = useThree((s) => s.viewport.initialDpr);
  return (
    <PerformanceMonitor
      onDecline={() => setDpr(1)}
      onIncline={() => setDpr(initialDpr)}
      flipflops={3}
      onFallback={() => setDpr(1)}
    />
  );
};

/**
 * HDR post chain for every mode. Scenes render linear HDR; bloom only catches
 * values above ~1 (sun core, lava, hovered rims), then ACES maps to display.
 */
const Effects = () => {
  const isTouch = useAppStore((s) => s.isTouch);

  return (
    <>
      <AdaptiveDpr />
      <EffectComposer multisampling={isTouch ? 0 : 2}>
        <Bloom
          mipmapBlur
          luminanceThreshold={1}
          luminanceSmoothing={0.2}
          intensity={0.55}
          radius={0.72}
          levels={isTouch ? 4 : 5}
        />
        <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        <Vignette offset={0.32} darkness={0.5} />
        {isTouch ? <></> : <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.04} />}
      </EffectComposer>
    </>
  );
};

export default Effects;
