import { useEffect, useRef } from 'react';
import { PerformanceMonitor, type PerformanceMonitorApi } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Bloom, BrightnessContrast, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { BlendFunction, ToneMappingMode } from 'postprocessing';
import { useAppStore } from '@/state/useAppStore';
import { qualityForced, rememberLow } from '@/scenes/gpuTier';

/**
 * Decided once at load and never changed: switching multisampling or effect
 * children later rebuilds the composer and stutters on hybrid devices.
 */
const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

/** Highest pixel ratio per tier (the canvas default) */
export const DPR_TOP = { high: 1.75, low: 1 } as const;
/** Lowest pixel ratio per tier: the high tier gives up its tier before going under 1x */
const FLOOR = { high: 1, low: 0.75 } as const;
/** Mean fps under which a decline at the floor counts against the tier */
const STRIKE_FPS = 30;
/** Strikes at the floor before the high tier steps down to low */
const STRIKES = 2;

/**
 * Keeps the frame rate up during the visit without ever recompiling mid-scene:
 *   1. the pixel ratio slides between the canvas default and the tier floor as fps falls and recovers;
 *   2. the high tier still too slow at its floor steps down to low, but only in orbit, so the
 *      recompile it causes never lands during a dive or on a planet; the next visit starts low.
 */
const Governor = ({ tier }: { tier: 'high' | 'low' }) => {
  const setDpr = useThree((s) => s.setDpr);
  const top = Math.min(DPR_TOP[tier], window.devicePixelRatio || 1);
  const floor = Math.min(FLOOR[tier], top);
  const strikes = useRef(0);
  const due = useRef(false);

  const stepDown = () => {
    if (!due.current || useAppStore.getState().mode !== 'overworld') return;
    due.current = false;
    rememberLow();
    useAppStore.getState().setQuality('low');
  };

  // a step down that came due away from orbit waits for the return
  useEffect(() => (tier === 'high' ? useAppStore.subscribe(stepDown) : undefined), [tier]);

  const onChange = ({ factor }: PerformanceMonitorApi) => setDpr(floor + (top - floor) * factor);
  const onDecline = (api: PerformanceMonitorApi) => {
    if (tier !== 'high' || qualityForced || api.factor > 0) return;
    const mean = api.averages.reduce((a, b) => a + b, 0) / Math.max(1, api.averages.length);
    if (mean >= STRIKE_FPS || (strikes.current += 1) < STRIKES) return;
    due.current = true;
    stepDown();
  };

  return <PerformanceMonitor factor={1} step={0.25} flipflops={8} onChange={onChange} onDecline={onDecline} />;
};

/**
 * HDR post chain for every mode. Scenes render linear HDR; bloom only catches
 * values above ~1 (sun core, lava, hovered rims), then AgX maps to display: it rolls highlights
 * off without the hue skew ACES gives saturated lava, skies and accents.
 */
const Effects = () => {
  // the frames drawn while loading under the loader are slow by nature: judge the frame rate only after
  const settled = useAppStore((s) => !s.intro && !s.warming);
  // the low tier (see gpuTier) is already at 1x pixels: no multisampling, a lighter bloom, no grain
  const low = useAppStore((s) => s.quality === 'low');
  const lean = COARSE || low;
  return (
    <>
      {/* keyed so a tier change starts the new tier's ladder from its own top */}
      {settled && <Governor key={low ? 'low' : 'high'} tier={low ? 'low' : 'high'} />}
      <EffectComposer multisampling={lean ? 0 : 2}>
        <Bloom
          mipmapBlur
          luminanceThreshold={0.9}
          luminanceSmoothing={0.25}
          intensity={0.7}
          radius={0.72}
          levels={low ? 3 : COARSE ? 4 : 5}
        />
        <ToneMapping mode={ToneMappingMode.AGX} />
        {/* AgX lands a touch flat; a little contrast brings the low-poly faces back apart */}
        <BrightnessContrast contrast={0.12} />
        <Vignette offset={0.36} darkness={0.38} />
        {lean ? <></> : <Noise blendFunction={BlendFunction.OVERLAY} opacity={0.04} />}
      </EffectComposer>
    </>
  );
};

export default Effects;
