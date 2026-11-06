import { PerformanceMonitor } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Bloom, BrightnessContrast, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';

/**
 * Decided once at load and never changed: switching multisampling or effect
 * children later rebuilds the composer and stutters on hybrid devices.
 */
const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

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
 * values above ~1 (sun core, lava, hovered rims), then AgX maps to display: it rolls highlights
 * off without the hue skew ACES gives saturated lava, skies and accents.
 */
const Effects = () => {
  return (
    <>
      <AdaptiveDpr />
      <EffectComposer multisampling={COARSE ? 0 : 2}>
        <Bloom
          mipmapBlur
          luminanceThreshold={1}
          luminanceSmoothing={0.2}
          intensity={0.55}
          radius={0.72}
          levels={COARSE ? 4 : 5}
        />
        <ToneMapping mode={ToneMappingMode.AGX} />
        {/* AgX lands a touch flat; a little contrast brings the low-poly faces back apart */}
        <BrightnessContrast contrast={0.12} />
        <Vignette offset={0.36} darkness={0.38} />
        {COARSE ? <></> : <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.04} />}
      </EffectComposer>
    </>
  );
};

export default Effects;
