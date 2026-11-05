import { setSoundEnabled, useSoundEnabled } from '@/audio/drone';
import { Button } from './primitives';

/** Text toggle for the ambient drone; the choice is remembered. */
const SoundToggle = () => {
  const on = useSoundEnabled();
  return (
    <Button size="sm" aria-pressed={on} onClick={() => setSoundEnabled(!on)} className="max-sm:px-1.5">
      {on ? 'Sound on' : 'Sound off'}
    </Button>
  );
};

export default SoundToggle;
