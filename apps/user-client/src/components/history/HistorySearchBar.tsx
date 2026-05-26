// SPDX-License-Identifier: AGPL-3.0-only

interface Props {
  value: string;
  onChange: (next: string) => void;
}

export function HistorySearchBar({ value, onChange }: Props): JSX.Element {
  return (
    <label className="block">
      <span className="sr-only">Search chats</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search chats by title…"
        className="w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-paper outline-none focus:border-paper-soft"
      />
    </label>
  );
}
