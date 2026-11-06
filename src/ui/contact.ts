import { create } from 'zustand';

interface ContactState {
  open: boolean;
  show: () => void;
  hide: () => void;
}

/** The contact sheet opened from the dash in orbit. */
export const useContact = create<ContactState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
