import { useAppStore } from '@/state/useAppStore';

const PlanetHud = () => {
  const mode = useAppStore((s) => s.mode);
  const isTouch = useAppStore((s) => s.isTouch);
  if (mode !== 'planet') return null;

  return (
    <div className="pointer-events-none fixed bottom-6 left-6 z-20 text-xs uppercase tracking-[0.3em] text-white/55">
      {isTouch ? (
        <span>Use ↺ to return</span>
      ) : (
        <>
          <span className="text-cosmos-accent">Q</span>
          <span className="text-white/40 mx-2">·</span>
          <span>exit</span>
        </>
      )}
    </div>
  );
};

export default PlanetHud;
