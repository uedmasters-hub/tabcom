const EMOJIS = [
  "😀", "😂", "🥹", "😍", "😎", "🤔", "😅", "🙌",
  "👍", "👎", "👏", "🙏", "💪", "🔥", "✨", "🎉",
  "❤️", "💙", "💯", "🎯", "🚀", "☕", "🍕", "🎧",
] as const;

export default function EmojiPicker({
  onPick,
}: {
  onPick: (emoji: string) => void;
}) {
  return (
    <div className="absolute bottom-14 left-2 z-10 grid grid-cols-8 gap-1 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-lg transition hover:bg-slate-100"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
