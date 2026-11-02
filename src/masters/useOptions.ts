import { useStore } from '../store/StoreContext';
import { defaultsOf } from './optionLists';

/** the items of an editable drop-down list: what the user saved in Settings → Drop-down Lists, else the built-in list */
export function useOptions(key: string): string[] {
  const { masters } = useStore();
  return masters.options[key] ?? defaultsOf(key);
}
