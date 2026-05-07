import { useAppStore } from '@/state/useAppStore';
import { planetById } from '@/data/content';

const Crosshair = () => {
  const mode = useAppStore((s) => s.mode);
  const hoveredId = useAppStore((s) => s.hoveredPlanetId);
  if (mode !== 'overworld') return null;

  const hovered = hoveredId ? planetById(hoveredId) : undefined;
  const accent = hovered?.accent ?? 'rgba(255,255,255,0.7)';

  return (
    <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center">
      {/* small + crossbar */}
      <div className="relative" style={{ width: 22, height: 22 }}>
        <div
          className="absolute top-1/2 -translate-y-1/2 left-0 h-px"
          style={{ width: 8, background: accent, transition: 'background 200ms' }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 right-0 h-px"
          style={{ width: 8, background: accent, transition: 'background 200ms' }}
        />
        <div
          className="absolute left-1/2 -translate-x-1/2 top-0 w-px"
          style={{ height: 8, background: accent, transition: 'background 200ms' }}
        />
        <div
          className="absolute left-1/2 -translate-x-1/2 bottom-0 w-px"
          style={{ height: 8, background: accent, transition: 'background 200ms' }}
        />
      </div>

      {/* planet name floats just under the crosshair when targeted */}
      {hovered && (
        <div
          className="absolute text-center text-xs uppercase tracking-[0.3em]"
          style={{ top: 'calc(50% + 28px)', color: hovered.accent }}
        >
          {hovered.title}
        </div>
      )}
    </div>
  );
};

export default Crosshair;
